import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppearanceEditor, CategoriesEditor } from '../app/ui/catalog-editors';
import ContactEditor from '../app/ui/contact-editor';
import Menu from '../app/ui/menu';
import { blankCatalog, palettePresets, actionText, contrastRatio, publishNameValid, type Catalog } from '../lib/contracts';
const ignore = () => {};
test('appearance preview uses the actual persisted action role and shared readable text',()=>{
 for (const theme of Object.values(palettePresets)) {
  const catalog={...blankCatalog,theme};
  const html=renderToStaticMarkup(React.createElement(AppearanceEditor,{draft:catalog,saved:catalog,setDraft:ignore}));
  assert.ok(html.includes(`background:${theme.action};color:${actionText(theme.action)}`));
  assert.ok(contrastRatio(theme.action,actionText(theme.action))>=4.5);
  assert.ok(html.includes('Restaurar guardados'));
  assert.ok(html.includes('Restablecer predeterminados'));
  for(const role of ['Fondo','Superficie o tarjetas','Texto','Acento','Botón de acción'])assert.ok(html.includes(`HEX ${role}`));
 }
});
test('one minimum category cannot be deleted and categories with dishes require a target',()=>{
 const html=renderToStaticMarkup(React.createElement(CategoriesEditor,{draft:{...blankCatalog,categories:[{id:'minimum',name:'Única'}]},setDraft:ignore}));
 assert.match(html,/disabled=""[^>]*>Eliminar/);
 const catalog:Catalog={...blankCatalog,categories:[{id:'a',name:'A'},{id:'b',name:'B'}],dishes:[{id:'p',name:'P',description:'',image:'',available:true,priceCents:100,categoryId:'a',modifierGroups:[]}]};
 const occupied=renderToStaticMarkup(React.createElement(CategoriesEditor,{draft:catalog,setDraft:ignore}));
 assert.ok(occupied.includes('Reasignar platos a'));
 assert.ok(occupied.includes('Elige categoría'));
});
test('contact editor never supplies a default personal number and marks invalid phone',()=>{
 const html=renderToStaticMarkup(React.createElement(ContactEditor,{draft:blankCatalog,setDraft:ignore}));
 assert.ok(html.includes('America/Guayaquil'));
 assert.ok(html.includes('preparar solicitudes'));
 assert.ok(!html.includes('+5939'));
 const invalid={...blankCatalog,contact:{address:'',phone:'javascript:1',whatsapp:'',hours:[]}};
 const error=renderToStaticMarkup(React.createElement(ContactEditor,{draft:invalid,setDraft:ignore}));
 assert.ok(error.includes('Teléfono inválido'));
 assert.ok(error.includes('aria-invalid="true"'));
});
test('all menu templates share content and invalid numbers never create call links',()=>{
 for(const template of ['list','cards','compact'] as const){
  const initialCatalog={...blankCatalog,name:'Prueba Producto ficticia',template,contact:{address:'Calle ficticia',phone:'javascript:alert(1)',whatsapp:'',hours:[]}};
  const html=renderToStaticMarkup(React.createElement(Menu,{initialCatalog,demo:true}));
  assert.ok(html.includes(`template-${template}`));assert.ok(html.includes('Prueba Producto ficticia'));assert.ok(!html.includes('tel:javascript'));assert.ok(!html.includes('Abierto según horario'));
 }
});

test('unconfirmed default names remain blocked with invisible Unicode but legitimate confirmation works',()=>{
 for(const name of ['Mi restaurante\u200B',' Mi\u00A0restaurante ','mi restaurante','Ｍｉ restaurante'])assert.equal(publishNameValid({name,nameConfirmed:false}),false);
 assert.equal(publishNameValid({name:'Mi restaurante',nameConfirmed:true}),true);
 assert.equal(publishNameValid({name:'Mi restaurante'},true),true);
});
