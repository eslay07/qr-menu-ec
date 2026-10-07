import { blankCatalog, defaultSettings, normalizeCatalog, normalizeSettings, type Catalog } from './contracts';
import type { State, Store, Stored } from './store';
import { FirestoreError, FirestoreRest, firestoreId, firestoreHashId, type FirestoreData, type FirestoreWrite } from './firestore-rest';
import { NotificationSettings } from './restaurant-preferences';
import { pushJob } from './firestore-push';

type RestaurantDocument = {
  revision: number; restaurantId: string; name: string; tagline: string;
  draftCatalogId: string; publishedCatalogId: string | null;
  published: Omit<NonNullable<State['published']>, 'catalog'> | null;
  access: NonNullable<State['access']>; createdAt: string;
};
type PrivateState = Omit<State, 'draft' | 'settings' | 'published' | 'access' | 'createdAt'>;
const date = (value: string) => new Date(value);
const data = (value: object) => value as FirestoreData;
export class FirestoreRestaurantStore implements Store {
  readonly path: string;
  constructor(readonly db: FirestoreRest, readonly restaurantId: string, private media: Pick<Store, 'mediaGet' | 'mediaPut'>) {
    this.path = `restaurants/${firestoreId(restaurantId)}`;
  }
  private catalogWrites(path: string, catalog: Catalog): FirestoreWrite[] {
    const { categories, dishes, promotions, ...header } = catalog;
    return [{ path, data: header, exists: false }, ...(['categories', 'dishes', 'promotions'] as const).flatMap(collection =>
      ({ categories, dishes, promotions }[collection]).map((item, sortOrder) => ({ path: `${path}/${collection}/${firestoreId(item.id)}`, data: { ...item, sortOrder }, exists: false })))];
  }
  private async catalog(id: string): Promise<Catalog> {
    const path = `${this.path}/catalogs/${firestoreId(id)}`;
    const [header, categories, dishes, promotions] = await Promise.all([
      this.db.get(path), this.db.all(`${path}/categories`, 30), this.db.all(`${path}/dishes`, 150), this.db.all(`${path}/promotions`, 8),
    ]);
    if (!header) throw Error('Catálogo incompleto. No se aplicó ningún cambio.');
    const ordered = (items: typeof categories) => items.map(item => item.data).sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)).map(({ sortOrder: _sortOrder, ...item }) => item);
    return normalizeCatalog({ ...header.data, categories: ordered(categories), dishes: ordered(dishes), promotions: ordered(promotions) });
  }
  async read(): Promise<Stored | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const root = await this.db.get<RestaurantDocument>(this.path);
      if (!root) return null;
      const [privateState, settings, draft, publishedCatalog] = await Promise.all([
        this.db.get<PrivateState>(`${this.path}/private/auth`),
        this.db.get(`${this.path}/settings/general`),
        this.catalog(root.data.draftCatalogId),
        root.data.publishedCatalogId ? this.catalog(root.data.publishedCatalogId) : null,
      ]);
      const current = await this.db.get(this.path);
      if (current?.updateTime !== root.updateTime) continue;
      if (!privateState || !settings) throw Error('Restaurante incompleto.');
      return { revision: root.data.revision, state: {
        ...privateState.data, restaurantId: this.restaurantId,
        createdAt: root.data.createdAt, access: root.data.access,
        draft, settings: normalizeSettings(settings.data),
        published: root.data.published && publishedCatalog ? { ...root.data.published, catalog: publishedCatalog } : null,
      } };
    }
    throw Error('El restaurante está cambiando. Intenta nuevamente.');
  }
  // Session probes must never hydrate either catalog or expose its draft.
  async readSession(): Promise<Stored | null> {
    const root = await this.db.get<RestaurantDocument>(this.path);
    if (!root) return null;
    const auth = await this.db.get<PrivateState>(`${this.path}/private/auth`);
    if (!auth) throw Error('Restaurante incompleto.');
    return { revision: root.data.revision, state: {
      ...auth.data, restaurantId: this.restaurantId, createdAt: root.data.createdAt,
      access: root.data.access, draft: structuredClone(blankCatalog), settings: structuredClone(defaultSettings), published: null,
    } };
  }
  async readMenu(): Promise<Stored | null> {
    const root = await this.db.get<RestaurantDocument>(this.path);
    if (!root) return null;
    const [settings, catalog] = await Promise.all([
      this.db.get(`${this.path}/settings/general`),
      root.data.publishedCatalogId ? this.catalog(root.data.publishedCatalogId) : null,
    ]);
    if (!settings) throw Error('Restaurante incompleto.');
    return { revision: root.data.revision, state: {
      schemaVersion: 1, restaurantId: this.restaurantId, ownerId: '', createdAt: root.data.createdAt,
      access: root.data.access, draft: structuredClone(blankCatalog), settings: normalizeSettings(settings.data),
      published: root.data.published && catalog ? { ...root.data.published, catalog } : null,
      license: null, password: { salt: '', hash: '', iterations: 0 }, recoveryHash: '',
      sessionEpoch: 0, failures: { count: 0, until: 0 },
    } };
  }
  async commit(input: State, revision: number | null, extraWrites: FirestoreWrite[] = []): Promise<boolean> {
    if (input.restaurantId !== this.restaurantId) throw Error('Restaurante incorrecto.');
    const state = structuredClone(input);
    state.draft = normalizeCatalog(state.draft);
    if (state.published) state.published.catalog = normalizeCatalog(state.published.catalog);
    const limit = state.access?.maxDishes ?? 150;
    if (!Number.isInteger(limit) || limit < 1 || limit > 150 || state.draft.dishes.length > limit || (state.published?.catalog.dishes.length || 0) > limit) throw Error('La carta supera el límite autorizado.');
    const root = await this.db.get<RestaurantDocument>(this.path);
    if (revision === null ? !!root : !root || root.data.revision !== revision) return false;
    const oldPrivate = await this.db.get<PrivateState>(`${this.path}/private/auth`);
    const existingDraft = root ? await this.catalog(root.data.draftCatalogId) : null;
    const changedDraft = !existingDraft || JSON.stringify(existingDraft) !== JSON.stringify(state.draft);
    const draftId = changedDraft ? `draft-${crypto.randomUUID()}` : root!.data.draftCatalogId;
    const changedPublished = state.published && (!root?.data.published || root.data.published.version !== state.published.version);
    if (state.published && root?.data.published && state.published.version < root.data.published.version) throw Error('La versión publicada no puede retroceder.');
    // Build private immutable versions first; readers only follow committed
    // root pointers. No partially staged catalog is placed in publicMenus.
    const publishedId = changedPublished ? `published-${state.published!.version}-${crypto.randomUUID()}` : root?.data.publishedCatalogId || null;
    if (changedDraft) await this.db.commit(this.catalogWrites(`${this.path}/catalogs/${draftId}`, state.draft));
    if (changedPublished) await this.db.commit(this.catalogWrites(`${this.path}/catalogs/${publishedId}`, state.published!.catalog));
    const { draft, published, settings, access, createdAt, ...privateState } = state;
    const { catalog: _catalog, ...publishedHeader } = published || { catalog: null };
    const writes: FirestoreWrite[] = [
      { path: this.path, data: { restaurantId: this.restaurantId, revision: revision === null ? 0 : revision + 1, name: draft.name, tagline: draft.tagline, draftCatalogId: draftId, publishedCatalogId: published ? publishedId : null, published: published ? { ...publishedHeader, at: date(published.at) } : null, access: { active: true, features: [], maxDishes: 150, sampleMenuEnabled: false, ...access }, createdAt: date(createdAt) }, ...(root ? { updateTime: root.updateTime } : { exists: false }) },
      { path: `${this.path}/private/auth`, data: data(privateState) },
      { path: `${this.path}/settings/general`, data: data(normalizeSettings(settings)), mask: ['webUrl', 'ordersEnabled'] },
    ];
    if (changedDraft && existingDraft) {
      const notificationSettings = NotificationSettings.parse((await this.db.get(`${this.path}/settings/notifications`))?.data || {});
      if (notificationSettings.soldOut) for (const dish of draft.dishes) {
        if (!dish.available && existingDraft.dishes.some(previous => previous.id === dish.id && previous.available)) {
          const id = crypto.randomUUID();
          writes.push({ path: `${this.path}/notifications/${id}`, data: { id, kind: 'sold_out', title: 'Producto agotado', message: dish.name, read: false, createdAt: new Date() }, exists: false });
          writes.push(pushJob(this.restaurantId, id, 'soldOut'));
        }
      }
    }
    const uid = state.security?.firebaseUid;
    const previousUid = oldPrivate?.data.security?.firebaseUid;
    if (uid) {
      writes.push({ path: `${this.path}/members/${firestoreId(uid)}`, data: { role: 'owner', active: access?.active !== false } });
      // Never overwrite user-editable displayName / locale on later saves.
      if (!await this.db.get(`users/${firestoreId(uid)}`)) writes.push({ path: `users/${uid}`, data: { displayName: '', locale: 'es-EC' }, exists: false });
    }
    if (previousUid && previousUid !== uid) writes.push({ path: `${this.path}/members/${firestoreId(previousUid)}`, data: { role: 'owner', active: false } });
    const emailHash = state.security?.emailHash;
    const previousEmailHash = oldPrivate?.data.security?.emailHash;
    if (emailHash) {
      const path = `platformConfig/ownerEmails/entries/${firestoreHashId(emailHash)}`;
      const reservation = await this.db.get<{ restaurantId: string }>(path);
      if (reservation && reservation.data.restaurantId !== this.restaurantId) throw Error('Ese correo ya tiene un restaurante asignado.');
      writes.push({ path, data: { restaurantId: this.restaurantId }, ...(reservation ? { updateTime: reservation.updateTime } : { exists: false }) });
    }
    if (previousEmailHash && previousEmailHash !== emailHash) writes.push({ path: `platformConfig/ownerEmails/entries/${firestoreHashId(previousEmailHash)}`, delete: true });
    if (changedPublished) {
      const publicPath = `publicMenus/${this.restaurantId}`;
      // Publish all documents + root pointer in the SAME atomic commit.
      writes.push(...this.catalogWrites(`${publicPath}/versions/${publishedId}`, published!.catalog));
      writes.push({ path: publicPath, data: { restaurantId: this.restaurantId, versionId: publishedId, version: published!.version, publishedAt: date(published!.at) } });
    }
    try { await this.db.commit([...writes, ...extraWrites]); return true; }
    catch (error) { if (error instanceof FirestoreError && error.conflict) return false; throw error; }
  }
  mediaGet(id: string) { return this.media.mediaGet(id); }
  mediaPut(id: string, bytes: Uint8Array, type: string) { return this.media.mediaPut(id, bytes, type); }
}
