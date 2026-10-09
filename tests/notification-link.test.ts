import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationTarget, preserveNotification } from '../lib/notification-link';
const restaurant = '998d4980-a169-469f-b009-634a373ca7ad';
void test('notification deep links select the exact event within a restaurant', () => {
  assert.equal(notificationTarget('daily-2026-10-07', restaurant), `/r/${restaurant}/?notification=daily-2026-10-07&restaurant=${restaurant}`);
  assert.notEqual(notificationTarget('first', restaurant), notificationTarget('second', restaurant));
});
void test('login and remembered-device renewal preserve the exact notification without open redirects', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://qr-menu-ec.consola.workers.dev',search:`?notification=order-42&restaurant=${restaurant}`}});
  try {
    assert.equal(preserveNotification(`/r/${restaurant}/`,true),`/r/${restaurant}/?notification=order-42&restaurant=${restaurant}&remembered=1`);
    assert.throws(() => preserveNotification('https://evil.example',true));
  } finally {
    if (previous) Object.defineProperty(globalThis,'location',previous);
    else Reflect.deleteProperty(globalThis,'location');
  }
});
void test('push cannot supply an arbitrary URL, path or unbounded identifier', () => {
  for (const id of ['https://evil.example', '../private', '<script>', 'a'.repeat(101), null]) assert.equal(notificationTarget(id, restaurant), null);
  assert.equal(notificationTarget('order', 'another-restaurant'), null);
});
