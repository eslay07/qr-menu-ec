ALTER TABLE `restaurant_hosts` ADD COLUMN `provider` text NOT NULL DEFAULT 'legacy';
ALTER TABLE `restaurant_hosts` ADD COLUMN `service_name` text;
ALTER TABLE `restaurant_hosts` ADD COLUMN `priority` integer NOT NULL DEFAULT 10;
ALTER TABLE `restaurant_hosts` ADD COLUMN `last_error` text;
ALTER TABLE `restaurant_hosts` ADD COLUMN `updated_at` text;

CREATE TABLE IF NOT EXISTS `auth_sessions` (
  `id_hash` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `restaurant_id` text,
  `csrf_token` text NOT NULL,
  `created_at` text NOT NULL,
  `last_seen_at` text NOT NULL,
  `idle_expires_at` text NOT NULL,
  `absolute_expires_at` text NOT NULL,
  `revoked_at` text
);
CREATE INDEX IF NOT EXISTS `auth_sessions_subject_idx` ON `auth_sessions` (`scope`,`restaurant_id`,`absolute_expires_at`);

CREATE TABLE IF NOT EXISTS `auth_challenges` (
  `id_hash` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `restaurant_id` text,
  `kind` text NOT NULL,
  `payload` text NOT NULL,
  `attempts` integer NOT NULL DEFAULT 0,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL
);

CREATE TABLE IF NOT EXISTS `rate_limits` (
  `key_hash` text NOT NULL,
  `bucket` text NOT NULL,
  `count` integer NOT NULL,
  `reset_at` text NOT NULL,
  PRIMARY KEY (`key_hash`,`bucket`)
);

CREATE TABLE IF NOT EXISTS `audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `restaurant_id` text,
  `actor` text NOT NULL,
  `action` text NOT NULL,
  `outcome` text NOT NULL,
  `duration_ms` integer NOT NULL,
  `created_at` text NOT NULL,
  `detail` text
);
CREATE INDEX IF NOT EXISTS `audit_events_created_idx` ON `audit_events` (`created_at`);
CREATE INDEX IF NOT EXISTS `audit_events_restaurant_idx` ON `audit_events` (`restaurant_id`,`created_at`);

CREATE TABLE IF NOT EXISTS `platform_domain_config` (
  `id` text PRIMARY KEY NOT NULL,
  `base_hostname` text,
  `zone_id` text,
  `status` text NOT NULL,
  `validation_data` text,
  `updated_at` text NOT NULL
);
