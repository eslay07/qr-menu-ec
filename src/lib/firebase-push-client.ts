import { getApp, getApps, initializeApp } from 'firebase/app';
import { getMessaging, isSupported, onMessage } from 'firebase/messaging';

// Push-only entrypoint: loading notifications does not initialize Firestore,
// Storage, Analytics or a second persistent Auth session.
const app = getApps().some(value => value.name === 'qrmenu-push') ? getApp('qrmenu-push') : initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}, 'qrmenu-push');
export const messaging = typeof window !== 'undefined' && window.isSecureContext
  ? isSupported().then(supported => supported ? getMessaging(app) : null) : Promise.resolve(null);
let listening = false;
export async function receiveForeground(registration: ServiceWorkerRegistration) {
  const instance = await messaging;
  if (!instance || listening) return;
  listening = true;
  onMessage(instance, payload => {
    // The service worker checks its persisted restaurant opt-in before showing.
    registration.active?.postMessage({ type: 'foreground-push', data: payload.data });
  });
}
