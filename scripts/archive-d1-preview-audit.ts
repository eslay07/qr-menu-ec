import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {D1DocumentStore} from '../lib/d1-documents';
import {decodeFirestoreFields} from '../lib/firestore-rest';
import {remoteD1,unchangedProduction} from './d1-transition-operator.mjs';
// Only the known public preview-login audit is eligible. No customer data.
const allowed=new Map([
 ['auditEvents/0627a867-2743-4f4d-9da9-00e91ea14941','2026-10-06T02:29:37.193Z'],
 ['auditEvents/12f5918b-2814-41f4-8638-b43be5a3c723','2026-10-06T12:08:37.460Z'],
]);
await unchangedProduction();
const db=new D1DocumentStore(remoteD1('0c8dab0c-5e79-4272-a28c-90b00a93e676') as unknown as D1Database);
const rows=await db.inventoryWire(100000);
if(rows.length!==allowed.size)throw Error('Unexpected destination; nothing removed.');
for(const row of rows){const data=decodeFirestoreFields(row.fields);if(data.action!=='GET /api/owner/login'||data.createdAt!==allowed.get(row.path))throw Error('Audit identity differs.');}
const content=JSON.stringify(rows),sha=(text:string)=>createHash('sha256').update(text).digest('hex');
await mkdir('work/d1-transition',{recursive:true});
const archive='work/d1-transition/preview-login-audit.json';
await writeFile(archive,content,{flag:'wx'});
if(sha(await readFile(archive,'utf8'))!==sha(content))throw Error('Archive verification failed.');
await unchangedProduction();
await db.commitWire(rows.map(row=>({path:row.path,delete:true,updateTime:row.updateTime})));
if((await db.inventoryWire(100000)).length!==0)throw Error('Destination not empty.');
console.log(JSON.stringify({previewAuditArchived:true,checksum:sha(content),destinationDocuments:0,productionUnchanged:true}));
