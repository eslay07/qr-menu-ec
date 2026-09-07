import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const output = path.resolve('dist-pages');
await fs.mkdir(path.join(output, 'demo'), { recursive: true });
await fs.copyFile('public/demo/encebollado.jpg', path.join(output, 'demo/encebollado.jpg'));
await fs.copyFile('public/icon.svg', path.join(output, 'icon.svg'));
for (const size of [192, 512]) await sharp('public/icon.svg').resize(size, size).png().toFile(path.join(output, `icon-${size}.png`));
const files = (await fs.readdir(output, { recursive: true })).filter(file => !file.startsWith('_') && file !== 'sw.js');
const urls = [];
const hash = createHash('sha256');
for (const file of files.sort()) {
  if (!(await fs.stat(path.join(output, file))).isFile()) continue;
  urls.push('/' + file.replaceAll('\\', '/'));
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
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.open(CACHE)).match('/index.html')));
  } else if (URLS.includes(url.pathname)) {
    event.respondWith((async () => (await (await caches.open(CACHE)).match(url.pathname)) || fetch(event.request))());
  }
});
`);
console.log(`Pages: ${urls.length} recursos offline; ${cache}`);
