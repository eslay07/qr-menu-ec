'use client';
import { useEffect, useState } from 'react';
import { api } from './client';
import { nativePush } from './native-push';

export default function PushSettings() {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    if (import.meta.env.VITE_FCM_ENABLED !== 'true') return;
    if (!window.qrmenuPush) {
      try { if (localStorage.getItem('qrmenu-push-enabled') === 'true' && Notification.permission === 'granted') void change(true); } catch { /* Storage or notifications unavailable. */ }
      return;
    }
    // Reconcile native token rotation only after this authenticated panel opens.
    void nativePush('status').then(status => { if (status.enabled) return change(true); }).catch(() => undefined);
  }, []);
  async function change(enabled: boolean) {
    if (busy) return;
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
      const [{ messaging, receiveForeground }, { getToken, deleteToken }, { default: workerUrl }] = await Promise.all([
        import('../../src/lib/firebase-push-client'), import('firebase/messaging'), import('../../src/lib/firebase-messaging-sw?worker&url'),
      ]);
      const instance = await messaging;
      if (!instance) throw Error('Este dispositivo no admite notificaciones web.');
      const registration = await navigator.serviceWorker.register(workerUrl, { scope: '/' });
      await navigator.serviceWorker.ready;
      const token = await getToken(instance, { vapidKey, serviceWorkerRegistration: registration });
      if (enabled) {
        const registered = await api('push/device', 'POST', { token, platform: 'web' });
        registration.active?.postMessage({ type: 'push-preference', restaurantId: registered.restaurantId });
        await receiveForeground(registration);
      } else {
        registration.active?.postMessage({ type: 'push-preference', restaurantId: null });
        await api('push/device', 'DELETE', { token }); await deleteToken(instance);
      }
      // Preference only, never an authentication or registration token.
      try { localStorage.setItem('qrmenu-push-enabled', String(enabled)); } catch { /* Optional preference persistence. */ }
      setMessage(enabled ? 'Notificaciones activadas en este navegador.' : 'Notificaciones desactivadas en este navegador.');
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section aria-label="Notificaciones en este dispositivo">
    <h3>Notificaciones en este dispositivo</h3>
    <p>Actívalas para recibir avisos aunque el panel esté cerrado. Puedes desactivarlas cuando quieras.</p>
    <button type="button" className="btn primary" disabled={busy} onClick={() => void change(true)}>Activar notificaciones</button>{' '}
    <button type="button" className="btn" disabled={busy} onClick={() => void change(false)}>Desactivar en este dispositivo</button>
    {message && <p className="notice" role="status" aria-live="polite">{message}</p>}
  </section>;
}
