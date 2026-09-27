'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Store } from 'lucide-react';
import Turnstile from './turnstile';

export default function OwnerLauncher() {
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/owner/login').then(r => { if (!r.ok) throw Error('Acceso no disponible'); return r.json(); }).then((data: any) => {
      setSiteKey(data.turnstileSiteKey); setReady(true);
    }).catch(() => setError('No se pudo cargar el acceso. Recarga la página.'));
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/owner/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: values.get('email'), password: values.get('password'), turnstileToken: token }),
      });
      const result = await response.json() as any;
      if (!response.ok) throw Error(result.error);
      location.assign(result.ownerUrl);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); setToken(''); setAttempt(value => value + 1); }
  }
  return <main className="creator-auth"><section className="creator-login card owner-login">
    <Store size={38} /><p className="eyebrow">TU RESTAURANTE, AL DÍA</p>
    <h1>Bienvenido a tu carta</h1><p>Entra para editar tus platos, destacar promociones y revisar pedidos.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    <form onSubmit={login}>
      <label>Correo electrónico<input name="email" type="email" autoComplete="username" placeholder="tu@restaurante.com" required maxLength={254} /></label>
      <label>Contraseña<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
      <Turnstile siteKey={siteKey} onToken={setToken} resetKey={attempt} />
      <button className="btn primary" disabled={busy || !ready || (!!siteKey && !token)}>{busy ? 'Entrando…' : 'Entrar a mi restaurante'}<ArrowRight size={18} /></button>
    </form>
    <p className="login-footnote">¿Necesitas recuperar el acceso? Pide al administrador que actualice tu correo o restablezca tu contraseña.</p>
  </section></main>;
}
