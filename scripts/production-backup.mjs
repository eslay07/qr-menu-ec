import { execFileSync } from 'node:child_process';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const account = '088309af758852fcbfc714c622dff11d';
const operational=process.argv.includes('--operational-documents');
const database = operational?'0c8dab0c-5e79-4272-a28c-90b00a93e676':'e81ee150-55f7-434f-84de-299b2d001f1c';
const auth = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' },
}));
if (!auth.token) throw Error('Authentication unavailable.');
async function api(path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { ...options, headers: { Authorization: `Bearer ${auth.token}`, ...options.headers } });
  const data = await response.json();
  if (!response.ok || data.success === false) throw Error(`API ${response.status}: ${(data.errors || []).map(e => `${e.code} ${e.message}`).join(';')}`);
  return data.result;
}
const deployment = (await api('/workers/scripts/qr-menu-ec/deployments')).deployments[0];
if (deployment.versions.length !== 1) throw Error('Multiple deployed versions; inspect bindings separately.');
const version = await api(`/workers/scripts/qr-menu-ec/versions/${deployment.versions[0].version_id}`);
const r2Bindings = version.resources.bindings.filter(binding => binding.type === 'r2_bucket');
let buckets, r2Error;
try { buckets = await api('/r2/buckets?per_page=1000'); } catch (error) { r2Error = error.message; }
const tables = await api(`/d1/database/${database}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" }) });
console.log(JSON.stringify({ version: version.id, r2Bindings, buckets, r2Error, tables: tables[0].results.map(row => row.name) }, null, 2));

if (process.argv[2] === '--backup-d1') {
  if (r2Bindings.length) throw Error('R2 bindings present: implement scoped object backup before claiming a complete archive.');
  const sha = value => createHash('sha256').update(value).digest('hex');
  let exported;
  for (let attempt = 0, bookmark; attempt < 30; attempt++) {
    exported = await api(`/d1/database/${database}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ output_format: 'polling', ...(bookmark ? { current_bookmark: bookmark } : {}) }) });
    if (exported.status === 'complete') break;
    if (exported.status === 'error') throw Error('D1 export failed.');
    bookmark = exported.at_bookmark;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (exported.status !== 'complete' || !exported.result?.signed_url) throw Error('Export incomplete.');
  const download = await fetch(exported.result.signed_url);
  if (!download.ok) throw Error('SQL download failed.');
  const sql = await download.text();
  const sqlSha256 = sha(sql);
  const quote = name => '"' + name.replaceAll('"', '""') + '"';
  function inspect(database) {
    const schema = database.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const inventory = schema.map(({name,sql}) => {
      const statement = database.prepare(`SELECT * FROM ${quote(name)}`);
      statement.setReadBigInts(true);
      const rows = statement.all().map(row => JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? { integer: value.toString() } : value instanceof Uint8Array ? { blob: Buffer.from(value).toString('base64') } : value)).sort();
      return { name, count: rows.length, schemaSha256: sha(sql || ''), rowsSha256: sha(rows.join('\n')) };
    });
    const integrity = database.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw Error('SQLite integrity check failed.');
    if (database.prepare('PRAGMA foreign_key_check').all().length) throw Error('Foreign key check failed.');
    return inventory;
  }
  const first = new DatabaseSync(':memory:');
  let inventory, media;
  try {
    first.exec(sql);
    inventory = inspect(first);
    const expectedTables = tables[0].results.map(row => row.name).filter(name => !name.startsWith('_cf_') && !name.startsWith('sqlite_'));
    if (expectedTables.some(name => !inventory.some(row => row.name === name))) throw Error('Export missing application tables.');
    if(operational){
      if(!expectedTables.includes('operational_documents'))throw Error('Operational table missing');
      for(const row of first.prepare('SELECT path,fields,payload FROM operational_documents').all()){
        if(!row.path||!JSON.parse(row.fields)||!JSON.parse(row.payload))throw Error('Invalid operational document');
      }
      media=[];
    }else media = first.prepare('SELECT restaurant_id,id,type,data FROM media ORDER BY restaurant_id,id').all().map(row => ({ restaurantId: row.restaurant_id, id: row.id, type: row.type, bytes: row.data.length, sha256: sha(Buffer.from(row.data)) }));
  } finally { first.close(); }
  const r2 = { bindings: r2Bindings, inventoryVerified: false, error: r2Error || null, buckets: buckets || null, objects: null };
  const inventorySha256 = sha(JSON.stringify({ tables: inventory, media, r2 }));
  const payload = { format: 'qrmenu-backup-v1', createdAt: new Date().toISOString(), workerVersion: version.id, database,
    bookmark: exported.at_bookmark, sql, sqlSha256, inventory, media, r2, inventorySha256 };
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const magic = Buffer.from('QRMENUBACKUP1');
  cipher.setAAD(magic);
  const ciphertext = Buffer.concat([cipher.update(gzipSync(JSON.stringify(payload))), cipher.final()]);
  const envelope = Buffer.concat([magic, iv, cipher.getAuthTag(), ciphertext]);
  const dpapi = (operation, bytes) => Buffer.from(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System.Security; $backupBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $backupResult=[Security.Cryptography.ProtectedData]::${operation}($backupBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($backupResult))`], { input: bytes.toString('base64'), encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }), 'base64');
  const sealedKey = dpapi('Protect', key);
  const directory = resolve('work/private-backups', new Date().toISOString().replaceAll(':','-') + '-' + randomBytes(4).toString('hex'));
  const archive = join(directory, 'd1-backup.aes256gcm');
  execFileSync('git', ['check-ignore', '--quiet', archive]);
  await mkdir(directory, { recursive: true });
  await writeFile(archive, envelope, { flag: 'wx' });
  await writeFile(join(directory, 'key.dpapi'), sealedKey, { flag: 'wx' });
  key.fill(0);
  const fromDisk = await readFile(archive);
  if (sha(fromDisk) !== sha(envelope)) throw Error('Archive checksum mismatch after write.');
  const recoveredKey = dpapi('Unprotect', await readFile(join(directory, 'key.dpapi')));
  const offset = magic.length;
  const decrypt = createDecipheriv('aes-256-gcm', recoveredKey, fromDisk.subarray(offset, offset + 12));
  decrypt.setAAD(magic); decrypt.setAuthTag(fromDisk.subarray(offset + 12, offset + 28));
  const restored = JSON.parse(gunzipSync(Buffer.concat([decrypt.update(fromDisk.subarray(offset + 28)), decrypt.final()])).toString());
  recoveredKey.fill(0);
  if (sha(restored.sql) !== sqlSha256 || sha(JSON.stringify({ tables: restored.inventory, media: restored.media, r2: restored.r2 })) !== inventorySha256) throw Error('Decrypted checksums differ.');
  const second = new DatabaseSync(':memory:');
  try {
    second.exec(restored.sql);
    if (JSON.stringify(inspect(second)) !== JSON.stringify(inventory)) throw Error('Restored table contents differ.');
    for (const item of restored.media) {
      const row = second.prepare('SELECT data FROM media WHERE restaurant_id=? AND id=?').get(item.restaurantId, item.id);
      if (!row || sha(Buffer.from(row.data)) !== item.sha256) throw Error('Restored image checksum differs.');
    }
  } finally { second.close(); }
  const receipt = { createdAt: payload.createdAt, workerVersion: version.id, database, scope:operational?'operational-documents':'legacy-and-photos', sqlSha256, archiveSha256: sha(fromDisk), inventorySha256,
    encryptedKeySha256: sha(sealedKey), tables: inventory.map(({name,count})=>({name,count})), mediaObjects: media.length,
    encrypted: 'AES-256-GCM; key protected with Windows DPAPI CurrentUser', restoreVerified: true, r2Verified: false,
    r2Status: r2Error || 'No linked buckets; scope requires review', productionDataChanged: false };
  await writeFile(join(directory, 'verification.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ directory, ...receipt }, null, 2));
}
