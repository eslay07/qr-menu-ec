import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { randomBytes,createHash,createCipheriv,createDecipheriv } from 'node:crypto';
import { gzipSync,gunzipSync } from 'node:zlib';
import { FirestoreRest } from '../lib/firestore-rest.ts';

const require=createRequire(import.meta.url), project='qr-menu-6981a';
const sha=value=>createHash('sha256').update(value).digest('hex');
const auth=require('firebase-tools/lib/auth');
await require('firebase-tools/lib/requireAuth').requireAuth({project,nonInteractive:true,...auth.getProjectDefaultAccount(process.cwd())});
const bearer=()=>require('firebase-tools/lib/apiv2').getAccessToken();
const source=new FirestoreRest(project,'',bearer);
console.log('Firestore source inventory: read-only, no credentials printed.');
let rows;
try { rows=await source.inventoryWire(100000); }
catch(error){
 await mkdir('work/d1-transition',{recursive:true});
 await writeFile('work/d1-transition/source-blocker.json',JSON.stringify({checkedAt:new Date().toISOString(),stage:'read-only-source-inventory',httpStatus:error.status||null,code:error.code||'UNKNOWN',sourceWrites:0,destinationWrites:0,productionUnchanged:true},null,2));
 throw error;
}
if(!rows.some(row=>row.path==='restaurants/998d4980-a169-469f-b009-634a373ca7ad')||!rows.some(row=>row.path==='platformConfig/creator'))throw Error('Critical source documents missing.');
const payload=JSON.stringify({format:'qrmenu-document-source-v1',createdAt:new Date().toISOString(),project,freezeConfirmed:false,documents:rows});
const key=randomBytes(32),iv=randomBytes(12),magic=Buffer.from('QRMENUDOCS1');
const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(magic);
const ciphertext=Buffer.concat([cipher.update(gzipSync(payload)),cipher.final()]);
const archive=Buffer.concat([magic,iv,cipher.getAuthTag(),ciphertext]);
function dpapi(operation,bytes){return Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Add-Type -AssemblyName System.Security; $documentBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $documentResult=[Security.Cryptography.ProtectedData]::${operation}($documentBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($documentResult))`],{input:bytes.toString('base64'),encoding:'utf8',stdio:['pipe','pipe','pipe']}),'base64');}
const sealed=dpapi('Protect',key);key.fill(0);
const directory=resolve('work/private-backups',new Date().toISOString().replaceAll(':','-')+'-firestore-documents');
execFileSync('git',['check-ignore','--quiet',directory]);
await mkdir(directory,{recursive:true});
await writeFile(join(directory,'documents.aes256gcm'),archive,{flag:'wx'});
await writeFile(join(directory,'key.dpapi'),sealed,{flag:'wx'});
const disk=await readFile(join(directory,'documents.aes256gcm')),restoredKey=dpapi('Unprotect',sealed);
const decipher=createDecipheriv('aes-256-gcm',restoredKey,disk.subarray(magic.length,magic.length+12));decipher.setAAD(magic);decipher.setAuthTag(disk.subarray(magic.length+12,magic.length+28));
const restored=gunzipSync(Buffer.concat([decipher.update(disk.subarray(magic.length+28)),decipher.final()])).toString();restoredKey.fill(0);
if(sha(restored)!==sha(payload))throw Error('Encrypted archive verification failed.');
const counts={};for(const row of rows){const key=row.path.split('/').at(-2);counts[key]=(counts[key]||0)+1;}
const receipt={checkedAt:new Date().toISOString(),directory,documents:rows.length,collections:counts,payloadSha256:sha(payload),archiveSha256:sha(disk),restoreVerified:true,freezeConfirmed:false,sourceWrites:0};
await writeFile(join(directory,'verification.json'),JSON.stringify(receipt,null,2));
await mkdir('work/d1-transition',{recursive:true});
await writeFile('work/d1-transition/source-receipt.json',JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
