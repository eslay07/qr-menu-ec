CREATE TABLE IF NOT EXISTS `restaurant_hosts` (
  `hostname` text PRIMARY KEY NOT NULL,
  `restaurant_id` text NOT NULL,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `cloudflare_id` text,
  `validation_data` text,
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `restaurant_hosts_restaurant_kind_idx` ON `restaurant_hosts` (`restaurant_id`, `kind`);

CREATE TABLE IF NOT EXISTS `orders` (
  `id` text PRIMARY KEY NOT NULL,
  `restaurant_id` text NOT NULL,
  `number` text NOT NULL,
  `status` text NOT NULL,
  `demo` integer NOT NULL DEFAULT 0,
  `alias` text NOT NULL DEFAULT '',
  `restaurant_name` text NOT NULL,
  `menu_version` integer NOT NULL,
  `currency` text NOT NULL DEFAULT 'USD',
  `total_cents` integer NOT NULL,
  `created_at` text NOT NULL,
  `public_expires_at` text NOT NULL,
  `public_token_hash` text NOT NULL UNIQUE,
  `cancelled_at` text,
  `snapshot` text NOT NULL
);
CREATE INDEX IF NOT EXISTS `orders_restaurant_created_idx` ON `orders` (`restaurant_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `orders_restaurant_status_idx` ON `orders` (`restaurant_id`, `status`);
