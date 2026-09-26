import { CreateOrderInput, type Catalog } from './contracts';
import { digest, randomToken } from './security';

export type OrderOptionSnapshot = {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDeltaCents: number;
};
export type OrderLineSnapshot = {
  id: string;
  dishId: string;
  dishName: string;
  quantity: number;
  basePriceCents: number;
  unitPriceCents: number;
  totalCents: number;
  note: string;
  options: OrderOptionSnapshot[];
};
export type OrderRecord = {
  id: string;
  restaurantId: string;
  number: string;
  status: 'confirmed' | 'cancelled';
  demo: boolean;
  alias: string;
  restaurantName: string;
  menuVersion: number;
  currency: 'USD';
  totalCents: number;
  createdAt: string;
  publicExpiresAt: string;
  cancelledAt: string | null;
  lines: OrderLineSnapshot[];
};

export type OrderReport = {
  confirmedOrders: number;
  cancelledOrders: number;
  totalCents: number;
  averageCents: number;
  dishes: Array<{
    id: string;
    name: string;
    quantity: number;
    totalCents: number;
  }>;
  options: Array<{ id: string; name: string; quantity: number }>;
  byDay: Array<{ day: string; orders: number; totalCents: number }>;
  byHour: Array<{ hour: number; orders: number }>;
};

export interface OrderStore {
  create(order: OrderRecord, tokenHash: string): Promise<void>;
  publicByTokenHash(tokenHash: string): Promise<OrderRecord | null>;
  list(
    restaurantId: string,
    filters?: {
      status?: string;
      from?: string;
      to?: string;
      query?: string;
      limit?: number;
    },
  ): Promise<OrderRecord[]>;
  setStatus(
    restaurantId: string,
    id: string,
    status: 'cancelled',
  ): Promise<boolean>;
}

export async function createOrderRecord(
  inputValue: unknown,
  catalog: Catalog,
  restaurantId: string,
  restaurantName: string,
  menuVersion: number,
  demo = false,
) {
  const input = CreateOrderInput.parse(inputValue);
  const lines: OrderLineSnapshot[] = input.lines.map((requested) => {
    const dish = catalog.dishes.find((item) => item.id === requested.dishId);
    if (!dish?.available)
      throw Error('Un plato del pedido ya no está disponible.');
    const requestedGroups = new Map(
      requested.selections.map((selection) => [
        selection.groupId,
        selection.optionIds,
      ]),
    );
    if (requestedGroups.size !== requested.selections.length)
      throw Error('Hay grupos de opciones duplicados.');
    const options: OrderOptionSnapshot[] = [];
    for (const group of dish.modifierGroups) {
      const optionIds = requestedGroups.get(group.id) || [];
      if (new Set(optionIds).size !== optionIds.length)
        throw Error(`Hay opciones repetidas en “${group.name}”.`);
      if (
        optionIds.length < group.minSelections ||
        optionIds.length > group.maxSelections
      )
        throw Error(`Revisa la selección de “${group.name}”.`);
      for (const optionId of optionIds) {
        const option = group.options.find((item) => item.id === optionId);
        if (!option?.available)
          throw Error(`Una opción de “${group.name}” ya no está disponible.`);
        options.push({
          groupId: group.id,
          groupName: group.name,
          optionId: option.id,
          optionName: option.name,
          priceDeltaCents: option.priceDeltaCents,
        });
      }
      requestedGroups.delete(group.id);
    }
    if (requestedGroups.size)
      throw Error('El pedido contiene opciones que no pertenecen al plato.');
    const unitPriceCents =
      dish.priceCents +
      options.reduce((sum, option) => sum + option.priceDeltaCents, 0);
    return {
      id: crypto.randomUUID(),
      dishId: dish.id,
      dishName: dish.name,
      quantity: requested.quantity,
      basePriceCents: dish.priceCents,
      unitPriceCents,
      totalCents: unitPriceCents * requested.quantity,
      note: requested.note.trim(),
      options,
    };
  });
  const token = randomToken() + randomToken();
  const now = new Date();
  const order: OrderRecord = {
    id: crypto.randomUUID(),
    restaurantId,
    number: `PED-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(
      Math.random() * 1_679_616,
    )
      .toString(36)
      .padStart(4, '0')
      .toUpperCase()}`,
    status: 'confirmed',
    demo,
    alias: input.alias.trim(),
    restaurantName,
    menuVersion,
    currency: 'USD',
    totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    createdAt: now.toISOString(),
    publicExpiresAt: new Date(
      now.getTime() + 24 * 60 * 60 * 1000,
    ).toISOString(),
    cancelledAt: null,
    lines,
  };
  return { order, token, tokenHash: await digest(token) };
}

export function reportFor(orders: OrderRecord[]): OrderReport {
  const confirmed = orders.filter(
    (order) => order.status === 'confirmed' && !order.demo,
  );
  const dishes = new Map<
    string,
    { id: string; name: string; quantity: number; totalCents: number }
  >();
  const options = new Map<
    string,
    { id: string; name: string; quantity: number }
  >();
  const byDay = new Map<
    string,
    { day: string; orders: number; totalCents: number }
  >();
  const byHour = new Map<number, { hour: number; orders: number }>();
  for (const order of confirmed) {
    const timestamp = new Date(order.createdAt);
    const dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Guayaquil',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(timestamp);
    const day = byDay.get(dayKey) || { day: dayKey, orders: 0, totalCents: 0 };
    day.orders++;
    day.totalCents += order.totalCents;
    byDay.set(dayKey, day);
    const hourKey =
      Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Guayaquil',
          hour: '2-digit',
          hour12: false,
        }).format(timestamp),
      ) % 24;
    const hour = byHour.get(hourKey) || { hour: hourKey, orders: 0 };
    hour.orders++;
    byHour.set(hourKey, hour);
    for (const line of order.lines) {
      const dish = dishes.get(line.dishId) || {
        id: line.dishId,
        name: line.dishName,
        quantity: 0,
        totalCents: 0,
      };
      dish.quantity += line.quantity;
      dish.totalCents += line.totalCents;
      dishes.set(line.dishId, dish);
      for (const selected of line.options) {
        const key = `${selected.groupId}:${selected.optionId}`;
        const option = options.get(key) || {
          id: key,
          name: `${selected.groupName}: ${selected.optionName}`,
          quantity: 0,
        };
        option.quantity += line.quantity;
        options.set(key, option);
      }
    }
  }
  const totalCents = confirmed.reduce(
    (sum, order) => sum + order.totalCents,
    0,
  );
  return {
    confirmedOrders: confirmed.length,
    cancelledOrders: orders.filter(
      (order) => order.status === 'cancelled' && !order.demo,
    ).length,
    totalCents,
    averageCents: confirmed.length
      ? Math.round(totalCents / confirmed.length)
      : 0,
    dishes: [...dishes.values()].sort(
      (a, b) => b.quantity - a.quantity || b.totalCents - a.totalCents,
    ),
    options: [...options.values()].sort((a, b) => b.quantity - a.quantity),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byHour: [...byHour.values()].sort((a, b) => a.hour - b.hour),
  };
}

export class D1OrderStore implements OrderStore {
  constructor(private db: D1Database) {}
  async create(order: OrderRecord, tokenHash: string) {
    await this.db
      .prepare(
        'INSERT INTO orders (id,restaurant_id,number,status,demo,alias,restaurant_name,menu_version,currency,total_cents,created_at,public_expires_at,public_token_hash,cancelled_at,snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        order.id,
        order.restaurantId,
        order.number,
        order.status,
        order.demo ? 1 : 0,
        order.alias,
        order.restaurantName,
        order.menuVersion,
        order.currency,
        order.totalCents,
        order.createdAt,
        order.publicExpiresAt,
        tokenHash,
        null,
        JSON.stringify(order.lines),
      )
      .run();
  }
  private row(value: Record<string, unknown>): OrderRecord {
    return {
      id: String(value.id),
      restaurantId: String(value.restaurant_id),
      number: String(value.number),
      status: value.status as 'confirmed' | 'cancelled',
      demo: Number(value.demo) === 1,
      alias: String(value.alias || ''),
      restaurantName: String(value.restaurant_name),
      menuVersion: Number(value.menu_version),
      currency: 'USD',
      totalCents: Number(value.total_cents),
      createdAt: String(value.created_at),
      publicExpiresAt: String(value.public_expires_at),
      cancelledAt: value.cancelled_at ? String(value.cancelled_at) : null,
      lines: JSON.parse(String(value.snapshot)) as OrderLineSnapshot[],
    };
  }
  async publicByTokenHash(tokenHash: string) {
    const row = await this.db
      .prepare('SELECT * FROM orders WHERE public_token_hash = ?')
      .bind(tokenHash)
      .first<Record<string, unknown>>();
    return row ? this.row(row) : null;
  }
  async list(
    restaurantId: string,
    filters: {
      status?: string;
      from?: string;
      to?: string;
      query?: string;
      limit?: number;
    } = {},
  ) {
    const clauses = ['restaurant_id = ?', 'demo = 0'],
      values: unknown[] = [restaurantId];
    if (filters.status) {
      clauses.push('status = ?');
      values.push(filters.status);
    }
    if (filters.from) {
      clauses.push('created_at >= ?');
      values.push(filters.from);
    }
    if (filters.to) {
      clauses.push('created_at <= ?');
      values.push(filters.to);
    }
    if (filters.query) {
      clauses.push('(number LIKE ? OR alias LIKE ?)');
      values.push(`%${filters.query}%`, `%${filters.query}%`);
    }
    const limit = filters.limit
      ? ` LIMIT ${Math.max(1, Math.min(10_000, Math.trunc(filters.limit)))}`
      : '';
    const result = await this.db
      .prepare(
        `SELECT * FROM orders WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC${limit}`,
      )
      .bind(...values)
      .all<Record<string, unknown>>();
    return result.results.map((row) => this.row(row));
  }
  async setStatus(restaurantId: string, id: string, status: 'cancelled') {
    const result = await this.db
      .prepare(
        "UPDATE orders SET status = ?, cancelled_at = ? WHERE id = ? AND restaurant_id = ? AND status = 'confirmed'",
      )
      .bind(status, new Date().toISOString(), id, restaurantId)
      .run();
    return result.meta.changes === 1;
  }
}
