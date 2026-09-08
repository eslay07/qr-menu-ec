/// <reference types="vite/client" />
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import Menu from '../app/ui/menu';
import { Catalog, buildVCard, defaultSettings } from '../lib/contracts';
import demo from '../data/restaurants/restaurante-demo.json';
import '../app/globals.css';
import '../app/product.css';
import './pages.css';

const restaurants: Record<string, Catalog> = { 'restaurante-demo': Catalog.parse(demo) };
const path = location.pathname.replace(/\/+$/, '') || '/';
const slug = ['/', '/menu', '/demo'].includes(path) ? 'restaurante-demo' : path.split('/')[1];
const catalog = restaurants[slug];
const isQr = path === `/${slug}/qr`;
const validRoute = ['/', '/menu', '/demo', `/${slug}`, `/${slug}/qr`].includes(path);

function App() {
  const [status, setStatus] = useState('Preparando copia para consultar sin conexión…');
  const [qrs, setQrs] = useState<{ kind: 'web' | 'vcard'; label: string; subtitle: string; payload: string; image: string }[]>([]);
  const webUrl = `https://qr-menu-resuelven.pages.dev/${slug}`;
  const offline = catalog ? buildVCard(catalog, {
    ...defaultSettings,
    webUrl,
    offlineCard: {
      ...defaultSettings.offlineCard,
      title: catalog.name,
      intro: 'Nuestra carta básica para consultar sin conexión.',
      farewell: 'Gracias por visitarnos',
      phone: '+593 99 000 0000',
      address: 'Dirección de demostración, Ecuador',
      hours: 'Lunes a domingo · 08:00 a 22:00',
    },
  }) : null;
  const payloads = offline ? [
    { kind: 'web' as const, label: 'MENÚ CON INTERNET', subtitle: 'fotos y experiencia completa', payload: webUrl },
    { kind: 'vcard' as const, label: 'MENÚ SIN INTERNET', subtitle: 'carta básica disponible sin conexión', payload: offline.payload },
  ] : [];
  useEffect(() => {
    if (!catalog || !validRoute) return;
    document.title = `${catalog.name} · QR Menu Resuelven`;
    if (import.meta.env.MODE === 'hotspot' || !('serviceWorker' in navigator) || !window.isSecureContext) {
      setStatus('Menú servido por la red local. Mantén el Wi-Fi conectado al teléfono servidor.');
      return;
    }
    navigator.serviceWorker.register('/sw.js').then(async registration => {
      await navigator.serviceWorker.ready;
      setStatus('Menú y fotos disponibles sin conexión en este navegador. La copia puede mostrar precios anteriores.');
      void registration.update().catch(() => {});
    }).catch(() => setStatus('No se pudo guardar el menú completo. Vuelve a abrirlo con conexión.'));
  }, []);
  useEffect(() => {
    if (isQr && payloads.length) Promise.all(payloads.map(async item => ({ ...item, image: await QRCode.toDataURL(item.payload, { width: 768, margin: 4, errorCorrectionLevel: 'M' }) })))
      .then(setQrs).catch(() => setStatus('No se pudieron generar los QR. Recarga la página.'));
  }, [isQr]);
  if (!catalog || !validRoute) return <main className="customer-empty"><h1>Restaurante no encontrado</h1><a className="btn" href="/restaurante-demo">Abrir restaurante demo</a></main>;
  if (isQr) return <main className="print-cards"><header className="print-card-heading"><h1>{catalog.name}</h1><p>Elige según tu conexión: experiencia visual por internet o carta básica sin conexión.</p><div className="actions no-print"><button className="btn" onClick={() => print()}>Imprimir ambos QR</button><a className="btn" href={`/${slug}`}>Abrir menú visual</a></div></header><div className="print-card-grid">{qrs.map((qr,index)=><article className={`print-card ${qr.kind}`} key={qr.kind}><p className="eyebrow">{qr.label}</p><h2>{catalog.name}</h2><p>{qr.subtitle}</p><img src={qr.image} width="360" height="360" alt={`Código QR de ${qr.label.toLowerCase()}`} /><strong>{index===0?'Usa este QR si tienes internet':'Usa este QR si no tienes internet'}</strong><details className="qr-payload no-print"><summary>{qr.kind==='web'?'Ver enlace incluido':'Ver nota vCard incluida'}</summary><pre>{qr.kind==='vcard'?offline?.note:qr.payload}</pre></details><a className="btn no-print" href={qr.image} download={`${slug}-${qr.kind}.png`}>Descargar PNG</a></article>)}</div></main>;
  return <div className="pages-edition"><Menu initialCatalog={catalog}/><aside className="pages-status" role="status"><p>{status}</p><a href={`/${slug}/qr`}>Ver e imprimir QR</a></aside></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
