import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
const root = resolve(process.argv[2] || 'dist-worker');
const types = { '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.html': 'text/html' };
createServer(async (req, res) => {
  let path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root + '\\') && path !== root) { res.writeHead(403).end(); return; }
  let bytes;
  try { bytes = await readFile(path); } catch { path = resolve(root, 'index.html'); bytes = await readFile(path); }
  const compressed = /\b(?:gzip)\b/.test(req.headers['accept-encoding'] || '') && ['.js', '.css', '.html'].includes(extname(path));
  res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'public,max-age=3600', ...(compressed ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) }).end(compressed ? gzipSync(bytes) : bytes);
}).listen(Number(process.env.QA_PORT || 4181), '127.0.0.1', () => console.log(`Synthetic preview http://127.0.0.1:${process.env.QA_PORT || 4181}`));
