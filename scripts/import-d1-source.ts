import {readFile,writeFile} from 'node:fs/promises';
import {createDecipheriv,createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {resolve,join,sep} from 'node:path';
import {D1DocumentStore} from '../lib/d1-documents';
import {documentManifest,transferDocuments} from '../lib/document-transfer';
import {remoteD1,unchangedProduction} from './d1-transition-operator.mjs';

if(!process.argv.includes('--import-isolated-copy'))throw Error('Explicit isolated import mode required. This script never deploys.');
const receipt=JSON.parse(await readFile('work/d1-transition/source-receipt.json','utf8'));
const directory=resolve(receipt.directory),privateRoot=resolve('work/private-backups')+sep;
if(!directory.startsWith(privateRoot)||receipt.restoreVerified!==true)throw Error('Invalid encrypted source archive.');
execFileSync('git',['check-ignore','--quiet',directory]);
const bytes=await readFile(join(directory,'documents.aes256gcm')),magic=Buffer.from('QRMENUDOCS1');
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
if(sha(bytes)!==receipt.archiveSha256||!magic.every((value:number,index:number)=>bytes[index]===value))throw Error('Source checksum mismatch.');
const sealed=await readFile(join(directory,'key.dpapi'));
const key=Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Security; $documentBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $documentResult=[Security.Cryptography.ProtectedData]::Unprotect($documentBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($documentResult))'],{input:btoa(String.fromCharCode(...sealed)),encoding:'utf8',stdio:['pipe','pipe','pipe']}),'base64');
let text;
try{const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(magic.length,magic.length+12));decipher.setAAD(magic);decipher.setAuthTag(bytes.subarray(magic.length+12,magic.length+28));text=gunzipSync(Buffer.concat([decipher.update(bytes.subarray(magic.length+28)),decipher.final()])).toString();}finally{key.fill(0);}
if(sha(text)!==receipt.payloadSha256)throw Error('Decrypted source checksum mismatch.');
const source=JSON.parse(text);
if(source.project!=='qr-menu-6981a'||source.format!=='qrmenu-document-source-v1')throw Error('Invalid source project/format.');
const destination=JSON.parse(await readFile('work/d1-transition/destination.json','utf8'));
if(destination.databaseId!=='0c8dab0c-5e79-4272-a28c-90b00a93e676')throw Error('Unexpected isolated D1 destination.');
let journal:{runId:string;records:Array<{path:string;checksum:string}>};
try{journal=JSON.parse(await readFile('work/d1-transition/import-journal.json','utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;journal={runId:crypto.randomUUID(),records:[]};}
const manifest=await documentManifest(source.documents,journal.runId);
const db=new D1DocumentStore(remoteD1(destination.databaseId) as unknown as D1Database);
const result=await transferDocuments(db,manifest,{authorizeWrites:async()=>{await unchangedProduction();},afterBatch:async records=>{journal.records.push(...records);await writeFile('work/d1-transition/import-journal.json',JSON.stringify(journal,null,2));}});
await writeFile('work/d1-transition/import-verification.json',JSON.stringify({...result,sourceFrozen:false,productionUnchanged:true},null,2));
console.log(JSON.stringify({...result,sourceFrozen:false,productionUnchanged:true},null,2));
