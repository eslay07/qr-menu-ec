import { performanceFixture } from './performance-fixture';
import { chromium, expect } from '@playwright/test';
const outputDir = process.env.QA_OUTPUT_DIR || 'outputs/mobile-performance';
import { writeFile } from 'node:fs/promises';
import { demoCatalog } from '../lib/contracts';
import { createOrderRecord } from '../lib/orders';
const phase=process.env.QA_PHASE || 'after',sourceBase=process.env.QA_URL || 'http://127.0.0.1:4185';
if(!['localhost','127.0.0.1'].includes(new URL(sourceBase).hostname))throw Error('Local fixtures only');
const fixture = await performanceFixture(sourceBase);
const base = fixture.base;
const browser=await chromium.launch(),results:{size:number;interaction:string;iteration:number;ms:number}[]=[];
try{
 for(const size of [10,40]){
  const catalog=structuredClone(demoCatalog);catalog.promotions=[];
  catalog.dishes=Array.from({length:size},(_,i)=>({...catalog.dishes[0],id:'qa-'+i,name:'Plato ficticio '+i,modifierGroups:[]}));
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  fixture.route('**/api/v1/menu',async route=>{await route.fulfill({json:{catalog,ordersEnabled:true,version:1}});});
  fixture.route('**/api/v1/orders',async route=>{

   const created=await createOrderRecord(route.request().postDataJSON(),catalog,'11111111-1111-4111-8111-111111111111','QA FICTICIO',1);
   await route.fulfill({json:{order:created.order,publicUrl:base+'/order/ficticio',pdfUrl:base+'/ficticio.pdf',qrPayload:base+'/order/ficticio'}});
  });
  for(let iteration=1;iteration<=20;iteration++){
   await page.goto(base+'/menu');await page.locator('.dish-card').first().waitFor();
   await page.locator('.add-dish').first().click();await page.locator('.add-dish').first().click();await page.locator('.selection-bar').click();
   let start=performance.now();await page.getByRole('button',{name:'Quitar Plato ficticio 0',exact:true}).click();
   await expect(page.locator('.quantity')).toHaveText('1');results.push({size,interaction:'cart-decrease',iteration,ms:performance.now()-start});
   start=performance.now();await page.getByRole('button',{name:'Quitar Plato ficticio 0',exact:true}).click();
   await expect(page.locator('.selection-row')).toHaveCount(0);results.push({size,interaction:'cart-remove',iteration,ms:performance.now()-start});
   await page.getByRole('button',{name:'Volver al menú',exact:true}).click();await page.locator('.add-dish').first().click();await page.locator('.selection-bar').click();
   start=performance.now();await page.getByRole('button',{name:'Vaciar selección',exact:true}).click();await expect(page.locator('.selection-bar')).toHaveCount(0);results.push({size,interaction:'cart-empty',iteration,ms:performance.now()-start});
   await page.locator('.add-dish').first().click();await page.locator('.selection-bar').click();await page.getByLabel('Nombre o alias').fill('QA FICTICIO laboratorio');
   start=performance.now();await page.getByRole('button',{name:'Confirmar pedido',exact:true}).click();await page.getByRole('heading',{name:'Muéstrale este pedido al mesero'}).waitFor();results.push({size,interaction:'order-create',iteration,ms:performance.now()-start});
  }
  await context.close();
 }
 await writeFile(outputDir+'/cart-order-'+phase+'.json',JSON.stringify({recordedAt:new Date().toISOString(),limitations:['Local fixture API, controlled 150ms; real recalculation function but no persistence, Firebase or Turnstile','Emulated network/CPU, automation overhead, no physical phone'],results},null,2));
 console.log(phase+': '+results.length+' supplemental measurements');
}finally{await browser.close(); await fixture.close();}
