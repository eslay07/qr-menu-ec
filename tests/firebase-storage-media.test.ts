import test from 'node:test';
import assert from 'node:assert/strict';
import { FirebaseStorageMedia, copyMediaVerified } from '../lib/firebase-storage-media';
import sharp from 'sharp';
const createImage = sharp as (options: { create: { width: number; height: number; channels: number; background: string } }) => { png(): { toBuffer(): Promise<Uint8Array> } };

test('Storage isolates restaurant paths, verifies bytes and never overwrites conflicting images', async t => {
  const rid = crypto.randomUUID(), id = crypto.randomUUID();
  const data = new Map<string, { bytes: Uint8Array; type: string }>();
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const request = new URL(url);
    assert.equal(request.hostname, 'storage.googleapis.com');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fake-test');
    const name = request.searchParams.get('name') || decodeURIComponent(request.pathname.split('/o/')[1]);
    if (init.method === 'POST') {
      assert.equal(request.searchParams.get('ifGenerationMatch'), '0');
      if (data.has(name)) return new Response('{}', { status: 412 });
      data.set(name, { bytes: new Uint8Array(init.body as Uint8Array), type: new Headers(init.headers).get('Content-Type')! });
      return new Response('{}');
    }
    const item = data.get(name);
    return item ? new Response(item.bytes as BodyInit, { headers: { 'Content-Type': item.type } }) : new Response('', { status: 404 });
  });
  const storage = new FirebaseStorageMedia('test.firebasestorage.app', rid, async () => 'fake-test');
  const bytes = new Uint8Array(await createImage({ create: { width: 2, height: 2, channels: 3, background: '#ff0000' } }).png().toBuffer());
  assert.equal(await copyMediaVerified([id, id], { async mediaGet() { return { bytes, type: 'image/png' }; } }, storage), 1);
  assert.deepEqual((await storage.mediaGet(id))?.bytes, bytes);
  await storage.mediaPut(id, bytes, 'image/png');
  await assert.rejects(storage.mediaPut(id, new Uint8Array([4]), 'image/png'));
  const different = new Uint8Array(await createImage({ create: { width: 2, height: 2, channels: 3, background: '#00ff00' } }).png().toBuffer());
  await assert.rejects(storage.mediaPut(id, different, 'image/png'), /diferente/);
  assert.equal(await new FirebaseStorageMedia('test.firebasestorage.app', crypto.randomUUID(), async () => 'fake-test').mediaGet(id), null);
  await assert.rejects(storage.mediaGet('../escape'));
  await assert.rejects(storage.mediaPut(id, bytes, 'image/svg+xml'));
  await assert.rejects(storage.mediaPut(id, new Uint8Array(1048577), 'image/png'));
});
