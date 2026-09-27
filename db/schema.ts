import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const application = sqliteTable('application', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  data: text('data').notNull(),
});
export const restaurantHosts = sqliteTable('restaurant_hosts', {
  hostname: text('hostname').primaryKey(),
  restaurantId: text('restaurant_id').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  cloudflareId: text('cloudflare_id'),
  validationData: text('validation_data'),
  provider: text('provider').notNull().default('legacy'),
  serviceName: text('service_name'),
  priority: integer('priority').notNull().default(10),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

export const authSessions = sqliteTable('auth_sessions', {
  idHash: text('id_hash').primaryKey(),
  scope: text('scope').notNull(),
  restaurantId: text('restaurant_id'),
  csrfToken: text('csrf_token').notNull(),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  idleExpiresAt: text('idle_expires_at').notNull(),
  absoluteExpiresAt: text('absolute_expires_at').notNull(),
  revokedAt: text('revoked_at'),
});

export const authChallenges = sqliteTable('auth_challenges', {
  idHash: text('id_hash').primaryKey(),
  scope: text('scope').notNull(),
  restaurantId: text('restaurant_id'),
  kind: text('kind').notNull(),
  payload: text('payload').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
});

export const rateLimits = sqliteTable('rate_limits', {
  keyHash: text('key_hash').notNull(),
  bucket: text('bucket').notNull(),
  count: integer('count').notNull(),
  resetAt: text('reset_at').notNull(),
});

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  restaurantId: text('restaurant_id'),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  outcome: text('outcome').notNull(),
  durationMs: integer('duration_ms').notNull(),
  createdAt: text('created_at').notNull(),
  detail: text('detail'),
});

export const platformDomainConfig = sqliteTable('platform_domain_config', {
  id: text('id').primaryKey(),
  baseHostname: text('base_hostname'),
  zoneId: text('zone_id'),
  status: text('status').notNull(),
  validationData: text('validation_data'),
  updatedAt: text('updated_at').notNull(),
});
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  restaurantId: text('restaurant_id').notNull(),
  number: text('number').notNull(),
  status: text('status').notNull(),
  demo: integer('demo').notNull(),
  alias: text('alias').notNull(),
  restaurantName: text('restaurant_name').notNull(),
  menuVersion: integer('menu_version').notNull(),
  currency: text('currency').notNull(),
  totalCents: integer('total_cents').notNull(),
  createdAt: text('created_at').notNull(),
  publicExpiresAt: text('public_expires_at').notNull(),
  publicTokenHash: text('public_token_hash').notNull(),
  cancelledAt: text('cancelled_at'),
  snapshot: text('snapshot').notNull(),
});
