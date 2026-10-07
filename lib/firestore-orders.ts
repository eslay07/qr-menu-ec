import type { OrderRecord, OrderStore, OrderLineSnapshot } from './orders';
import { FirestoreError, FirestoreRest, firestoreId, firestoreHashId, type FirestoreData } from './firestore-rest';
import { NotificationSettings } from './restaurant-preferences';
import { pushJob } from './firestore-push';

type Header = Omit<OrderRecord, 'lines'>;
export class FirestoreOrderStore implements OrderStore {
  constructor(readonly db: FirestoreRest) {}
  private path(restaurantId: string, orderId: string) { return `restaurants/${firestoreId(restaurantId)}/orders/${firestoreId(orderId)}`; }
  async create(order: OrderRecord, tokenHash: string, emitNotification = true) {
    if (order.lines.length < 1 || order.lines.length > 100 || new Set(order.lines.map(line => line.id)).size !== order.lines.length) throw Error('Líneas de pedido inválidas.');
    const path = this.path(order.restaurantId, order.id);
    const { lines, ...header } = order;
    const preferences = NotificationSettings.parse((await this.db.get(`restaurants/${firestoreId(order.restaurantId)}/settings/notifications`))?.data || {});
    if (!emitNotification) preferences.newOrder = false;
    await this.db.commit([
      { path, data: { ...header, createdAt: new Date(order.createdAt), publicExpiresAt: new Date(order.publicExpiresAt), cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null }, exists: false },
      ...lines.map((line, sortOrder) => ({ path: `${path}/lines/${firestoreId(line.id)}`, data: { ...line, sortOrder }, exists: false })),
      // Private lookup preserves old opaque report links, never public reads.
      { path: `platformConfig/orderTokens/entries/${firestoreHashId(tokenHash)}`, data: { restaurantId: order.restaurantId, orderId: order.id, expiresAt: new Date(order.publicExpiresAt) }, exists: false },
      ...(!order.demo && preferences.newOrder ? [{ path: `restaurants/${order.restaurantId}/notifications/${order.id}`, data: { id: order.id, kind: 'order', title: 'Nuevo pedido recibido', message: `${order.number} · USD ${(order.totalCents / 100).toFixed(2)}`, read: false, createdAt: new Date(order.createdAt) }, exists: false }] : []),
      ...(!order.demo && preferences.newOrder ? [pushJob(order.restaurantId, order.id, 'newOrder', new Date(order.createdAt))] : []),
    ]);
  }
  async read(restaurantId: string, orderId: string): Promise<OrderRecord | null> {
    const path = this.path(restaurantId, orderId);
    const header = await this.db.get<Header>(path);
    if (!header) return null;
    if (header.data.restaurantId !== restaurantId || header.data.id !== orderId) throw Error('Pedido fuera de ámbito.');
    const lines = await this.db.all<OrderLineSnapshot & { sortOrder: number }>(`${path}/lines`, 100);
    return { ...header.data, lines: lines.map(row => row.data).sort((a, b) => a.sortOrder - b.sortOrder).map(({ sortOrder: _sortOrder, ...line }) => line) };
  }
  async publicByTokenHash(tokenHash: string) {
    const reservation = await this.db.get<{ restaurantId: string; orderId: string; expiresAt: string }>(`platformConfig/orderTokens/entries/${firestoreHashId(tokenHash)}`);
    if (!reservation || Date.parse(reservation.data.expiresAt) <= Date.now()) return null;
    return this.read(reservation.data.restaurantId, reservation.data.orderId);
  }
  async list(restaurantId: string, filters: NonNullable<Parameters<OrderStore['list']>[1]> = {}) {
    const path = `restaurants/${firestoreId(restaurantId)}/orders`;
    const clauses: Array<{ field: string; value: unknown; op?: string }> = [{ field: 'demo', value: false }];
    if (filters.status) clauses.push({ field: 'status', value: filters.status });
    if (filters.from) clauses.push({ field: 'createdAt', op: 'GREATER_THAN_OR_EQUAL', value: new Date(filters.from) });
    if (filters.to) clauses.push({ field: 'createdAt', op: 'LESS_THAN_OR_EQUAL', value: new Date(filters.to) });
    const query = filters.query?.normalize('NFKC').toLocaleLowerCase('es');
    const limit = Math.max(1, Math.min(10_000, filters.limit ?? 10_000));
    const selected: Header[] = [];
    let cursor: Array<{ value?: unknown; reference?: string }> | undefined;
    let scanned = 0;
    for (;;) {
      const rows = await this.db.query<Header>(path, clauses, 200, {
        orderBy: [{ field: 'createdAt', direction: 'DESCENDING' }, { field: '__name__', direction: 'ASCENDING' }],
        startAfter: cursor,
      });
      if (!rows.length) break;
      for (const row of rows) {
        if (++scanned > 10_000) throw Error('La búsqueda es demasiado amplia. Reduce el intervalo de fechas.');
        const order = row.data;
        if (!query || `${order.number} ${order.alias}`.normalize('NFKC').toLocaleLowerCase('es').includes(query)) selected.push(order);
        if (selected.length === limit) break;
      }
      if (selected.length === limit || rows.length < 200) break;
      const last = rows[rows.length - 1];
      cursor = [{ value: new Date(last.data.createdAt) }, { reference: last.path }];
    }
    const result: OrderRecord[] = [];
    for (const header of selected) {
      const order = await this.read(restaurantId, header.id);
      if (order) result.push(order);
    }
    return result;
  }
  async setStatus(restaurantId: string, id: string, status: 'cancelled', actor: 'owner' | 'customer' = 'owner') {
    const path = this.path(restaurantId, id);
    const header = await this.db.get<Header>(path);
    if (!header || header.data.restaurantId !== restaurantId || header.data.status !== 'confirmed') return false;
    const preferences = NotificationSettings.parse((await this.db.get(`restaurants/${firestoreId(restaurantId)}/settings/notifications`))?.data || {});
    const notificationId = crypto.randomUUID();
    if (actor !== 'customer') preferences.customerCancelled = false;
    try {
      await this.db.commit([{ path, data: { status, cancelledAt: new Date() }, mask: ['status', 'cancelledAt'], updateTime: header.updateTime },
        ...(preferences.customerCancelled ? [{ path: `restaurants/${restaurantId}/notifications/${notificationId}`, data: { id: notificationId, kind: 'order', title: 'Pedido cancelado por el comensal', message: `El comensal canceló ${header.data.number} · USD ${(header.data.totalCents / 100).toFixed(2)}. El pedido se conserva en el historial.`, read: false, createdAt: new Date() }, exists: false }] : []),
        ...(preferences.customerCancelled && !header.data.demo ? [pushJob(restaurantId, notificationId, 'customerCancelled')] : []),
      ]);
      return true;
    } catch (error) { if (error instanceof FirestoreError && error.conflict) return false; throw error; }
  }
  async exportRecords(restaurantId: string): Promise<FirestoreData[]> {
    const rows = await this.db.all<Header>(`restaurants/${firestoreId(restaurantId)}/orders`, 10_000);
    const records: FirestoreData[] = [];
    for (const row of rows) records.push((await this.read(restaurantId, row.data.id))! as unknown as FirestoreData);
    return records;
  }
}
