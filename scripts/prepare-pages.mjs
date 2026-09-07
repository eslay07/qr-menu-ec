import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const output = path.resolve('dist-pages');
await fs.mkdir(path.join(output, 'demo'), { recursive: true });
await fs.copyFile('public/demo/encebollado.jpg', path.join(output, 'demo/encebollado.jpg'));
await fs.copyFile('public/icon.svg', path.join(output, 'icon.svg'));
for (const size of [192, 512]) await sharp('public/icon.svg').resize(size, size).png().toFile(path.join(output, `icon-${size}.png`));
const files = (await fs.readdir(output, { recursive: true })).filter(file => !file.startsWith('_') && file !== 'sw.js' && file !== 'android.html' && !file.startsWith('downloads'));
const urls = [];
const hash = createHash('sha256');
hash.update(await fs.readFile(new URL(import.meta.url)));
for (const file of files.sort()) {
  if (!(await fs.stat(path.join(output, file))).isFile()) continue;
  // Pages redirects /index.html to /. Cache the canonical response so an offline
  // navigation never receives a redirected response (which Chromium rejects).
  urls.push(file === 'index.html' ? '/' : '/' + file.replaceAll('\\', '/'));
  hash.update(file).update(await fs.readFile(path.join(output, file)));
}
const cache = 'qrmenu-pages-' + hash.digest('hex').slice(0, 16);
// Installation is atomic: no ready indication until every asset is cached.
await fs.writeFile(path.join(output, 'sw.js'), `const CACHE=${JSON.stringify(cache)};
const URLS=${JSON.stringify(urls)};
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  try { await cache.addAll(URLS.map(url => new Request(url, {cache:'reload'}))); }
  catch (error) { await caches.delete(CACHE); throw error; }
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  for (const name of await caches.keys()) if (name.startsWith('qrmenu-pages-') && name !== CACHE) await caches.delete(name);
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/downloads/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.open(CACHE)).match('/')));
  } else if (URLS.includes(url.pathname)) {
    event.respondWith((async () => (await (await caches.open(CACHE)).match(url.pathname)) || fetch(event.request))());
  }
});
`);
console.log(`Pages: ${urls.length} recursos offline; ${cache}`);
// Installers are downloadable, never part of the diner's offline cache.
await fs.mkdir(path.join(output, 'downloads'), { recursive: true });
await fs.copyFile('deployment/android/qr-menu-android.apk', path.join(output, 'downloads/qr-menu-android.apk'));
await fs.copyFile('deployment/android/SHA256SUMS.txt', path.join(output, 'downloads/SHA256SUMS.txt'));
