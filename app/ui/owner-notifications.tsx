'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client';
import type { OwnerNotification } from '../../lib/firestore-business';
import PushSettings from './push-settings';
import { Bell, ChevronLeft, ChevronRight } from 'lucide-react';

const labels: Record<OwnerNotification['kind'], string> = { order:'Pedidos', license:'Licencia', backup:'Respaldos', domain:'Dirección del menú', security:'Seguridad', sold_out:'Producto agotado', daily_summary:'Resumen diario', inactivity:'Inactividad' };
export default function OwnerNotifications({pushEnabled=true,restaurantId}:{pushEnabled?:boolean;restaurantId:string}) {
  const [items, setItems] = useState<OwnerNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<OwnerNotification | null>(null);
  const [opening, setOpening] = useState(false), [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false), [marking, setMarking] = useState<string | null>(null);
  const alive = useRef(true), loading = useRef(false);
  const openingSequence = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (detail) detailHeading.current?.focus(); }, [detail?.id]);
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
  const open = useCallback(async (id: string) => {
    const sequence = ++openingSequence.current;
    setOpening(true); setError(''); setDetail(null);
    try {
      const { notification } = await api(`notifications/${encodeURIComponent(id)}`);
      if (!alive.current || sequence !== openingSequence.current) return;
      setDetail(notification);
      const url = new URL(location.href); url.searchParams.set('notification', id);
      history.replaceState(null, '', url.pathname + url.search);
      if (!notification.read) {
        const result = await api(`notifications/${encodeURIComponent(id)}/read`, 'POST', {});
        if (!result.ok) throw Error('No se pudo marcar el aviso como leído.');
        if (alive.current && sequence === openingSequence.current) {
          setDetail({ ...notification, read: true });
          setItems(current => current.map(item => item.id === id ? { ...item, read: true } : item));
        }
      }
    } catch (cause) { if (alive.current && sequence === openingSequence.current) setError((cause as Error).message); }
    finally { if (alive.current && sequence === openingSequence.current) setOpening(false); }
  }, []);
  useEffect(() => {
    const query = new URLSearchParams(location.search), id = query.get('notification');
    if (query.get('restaurant') && query.get('restaurant') !== restaurantId) {
      setError('Este aviso pertenece a otro restaurante. Accede con su cuenta para consultarlo.'); return;
    }
    if (id && /^[a-zA-Z0-9_-]{1,100}$/.test(id)) void open(id);
  }, [open,restaurantId]);
  function closeDetail() {
    openingSequence.current++;
    setOpening(false);
    setDetail(null); setError('');
    const url = new URL(location.href); url.searchParams.delete('notification'); url.searchParams.delete('restaurant');
    history.replaceState(null, '', url.pathname + url.search);
  }
  async function markRead(id: string) {
    if (marking) return;
    setMarking(id); setError('');
    try {
      await api(`notifications/${encodeURIComponent(id)}/read`, 'POST', {});
      if (alive.current) setItems(current => current.map(item => item.id === id ? { ...item, read: true } : item));
    } catch (cause) { if (alive.current) setError((cause as Error).message); }
    finally { if (alive.current) setMarking(null); }
  }
  return <section className="card settings-section notifications-center" aria-labelledby="owner-notifications-heading" aria-busy={busy || opening}>
    <h2 id="owner-notifications-heading"><Bell aria-hidden="true" /> Actividad de tu restaurante</h2>
    <p className="muted">Consulta tus novedades aquí. Los pedidos no confirman un pago recibido.</p>
    <details><summary style={{minHeight:44,cursor:'pointer'}}>Configurar avisos en este dispositivo</summary>{pushEnabled?<PushSettings />:<p>Las notificaciones en el celular están disponibles desde el plan Medio.</p>}</details>
    <button className="btn" type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Actualizando…' : 'Actualizar avisos'}</button>
    {error && <p className="notice error" role="alert">{error}</p>}
    {opening && <p role="status" aria-live="polite">Abriendo el detalle del aviso…</p>}
    {detail && <article style={{padding:24,marginTop:16,background:'#f0f7ed',border:'2px solid #47772d',borderRadius:16}} aria-label="Detalle de la notificación">
      <button className="btn" onClick={closeDetail}><ChevronLeft aria-hidden="true" /> Volver a notificaciones</button>
      <p className="muted">{labels[detail.kind] || 'Aviso del restaurante'} · {detail.read ? 'Leído' : 'Sin leer'}</p>
      <h3 ref={detailHeading} tabIndex={-1}>{detail.title}</h3><p style={{fontSize:18,lineHeight:1.6,whiteSpace:'pre-wrap'}}>{detail.message}</p>
      <time dateTime={detail.createdAt}>{new Date(detail.createdAt).toLocaleString('es-EC',{timeZone:'America/Guayaquil'})}</time>
      <p className="muted">Este aviso pertenece exclusivamente a tu restaurante. Un pedido no confirma un pago recibido.</p>
    </article>}
    {!detail && !opening && <button className="btn" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(value => !value)}>{unreadOnly ? 'Mostrar todos' : 'Mostrar sin leer'}</button>}
    {!loaded && busy && <p role="status">Cargando avisos…</p>}
    {loaded && !items.length && <p role="status">No hay avisos todavía.</p>}
    {loaded && !detail && !opening && items.length > 0 && <p className="muted">{items.filter(item => !item.read).length} sin leer entre los {items.length} avisos cargados.</p>}
    {loaded && unreadOnly && !detail && !opening && items.length > 0 && !items.some(item => !item.read) && <p role="status">Todos los avisos cargados están leídos.{cursor ? ' Puedes consultar los anteriores.' : ''}</p>}
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {!detail && !opening && items.filter(item => !unreadOnly || !item.read).map(item => <li key={item.id} style={{ padding: '16px', marginTop:12, background:item.read?'#fff':'#f0f7ed', border: '1px solid #d6dcd3',borderRadius:12 }}>
        <small>{labels[item.kind] || 'Aviso del restaurante'}</small>
        <h3>{item.title} {!item.read && <small>· Sin leer</small>}</h3>
        <p>{item.message}</p>
        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}</time>
        <div><button className="btn primary" onClick={() => void open(item.id)}>Ver detalle <ChevronRight aria-hidden="true" /></button></div>
        {!item.read && <div><button className="btn" type="button" disabled={!!marking} onClick={() => void markRead(item.id)}>{marking === item.id ? 'Guardando…' : 'Marcar como leído'}</button></div>}
      </li>)}
    </ul>
    {cursor && <button className="btn" type="button" disabled={busy} onClick={() => void load(cursor)}>Ver avisos anteriores</button>}
  </section>;
}
