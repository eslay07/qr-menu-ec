import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../app/ui/client';

void test('identical concurrent reads share a request but never share mutable results', async () => {
  const transport = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return Response.json({ draft: { name: 'Ficticio' } }); };
  try {
    const [first, second] = await Promise.all([api('state'), api('state')]);
    assert.equal(calls, 1);
    first.draft.name = 'Otro';
    assert.equal(second.draft.name, 'Ficticio');
    await api('state');
    assert.equal(calls, 2, 'private results are never persisted as a cache');
  } finally { globalThis.fetch = transport; }
});

void test('failed reads can retry and mutations are never deduplicated', async () => {
  const transport = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return calls === 1 ? Response.json({error:'Temporal'}, {status:503}) : Response.json({ok:true}); };
  try {
    await assert.rejects(api('state'), /Temporal/);
    assert.equal((await api('state')).ok, true);
    await Promise.all([api('draft', 'PUT', {}), api('draft', 'PUT', {})]);
    assert.equal(calls, 4);
  } finally { globalThis.fetch = transport; }
});
