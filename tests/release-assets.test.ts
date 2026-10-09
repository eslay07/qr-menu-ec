import test from 'node:test';
import assert from 'node:assert/strict';
import { assetMime,assetDescriptor,assetPart } from '../scripts/release-assets.mjs';
void test('release upload preserves executable and document content types instead of generic binary',async()=>{
 for(const [path,type] of [['/index.html','text/html'],['/assets/main.js','application/javascript'],['/assets/main.css','text/css'],['/icon.svg','image/svg+xml'],['/downloads/app.apk','application/vnd.android.package-archive']]){
  const bytes=Buffer.from('fixture');assert.equal(assetMime(path),type);const part=assetPart(path,bytes);assert.equal(part.type,type);assert.equal(await part.text(),bytes.toString('base64'));
 }
});
void test('release content identity includes file type and is deterministic with preserved APK bytes',()=>{
 const bytes=Buffer.from('same bytes');assert.deepEqual(assetDescriptor('one.js',bytes),assetDescriptor('two.js',bytes));assert.notEqual(assetDescriptor('one.js',bytes).hash,assetDescriptor('one.css',bytes).hash);assert.equal(assetDescriptor('app.apk',bytes).size,bytes.length);
});

void test('release verification tolerates bounded propagation while preserving failure rollback signals',async()=>{
 const {waitForReleaseHtml}=await import('../scripts/release-assets.mjs');let reads=0,pauses=0;
 const html=await waitForReleaseHtml(async()=>new Response(++reads===1?'old release':'/assets/new.js',{headers:{'Content-Type':'text/html'}}),['/assets/new.js'],async()=>{pauses++;});assert.equal(html,'/assets/new.js');assert.equal(reads,2);assert.equal(pauses,1);
 reads=0;pauses=0;await assert.rejects(()=>waitForReleaseHtml(async()=>{reads++;return new Response('old',{headers:{'Content-Type':'text/html'}});},['/assets/new.js'],async()=>{pauses++;}),/propagation/);assert.equal(reads,15);assert.equal(pauses,14);
 reads=0;await assert.rejects(()=>waitForReleaseHtml(async()=>{reads++;return new Response('bad',{headers:{'Content-Type':'application/octet-stream'}});},['/assets/new.js'],async()=>{}),/content type/);assert.equal(reads,1);
});
void test('release verification accepts propagation beyond the previous five-read window',async()=>{
 const {waitForReleaseHtml}=await import('../scripts/release-assets.mjs');let reads=0,pauses=0;
 const html=await waitForReleaseHtml(async()=>new Response(++reads<7?'previous release':'/assets/current.js',{headers:{'Content-Type':'text/html'}}),['/assets/current.js'],async()=>{pauses++;});
 assert.equal(html,'/assets/current.js');assert.equal(reads,7);assert.equal(pauses,6);
});
