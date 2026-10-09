'use client';
import { useEffect, useState, type SubmitEvent } from 'react';
import { ArrowRight, Store } from 'lucide-react';
import Turnstile from './turnstile';
import { preserveNotification } from '../../lib/notification-link';
import { revealIssue } from './reveal-issue';

export default function OwnerLauncher() {
  const inAndroidApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('QRMenuEC-Android/');
  const canRemember = inAndroidApp && !navigator.userAgent.includes('QRMenuEC-NoLock/');
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [message, setMessage] = useState('');
  const [restoring, setRestoring] = useState(inAndroidApp);
  useEffect(() => {
    fetch('/api/owner/login').then(r => { if (!r.ok) throw Error('Acceso no disponible'); return r.json(); }).then((value) => {
      const data = value as {turnstileSiteKey:string|null};
      setSiteKey(data.turnstileSiteKey); setReady(true);
    }).catch(() => setError('No se pudo cargar el acceso. Recarga la página.'));
  }, []);
  useEffect(() => {
    if (!inAndroidApp) return;
    void (async () => {
      try {
        const statusResponse = await fetch('/api/owner/device-session');
        const status = await statusResponse.json() as { remembered?: boolean; csrfToken?: string };
        if (!status.remembered || !status.csrfToken) return;
        const response = await fetch('/api/owner/device-session/refresh', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': status.csrfToken }, body: '{}',
        });
        if (!response.ok) return;
        const result = await response.json() as { ownerUrl: string };
        location.replace(preserveNotification(result.ownerUrl, true));
      } catch { /* La contraseña sigue disponible si no hay conexión o el permiso venció. */ }
      finally { setRestoring(false); }
    })();
  }, [inAndroidApp]);
  async function login(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const response = await fetch(recovering ? '/api/owner/recovery' : '/api/owner/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recovering ? { email: values.get('email'), turnstileToken: token } : { email: values.get('email'), password: values.get('password'), turnstileToken: token,
          rememberDevice: canRemember && values.get('rememberDevice') === 'on' }),
      });
      const result = await response.json() as {error: string; message: string; ownerUrl: string};
      if (!response.ok) throw Error(result.error);
      if (recovering) { setMessage(result.message); return; }
      location.assign(preserveNotification(result.ownerUrl, canRemember && values.get('rememberDevice') === 'on'));
    } catch (failure) { setError((failure as Error).message); revealIssue('.owner-login [role="alert"]'); }
    finally { setBusy(false); setToken(''); setAttempt(value => value + 1); }
  }
  if (restoring) return <main className="creator-auth" aria-busy="true"><output className="creator-login card">Revisando el acceso guardado en este celular…</output></main>;
  return <main className="creator-auth"><section className="creator-login card owner-login">
    <Store size={38} /><p className="eyebrow">TU RESTAURANTE, AL DÍA</p>
    <h1>{recovering ? 'Recupera tu acceso' : 'Bienvenido a tu carta'}</h1><p>{recovering ? 'Recibe un enlace para elegir una contraseña nueva.' : 'Entra para editar tus platos, destacar promociones y revisar pedidos.'}</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <output className="notice" >{message}</output>}
    <form onSubmit={login}>
      <label>Correo electrónico<input name="email" type="email" autoComplete="username" placeholder="tu@restaurante.com" required maxLength={254} /></label>
      {!recovering && <label>Contraseña<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>}
      {!recovering && canRemember && <label className="check-label"><input type="checkbox" name="rememberDevice" defaultChecked /> Recordar este celular. Al volver, desbloquéalo con huella, rostro o PIN.</label>}
      {inAndroidApp && !canRemember && <p className="notice">Para recordar este celular, activa primero huella, rostro o PIN en los ajustes de Android. Puedes entrar ahora con tu contraseña.</p>}
      <Turnstile siteKey={siteKey} onToken={setToken} resetKey={attempt} />
      <button className="btn primary" disabled={busy || !ready || (!!siteKey && !token)}>{busy ? 'Un momento…' : recovering ? 'Enviar enlace de recuperación' : 'Entrar a mi restaurante'}<ArrowRight size={18} /></button>
    </form>
    <button type="button" className="btn" onClick={() => { setRecovering(!recovering); setMessage(''); setError(''); setToken(''); setAttempt(value => value + 1); }}>{recovering ? 'Volver al acceso' : 'Olvidé mi contraseña'}</button>
    <p className="login-footnote">Si no tienes acceso al correo, pide al administrador que verifique tu identidad y restablezca tu cuenta.</p>
  </section></main>;
}
