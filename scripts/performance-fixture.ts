import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
type Reply = { status?: number; json?: unknown; body?: string | Buffer; contentType?: string };
type FixtureRequest = { url(): string; method(): string; postDataJSON<T = unknown>(): T; headers(): Record<string, string>; postDataBuffer(): Buffer };
type FixtureRoute = { request(): FixtureRequest; fulfill(reply: Reply): Promise<void> };
/** HTTP fixtures preserve browser caching; Playwright request routing disables it. */
export async function performanceFixture(upstream: string) {
  if (!['localhost', '127.0.0.1'].includes(new URL(upstream).hostname)) throw Error('Local performance fixtures only');
  const routes: { pattern: string; handler: (route: FixtureRoute) => unknown }[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url || '/', upstream);
      if (url.origin !== new URL(upstream).origin) throw Error('Fixture proxy origin mismatch');
      const route = [...routes].reverse().find(row => row.pattern.endsWith('/**') ? url.pathname.startsWith(row.pattern.slice(2, -2)) : url.pathname === row.pattern.slice(2));
      if (route) {
        const parts: Buffer[] = []; for await (const part of request) parts.push(Buffer.from(part));
        const body = Buffer.concat(parts);
        if (body.length > 2_000_000) throw Error('Fixture body exceeds limit');
        await route.handler({
          request: () => ({url: () => url.href, method: () => request.method || 'GET', postDataJSON: <T>() => JSON.parse(body.toString()) as T, headers: () => Object.fromEntries(Object.entries(request.headers).map(([key,value]) => [key,Array.isArray(value) ? value.join(',') : value || ''])), postDataBuffer: () => body}),
          fulfill: async reply => { const bytes = reply.json === undefined ? (reply.body || '') : JSON.stringify(reply.json); response.writeHead(reply.status || 200, {'Content-Type': reply.contentType || 'application/json', 'Cache-Control': 'no-store'}).end(bytes); },
        });
        return;
      }
      const source = await fetch(url, {headers: {'Accept-Encoding': 'identity'}});
      const bytes = Buffer.from(await source.arrayBuffer());
      const type = source.headers.get('content-type') || 'application/octet-stream';
      const compressed = /\bgzip\b/.test(request.headers['accept-encoding'] || '') && /javascript|css|html/.test(type);
      const payload = compressed ? gzipSync(bytes) : bytes;
      response.writeHead(source.status, {'Content-Type': type, 'Cache-Control': type.includes('html') ? 'no-store' : source.headers.get('cache-control') || 'no-store', ...(compressed ? {'Content-Encoding':'gzip','Vary':'Accept-Encoding'} : {})}).end(payload);
    })().catch(error => { if (response.headersSent) { response.destroy(error instanceof Error ? error : undefined); return; } response.writeHead(500, {'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({error:String(error)})); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Fixture port missing');
  return { base: 'http://127.0.0.1:' + address.port, route(pattern: string, handler: (route: FixtureRoute) => unknown) { routes.push({pattern,handler}); }, close: () => new Promise<void>((resolve,reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}
