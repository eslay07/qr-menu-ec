// A control-plane acknowledgement is not evidence that every edge has switched.
// Do not export/migrate until ALL probes succeed for three complete rounds.
export async function awaitMaintenance(probe, { rounds=3, timeoutMs=90000, intervalMs=3000, now=Date.now, sleep=ms=>new Promise(r=>setTimeout(r,ms)) }={}) {
  const start=now();let consecutive=0;const attempts=[];
  while(now()-start<timeoutMs) {
    const results=await probe();
    const passed=results.length>0&&results.every(r=>r.status===503&&r.marker==='write-freeze-v1'&&r.build==='d1-freeze-v2');
    attempts.push({elapsedMs:now()-start,passed,results});
    consecutive=passed?consecutive+1:0;
    if(consecutive>=rounds)return attempts;
    await sleep(intervalMs);
  }
  throw Error('Maintenance did not converge; no backup or migration allowed');
}
