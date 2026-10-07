import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import type { Messaging } from 'firebase/messaging';

// Client configuration only. Never add service-account keys or server secrets here.
const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missing = Object.entries(config)
  .filter(([, value]) => typeof value !== 'string' || !value.trim())
  .map(([key]) => key);

if (missing.length) {
  throw new Error(
    `Firebase no está configurado. Completa .env.local: ${missing.join(', ')}. Consulta docs/firebase-setup.md.`,
  );
}

// Reuse the default app during Vite hot reloads.
export const firebaseApp = getApps().some((app) => app.name === '[DEFAULT]')
  ? getApp()
  : initializeApp(config);
export const db = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);
export const storage = getStorage(firebaseApp);

async function browserMessaging(): Promise<Messaging | null> {
  if (typeof window === 'undefined' || !window.isSecureContext) return null;
  const { getMessaging, isSupported } = await import('firebase/messaging');
  // isSupported is asynchronous and checks the browser APIs FCM needs.
  if (!(await isSupported())) return null;
  return getMessaging(firebaseApp);
}

// No permission prompt, registration token, service worker or subscription yet.
// Consumers must await this separately from Auth/Firestore/Storage.
export const messaging: Promise<Messaging | null> = browserMessaging().catch(() => {
  console.warn('Firebase Messaging no está disponible en este entorno.');
  return null;
});
