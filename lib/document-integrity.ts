import {decodeFirestoreFields,type TransferDocument} from './firestore-rest';

// Structural acceptance only. It does not authenticate actors or authorize a
// cutover; the operator must separately check freeze and CAS preconditions.
export function validateDocumentIntegrity(rows:TransferDocument[]){
 const data=new Map(rows.map(row=>[row.path,decodeFirestoreFields(row.fields)]));
 if(data.size!==rows.length)throw Error('Duplicate document paths');
 const errors:string[]=[];let restaurants=0,orders=0,lines=0;
 for(const [path,row] of data){
  const parts=path.split('/');
  if(parts[0]==='restaurants'&&parts.length===2){
   restaurants++;
   if(row.restaurantId!==parts[1])errors.push('Restaurant identity mismatch');
   for(const field of ['draftCatalogId','publishedCatalogId'])if(row[field]&&!data.has(`${path}/catalogs/${row[field]}`))errors.push('Missing referenced catalog');
   if(!data.has(`${path}/private/auth`)||!data.has(`${path}/settings/general`))errors.push('Missing private restaurant records');
   const auth=data.get(`${path}/private/auth`),security=auth?.security as Record<string,unknown>|undefined;
   if(security?.firebaseUid){
    const member=data.get(`${path}/members/${security.firebaseUid}`);
    if(!member||member.role!=='owner'||!data.has(`users/${security.firebaseUid}`))errors.push('Owner membership mismatch');
    const access=row.access as Record<string,unknown>|undefined;
    if(member?.active!==(access?.active!==false))errors.push('Owner membership activation mismatch');
   }
  }
  if(parts[0]==='restaurants'&&parts[2]==='orders'&&parts.length===4){
   orders++;
   if(row.id!==parts[3]||row.restaurantId!==parts[1]||!data.has(`restaurants/${parts[1]}`))errors.push('Order identity mismatch');
   if(!rows.some(line=>line.path.startsWith(path+'/lines/')))errors.push('Order without lines');
  }
  if(parts[0]==='restaurants'&&parts[2]==='orders'&&parts[4]==='lines'&&parts.length===6){
   lines++;
   if(!data.has(parts.slice(0,4).join('/'))||row.id!==parts[5])errors.push('Orphan or mismatched order line');
  }
  if(parts[0]==='publicMenus'&&parts.length===2&&row.versionId&&!data.has(`${path}/versions/${row.versionId}`))errors.push('Missing public menu version');
 }
 if(errors.length)throw Error(`Document integrity failed: ${[...new Set(errors)].join('; ')}`);
 return {documents:rows.length,restaurants,orders,lines,verified:true};
}
