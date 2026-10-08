import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog, blankCatalog, palettePresets, contrastRatio, publishNameValid, isRestaurantOpen, activePromotion } from '../lib/contracts';
import { HexColor } from '../lib/menu-design';
void test('color roles normalize HEX, reject CSS and prevent unreadable themes',()=>{
 assert.equal(HexColor.parse('#abc'),'#AABBCC');assert.equal(HexColor.safeParse('red;background:url(x)').success,false);
 for(const theme of Object.values(palettePresets))assert.ok(Catalog.safeParse({...blankCatalog,theme}).success);
 assert.equal(contrastRatio('#000','#fff'),21);assert.equal(Catalog.safeParse({...blankCatalog,theme:{...palettePresets.neutral,text:'#FFFFFF'}}).success,false);
});
void test('names and category relations reject invisible or confusing values',()=>{
 assert.equal(publishNameValid({...blankCatalog,name:'\u200b \u2060'}),false);assert.equal(publishNameValid(blankCatalog),false);assert.equal(publishNameValid({...blankCatalog,nameConfirmed:true}),true);
 assert.equal(Catalog.safeParse({...blankCatalog,categories:[{id:'a',name:'Café'},{id:'b',name:' cafe '}]}).success,false);
 assert.equal(Catalog.safeParse({...blankCatalog,dishes:[{id:'p',name:'P',description:'',priceCents:1,categoryId:'missing',available:true,image:'',modifierGroups:[]}]}).success,false);
});
void test('overnight schedules use Guayaquil and missing data never claims open',()=>{
 assert.equal(isRestaurantOpen([],new Date()),null);
 const hours=[{day:2,closed:false,open:'22:00',close:'02:00'},{day:3,closed:true,open:'00:00',close:'00:00'}];
 assert.equal(isRestaurantOpen(hours,new Date('2026-10-07T06:00:00Z')),true);assert.equal(isRestaurantOpen(hours,new Date('2026-10-07T08:00:00Z')),false);
});
void test('informational campaigns never change prices and discounts require explicit rules',()=>{
 const promo={id:'a',dishId:'',kind:'notice',title:'Aviso',description:'2×1 informativo',badge:'',image:'',promotionalPriceCents:null,startsAt:null,endsAt:null,enabled:true};
 const catalog=Catalog.parse({...blankCatalog,promotions:[promo]});assert.equal(activePromotion(catalog,''),undefined);
 assert.equal(Catalog.safeParse({...blankCatalog,promotions:[{...promo,promotionalPriceCents:1}]}).success,false);
 assert.equal(Catalog.safeParse({...blankCatalog,promotions:[{...promo,kind:'discount'}]}).success,false);
});
