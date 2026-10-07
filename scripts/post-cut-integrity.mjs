import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifiedBackup } from './verify-encrypted-backup.mjs';
const dir=process.argv[2];
if(!/^work\/migration-window-2026-10-05-[a-z0-9-]+$/.test(dir||''))throw Error('Verified window directory required');
const completed=JSON.parse(await readFile(dir+'/completed.json','utf8'));
if(!completed.productionActivated)throw Error('Production cut not complete');
const {payload}=await verifiedBackup(completed.backupDirectory);
let verifiedImages=0,privateImagesBlocked=0;
const publicImages=new Map();
for(const restaurantId of new Set(payload.media.map(image=>image.restaurantId))){
 const r=await fetch(`https://qr-menu-ec.consola.workers.dev/r/${restaurantId}/api/v1/menu`);
 const menu=await r.json();if(r.status!==200||!menu.catalog)throw Error('Cannot verify published image references');
 const c=menu.catalog;
 publicImages.set(restaurantId,new Set([c.logo,...c.dishes.map(d=>d.image),...(c.promotions||[]).map(p=>p.image)].filter(url=>/\/api\/v1\/media\/[a-f0-9-]{36}$/.test(url||'')).map(url=>url.split('/').at(-1))));
}
for(const image of payload.media){
 const response=await fetch(`https://qr-menu-ec.consola.workers.dev/r/${encodeURIComponent(image.restaurantId)}/api/v1/media/${encodeURIComponent(image.id)}`,{signal:AbortSignal.timeout(20000)});
 const bytes=Buffer.from(await response.arrayBuffer());
 if(!publicImages.get(image.restaurantId).has(image.id)){
  if(response.status!==401)throw Error('Unpublished draft image accessible without authentication');
  privateImagesBlocked++;continue;
 }
 if(response.status!==200||!/^image\/(jpeg|png|webp)/.test(response.headers.get('content-type')||'')||createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw Error('Production image differs from verified D1 backup');
 verifiedImages++;
}
const id='998d4980-a169-469f-b009-634a373ca7ad';
const alias=await fetch(`https://qr-menu-ec.consola.workers.dev/r/${id}/menu?table=4`,{redirect:'manual'});
if(alias.status!==302||alias.headers.get('location')!=='https://la-sazon-marinera.consola.workers.dev/menu?table=4')throw Error('Old UUID QR redirect failed');await alias.arrayBuffer();
const canonical=await fetch(alias.headers.get('location'));
if(canonical.status!==200||!canonical.headers.get('content-type')?.startsWith('text/html'))throw Error('Canonical menu page failed');await canonical.arrayBuffer();
const privatePrint=await fetch(`https://qr-menu-ec.consola.workers.dev/r/${id}/api/v1/qr/print-wifi`);
if(privatePrint.status!==401)throw Error('Private print is exposed without authentication');await privatePrint.arrayBuffer();
const result={checkedAt:new Date().toISOString(),productionActivated:true,publishedImagesChecksummed:verifiedImages,privateImagesBlocked,totalBackupImagesVerified:payload.media.length,allPublishedImageChecksumsMatch:true,oldUuidAliasPassed:true,canonicalMenuPassed:true,unauthenticatedPrintBlocked:true,explicitWrites:0};
await writeFile(dir+'/post-cut-integrity.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result,null,2));
