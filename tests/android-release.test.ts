import test from 'node:test';import assert from 'node:assert/strict';import{createHash}from'node:crypto';import{checkedAndroidRelease}from'../scripts/android-release.mjs';
const apk=Buffer.from('fictitious build bytes');const release={versionCode:15,versionName:'0.8.4',url:'https://qr-menu-ec.consola.workers.dev/downloads/qr-menu-ec.apk',sha256:createHash('sha256').update(apk).digest('hex'),size:apk.length,certificateSha256:'a'.repeat(64)};
void test('Android release cannot advertise a different binary or an external download',()=>{
 assert.deepEqual(checkedAndroidRelease(release,apk),release);
 for(const altered of [{sha256:'b'.repeat(64)},{size:apk.length+1},{size:31*1024*1024},{url:'https://elsewhere.example/app.apk'},{url:release.url+'?token=private'},{certificateSha256:'invalid'},{versionCode:0},{versionName:'<script>'}])assert.throws(()=>checkedAndroidRelease({...release,...altered},apk));
 assert.throws(()=>checkedAndroidRelease(release,Buffer.from('other bytes')));
});
