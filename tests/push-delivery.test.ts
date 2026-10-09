import { jsonRequestBody } from './http-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FcmSender, pushRetryAt } from '../lib/push-delivery';

const message = { token: 'test-token-that-is-not-a-real-device', eventId: 'order-test', restaurantId: '998d4980-a169-469f-b009-634a373ca7ad' };
void test('FCM preserves the global fetch receiver required by Cloudflare Workers', async () => {
  const transport = async function (this: unknown) {
    assert.equal(this, globalThis);
    return Response.json({ name: 'projects/demo/messages/test' });
  } as typeof fetch;
  assert.equal(await new FcmSender('demo-qr-menu-ec', async () => 'test', transport).send(message), 'sent');
});
void test('FCM sends generic data only, with bounded TTL and authorized project', async () => {
  const sender = new FcmSender('demo-qr-menu-ec', async () => 'test-bearer', async (url, init) => {
    assert.equal(url, 'https://fcm.googleapis.com/v1/projects/demo-qr-menu-ec/messages:send');
    const payload = jsonRequestBody<{message:{token:string;data:Record<string,string>;android:{ttl:string;collapse_key?:string};webpush:{headers:{TTL:string}}}}>(init?.body).message;
    assert.equal(payload.token, message.token);
    assert.deepEqual(Object.keys(payload.data).sort(), ['body', 'eventId', 'restaurantId', 'title']);
    assert.equal(payload.android.ttl, '3600s');
    assert.equal(payload.webpush.headers.TTL, '3600');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-bearer');
    return Response.json({ name: 'projects/demo/messages/test' });
  });
  assert.equal(await sender.send(message), 'sent');
});
void test('FCM distinguishes unregistered tokens, payload errors and retryable errors', async () => {
  for (const [status, code, expected] of [[404, 'UNREGISTERED', 'invalid-token'], [400, 'INVALID_ARGUMENT', 'rejected'], [429, '', 'retry'], [503, '', 'retry'], [403, '', 'retry']] as const) {
    const sender = new FcmSender('demo-qr-menu-ec', async () => 'test', async () => Response.json({ error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] } }, { status }));
    assert.equal(await sender.send(message), expected);
  }
  assert.equal(await new FcmSender('demo-qr-menu-ec', async () => { throw Error('offline'); }).send(message), 'retry');
  assert.equal(pushRetryAt(1, 0).getTime(), 60_000);
  assert.equal(pushRetryAt(20, 0).getTime(), 3_600_000);
});
void test('FCM delivers the actual reason without collapsing distinct restaurant events', async () => {
  const sender = new FcmSender('demo-qr-menu-ec', async () => 'test', async (_url, init) => {
    const payload = jsonRequestBody<{message:{token:string;data:Record<string,string>;android:{ttl:string;collapse_key?:string};webpush:{headers:{TTL:string}}}}>(init?.body).message;
    assert.equal(payload.data.title, 'Pedido cancelado');
    assert.equal(payload.data.body, 'Pedido 42 cancelado · USD 8.00');
    assert.equal(payload.android.collapse_key, undefined);
    assert.equal(payload.data.eventId, 'cancel-42');
    return Response.json({ name:'test' });
  });
  assert.equal(await sender.send({...message,eventId:'cancel-42',title:'Pedido cancelado',body:'Pedido 42 cancelado · USD 8.00'}),'sent');
  await assert.rejects(sender.send({...message,eventId:'../other'}));
});
