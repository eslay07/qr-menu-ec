import { execFileSync } from 'node:child_process';

// Read only. Never print binding values, secret material or response payloads.
try {
  const credential = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' },
  }));
  const base = 'https://api.cloudflare.com/client/v4/accounts/088309af758852fcbfc714c622dff11d/workers/scripts/qr-menu-ec';
  async function get(path) {
    const response = await fetch(base + path, { headers: { Authorization: `Bearer ${credential.token}` } });
    if (!response.ok) throw Error('Read failed.');
    return (await response.json()).result;
  }
  const active = (await get('/deployments')).deployments[0];
  if (active.versions.length !== 1 || active.versions[0].percentage !== 100) throw Error('Ambiguous deployment.');
  const version = await get(`/versions/${active.versions[0].version_id}`);
  const bindings = version.resources.bindings;
  const expected = { DATA_PROVIDER: 'd1', FIRESTORE_PROJECT_ID: 'qr-menu-6981a', FIRESTORE_REMOTE_ENABLED: 'false', FCM_ENABLED: 'false' };
  const checks = Object.entries(expected).map(([name, expectedValue]) => {
    const binding = bindings.find(item => item.name === name);
    return { name, exists: !!binding, readable: binding?.type === 'plain_text',
      correctForPreActivation: binding?.type === 'plain_text' ? binding.text === expectedValue : null };
  });
  const secret = bindings.find(item => item.name === 'FIRESTORE_SERVICE_ACCOUNT');
  checks.push({ name: 'FIRESTORE_SERVICE_ACCOUNT', exists: !!secret, secretBinding: secret?.type === 'secret_text',
    contentValidated: false, reason: secret ? 'Write-only secret; metadata cannot verify contents or IAM.' : 'Missing from active version.' });
  // VITE_* is compiled into browser assets, not a runtime Worker secret.
  const site = 'https://qr-menu-ec.consola.workers.dev';
  const htmlResponse = await fetch(site + '/owner', { cache: 'no-store' });
  if (!htmlResponse.ok) throw Error('Public artifact read failed.');
  const html = await htmlResponse.text();
  const paths = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(match => match[1]).filter(path => path.startsWith('/assets/'));
  const artifacts = [];
  for (const path of paths) {
    const response = await fetch(site + path, { cache: 'no-store' });
    if (!response.ok) throw Error('Public JS read failed.');
    const text = await response.text();
    artifacts.push({ containsViteFlag: text.includes('VITE_FCM_ENABLED'), containsPushSettings: text.includes('Las notificaciones push aún no están habilitadas'),
      containsPushRegistration: text.includes('push/device'), containsMessagingSDK: text.includes('fcmregistrations.googleapis.com') });
  }
  if ((await get('/deployments')).deployments[0].id !== active.id) throw Error('Deployment changed during inspection.');
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'active production version; no changes', checks,
    frontend: { name: 'VITE_FCM_ENABLED', runtimeBindingExists: bindings.some(item => item.name === 'VITE_FCM_ENABLED'),
      buildValueConfirmed: false, reason: 'Build-time setting requires matching build evidence, not runtime binding.', artifacts }, changedProduction: false }, null, 2));
} catch {
  console.error('Configuration check failed safely; no values disclosed and no production changes.');
  process.exitCode = 1;
}
