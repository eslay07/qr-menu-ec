import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
void test('generated braces remains a synchronous CommonJS function with compatible parser subpaths', () => {
  const braces = require('braces') as { expand(pattern: string): string[] };
  assert.equal(typeof braces, 'function');
  const parse = require('braces/lib/parse') as (pattern: string) => unknown;
  assert.equal(parse, require('braces/lib/parse.js'));
  assert.deepEqual(braces.expand('a/{b,c}'), ['a/b', 'a/c']);
  assert.throws(() => parse('{'.repeat(64)), /nesting exceeds safe depth/);
});
void test('checked-in CommonJS distribution exactly reproduces the maintained ES module sources', () => {
  assert.match(execFileSync(process.execPath, ['vendor/braces/build.mjs', '--check'], { encoding: 'utf8' }), /build verified/);
});
