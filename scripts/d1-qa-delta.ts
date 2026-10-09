import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createDecipheriv,createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {join,resolve,sep} from 'node:path';
import {D1DocumentStore} from '../lib/d1-documents';
import {canonicalDocument} from '../lib/document-transfer';
import {remoteD1,unchangedProduction} from './d1-transition-operator.mjs';
await unchangedProduction();
const receipt=JSON.parse(await readFile('work/d1-transition/source-receipt.json','utf8'));
const directory=resolve(receipt.directory);
if(!directory.startsWith(resolve('work/private-backups')+sep)||receipt.restoreVerified!==true)throw Error('Invalid private archive.');
execFileSync('git',['check-ignore','--quiet',directory]);
const bytes=await readFile(join(directory,'documents.aes256gcm')),sealed=Buffer.from(await readFile(join(directory,'key.dpapi')));
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
if(sha(bytes)!==receipt.archiveSha256)throw Error('Archive checksum mismatch.');
const key=Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Security; $documentBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($documentBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))'],{input:sealed.toString('base64'),encoding:'utf8',stdio:['pipe','pipe','pipe']}),'base64');
let plain:string;
try{const magic=Buffer.from('QRMENUDOCS1');const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(magic.length,magic.length+12));cipher.setAAD(magic);cipher.setAuthTag(bytes.subarray(magic.length+12,magic.length+28));plain=gunzipSync(Buffer.concat([cipher.update(bytes.subarray(magic.length+28)),cipher.final()])).toString();}finally{key.fill(0);}
if(sha(plain)!==receipt.payloadSha256)throw Error('Source checksum mismatch.');
const source=JSON.parse(plain);if(source.project!=='qr-menu-6981a')throw Error('Wrong source project.');
const baseline=new Map<string,string>(source.documents.map((row:import("../lib/firestore-rest").TransferDocument)=>[row.path,canonicalDocument(row.fields)]));
const db=new D1DocumentStore(remoteD1('0c8dab0c-5e79-4272-a28c-90b00a93e676') as unknown as D1Database);
const actual=await db.inventoryWire(100000),seen=new Set<string>(),counts:Record<string,{created:number;changed:number;deleted:number}>={};
function add(path:string,kind:'created'|'changed'|'deleted'){const group=path.split('/').at(-2)!;counts[group]||={created:0,changed:0,deleted:0};counts[group][kind]++;}
for(const row of actual){seen.add(row.path);if(!baseline.has(row.path))add(row.path,'created');else if(baseline.get(row.path)!==canonicalDocument(row.fields))add(row.path,'changed');}
for(const path of baseline.keys())if(!seen.has(path))add(path,'deleted');
await unchangedProduction();
const report={checkedAt:new Date().toISOString(),baselineDocuments:baseline.size,currentD1Documents:actual.length,changesByCollection:counts,readOnly:true,productionUnchanged:true};
await writeFile('work/d1-transition/qa-delta.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
