import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {performanceFixture} from '../scripts/performance-fixture';
void test('HTTP lab preserves cache headers and isolates fictional API responses from upstream', async () => {
  let requests=0;
  const origin=createServer((_request,response)=>{requests++;response.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'public,max-age=3600'}).end('console.log("fixture");');});
  await new Promise<void>(resolve=>origin.listen(0,'127.0.0.1',resolve));
  const address=origin.address();assert(address&&typeof address!=='string');
  const fixture=await performanceFixture('http://127.0.0.1:'+address.port);
  try {
    fixture.route('**/api/**',route=>route.fulfill({json:{fictional:true}}));
    const api=await fetch(fixture.base+'/api/v1/state');assert.deepEqual(await api.json(),{fictional:true});assert.equal(api.headers.get('cache-control'),'no-store');assert.equal(requests,0);
    const asset=await fetch(fixture.base+'/assets/main.js');assert.equal(await asset.text(),'console.log("fixture");');assert.equal(asset.headers.get('cache-control'),'public,max-age=3600');assert.equal(asset.headers.get('content-type'),'application/javascript');assert.equal(requests,1);
    await assert.rejects(performanceFixture('https://example.com'),/Local performance fixtures only/);
  } finally {await fixture.close();await new Promise<void>((resolve,reject)=>origin.close(error=>error?reject(error):resolve()));}
});
