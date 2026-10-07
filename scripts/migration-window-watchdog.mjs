import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
// Safety stop, not an activation scheduler. Parent explicitly starts it only
// after maintenance; a completed/aborted window cancels it via this marker.
const receipt=process.argv[2]||'work/migration-preparation/maintenance-version-v2.json';
const dir=process.argv[3]||'work/migration-window-2026-10-04-v3';
if(!/^work\/[a-zA-Z0-9/_.-]+\.json$/.test(receipt)||!/^work\/[a-zA-Z0-9/_.-]+$/.test(dir)||receipt.includes('..')||dir.includes('..'))throw Error('Invalid watchdog paths');
const stop=dir+'/watchdog-stop';
const deadline=Date.now()+50*60*1000;
while(Date.now()<deadline){
  if(await access(stop).then(()=>true,()=>false))process.exit(0);
  await new Promise(r=>setTimeout(r,10000));
}
const child=spawn(process.execPath,['scripts/migration-window-control.mjs','--rollback',receipt,dir],{windowsHide:true,stdio:'ignore'});
await new Promise(resolve=>child.on('close',resolve));
