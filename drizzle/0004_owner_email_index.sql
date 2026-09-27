CREATE UNIQUE INDEX IF NOT EXISTS application_owner_email_idx
ON application (json_extract(data, '$.security.emailHash'))
WHERE id <> '__creator__' AND json_extract(data, '$.security.emailHash') IS NOT NULL;

CREATE TABLE IF NOT EXISTS security_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  completed_at TEXT NOT NULL
);
