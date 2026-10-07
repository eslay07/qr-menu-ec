import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { demoCatalog, defaultSettings } from '../lib/contracts';
const base = 'http://127.0.0.1:4180';
const restaurant = '998d4980-a169-469f-b009-634a373ca7ad';
const event = { id:'cancel-42', kind:'order', title:'Pedido cancelado por el comensal', message:'El comensal canceló Pedido 42 · USD 8.00.', read:false, createdAt:'2026-10-07T12:00:00.000Z' };
const browser = await chromium.launch();
await mkdir('outputs/notifications-qa', {recursive:true});
try {
  for (const width of [320,360,390,1440]) {
    const page = await browser.newPage({viewport:{width,height:844}});
    let marked = false;
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/session')) return route.fulfill({json:{authenticated:true,configured:true,runtime:'cloud',csrfToken:'test-csrf'}});
      if (path.endsWith('/state')) return route.fulfill({json:{restaurantId:restaurant,revision:1,draft:demoCatalog,settings:defaultSettings,published:null,role:'owner',features:['orders','promotions'],businessReady:true,entitlements:{push:false,notificationPreferences:false}}});
      if (path.endsWith('/notifications/cancel-42/read')) { marked = true; return route.fulfill({json:{ok:true}}); }
      if (path.endsWith('/notifications/cancel-42')) return route.fulfill({json:{notification:{...event,read:marked}}});
      if (path.endsWith('/notifications/missing')) return route.fulfill({status:404,json:{error:'El aviso no existe en este restaurante.'}});
      if (path.endsWith('/notifications')) return route.fulfill({json:{notifications:[{...event,read:marked}],nextCursor:null}});
      return route.fulfill({json:{}});
    });
    await page.goto(`${base}/r/${restaurant}/?notification=cancel-42&restaurant=${restaurant}`);
    await expect(page.getByRole('article',{name:'Detalle de la notificación'})).toBeVisible();
    await expect(page.getByRole('article').getByText(event.message,{exact:true})).toBeVisible();
    await expect(page.getByRole('article').getByText('Pedidos · Leído',{exact:true})).toBeVisible();
    if(width<640) {
      await expect(page.locator('.nav-mobile-label').filter({hasText:/^Avisos$/})).toBeVisible();
      if(!await page.locator('.sidebar nav').evaluate(nav=>[...nav.querySelectorAll('button')].every(button=>{const label=button.querySelector('.nav-mobile-label')!.getBoundingClientRect(),box=button.getBoundingClientRect();return label.left>=box.left && label.right<=box.right && box.height>=44;}))) throw Error('Mobile navigation labels overlap.');
    }
    await page.screenshot({path:`outputs/notifications-qa/detail-${width}.png`});
    await page.getByRole('button',{name:'Volver a notificaciones'}).click();
    await page.getByRole('button',{name:'Ver detalle'}).click();
    await expect(page.getByRole('article')).toBeVisible();
    await page.reload(); await expect(page.getByRole('article')).toBeVisible();
    await page.goto(`${base}/r/${restaurant}/?notification=missing&restaurant=${restaurant}`);
    await expect(page.getByRole('alert')).toContainText('El aviso no existe');
    await page.close();
  }
  await writeFile('outputs/notifications-qa/result.json',JSON.stringify({checkedAt:new Date().toISOString(),passed:true,viewports:[320,360,390,1440],exactDetail:true,readPersisted:true,reload:true,missingEventHandled:true,mobileLabels:true,mockedLocalOnly:true},null,2));
  console.log('Notifications QA: exact detail, read state, reload and missing event passed in mobile and desktop.');
} finally { await browser.close(); }
