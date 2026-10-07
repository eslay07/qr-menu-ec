import {DatabaseSync} from 'node:sqlite';
import {writeFile} from 'node:fs/promises';
import {verifiedBackup} from './verify-encrypted-backup.mjs';
import {D1DocumentStore} from '../lib/d1-documents';
import {decodeFirestoreFields} from '../lib/firestore-rest';
import {canonicalDocument} from '../lib/document-transfer';
import {remoteD1,unchangedProduction} from './d1-transition-operator.mjs';
await unchangedProduction();
const backup=await verifiedBackup('work/private-backups/2026-10-07T04-05-55.374Z-edd619d6');
if(backup.receipt.database!=='0c8dab0c-5e79-4272-a28c-90b00a93e676')throw Error('Wrong backup database');
const restaurantId=process.argv[2]||'998d4980-a169-469f-b009-634a373ca7ad';
if(!['998d4980-a169-469f-b009-634a373ca7ad','550cd3d2-eead-4f4a-8505-df582abc001b'].includes(restaurantId))throw Error('Unknown QA restaurant');
const path=`restaurants/${restaurantId}/settings/general`;
const memory=new DatabaseSync(':memory:');let original;
try{memory.exec(backup.payload.sql);const row=memory.prepare('SELECT fields FROM operational_documents WHERE path=?').get(path);if(!row)throw Error('Original settings missing');original=JSON.parse(String(row.fields));}finally{memory.close();}
const db=new D1DocumentStore(remoteD1(backup.receipt.database) as unknown as D1Database),current=await db.getWire(path);
if(!current)throw Error('Current settings missing');
const data=decodeFirestoreFields(current.fields);
if(data.wifiName!=='Red de prueba')throw Error('Settings changed independently; do not restore');
const restored={...current.fields};
for(const key of ['wifiEnabled','wifiName','wifiCiphertext']){delete restored[key];if(original[key]!==undefined)restored[key]=original[key];}
await db.commitWire([{path,fields:restored,updateTime:current.updateTime}]);
const after=await db.getWire(path);
if(!after||canonicalDocument(after.fields)!==canonicalDocument(restored))throw Error('Restoration mismatch');
await unchangedProduction();
const result={checkedAt:new Date().toISOString(),originalWifiRestored:true,otherSettingsUnchanged:true,ordersTouched:0,productionUnchanged:true};
await writeFile('work/d1-production-candidate/wifi-restored.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
