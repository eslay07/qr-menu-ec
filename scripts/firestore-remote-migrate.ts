import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { FirestoreRest } from '../lib/firestore-rest';
import { migrationIam, withMigrationCredential, credentialAudit } from './migration-credential.mjs';
import { canonicalWire, makeManifest, importRemoteManifest, validateManifest, type MigrationManifest } from '../lib/firestore-remote-migration';
import { digest } from '../lib/security';
import { migrationStage, safeMigrationError } from './migration-diagnostics.mjs';
let currentStage = 'arguments';
function stage(value: string) { currentStage=value;console.log(JSON.stringify({stage:value,time:new Date().toISOString()})); }

// No plaintext manifest or credentials are written. DPAPI requires the same
// Windows user. --prepare reads an already verified, dedicated emulator only.
function dpapi(bytes: Uint8Array, protect: boolean) {
  return Buffer.from(execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',
    `Add-Type -AssemblyName System.Security; $migrationBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $migrationResult=[Security.Cryptography.ProtectedData]::${protect ? 'Protect' : 'Unprotect'}($migrationBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($migrationResult))`],
    { input: Buffer.from(bytes).toString('base64'), encoding: 'utf8', stdio: ['pipe','pipe','pipe'], maxBuffer: 100_000_000 }), 'base64');
}
async function main() {
  const [mode, filename, checksum, runId, maintenanceVersion] = process.argv.slice(2);
  if (!filename || !checksum || !runId) throw Error('Missing arguments.');
  if (mode === '--prepare') {
    const host = process.env.FIRESTORE_EMULATOR_HOST || '';
    if (!host) throw Error('Dedicated emulator required.');
    const db = new FirestoreRest('demo-qr-menu-migration', host);
    const marker = await db.get(`migrationRuns/${runId}`);
    if (marker?.data.status !== 'verified' || marker.data.sourceChecksum !== checksum || marker.data.serverTablesVerified !== true) throw Error('Verified source rehearsal required.');
    const plan = await makeManifest(db, runId, checksum);
    const bytes = Buffer.from(JSON.stringify(plan));
    try { await writeFile(filename, dpapi(bytes, true), { flag: 'wx' }); }
    finally { bytes.fill(0); }
    console.log(JSON.stringify({ prepared: true, runId, checksum: await digest(canonicalWire(plan)), documents: plan.documents.length, remoteWrites: 0 }));
    return;
  }
  if (mode !== '--apply' || process.env.REMOTE_MIGRATION_AUTHORIZATION !== 'APPROVED_FROZEN_WINDOW' || !/^[a-f0-9-]{36}$/.test(maintenanceVersion || '')) throw Error('Frozen-window authorization required; no remote writes.');
  stage('manifest.decrypt');
  const bytes = dpapi(await readFile(filename), false);
  let plan: MigrationManifest;
  try { plan = JSON.parse(bytes.toString()); } finally { bytes.fill(0); }
  if (plan.runId !== runId) throw Error('Run UUID mismatch.');
  stage('manifest.validate');
  await validateManifest(plan, checksum);
  const credential = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js','auth','token','--json'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' } }));
  const base = 'https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/qr-menu-ec';
  async function cf(path: string) {
    const response = await fetch(base + path, { headers: { Authorization: `Bearer ${credential.token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Object.assign(Error('Cannot confirm write freeze.'), {status:response.status,code:'MAINTENANCE_LOOKUP_FAILED'});
    return (await response.json()) as { result: {resources: {bindings: {name:string;text?:string}[]};deployments:{versions:{version_id:string;percentage:number}[]}[]} };
  }
  const origins = new Set(['https://qr-menu-ec.consola.workers.dev']);
  for (const d of plan.documents.filter(d => d.path.startsWith('hostnames/'))) {
    const hostname = d.fields.hostname?.stringValue;
    if (!hostname || !/^[a-z0-9.-]+$/.test(hostname)) throw Error('Invalid hostname inventory.');
    origins.add(`https://${hostname}`);
  }
  const authorizeWrites = async () => {
    const deployment = (await cf('/deployments')).result.deployments[0];
    if (deployment.versions.length !== 1 || deployment.versions[0].version_id !== maintenanceVersion || deployment.versions[0].percentage !== 100) throw Error('Maintenance version is not exclusively active.');
    const version = (await cf(`/versions/${maintenanceVersion}`)).result;
    if (!version.resources.bindings.some((b: {name:string;text?:string}) => b.name === 'MAINTENANCE_MODE' && b.text === 'true')) throw Error('Maintenance flag not confirmed.');
    for (const origin of origins) {
      const response = await fetch(`${origin}/api/owner/login`, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (response.status !== 503 || response.headers.get('X-QRMenu-Maintenance') !== 'write-freeze-v1') throw Error('An origin is not frozen.');
    }
  };
  // Validate the freeze before creating a temporary key, then recheck it for
  // every migration batch. No credential is supplied through env or argv.
  stage('maintenance.verify');
  await authorizeWrites();
  stage('credential.prepare');
  const result = await withMigrationCredential(await migrationIam(), async (bearer: () => Promise<string>) => {
    stage('preflight.oauth-exchange');
    await migrationStage(currentStage,bearer);
    const db=new FirestoreRest(plan.project,'',bearer);
    stage('preflight.read-before-write');
    const inventory=await migrationStage(currentStage,()=>db.inventoryWire());
    console.log(JSON.stringify({stage:currentStage,status:'passed',documents:inventory.length,project:plan.project}));
    return importRemoteManifest(db, plan, checksum, { authorizeWrites, onStage:stage,
      afterBatch:async(completed)=>{console.log(JSON.stringify({stage:'import.batch-completed',completed,total:plan.documents.length}));} });
  }, credentialAudit);
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(JSON.stringify({stage:currentStage,status:'failed',error:safeMigrationError(error)})); process.exitCode = 1; });
