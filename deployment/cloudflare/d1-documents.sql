-- Separate from legacy application/orders/media: never overwrite the old copy.
CREATE TABLE IF NOT EXISTS operational_documents (
  path TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  fields TEXT NOT NULL CHECK(json_valid(fields)),
  version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operational_collection ON operational_documents(collection,path);
CREATE INDEX IF NOT EXISTS operational_collection_group ON operational_documents(collection_id,path);
CREATE INDEX IF NOT EXISTS operational_created ON operational_documents(collection,json_extract(payload,'$.createdAt'),path);
CREATE INDEX IF NOT EXISTS operational_expiry ON operational_documents(collection,json_extract(payload,'$.expiresAt'),path);
CREATE INDEX IF NOT EXISTS operational_attempt ON operational_documents(collection,json_extract(payload,'$.nextAttemptAt'),path);
CREATE TABLE IF NOT EXISTS operational_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT OR IGNORE INTO operational_meta VALUES (1,0);
CREATE TABLE IF NOT EXISTS operational_guard (ok INTEGER NOT NULL CHECK(ok=1));
