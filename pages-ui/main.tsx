/// <reference types="vite/client" />
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import Menu from '../app/ui/menu';
import { Catalog, textPages } from '../lib/contracts';
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
  const [qrs, setQrs] = useState<string[]>([]);
  const payloads = catalog ? textPages(catalog) : [];
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
    if (isQr && payloads.length) Promise.all(payloads.map(payload => QRCode.toDataURL(payload, { width: 768, margin: 4, errorCorrectionLevel: 'M' })))
      .then(setQrs).catch(() => setStatus('No se pudo generar el QR. Recarga la página.'));
  }, [isQr]);
  if (!catalog || !validRoute) return <main className="customer-empty"><h1>Restaurante no encontrado</h1><a className="btn" href="/restaurante-demo">Abrir restaurante demo</a></main>;
  if (isQr) return <main className="print-cards"><header className="print-card-heading"><h1>{catalog.name}</h1><p>La carta está guardada dentro del QR. El primer escaneo no necesita internet ni una visita previa.</p><div className="actions no-print"><button className="btn" onClick={() => print()}>Imprimir QR</button><a className="btn" href={`/${slug}`}>Abrir menú visual</a></div></header>{qrs.map((qr,index)=><article className="print-card" key={index}><p className="eyebrow">MENÚ SIN INTERNET</p><h2>{catalog.name}</h2><p>Escanea para leer platos y precios</p><img src={qr} width="360" height="360" alt={`Código QR del menú, parte ${index+1} de ${qrs.length}`} /><p>Parte {index+1} de {qrs.length}</p><details className="qr-payload no-print"><summary>Ver texto incluido</summary><pre>{payloads[index]}</pre></details><a className="btn no-print" href={qr} download={`${slug}-qr-${index+1}.png`}>Descargar PNG</a></article>)}</main>;
  return <div className="pages-edition"><Menu initialCatalog={catalog}/><aside className="pages-status" role="status"><p>{status}</p><a href={`/${slug}/qr`}>Ver e imprimir QR</a></aside></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
