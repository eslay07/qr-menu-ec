import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const root = 'work/session-ui-hotfix/source/dist-worker';
const hash = value => createHash('sha256').update(value).digest('hex');
let count = 0;
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if (item.isDirectory()) { await walk(file); continue; }
    const path = relative(root, file).replaceAll('\\', '/');
    const response = await fetch(`https://qr-menu-ec.consola.workers.dev/${path === 'index.html' ? 'owner' : path}`);
    if (!response.ok || hash(await readFile(file)) !== hash(Buffer.from(await response.arrayBuffer()))) throw Error(`Baseline mismatch: ${path}`);
    count++;
  }
}
await walk(root);
console.log(`Baseline verified: ${count} files byte-identical to production.`);
