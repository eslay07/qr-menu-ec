import { useState } from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import Turnstile from './turnstile';

export default function CreatorRecovery({ siteKey, enabled, onBack, token }: {
  siteKey: string | null; enabled: boolean; onBack: () => void; token: string;
}) {
  const [botToken, setBotToken] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  return <main className="creator-auth"><section className="creator-login card">
    <button className="close-button" onClick={onBack}><ArrowLeft size={18} /> Volver al acceso</button>
    <Mail size={34} /><h1>{token ? 'Recupera tu cuenta' : '¿Olvidaste tu acceso?'}</h1>
    <p>{token ? 'Elige una contraseña nueva. Después configurarás otra vez tu autenticador.' : 'Enviaremos un enlace privado al correo de recuperación registrado para el creador.'}</p>
    {!enabled && !token && <p className="notice" role="status">El envío de correo aún necesita configuración. El acceso habitual sigue disponible.</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {message ? <p className="notice" role="status">{message}</p> : <form onSubmit={async event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      if (token && values.get('password') !== values.get('confirmPassword')) { setError('Las contraseñas no coinciden.'); return; }
      setBusy(true); setError('');
      try {
        const response = await fetch(`/api/creator/recovery/${token ? 'reset' : 'request'}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(token ? { token, password: values.get('password'), turnstileToken: botToken } : { turnstileToken: botToken }),
        });
        const result = await response.json() as any;
        if (!response.ok) throw Error(result.error);
        setMessage(token ? 'Contraseña actualizada. Vuelve al acceso para configurar tu autenticador.' : result.message);
      } catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); setBotToken(''); setAttempt(n => n + 1); }
    }}>
      {token && <><label>Nueva contraseña<input type="password" name="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
        <label>Repite la contraseña<input type="password" name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required /></label></>}
      <Turnstile siteKey={siteKey} onToken={setBotToken} resetKey={attempt} />
      <button className="btn primary" disabled={busy || (!enabled && !token) || (!!siteKey && !botToken)}>{busy ? 'Un momento…' : token ? 'Guardar nueva contraseña' : 'Enviar enlace de recuperación'}</button>
    </form>}
  </section></main>;
}
