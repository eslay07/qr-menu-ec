import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const project = 'qr-menu-6981a';
const options = () => ({ skipLog: { reqBody: true, resBody: true }, resolveOnHTTPError: true });
const pause = () => new Promise(resolve => setTimeout(resolve, 3000));
try {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  const auth = require('firebase-tools/lib/auth');
  await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
  const { Client } = require('firebase-tools/lib/apiv2');
  const firestore = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
  const services = new Client({ urlPrefix: 'https://serviceusage.googleapis.com', apiVersion: 'v1' });
  let inventory = await firestore.get(`projects/${project}/databases`, options());
  if (inventory.status === 403 && inventory.body?.error?.details?.some(item => item.reason === 'SERVICE_DISABLED')) {
    const enabled = await services.post(`projects/${project}/services/firestore.googleapis.com:enable`, {}, options());
    if (enabled.status >= 300) throw Error('API enable failed');
    for (let attempt = 0; attempt < 40; attempt++) {
      await pause();
      inventory = await firestore.get(`projects/${project}/databases`, options());
      if (inventory.status === 200) break;
    }
  }
  if (inventory.status !== 200) throw Error('Inventory not confirmed; creation refused');
  const databases = inventory.body.databases || [];
  console.log(JSON.stringify({ verifiedExistingDatabases: databases.map(d => ({ name: d.name, location: d.locationId, edition: d.databaseEdition })) }));
  if (databases.length) {
    console.log('Existing database found; nothing created or modified.');
  } else {
    const result = await firestore.post(`projects/${project}/databases`, { locationId: 'us-east1', type: 'FIRESTORE_NATIVE', databaseEdition: 'STANDARD' }, { ...options(), queryParams: { databaseId: '(default)' } });
    if (result.status >= 300) throw Error(`Creation rejected (${result.status})`);
    for (let attempt = 0; attempt < 60; attempt++) {
      const current = await firestore.get(`projects/${project}/databases/(default)`, options());
      if (current.status === 200) {
        if (current.body.locationId !== 'us-east1' || current.body.databaseEdition !== 'STANDARD') throw Error('Unexpected database configuration');
        console.log(JSON.stringify({ created: true, name: current.body.name, location: current.body.locationId, edition: current.body.databaseEdition, billingChanged: false, productionDeployed: false }));
        process.exit(0);
      }
      await pause();
    }
    throw Error('Creation requested; confirmation timed out. Inspect before retrying.');
  }
} catch (error) {
  console.error(JSON.stringify({ error: String(error.message).replace(/[A-Za-z0-9_=-]{40,}/g, '[redacted]').slice(0, 220) }));
  process.exitCode = 1;
}
