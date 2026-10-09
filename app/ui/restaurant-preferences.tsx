'use client';
import { useEffect, useState } from 'react';
import { api } from './client';
import { revealIssue } from './reveal-issue';

type Notifications = { newOrder: boolean; customerCancelled: boolean; soldOut: boolean; dailySummary: boolean; inactivity: boolean; inactivityHours: number };
const labels = { newOrder: 'Nuevo pedido recibido', customerCancelled: 'Pedido cancelado por el comensal', soldOut: 'Producto agotado', dailySummary: 'Resumen diario de ventas', inactivity: 'Sin pedidos durante varias horas' };
export default function RestaurantPreferencesPanel({ mode }: { mode: 'notifications' | 'wifi' }) {
  const [notification, setNotification] = useState<Notifications | null>(null);
  const [wifi, setWifi] = useState({ enabled: false, name: '', password: '' });
  const [revision, setRevision] = useState<string | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    api(`settings/${mode}`).then(value => {
      if (!active) return;
      setRevision(value.revision);
      if (mode === 'notifications') setNotification(value.settings);
      else setWifi({ enabled: value.enabled, name: value.name, password: '' });
      setReady(true);
    }).catch(error => { if (active) { setFailed(true); setMessage(error.message); } });
    return () => { active = false; };
  }, [mode]);
  async function save() {
    if (busy) return;
    setBusy(true); setFailed(false); setMessage('');
    try {
      const result = await api(`settings/${mode}`, 'PUT', { revision, settings: mode === 'notifications' ? notification : wifi });
      setRevision(result.revision);
      if (mode === 'wifi') setWifi(current => ({ ...current, password: '' }));
      setMessage('Guardado ✓');
    } catch (error) {
      setFailed(true); setMessage((error as Error).message);
      revealIssue(`#preference-status-${mode}`);
    } finally { setBusy(false); }
  }
  return <section className="card settings-section" aria-busy={(!ready && !failed) || busy}>
    <h2>{mode === 'wifi' ? 'WiFi en el QR impreso' : 'Notificaciones del restaurante'}</h2>
    <p className="muted">{mode === 'wifi' ? 'La clave solo aparece en la impresión autenticada. No se incorpora al código QR ni al menú público.' : 'Avisos dentro del panel. No requieren notificaciones push del teléfono.'}</p>
    {message && <output id={`preference-status-${mode}`} className={`notice ${failed ? 'error' : ''}`} role={failed ? 'alert' : 'status'} tabIndex={-1}>{message}</output>}
    {!ready && !failed && <output >Cargando preferencias…</output>}
    {ready && <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {mode === 'notifications' && notification && <>
        {(Object.keys(labels) as Array<keyof typeof labels>).map(key => <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}><input type="checkbox" checked={notification[key]} onChange={event => setNotification({ ...notification, [key]: event.target.checked })} />{labels[key]}</label>)}
        {notification.inactivity && <label>Horas sin pedidos<input type="number" min={1} max={168} required value={notification.inactivityHours} onChange={event => setNotification({ ...notification, inactivityHours: Number(event.target.value) })} /></label>}
      </>}
      {mode === 'wifi' && <>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}><input type="checkbox" checked={wifi.enabled} onChange={event => setWifi({ ...wifi, enabled: event.target.checked })} />Mostrar WiFi en la impresión</label>
        {wifi.enabled && <><label>Nombre de la red<input maxLength={32} required value={wifi.name} onChange={event => setWifi({ ...wifi, name: event.target.value })} /></label><label>Clave del WiFi<input type="password" autoComplete="new-password" maxLength={63} required value={wifi.password} onChange={event => setWifi({ ...wifi, password: event.target.value })} /></label><small>Vuelve a introducir la clave para cambiar esta configuración. No mostramos la clave almacenada.</small></>}
      </>}
      <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar preferencias'}</button>
      </fieldset>
    </form>}
  </section>;
}
