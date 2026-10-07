import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createDecipheriv, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

export async function verifiedBackup(backupDirectory) {
const directory = resolve(backupDirectory);
const sha = data => createHash('sha256').update(data).digest('hex');
const [envelope, protectedKey, receiptText] = await Promise.all([
  readFile(join(directory, 'd1-backup.aes256gcm')), readFile(join(directory, 'key.dpapi')), readFile(join(directory, 'verification.json'), 'utf8'),
]);
const receipt = JSON.parse(receiptText);
if (sha(envelope) !== receipt.archiveSha256 || sha(protectedKey) !== receipt.encryptedKeySha256) throw Error('Disk checksums do not match receipt.');
const magic = Buffer.from('QRMENUBACKUP1');
if (!envelope.subarray(0, magic.length).equals(magic)) throw Error('Unsupported archive.');
const key = Buffer.from(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  'Add-Type -AssemblyName System.Security; $backupBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $backupKey=[Security.Cryptography.ProtectedData]::Unprotect($backupBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($backupKey))'],
  { input: protectedKey.toString('base64'), encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }), 'base64');
let payload;
try {
  const offset = magic.length;
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(offset, offset + 12));
  decipher.setAAD(magic); decipher.setAuthTag(envelope.subarray(offset + 12, offset + 28));
  payload = JSON.parse(gunzipSync(Buffer.concat([decipher.update(envelope.subarray(offset + 28)), decipher.final()])).toString());
} finally { key.fill(0); }
if (payload.sqlSha256 !== receipt.sqlSha256 || sha(payload.sql) !== receipt.sqlSha256) throw Error('SQL checksum mismatch.');
if (sha(JSON.stringify({ tables: payload.inventory, media: payload.media, r2: payload.r2 })) !== receipt.inventorySha256) throw Error('Inventory checksum mismatch.');
const db = new DatabaseSync(':memory:');
try {
  db.exec(payload.sql);
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Restoration integrity failure.');
  const tables = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  if (tables.length !== payload.inventory.length) throw Error('Table inventory differs.');
  for (const table of tables) {
    const statement = db.prepare('SELECT * FROM "' + table.name.replaceAll('"', '""') + '"');
    statement.setReadBigInts(true);
    const rows = statement.all().map(row => JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? { integer: value.toString() } : value instanceof Uint8Array ? { blob: Buffer.from(value).toString('base64') } : value)).sort();
    const expected = payload.inventory.find(value => value.name === table.name);
    if (!expected || rows.length !== expected.count || sha(rows.join('\n')) !== expected.rowsSha256 || sha(table.sql || '') !== expected.schemaSha256) throw Error('Restored table differs.');
  }
  for (const item of payload.media) {
    const row = db.prepare('SELECT data FROM media WHERE restaurant_id=? AND id=?').get(item.restaurantId, item.id);
    if (!row || sha(Buffer.from(row.data)) !== item.sha256) throw Error('Restored media differs.');
  }
  return { payload, receipt, verification: { archiveSha256: receipt.archiveSha256, sqlSha256: receipt.sqlSha256, inventorySha256: receipt.inventorySha256, restoredTables: tables.length, mediaVerified: payload.media.length, integrity: 'ok', foreignKeys: 'ok', r2Verified: receipt.r2Verified, source: 'encrypted files on disk; no network access or production changes' } };
} finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw Error('Provide the local encrypted backup directory.');
  console.log(JSON.stringify((await verifiedBackup(process.argv[2])).verification, null, 2));
}
