import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createDecipheriv,createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {join,resolve,sep} from 'node:path';
import type {TransferDocument} from '../lib/firestore-rest';
export async function privateDocumentSource(receiptFile:string):Promise<TransferDocument[]>{
 if(!resolve(receiptFile).startsWith(resolve('work/d1-transition')+sep))throw Error('Unexpected receipt path.');
 const receipt=JSON.parse(await readFile(receiptFile,'utf8')),directory=resolve(receipt.directory);
 if(!directory.startsWith(resolve('work/private-backups')+sep)||receipt.restoreVerified!==true)throw Error('Invalid private archive.');
 execFileSync('git',['check-ignore','--quiet',directory]);
 const bytes=Buffer.from(await readFile(join(directory,'documents.aes256gcm'))),sealed=Buffer.from(await readFile(join(directory,'key.dpapi')));
 const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex'),magic=Buffer.from('QRMENUDOCS1');
 if(sha(bytes)!==receipt.archiveSha256||!bytes.subarray(0,magic.length).equals(magic))throw Error('Archive checksum mismatch.');
 const key=Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Security; $documentBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($documentBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))'],{input:sealed.toString('base64'),encoding:'utf8',stdio:['pipe','pipe','pipe']}),'base64');
 let plain:string;
 try{const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(magic.length,magic.length+12));cipher.setAAD(magic);cipher.setAuthTag(bytes.subarray(magic.length+12,magic.length+28));plain=gunzipSync(Buffer.concat([cipher.update(bytes.subarray(magic.length+28)),cipher.final()])).toString();}finally{key.fill(0);}
 if(sha(plain)!==receipt.payloadSha256)throw Error('Source checksum mismatch.');
 const source=JSON.parse(plain);if(source.project!=='qr-menu-6981a'||source.format!=='qrmenu-document-source-v1'||source.documents.length!==receipt.documents)throw Error('Invalid source project/count.');
 return source.documents;
}
