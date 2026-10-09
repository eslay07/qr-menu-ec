import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),braces=require('braces');
void test('installed transitive braces uses the reviewed local patch',()=>{
 assert.equal(require('braces/package.json').version,'3.0.4-qrmenu.1');
});
void test('bounded braces preserves normal glob compilation, expansion, quotes and escapes',()=>{
 assert.deepEqual(braces.expand('src/{lib,app}/*.{ts,tsx}'),['src/lib/*.ts','src/lib/*.tsx','src/app/*.ts','src/app/*.tsx']);
 assert.deepEqual(braces.expand('{1..3}'),['1','2','3']);
 assert.deepEqual(braces.expand('a/{b,{c,d}}/e'),['a/b/e','a/c/e','a/d/e']);
 assert.deepEqual(braces('foo/{a,b}'),['foo/(a|b)']);
 assert.doesNotThrow(()=>braces('"'+'{'.repeat(200)+'"'));
 assert.doesNotThrow(()=>braces('\\{'.repeat(200)));
});
void test('deep brace and parenthesis patterns fail explicitly before recursive stack exhaustion',()=>{
 for(const [open,close] of [['{','}'],['(',')']]){
  const pattern=open.repeat(4000)+'a'+close.repeat(4000);
  for(const method of [braces,braces.parse,braces.compile,braces.expand])assert.throws(()=>method(pattern),/nesting exceeds safe depth/);
 }
});
