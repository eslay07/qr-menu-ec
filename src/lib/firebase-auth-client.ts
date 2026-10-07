import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, inMemoryPersistence, onAuthStateChanged, setPersistence, signInWithCustomToken, signOut } from 'firebase/auth';

// This Auth-only entrypoint deliberately does not import Firestore/Storage/FCM.
const app = getApps().some((value) => value.name === 'qrmenu-auth') ? getApp('qrmenu-auth') : initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}, 'qrmenu-auth');
const auth = getAuth(app);
const memoryOnly = setPersistence(auth, inMemoryPersistence);
let synchronizing: Promise<void> | undefined;

export async function synchronizeFirebaseClient(
  session: { authenticated: boolean; authProvider?: string; firebaseUid?: string | null },
  issueToken: () => Promise<{ customToken: string }>,
) {
  if (session.authProvider !== 'firebase') return;
  await memoryOnly;
  if (!session.authenticated) { await signOut(auth); return; }
  if (!session.firebaseUid) throw Error('La sesión de Firebase no está identificada.');
  if (auth.currentUser?.uid === session.firebaseUid) return;
  if (synchronizing) await synchronizing;
  if (auth.currentUser?.uid === session.firebaseUid) return;
  synchronizing = (async () => {
    const { customToken } = await issueToken();
    const result = await signInWithCustomToken(auth, customToken);
    if (result.user.uid !== session.firebaseUid) {
      await signOut(auth);
      throw Error('La sesión no corresponde a esta cuenta.');
    }
    // Wait for the SDK observer before presenting the authenticated panel.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { unsubscribe(); reject(Error('No se pudo sincronizar el acceso.')); }, 10_000);
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        clearTimeout(timeout); unsubscribe();
        if (user?.uid === session.firebaseUid) resolve();
        else reject(Error('La sesión de Firebase cambió. Vuelve a entrar.'));
      }, (error) => { clearTimeout(timeout); unsubscribe(); reject(error); });
    });
  })();
  try { await synchronizing; } finally { synchronizing = undefined; }
}
