CREATE TABLE IF NOT EXISTS order_operations (
 restaurant_id TEXT NOT NULL,
 operation_key TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 token TEXT NOT NULL,
 order_snapshot TEXT NOT NULL,
 PRIMARY KEY (restaurant_id, operation_key)
);
