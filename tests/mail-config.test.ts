import test from 'node:test';
import assert from 'node:assert/strict';
import { mailFrom, validateMailRecipient } from '../lib/mail-config';

void test('mail domain keeps current sender until a verified custom domain is supplied', () => {
  assert.equal(mailFrom({ MAIL_DOMAIN: '', EMAIL_FROM: 'test@example.com' }), 'test@example.com');
  assert.equal(mailFrom({ MAIL_DOMAIN: ' Menu.Example.com ' }), 'QR Menu EC <notificaciones@menu.example.com>');
  for (const MAIL_DOMAIN of ['consola.workers.dev', 'workers.dev', 'evil.com\r\nBcc: x@example.com', 'https://example.com']) assert.throws(() => mailFrom({ MAIL_DOMAIN }));
});

void test('sandbox uses Resend test sender and permits only the configured account recipient', () => {
  const env = { MAIL_SANDBOX: 'true', MAIL_SANDBOX_TO: 'owner@example.test' };
  assert.match(mailFrom(env)!, /onboarding@resend.dev/);
  assert.doesNotThrow(() => validateMailRecipient(env, 'owner@example.test'));
  assert.throws(() => validateMailRecipient(env, 'customer@example.test'));
  assert.throws(() => validateMailRecipient({ MAIL_SANDBOX: 'true' }, 'owner@example.test'));
  assert.doesNotThrow(() => validateMailRecipient({ ...env, MAIL_DOMAIN: 'example.com' }, 'customer@example.com'));
});
