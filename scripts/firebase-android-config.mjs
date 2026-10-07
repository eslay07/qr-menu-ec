import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const project = 'qr-menu-6981a';
try {
  const auth = require('firebase-tools/lib/auth');
  await require('firebase-tools/lib/requireAuth').requireAuth({ project, nonInteractive: true, ...auth.getProjectDefaultAccount(process.cwd()) });
  const api = require('firebase-tools/lib/management/apps');
  const apps = await api.listFirebaseApps(project, api.AppPlatform.ANDROID);
  let app = apps.find(item => item.packageName === 'ec.qrmenu.app');
  if (!app) {
    if (!process.argv.includes('--create')) throw Error('Android app not registered; explicit --create required');
    app = await api.createAndroidApp(project, { packageName: 'ec.qrmenu.app', displayName: 'QR Menu EC Android' });
  }
  const config = await api.getAppConfig(app.appId, api.AppPlatform.ANDROID);
  const decoded = JSON.parse(Buffer.from(config.configFileContents, 'base64').toString('utf8'));
  const client = decoded.client.find(item => item.client_info.android_client_info.package_name === 'ec.qrmenu.app');
  // Only public SDK identifiers, never a service account or registration token.
  console.log(JSON.stringify({ appId: client.client_info.mobilesdk_app_id, projectId: decoded.project_info.project_id, senderId: decoded.project_info.project_number, apiKey: client.api_key[0].current_key }));
} catch { console.error('Android configuration could not be obtained; no credentials printed.'); process.exitCode = 1; }
