'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client';
import { nativePush } from './native-push';
import { waitForPushRegistration } from './web-push-registration';

function webRegistrationKey(restaurantId: string) {
  const storageKey = 'qrmenu-web-push-registration:' + restaurantId;
  try { const key = localStorage.getItem(storageKey) || crypto.randomUUID(); localStorage.setItem(storageKey, key); return key; }
  catch { throw Error('Permite el almacenamiento de este navegador para vincular las notificaciones al dispositivo.'); }
}
export default function PushSettings({restaurantId}:{restaurantId:string}) {
  const pending = useRef(false);
  const stopRegistration = useRef<(() => void)|null>(null);
  useEffect(() => () => { stopRegistration.current?.(); }, []);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const change = useCallback(async (enabled: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setMessage('');
    try {
      if (!import.meta.env.VITE_FCM_ENABLED || import.meta.env.VITE_FCM_ENABLED !== 'true') throw Error('Las notificaciones push aún no están habilitadas en este entorno. Los avisos del panel siguen disponibles.');
      if (window.qrmenuPush) {
        if (enabled) {
          const result = await nativePush('token');
          if (!result.token) throw Error('No se obtuvo el identificador de notificaciones.');
          const registered = await api('push/device', 'POST', { token: result.token, platform: 'android' });
          await nativePush('commit', registered.restaurantId);
        } else await nativePush('disable');
        setMessage(enabled ? 'Notificaciones activadas en este celular.' : 'Notificaciones desactivadas en este celular.');
        return;
      }
      if (!('Notification' in window) || !('serviceWorker' in navigator)) throw Error('Este navegador no admite push. Consulta los avisos del panel.');
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      if (!vapidKey) throw Error('Falta la configuración de notificaciones web.');
      if (enabled && await Notification.requestPermission() !== 'granted') throw Error('Permite notificaciones en los ajustes de este navegador para activarlas.');
      if (Notification.permission !== 'granted') throw Error('Las notificaciones están bloqueadas por el navegador.');
      const [{ messaging, receiveForeground }, { register, unregister, onRegistered }, { default: workerUrl }] = await Promise.all([
        import('../../src/lib/firebase-push-client'), import('firebase/messaging'), import('../../src/lib/firebase-messaging-sw?worker&url'),
      ]);
      const instance = await messaging;
      if (!instance) throw Error('Este dispositivo no admite notificaciones web.');
      const registration = await navigator.serviceWorker.register(workerUrl, { scope: '/' });
      await navigator.serviceWorker.ready;
      if (enabled) {
        const token = await waitForPushRegistration({subscribe: (next, error) => onRegistered(instance, {next, error, complete: () => {}}), register: () => register(instance, {vapidKey, serviceWorkerRegistration: registration})});
        const registrationKey = webRegistrationKey(restaurantId);
        const registered = await api('push/device', 'POST', { token, platform: 'web', targetType: 'fid', registrationKey });
        stopRegistration.current?.();
        let currentFid = token;
        stopRegistration.current = onRegistered(instance, {next: fid => {
          if (fid === currentFid) return;
          void api('push/device', 'POST', {token:fid,platform:'web',targetType:'fid',registrationKey}).then(() => {currentFid=fid;}).catch(() => setMessage('No se pudo renovar la vinculación de notificaciones. Vuelve a activarlas.'));
        }, error: () => setMessage('No se pudo renovar la vinculación de notificaciones. Vuelve a activarlas.'), complete: () => {}});
        registration.active?.postMessage({ type: 'push-preference', restaurantId: registered.restaurantId });
        await receiveForeground(registration);
      } else {
        stopRegistration.current?.(); stopRegistration.current = null;
        registration.active?.postMessage({ type: 'push-preference', restaurantId: null });
        const {getId, getInstallations} = await import('firebase/installations');
        const token = await getId(getInstallations(instance.app));
        await api('push/device', 'DELETE', { token });
        await unregister(instance);
      }
      // Preference only, never an authentication or registration token.
      try { localStorage.setItem('qrmenu-push-enabled', String(enabled)); } catch { /* Optional preference persistence. */ }
      setMessage(enabled ? 'Notificaciones activadas en este navegador.' : 'Notificaciones desactivadas en este navegador.');
    } catch (error) { setMessage((error as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }, [restaurantId]);
  useEffect(() => {
    if (import.meta.env.VITE_FCM_ENABLED !== 'true') return;
    if (!window.qrmenuPush) {
      try { if (localStorage.getItem('qrmenu-push-enabled') === 'true' && Notification.permission === 'granted') void Promise.resolve().then(() => change(true)); } catch { /* Storage or notifications unavailable. */ }
      return;
    }
    // Reconcile native token rotation only after this authenticated panel opens.
    void nativePush('status').then(status => { if (status.enabled) return change(true); }).catch(() => undefined);
  }, [change]);
  return <section aria-label="Notificaciones en este dispositivo">
    <h3>Notificaciones en este dispositivo</h3>
    <p>Actívalas para recibir avisos aunque el panel esté cerrado. Puedes desactivarlas cuando quieras.</p>
    <button type="button" className="btn primary" disabled={busy} onClick={() => void change(true)}>Activar notificaciones</button>{' '}
    <button type="button" className="btn" disabled={busy} onClick={() => void change(false)}>Desactivar en este dispositivo</button>
    {message && <output className="notice"  aria-live="polite">{message}</output>}
  </section>;
}
