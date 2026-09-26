import { z } from 'zod';

export type DomainEnv = {
  DB: D1Database;
  PLATFORM_MENU_DOMAIN?: string;
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_CNAME_TARGET?: string;
};
export type DomainRecord = {
  hostname: string;
  restaurantId: string;
  kind: 'free' | 'custom';
  status: string;
  cloudflareId: string | null;
  validation: unknown;
};

const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,63}$/,
    'Usa un subdominio como menu.restaurante.com.',
  );
export function slugFor(value: string) {
  return (
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'restaurante'
  );
}

export class DomainService {
  constructor(private env: DomainEnv) {}
  async provisionFree(
    restaurantId: string,
    name: string,
    fallbackOrigin: string,
  ) {
    const existing = await this.env.DB.prepare(
      "SELECT hostname FROM restaurant_hosts WHERE restaurant_id = ? AND kind = 'free'",
    )
      .bind(restaurantId)
      .first<{ hostname: string }>();
    if (existing) return `https://${existing.hostname}/menu`;
    if (!this.env.PLATFORM_MENU_DOMAIN)
      return `${fallbackOrigin}/r/${restaurantId}/menu`;
    const base = slugFor(name),
      domain = this.env.PLATFORM_MENU_DOMAIN.toLowerCase();
    let hostname = '';
    for (const length of [0, 6, 8, 10, 12, 16, 32]) {
      const candidate = length
        ? `${base}-${restaurantId.replace(/-/g, '').slice(0, length)}.${domain}`
        : `${base}.${domain}`;
      const collision = await this.env.DB.prepare(
        'SELECT 1 AS found FROM restaurant_hosts WHERE hostname = ?',
      )
        .bind(candidate)
        .first();
      if (!collision) {
        hostname = candidate;
        break;
      }
    }
    if (!hostname) throw Error('No se pudo reservar la dirección gratuita.');
    await this.env.DB.prepare(
      "INSERT INTO restaurant_hosts (hostname,restaurant_id,kind,status,created_at) VALUES (?,?,?,'active',?)",
    )
      .bind(hostname, restaurantId, 'free', new Date().toISOString())
      .run();
    return `https://${hostname}/menu`;
  }
  private map(row: Record<string, unknown>): DomainRecord {
    return {
      hostname: String(row.hostname),
      restaurantId: String(row.restaurant_id),
      kind: row.kind as 'free' | 'custom',
      status: String(row.status),
      cloudflareId: row.cloudflare_id ? String(row.cloudflare_id) : null,
      validation: row.validation_data
        ? JSON.parse(String(row.validation_data))
        : null,
    };
  }
  async get(restaurantId: string) {
    const rows = await this.env.DB.prepare(
      'SELECT * FROM restaurant_hosts WHERE restaurant_id = ? ORDER BY kind',
    )
      .bind(restaurantId)
      .all<Record<string, unknown>>();
    const records = rows.results.map((row) => this.map(row));
    return {
      free: records.find((item) => item.kind === 'free') || null,
      custom: records.find((item) => item.kind === 'custom') || null,
      cnameTarget: this.env.CLOUDFLARE_CNAME_TARGET || null,
    };
  }
  private async cloudflare(path: string, init?: RequestInit) {
    if (!this.env.CLOUDFLARE_ZONE_ID || !this.env.CLOUDFLARE_API_TOKEN)
      throw Error('Cloudflare for SaaS no está configurado.');
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${this.env.CLOUDFLARE_ZONE_ID}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      },
    );
    const value = (await response.json()) as {
      success: boolean;
      result?: Record<string, unknown>;
      errors?: Array<{ message: string }>;
    };
    if (!response.ok || !value.success)
      throw Error(
        value.errors?.map((item) => item.message).join(' ') ||
          'Cloudflare no pudo completar la operación.',
      );
    return value.result || {};
  }
  async put(restaurantId: string, value: unknown) {
    const hostname = hostnameSchema.parse(value);
    if (
      this.env.PLATFORM_MENU_DOMAIN &&
      hostname.endsWith(`.${this.env.PLATFORM_MENU_DOMAIN.toLowerCase()}`)
    )
      throw Error('Ese nombre pertenece al dominio gratuito de la plataforma.');
    const duplicate = await this.env.DB.prepare(
      'SELECT restaurant_id FROM restaurant_hosts WHERE hostname = ?',
    )
      .bind(hostname)
      .first<{ restaurant_id: string }>();
    if (duplicate && duplicate.restaurant_id !== restaurantId)
      throw Error('Ese dominio ya pertenece a otro restaurante.');
    const current = await this.env.DB.prepare(
      "SELECT hostname,cloudflare_id FROM restaurant_hosts WHERE restaurant_id = ? AND kind = 'custom'",
    )
      .bind(restaurantId)
      .first<{ hostname: string; cloudflare_id: string | null }>();
    if (current?.hostname === hostname) return this.get(restaurantId);
    const result = await this.cloudflare('/custom_hostnames', {
      method: 'POST',
      body: JSON.stringify({
        hostname,
        ssl: {
          method: 'http',
          type: 'dv',
          settings: { min_tls_version: '1.2' },
        },
      }),
    });
    if (current?.cloudflare_id)
      await this.cloudflare(`/custom_hostnames/${current.cloudflare_id}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    await this.env.DB.prepare(
      "DELETE FROM restaurant_hosts WHERE restaurant_id = ? AND kind = 'custom'",
    )
      .bind(restaurantId)
      .run();
    await this.env.DB.prepare(
      "INSERT INTO restaurant_hosts (hostname,restaurant_id,kind,status,cloudflare_id,validation_data,created_at) VALUES (?,?,'custom',?,?,?,?)",
    )
      .bind(
        hostname,
        restaurantId,
        String(result.status || 'pending_validation'),
        String(result.id || ''),
        JSON.stringify(result),
        new Date().toISOString(),
      )
      .run();
    return this.get(restaurantId);
  }
  async verify(restaurantId: string) {
    const current = await this.env.DB.prepare(
      "SELECT * FROM restaurant_hosts WHERE restaurant_id = ? AND kind = 'custom'",
    )
      .bind(restaurantId)
      .first<Record<string, unknown>>();
    if (!current?.cloudflare_id)
      throw Error('Primero registra el dominio personalizado.');
    const result = await this.cloudflare(
      `/custom_hostnames/${current.cloudflare_id}`,
    );
    const ssl = result.ssl as Record<string, unknown> | undefined;
    const ready = result.status === 'active' && ssl?.status === 'active';
    await this.env.DB.prepare(
      'UPDATE restaurant_hosts SET status = ?, validation_data = ? WHERE hostname = ?',
    )
      .bind(
        ready ? 'active' : 'pending_validation',
        JSON.stringify(result),
        current.hostname,
      )
      .run();
    return this.get(restaurantId);
  }
}
