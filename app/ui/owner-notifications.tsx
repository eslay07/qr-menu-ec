'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client';
import type { OwnerNotification } from '../../lib/firestore-business';
import PushSettings from './push-settings';

export default function OwnerNotifications({pushEnabled=true}:{pushEnabled?:boolean}) {
  const [items, setItems] = useState<OwnerNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false), [marking, setMarking] = useState<string | null>(null);
  const alive = useRef(true), loading = useRef(false);
  const load = useCallback(async (next?: string) => {
    if (loading.current) return;
    loading.current = true; setBusy(true); setError('');
    try {
      const response = await api(`notifications${next ? `?cursor=${encodeURIComponent(next)}` : ''}`);
      if (!alive.current) return;
      setItems(current => next ? [...current, ...response.notifications.filter((item: OwnerNotification) => !current.some(old => old.id === item.id))] : response.notifications);
      setCursor(response.nextCursor); setLoaded(true);
    } catch (cause) { if (alive.current) setError((cause as Error).message); }
    finally { loading.current = false; if (alive.current) setBusy(false); }
  }, []);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  async function markRead(id: string) {
    if (marking) return;
    setMarking(id); setError('');
    try {
      await api(`notifications/${encodeURIComponent(id)}/read`, 'POST', {});
      if (alive.current) setItems(current => current.map(item => item.id === id ? { ...item, read: true } : item));
    } catch (cause) { if (alive.current) setError((cause as Error).message); }
    finally { if (alive.current) setMarking(null); }
  }
  return <section className="card settings-section" aria-labelledby="owner-notifications-heading" aria-busy={busy}>
    <h2 id="owner-notifications-heading">Avisos del restaurante</h2>
    <p className="muted">Consulta tus novedades aquí. Los pedidos no confirman un pago recibido.</p>
    {pushEnabled?<PushSettings />:<p>Las notificaciones en el celular están disponibles desde el plan Medio.</p>}
    <button className="btn" type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Actualizando…' : 'Actualizar avisos'}</button>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!loaded && busy && <p role="status">Cargando avisos…</p>}
    {loaded && !items.length && <p role="status">No hay avisos todavía.</p>}
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {items.map(item => <li key={item.id} style={{ padding: '16px 0', borderBottom: '1px solid #d6dcd3' }}>
        <h3>{item.title} {!item.read && <small>· Sin leer</small>}</h3>
        <p>{item.message}</p>
        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}</time>
        {!item.read && <div><button className="btn" type="button" disabled={!!marking} onClick={() => void markRead(item.id)}>{marking === item.id ? 'Guardando…' : 'Marcar como leído'}</button></div>}
      </li>)}
    </ul>
    {cursor && <button className="btn" type="button" disabled={busy} onClick={() => void load(cursor)}>Ver avisos anteriores</button>}
  </section>;
}
