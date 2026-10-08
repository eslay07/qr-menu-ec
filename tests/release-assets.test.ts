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
