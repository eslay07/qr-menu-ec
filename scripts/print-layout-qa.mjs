import { chromium } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const current=process.argv.includes('--current-d1');
const root=current?'work/d1-production-candidate':'work/print-candidate-v2';
const receipt=JSON.parse(await readFile(root+'/version.json','utf8'));
const host=`${(current?receipt.versionId:receipt.candidateVersion).slice(0,8)}-qr-menu-ec.consola.workers.dev`;
const html=current?await (await fetch(`https://${host}/owner`)).text():'';
const stylesheet=current?html.match(/href="([^"\s]+\.css)"/)?.[1]:receipt.stylesheet;
assert.ok(stylesheet,'Stylesheet must be present');
const css=await readFile(current?'dist-worker'+stylesheet:root+'/assets'+stylesheet,'utf8');
const response=await fetch(`https://${host}${stylesheet}`);
assert.equal(response.status,200);assert.ok(response.headers.get('content-type').startsWith('text/css'));assert.equal(await response.text(),css);
const qr=await QRCode.toDataURL('https://la-sazon-marinera.consola.workers.dev/menu',{width:1024,margin:4});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const reports=[];
try {
 const errors=[];page.on('pageerror',e=>errors.push(e.name));
 const loaded=await page.goto(`https://${host}/owner`);
 assert.ok(loaded.headers()['content-type'].startsWith('text/html'));
 await page.getByRole('button',{name:'Entrar a mi restaurante',exact:true}).waitFor({timeout:45000});
 assert.deepEqual(errors,[],'Candidate must render without script exceptions');
 for(const [format,name,pass]of [['A4','QRMenu-QA','qa-wifi-2026'],['Letter','Red ilustrativa con nombre largo','A'.repeat(63)]]){
  await page.setContent(`<html lang="es"><head><style>${css}</style></head><body><main class="main"><section class="card qr-print-region"><h2>No imprimir controles</h2><article class="qr-card"><span class="eyebrow">MENÚ ONLINE</span><h2>La sazón marinera</h2><img class="qr-image" src="${qr}" alt="QR del menú"><strong>Escanea para ver el menú</strong><small>https://la-sazon-marinera.consola.workers.dev/menu</small><div class="wifi-print-only"><strong>${name}</strong><p>WiFi gratis · Clave: ${pass}</p></div></article></section></main></body></html>`);
  await page.emulateMedia({media:'print'});
  await page.locator('.qr-image').evaluate(img=>img.decode());
  const measurements=await page.locator('.qr-card').evaluate(card=>({cardHeight:card.getBoundingClientRect().height,qrWidth:card.querySelector('img').getBoundingClientRect().width,wifiFontPx:parseFloat(getComputedStyle(card.querySelector('.wifi-print-only p')).fontSize),wifiWidth:card.querySelector('.wifi-print-only p').getBoundingClientRect().width,overflow:card.scrollWidth>card.clientWidth}));
  assert.ok(measurements.wifiFontPx>=26.6);assert.ok(measurements.qrWidth>=300);assert.equal(measurements.overflow,false);
  const path=`${root}/desktop-${format}.pdf`;
  const pdf=await page.pdf({path,format,margin:{top:'12mm',bottom:'12mm',left:'12mm',right:'12mm'},printBackground:true});
  assert.equal((await PDFDocument.load(pdf)).getPageCount(),1,'Entire QR card must fit on one page');
  reports.push({format,...measurements,pages:1,publicStylesheetMatches:true});
 }
 await writeFile(root+'/desktop-print-qa.json',JSON.stringify({testedAt:new Date().toISOString(),reports},null,2));
 console.log(JSON.stringify({passed:true,reports},null,2));
}finally{await browser.close()}
