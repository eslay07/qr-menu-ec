import {localFirestore} from '../../lib/application-repository';
import {AuthSecurity,type SecurityEnv} from '../../lib/auth-security';
import {FcmSender} from '../../lib/push-delivery';
import {FirestorePush,pushJob} from '../../lib/firestore-push';
import {firestoreBearer} from '../../lib/firestore-credentials';
type Env=SecurityEnv & {QA_TOKEN:string;QA_EXPIRES:string;FIREBASE_FCM_SERVICE_ACCOUNT:string;FIREBASE_PROJECT_ID:string};
const worker = {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/test'||request.headers.get('Authorization')!==`Bearer ${env.QA_TOKEN}`||Date.now()>Number(env.QA_EXPIRES))return new Response(null,{status:404});
 const db=localFirestore(env);if(!db)return new Response(null,{status:503});
 const registered=await db.query<{platform:string}>('pushDevices',[],100,{allDescendants:true});
 const android=registered.filter(row=>row.data.platform==='android'&&/^restaurants\/[^/]+\/pushDevices\/[^/]+$/.test(row.path));
 if(android.length!==1)return Response.json({eligibleAndroidDevices:android.length,sent:false},{status:409});
 const id=android[0].path.split('/')[1];
 const auth=await db.get<{sessionEpoch:number}>(`restaurants/${id}/private/auth`);
 const devices=(await db.list<{platform:string;sessionEpoch:number;tokenCiphertext:string;expiresAt:string;registeredAt:string}>(`restaurants/${id}/pushDevices`,20)).documents.filter(row=>row.data.platform==='android'&&row.data.sessionEpoch===auth?.data.sessionEpoch&&Date.parse(row.data.expiresAt)>Date.now());
 if(devices.length!==1)return Response.json({eligibleAndroidDevices:devices.length,sent:false},{status:409});
 const _device=devices[0];
 const sender=new FcmSender(env.FIREBASE_PROJECT_ID,firestoreBearer(env.FIREBASE_PROJECT_ID,env.FIREBASE_FCM_SERVICE_ACCOUNT,'https://www.googleapis.com/auth/firebase.messaging'));
 const security=new AuthSecurity(env),eventId=crypto.randomUUID();
 // A synthetic queue event only, never a synthetic customer order.
 const job=pushJob(id,eventId,'newOrder');await db.commit([job]);
 let sent=0;const send=sender.send.bind(sender);
 sender.send=async message=>{const result=await send(message);if(result==='sent')sent++;return result;};
 try{
  await new FirestorePush(db,id,security).dispatch(sender);
  const pending=await db.get(job.path);
  return Response.json({result:sent===1&&!pending?'sent':'queue-test-failed',eventId,queueDrained:!pending,eligibleAndroidDevices:1,productionChanged:false});
 }finally{
  const remaining=await db.get(job.path);if(remaining)await db.commit([{path:remaining.path,delete:true,updateTime:remaining.updateTime}]);
 }
}};

export default worker;
