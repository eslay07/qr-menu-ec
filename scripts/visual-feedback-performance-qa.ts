import { chromium } from '@playwright/test';
const outputDir = process.env.QA_OUTPUT_DIR || 'outputs/mobile-performance';
import { mkdir, writeFile } from 'node:fs/promises';
import { demoCatalog } from '../lib/contracts';
type Sample={size:number;interaction:'search'|'category'|'cart-add';iteration:number;eventToMutationMs:number;visualMs:number};
const phase=process.env.QA_PHASE || 'before';
if(!['before','after'].includes(phase))throw Error('QA_PHASE must be before or after');
const base=process.env.QA_URL || (phase==='before'?'http://127.0.0.1:4181':'http://127.0.0.1:4185');
if(!/^https?:$/.test(new URL(base).protocol)||!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Synthetic fixtures require loopback preview');
const browser=await chromium.launch(),samples:Sample[]=[];
try {
 for(const size of [10,40]) {
  const catalog=structuredClone(demoCatalog);catalog.name='QA FICTICIO · respuesta visual';catalog.promotions=[];
  catalog.dishes=Array.from({length:size},(_,i)=>({...catalog.dishes[0],id:'qa-'+i,name:'Plato ficticio '+i,categoryId:catalog.categories[i%catalog.categories.length].id,modifierGroups:[],image:''}));
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  await page.addInitScript('window.__name = (fn) => fn;');
  await page.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await page.route('**/api/v1/menu',route=>route.fulfill({json:{catalog,ordersEnabled:true,version:1}}));
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1600000/8,uploadThroughput:750000/8});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto(base+'/menu',{waitUntil:'networkidle'});await page.locator('.dish-card').first().waitFor();
  const restingCount=await page.locator('.dish-card').count();
  const measure=async(interaction:Sample['interaction'],iteration:number,expected:number,act:()=>Promise<unknown>)=>{
   await page.evaluate(({interaction,expected})=>{
    const bridge=window as unknown as {__visualFeedback:Promise<{eventToMutationMs:number;visualMs:number}>};
    bridge.__visualFeedback=new Promise((resolve,reject)=>{
     let started:number|undefined,settled=false;
     const ready=()=>interaction==='search'?document.querySelectorAll('.dish-card').length===expected:interaction==='category'?!!document.querySelector('.category-tabs button.selected')&&document.querySelectorAll('.dish-card').length===expected&&document.querySelector('.category-tabs button.selected')?.textContent?.trim()!=='Todo el menú':Number(document.querySelector('.bag-icon b')?.textContent)===expected;
     const finish=()=>{
      if(started===undefined||settled||!ready())return;settled=true;const mutationAt=performance.now();observer.disconnect();
      requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);document.removeEventListener('input',capture,true);document.removeEventListener('click',capture,true);resolve({eventToMutationMs:mutationAt-started!,visualMs:performance.now()-started!});}));
     };
     const capture=(event:Event)=>{
      const target=event.target instanceof Element?event.target:null;
      const match=interaction==='search'?event.type==='input'&&target?.matches('input[aria-label="Buscar platos"]'):event.type==='click'&&!!target?.closest(interaction==='category'?'.category-tabs button':'.add-dish');
      if(match&&started===undefined)started=performance.now();
     };
     const observer=new MutationObserver(finish);observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
     document.addEventListener('input',capture,true);document.addEventListener('click',capture,true);
     const timer=setTimeout(()=>{observer.disconnect();document.removeEventListener('input',capture,true);document.removeEventListener('click',capture,true);reject(new Error('Expected visual response not observed: '+interaction));},5000);
    });
   },{interaction,expected});
   await act();
   const result=await page.evaluate(()=>(window as unknown as {__visualFeedback:Promise<{eventToMutationMs:number;visualMs:number}>}).__visualFeedback);
   samples.push({size,interaction,iteration,...result});
  };
  for(let i=1;i<=20;i++) {
   await measure('search',i,1,()=>page.getByRole('textbox',{name:'Buscar platos'}).fill('ficticio 0'));
   await page.getByRole('textbox',{name:'Buscar platos'}).fill('');await page.waitForFunction(n=>document.querySelectorAll('.dish-card').length===n,restingCount,{timeout:3000}).catch(async error=>{throw new Error(JSON.stringify({size,iteration:i,cards:await page.locator('.dish-card').count(),selected:await page.locator('.category-tabs button.selected').textContent(),cause:String(error)}));});
   const count=catalog.dishes.filter(d=>d.categoryId===catalog.categories[0].id).length;
   await measure('category',i,count,()=>page.locator('.category-tabs button').nth(1).click());
   await page.getByRole('button',{name:'Todo el menú',exact:true}).click();await page.waitForFunction(n=>document.querySelectorAll('.dish-card').length===n,restingCount);
   await measure('cart-add',i,i,()=>page.locator('.add-dish').first().click());
  }
  await context.close();
 }
 const summary=[10,40].flatMap(size=>['search','category','cart-add'].map(interaction=>{
  const rows=samples.filter(s=>s.size===size&&s.interaction===interaction);
  const statistics=(field:'eventToMutationMs'|'visualMs')=>{const values=rows.map(r=>r[field]).sort((a,b)=>a-b);return {medianMs:(values[9]+values[10])/2,minMs:values[0],maxMs:values.at(-1),samples:values.length};};
  return {size,interaction,eventToMutation:statistics('eventToMutationMs'),eventToTwoAnimationFrames:statistics('visualMs')};
 }));
 await mkdir(outputDir,{recursive:true});
 await writeFile(outputDir+'/visual-'+phase+'.json',JSON.stringify({phase,base,recordedAt:new Date().toISOString(),profile:{width:390,cpu:4,downloadMbps:1.6,uploadKbps:750,rttMs:150},method:'Browser capture listener starts performance.now at input/click. MutationObserver waits for expected DOM result, then two requestAnimationFrame callbacks. Playwright only triggers actions; its locator/action duration is outside the measured interval.',limitations:['Loopback fixed built bundle with mocked fictional public API and no photos; not production or physical Android.','Two animation frames are a presentation opportunity proxy, not observed pixels or INP.','Starts at browser event capture; does not include hardware input latency or browser queue before dispatch.','One page load per catalog; this run measures interactions only. The 40-product catalog uses the existing first 30-card rendering window.','Network emulation applies to preview resources; fixture response is mocked.'],summary,samples},null,2));
 console.log(JSON.stringify({phase,measurements:samples.length,summary}));
} finally {await browser.close();}
