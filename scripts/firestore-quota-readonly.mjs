import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require=createRequire(import.meta.url), project='qr-menu-6981a';
const auth=require('firebase-tools/lib/auth');
await require('firebase-tools/lib/requireAuth').requireAuth({project,nonInteractive:true,...auth.getProjectDefaultAccount(process.cwd())});
const token=await require('firebase-tools/lib/apiv2').getAccessToken();
const results=[];
for(const metric of ['read_count','write_count']){
 const url=new URL(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`);
 url.searchParams.set('filter',`metric.type = "firestore.googleapis.com/document/${metric}"`);
 url.searchParams.set('interval.startTime','2026-10-05T07:00:00Z');
 url.searchParams.set('interval.endTime',new Date().toISOString());
 url.searchParams.set('aggregation.alignmentPeriod','60s');
 url.searchParams.set('aggregation.perSeriesAligner','ALIGN_SUM');
 const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
 const value=await response.json();
 results.push({metric,status:response.status,error:value.error?.status,series:value.timeSeries?.map(row=>({labels:row.metric.labels,total:Number(row.points?.reduce((sum,point)=>sum+Number(point.value?.int64Value||point.value?.doubleValue||0),0)||0),earliest:row.points?.at(-1)?.interval.startTime,latest:row.points?.[0]?.interval.endTime}))});
}
const receipt={checkedAt:new Date().toISOString(),startTime:'2026-10-05T07:00:00Z',dataWrites:0,results};
await mkdir('work/firestore-runtime-diagnostic',{recursive:true});await writeFile('work/firestore-runtime-diagnostic/metrics.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
