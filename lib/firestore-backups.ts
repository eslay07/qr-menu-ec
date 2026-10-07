import { z } from 'zod';
import { Catalog, Settings } from './contracts';
import { digest } from './security';
import type { Store } from './store';
import { businessSnapshot } from './firestore-business';
import { FirestoreOrderStore } from './firestore-orders';
import { FirestoreRest, firestoreId, firestoreHashId } from './firestore-rest';
import { FirestoreRestaurantStore } from './firestore-store';
import type { FirestoreWrite } from './firestore-rest';
import type { OrderRecord } from './orders';

const Snapshot = z.object({
  schemaVersion: z.literal(3), sourceId: z.string(),
  draft: Catalog, settings: Settings,
  published: z.object({ version: z.number().int(), at: z.string(), catalog: Catalog, mode: z.string().optional(), settings: Settings.optional() }).nullable(),
  orders: z.array(z.record(z.string(), z.unknown())).max(10_000),
  orderTokens: z.array(z.object({ hash: z.string().min(1).max(256), restaurantId: z.string(), orderId: z.string(), expiresAt: z.string().datetime() }).strict()).max(10_000).default([]),
  media: z.array(z.object({ id: z.string().uuid(), type: z.enum(['image/jpeg', 'image/png', 'image/webp']), content: z.string().max(1_400_000), checksum: z.string() }).strict()).max(320).default([]),
  preferences: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
}).strict();
type Manifest = { status: 'verified'; checksum: string; chunks: number; revision: number; createdAt: string; orderCount: number; mediaBridgeRequired: boolean };

// Local migration snapshot service. Image bytes remain in the existing media
// provider until Step 5. Manifests explicitly disclose that dependency.
export class FirestoreBackupRepository {
  readonly path: string;
  constructor(private db: FirestoreRest, private restaurantId: string, private store: Store) {
    this.path = `restaurants/${firestoreId(restaurantId)}/backups`;
  }
  async create() {
    const capture = await this.db.consistentRead(async db => {
      const before = await new FirestoreRestaurantStore(db, this.restaurantId, this.store).read();
      if (!before || before.state.restaurantId !== this.restaurantId) throw Error('Restaurante no disponible.');
      const orders = await new FirestoreOrderStore(db).exportRecords(this.restaurantId);
      const orderTokens: Array<{ hash: string; restaurantId: string; orderId: string; expiresAt: string }> = [];
      let tokenCursor: string | undefined;
      for (;;) {
        const rows = await db.query<{ restaurantId: string; orderId: string; expiresAt: string }>('platformConfig/orderTokens/entries', [{ field: 'restaurantId', value: this.restaurantId }], 200, { orderBy: [{ field: '__name__', direction: 'ASCENDING' }], ...(tokenCursor ? { startAfter: [{ reference: tokenCursor }] } : {}) });
        orderTokens.push(...rows.map(row => ({ hash: row.path.split('/').pop()!, ...row.data })));
        if (orderTokens.length > 10000) throw Error('Demasiados enlaces para un respaldo atómico.');
        if (rows.length < 200) break;
        tokenCursor = rows[rows.length - 1].path;
      }
      const preferences: Record<string, Record<string, unknown>> = {};
      for (const key of ['general', 'notifications', 'print']) {
        const row = await db.get(`restaurants/${this.restaurantId}/settings/${key}`);
        if (row) preferences[key] = row.data;
      }
      return { before, orders, orderTokens, preferences };
    });
    const { before, orders, orderTokens, preferences } = capture;
    const media = [];
    const refs = JSON.stringify([before.state.draft, before.state.published?.catalog]);
    const ids = new Set([...refs.matchAll(/\/media\/([0-9a-f-]{36})/gi)].map(match => match[1]));
    for (const id of ids) {
      const item = await this.store.mediaGet(id);
      if (!item || item.bytes.length > 1_048_576) throw Error('Imagen ausente o excesiva: respaldo rechazado.');
      const content = encodeBytes(item.bytes);
      media.push({ id, type: item.type, content, checksum: await digest(content) });
    }
    const snapshot = Snapshot.parse({ ...businessSnapshot(before.state), orders, orderTokens, media, preferences });
    const payload = JSON.stringify(snapshot);
    if (new TextEncoder().encode(payload).length > 32_000_000) throw Error('El respaldo requiere exportación por lotes.');
    const id = crypto.randomUUID();
    const chunks = payload.match(/[\s\S]{1,100000}/gu) || [];
    const writes = chunks.map((content, i) => ({ path: `${this.path}/${id}/chunks/${String(i).padStart(4, '0')}`, data: { content }, exists: false }));
    await this.db.commit([{ path: `${this.path}/${id}`, data: { status: 'staging', createdAt: new Date(), revision: before.revision, mediaBridgeRequired: false }, exists: false }]);
    for (let offset = 0; offset < writes.length; offset += 10) await this.db.commit(writes.slice(offset, offset + 10));
    const checksum = await digest(payload);
    // Read back every chunk before the manifest can be marked verified.
    const saved = await this.db.all<{ content: string }>(`${this.path}/${id}/chunks`, 400);
    if (await digest(saved.sort((a, b) => a.path.localeCompare(b.path)).map(row => row.data.content).join('')) !== checksum) throw Error('No se pudo verificar el respaldo.');
    await this.db.commit([{ path: `${this.path}/${id}`, data: { status: 'verified', createdAt: new Date(), checksum, chunks: chunks.length, revision: before.revision, orderCount: orders.length, mediaCount: media.length, mediaBridgeRequired: false } }]);
    return id;
  }
  async read(id: string) {
    const path = `${this.path}/${firestoreId(id)}`;
    const manifest = await this.db.get<Manifest>(path);
    if (manifest?.data.status !== 'verified') throw Error('Respaldo no verificado.');
    const chunks = await this.db.all<{ content: string }>(`${path}/chunks`, 400);
    const payload = chunks.sort((a, b) => a.path.localeCompare(b.path)).map(row => row.data.content).join('');
    if (chunks.length !== manifest.data.chunks || await digest(payload) !== manifest.data.checksum) throw Error('Respaldo incompleto o alterado.');
    const snapshot = Snapshot.parse(JSON.parse(payload));
    if (snapshot.sourceId !== this.restaurantId) throw Error('Respaldo de otro restaurante.');
    for (const image of snapshot.media) {
      if (await digest(image.content) !== image.checksum || atob(image.content).length > 1_048_576) throw Error('Imagen de respaldo alterada.');
    }
    return snapshot;
  }
  async automatic(now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    const markerPath = `restaurants/${this.restaurantId}/private/automaticBackup`;
    const marker = await this.db.get(markerPath);
    if (marker?.data.day === day) return null;
    const id = await this.create();
    await this.db.commit([{ path: markerPath, data: { day, backupId: id, verifiedAt: now }, ...(marker ? { updateTime: marker.updateTime } : { exists: false }) }]);
    return id;
  }
  async restoreComplete(id: string, expectedRevision: number) {
    if (!(this.store instanceof FirestoreRestaurantStore)) throw Error('Restauración completa requiere el repositorio Firestore.');
    const snapshot = await this.read(id);
    const current = await this.store.read();
    if (!current || current.revision !== expectedRevision) return false;
    const writes: FirestoreWrite[] = [];
    for (const raw of snapshot.orders) {
      const order = raw as unknown as OrderRecord;
      if (order.restaurantId !== this.restaurantId || !Array.isArray(order.lines) || order.lines.length > 100) throw Error('Pedido fuera de ámbito o inválido.');
      const path = `restaurants/${this.restaurantId}/orders/${firestoreId(order.id)}`;
      const existing = await this.db.get(path);
      if (existing) {
        const complete = await new FirestoreOrderStore(this.db).read(this.restaurantId, order.id);
        const { lines: expectedLines, ...expectedHeader } = order;
        const { lines: actualLines, ...actualHeader } = complete!;
        if (stable(actualHeader) !== stable(expectedHeader) || actualLines.some(line => !expectedLines.some(expected => stable(line) === stable(expected)))) throw Error('El historial cambió desde el respaldo. No se sobrescribirán pedidos.');
        writes.push({ path, data: {}, mask: [], updateTime: existing.updateTime });
        for (const [sortOrder, line] of expectedLines.entries()) if (!actualLines.some(actual => actual.id === line.id)) writes.push({ path: `${path}/lines/${firestoreId(line.id)}`, data: { ...line, sortOrder }, exists: false });
      } else {
        const { lines, ...header } = order;
        writes.push({ path, data: { ...header, createdAt: new Date(order.createdAt), publicExpiresAt: new Date(order.publicExpiresAt), cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null }, exists: false });
        for (const [sortOrder, line] of lines.entries()) writes.push({ path: `${path}/lines/${firestoreId(line.id)}`, data: { ...line, sortOrder }, exists: false });
      }
    }
    const orderIds = new Set(snapshot.orders.map(order => order.id));
    for (const token of snapshot.orderTokens) {
      if (token.restaurantId !== this.restaurantId || !orderIds.has(token.orderId)) throw Error('Enlace de pedido fuera del respaldo.');
      // Never resurrect links after their privacy deadline.
      if (Date.parse(token.expiresAt) <= Date.now()) continue;
      const path = `platformConfig/orderTokens/entries/${firestoreHashId(token.hash)}`;
      const existing = await this.db.get(path);
      const { hash: _hash, ...data } = token;
      if (existing && stable(existing.data) !== stable(data)) throw Error('Un enlace existente pertenece a otros datos; no se sobrescribirá.');
      if (!existing) writes.push({ path, data: { ...data, expiresAt: new Date(data.expiresAt) }, exists: false });
    }
    // Fail before any live-state mutation; never split a restore into partial commits.
    if (writes.length > 380 || new TextEncoder().encode(JSON.stringify(writes)).length > 4_000_000) throw Error('Restauración excede el límite atómico; requiere ensayo de recuperación por lotes asistido.');
    for (const image of snapshot.media) {
      const existing = await this.store.mediaGet(image.id);
      if (existing && (existing.type !== image.type || await digest(encodeBytes(existing.bytes)) !== image.checksum)) throw Error('Una imagen existente cambió; no se sobrescribirá.');
    }
    for (const image of snapshot.media) if (!await this.store.mediaGet(image.id)) await this.store.mediaPut(image.id, Uint8Array.from(atob(image.content), char => char.charCodeAt(0)), image.type);
    current.state.draft = snapshot.draft;
    current.state.settings = { ...snapshot.settings, webUrl: current.state.settings.webUrl, ordersEnabled: snapshot.settings.ordersEnabled && !!current.state.access?.features?.includes('orders') };
    current.state.published = snapshot.published ? { ...snapshot.published, version: (current.state.published?.version || 0) + 1, at: new Date().toISOString() } : current.state.published;
    for (const key of ['notifications', 'print']) if (snapshot.preferences[key]) writes.push({ path: `restaurants/${this.restaurantId}/settings/${key}`, data: snapshot.preferences[key] });
    // General settings contain encrypted WiFi, not identity or privilege grants.
    const wifi = snapshot.preferences.general;
    if (wifi) writes.push({ path: `restaurants/${this.restaurantId}/settings/general`, data: { wifiEnabled: wifi.wifiEnabled ?? false, wifiName: wifi.wifiName ?? '', wifiCiphertext: wifi.wifiCiphertext ?? null }, mask: ['wifiEnabled', 'wifiName', 'wifiCiphertext'] });
    return this.store.commit(current.state, expectedRevision, writes);
  }
  async restoreDraft(id: string, expectedRevision: number) {
    const snapshot = await this.read(id);
    const current = await this.store.read();
    if (!current || current.revision !== expectedRevision) return false;
    // Do not reinstate privileges, secrets, sessions or overwrite order history.
    current.state.draft = snapshot.draft;
    current.state.settings = { ...snapshot.settings, webUrl: current.state.settings.webUrl, ordersEnabled: snapshot.settings.ordersEnabled && !!current.state.access?.features?.includes('orders') };
    return this.store.commit(current.state, expectedRevision);
  }
}
function encodeBytes(bytes: Uint8Array) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}
