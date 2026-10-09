import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

void test('la ficha rechaza pendientes, casos duplicados y combinaciones cambiadas',()=>{
 const dir=mkdtempSync(join(tmpdir(),'qrmenu-cert-test-')),file=join(dir,'fixture.json');
 const run=(command:string)=>spawnSync(process.execPath,[resolve('tools/certification.mjs'),command,file],{encoding:'utf8'});
 try{
  assert.equal(run('crear').status,0);assert.equal(run('revisar').status,2);
  const report=JSON.parse(readFileSync(file,'utf8'));
  report.technician='Fixture de prueba';report.restaurant='NO ES CERTIFICACIÓN';
  report.server={type:'android',model:'fixture',osVersion:'fixture',appVersion:'fixture',sha256:'a'.repeat(64)};
  report.router={model:'fixture',firmware:'fixture',openNDS:'fixture'};
  for(const client of Object.values(report.clients) as {model:string;osVersion:string}[]){client.model='fixture';client.osVersion='fixture'}
  report.observedWifiClients=30;report.androidHours=8;
  for(const c of report.cases){c.result='aprobado';c.evidence='Evidencia ficticia exclusiva de prueba automatizada';c.taps=2;c.seconds=3}
  const save=()=>writeFileSync(file,JSON.stringify(report));save();assert.equal(run('revisar').status,0);
  report.cases[0].network='recordada';save();assert.equal(run('revisar').status,2);
  report.cases[0].network='olvidada';report.cases.push(report.cases[0]);save();assert.equal(run('revisar').status,2);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
