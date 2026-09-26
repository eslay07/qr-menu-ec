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
  createdAt: text('created_at').notNull(),
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
