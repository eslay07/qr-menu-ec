CREATE TABLE IF NOT EXISTS owner_devices (
  id_hash TEXT PRIMARY KEY NOT NULL,
  restaurant_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS owner_devices_restaurant_idx ON owner_devices (restaurant_id, absolute_expires_at);
