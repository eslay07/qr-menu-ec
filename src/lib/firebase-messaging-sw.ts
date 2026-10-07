/// <reference lib="webworker" />
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';
import { notificationTarget } from '../../lib/notification-link';

declare const self: ServiceWorkerGlobalScope;
const preferenceUrl = new URL('/__qrmenu_push_preference__', self.location.origin).href;
async function display(data?: Record<string, string>) {
  if (!data || !notificationTarget(data.eventId, data.restaurantId)) return;
  const saved = await (await caches.open('qrmenu-push-preference')).match(preferenceUrl);
  if (!saved || await saved.text() !== data.restaurantId) return;
  await self.registration.showNotification(data.title?.slice(0,120) || 'QR Menu EC', {
    body: data.body?.slice(0,600) || 'Abre el aviso para consultar su detalle.',
    data: { eventId: data.eventId, restaurantId: data.restaurantId },
    tag: `qrmenu-${data.restaurantId}-${data.eventId}`,
  });
}
self.addEventListener('message', event => {
  if (!event.source || !('url' in event.source) || new URL(event.source.url).origin !== self.location.origin) return;
  if (event.data?.type === 'push-preference') event.waitUntil((async () => {
    const cache = await caches.open('qrmenu-push-preference');
    if (typeof event.data.restaurantId === 'string' && /^[a-f0-9-]{36}$/.test(event.data.restaurantId)) await cache.put(preferenceUrl, new Response(event.data.restaurantId));
    else await cache.delete(preferenceUrl);
  })());
  if (event.data?.type === 'foreground-push') event.waitUntil(display(event.data.data).then(() => event.ports[0]?.postMessage({ ok: true })));
});
// Set click behavior before the FCM SDK installs its handlers. Never trust a URL
// supplied by a push payload; opening the panel still requires server Auth.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = notificationTarget(event.notification.data?.eventId, event.notification.data?.restaurantId);
  event.waitUntil(self.clients.openWindow(new URL(target || '/owner', self.location.origin).href));
});
const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});
onBackgroundMessage(getMessaging(app), async payload => {
  await display(payload.data);
});
