import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

let env;
before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with the Firestore emulator; never use production.');
  env = await initializeTestEnvironment({
    projectId: 'demo-qr-menu-ec',
    firestore: { rules: await readFile(new URL('../src/lib/firebase.rules', import.meta.url), 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const id of ['a', 'b']) {
      await setDoc(doc(db, `restaurants/${id}`), {
        name: `Restaurante ${id}`, tagline: '', access: { active: true, features: ['orders'], maxDishes: 40 },
      });
      await setDoc(doc(db, `restaurants/${id}/members/owner-${id}`), { role: 'owner', active: true });
      await setDoc(doc(db, `restaurants/${id}/settings/general`), { ordersEnabled: false, webUrl: '' });
      await setDoc(doc(db, `restaurants/${id}/catalogs/draft/dishes/dish`), { name: 'Plato', priceCents: 500 });
      await setDoc(doc(db, `users/owner-${id}`), { displayName: id, locale: 'es-EC', role: 'owner' });
      await setDoc(doc(db, `restaurants/${id}/notifications/test`), { read: false, title: 'Pedido' });
      await setDoc(doc(db, `restaurants/${id}/backups/test`), { status: 'verified' });
      await setDoc(doc(db, `restaurants/${id}/private/auth`), { private: true });
    }
    await setDoc(doc(db, 'publicMenus/a'), { activeVersion: 1 });
    await setDoc(doc(db, 'publicMenus/a/versions/1/dishes/dish'), { name: 'Plato' });
    for (const collection of ['rateLimits', 'auditEvents', 'hostnames']) {
      await setDoc(doc(db, `${collection}/private`), { private: true });
    }
  });
});
after(async () => { if (env) await env.cleanup(); });

test('push device tokens, delivery queue and ownership index are server-only', async () => {
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext('owner-a')]) {
    for (const path of ['restaurants/a/pushDevices/test', 'restaurants/a/pushJobs/test', 'platformConfig/pushTokens/entries/test']) {
      await assertFails(getDoc(doc(context.firestore(), path)));
      await assertFails(setDoc(doc(context.firestore(), path), { token: 'forged' }));
    }
  }
});

test('owner reads and updates permitted fields only within their restaurant', async () => {
  const db = env.authenticatedContext('owner-a').firestore();
  await assertSucceeds(getDoc(doc(db, 'restaurants/a')));
  await assertSucceeds(updateDoc(doc(db, 'restaurants/a'), { name: 'Mi carta' }));
  await assertSucceeds(updateDoc(doc(db, 'restaurants/a/settings/general'), { ordersEnabled: true }));
  await assertSucceeds(getDoc(doc(db, 'restaurants/a/catalogs/draft/dishes/dish')));
  await assertFails(getDoc(doc(db, 'restaurants/b')));
  await assertFails(getDoc(doc(db, 'restaurants/b/catalogs/draft/dishes/dish')));
  await assertFails(updateDoc(doc(db, 'restaurants/b'), { name: 'Intrusión' }));
  await assertFails(setDoc(doc(db, 'restaurants/b/catalogs/draft/dishes/new'), { name: 'Intrusión' }));
});

test('owner cannot grant membership, change limits, publish or forge order prices', async () => {
  const db = env.authenticatedContext('owner-a').firestore();
  await assertFails(setDoc(doc(db, 'restaurants/b/members/owner-a'), { role: 'owner', active: true }));
  await assertFails(updateDoc(doc(db, 'restaurants/a'), { 'access.maxDishes': 150 }));
  await assertFails(updateDoc(doc(db, 'restaurants/a'), { 'access.features': ['orders', 'promotions'] }));
  await assertFails(setDoc(doc(db, 'restaurants/a/orders/forged'), { totalCents: 1 }));
  await assertFails(setDoc(doc(db, 'restaurants/a/catalogs/published'), { version: 1 }));
});

test('public menu and nested dishes are readable anonymously but never writable', async () => {
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext('owner-a')]) {
    const db = context.firestore();
    for (const path of ['publicMenus/a', 'publicMenus/a/versions/1/dishes/dish']) {
      await assertSucceeds(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { malicious: true }));
    }
  }
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'restaurants/a')));
});

test('private server collections deny all client access, including claimed creator', async () => {
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext('owner-a'), env.authenticatedContext('creator', { role: 'creator' })]) {
    for (const collection of ['rateLimits', 'auditEvents', 'hostnames', 'platformConfig', 'migrationRuns']) {
      const ref = doc(context.firestore(), `${collection}/private`);
      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { malicious: true }));
    }
  }
});

test('profile is private and cannot be used for privilege escalation', async () => {
  const db = env.authenticatedContext('owner-a').firestore();
  await assertSucceeds(getDoc(doc(db, 'users/owner-a')));
  await assertSucceeds(updateDoc(doc(db, 'users/owner-a'), { displayName: 'Dueño' }));
  await assertFails(getDoc(doc(db, 'users/owner-b')));
  await assertFails(updateDoc(doc(db, 'users/owner-b'), { displayName: 'Intrusión' }));
  await assertFails(updateDoc(doc(db, 'users/owner-a'), { role: 'creator' }));
  await assertFails(setDoc(doc(db, 'users/owner-a/devices/forged'), { active: true }));
});

test('missing, inactive memberships and suspended restaurants fail closed', async () => {
  const outsider = env.authenticatedContext('outsider').firestore();
  await assertFails(getDoc(doc(outsider, 'restaurants/a')));
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'restaurants/b'), { 'access.active': false });
    await setDoc(doc(context.firestore(), 'restaurants/a/members/inactive'), { role: 'owner', active: false });
  });
  await assertFails(getDoc(doc(env.authenticatedContext('owner-b').firestore(), 'restaurants/b')));
  await assertFails(getDoc(doc(env.authenticatedContext('inactive').firestore(), 'restaurants/a')));
});

test('notifications permit read-state changes only; backup manifests never client writes', async () => {
  const db = env.authenticatedContext('owner-a').firestore();
  await assertSucceeds(getDoc(doc(db, 'restaurants/a/notifications/test')));
  await assertSucceeds(updateDoc(doc(db, 'restaurants/a/notifications/test'), { read: true }));
  await assertFails(updateDoc(doc(db, 'restaurants/a/notifications/test'), { title: 'Forged' }));
  await assertFails(updateDoc(doc(db, 'restaurants/a/notifications/test'), { read: 'yes' }));
  await assertFails(getDoc(doc(db, 'restaurants/b/notifications/test')));
  await assertSucceeds(getDoc(doc(db, 'restaurants/a/backups/test')));
  await assertFails(setDoc(doc(db, 'restaurants/a/backups/forged'), { status: 'verified' }));
  await assertFails(getDoc(doc(db, 'restaurants/a/private/auth')));
  await assertFails(getDoc(doc(db, 'platformConfig/ownerEmails/entries/private')));
  await assertFails(getDoc(doc(db, 'platformConfig/orderTokens/entries/private')));
});
