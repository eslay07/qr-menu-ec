import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('outputs/mobile-performance', {recursive:true});
// Fixed copied bundles, one browser at a time, identical lab conditions.
for (const phase of ['before','after']) {
  for (const script of ['mobile-performance-qa.ts','owner-performance-qa.ts','session-performance-qa.ts']) {
    const result=spawnSync(process.execPath,['--import','tsx','scripts/'+script],{
      encoding:'utf8',windowsHide:true,
      env:{...process.env,QA_PHASE:phase,QA_URL:phase==='before'?'http://127.0.0.1:4181':'http://127.0.0.1:4182'},
    });
    const name=phase+'-'+script.replace('.ts','');
    writeFileSync('outputs/mobile-performance/'+name+'.log',(result.stdout||'')+(result.stderr||''));
    console.log(name+': exit '+result.status);
    if(result.status!==0)process.exit(result.status||1);
  }
}
const result=spawnSync(process.execPath,['scripts/performance-summary.mjs'],{encoding:'utf8',windowsHide:true});
writeFileSync('outputs/mobile-performance/summary.log',(result.stdout||'')+(result.stderr||''));
if(result.status!==0)process.exit(result.status||1);
console.log('Comparable serial measurements saved.');
