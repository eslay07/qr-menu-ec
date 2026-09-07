/// <reference types="vite/client" />
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import Menu from '../app/ui/menu';
import { Catalog } from '../lib/contracts';
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
  const [qr, setQr] = useState('');
  const menuUrl = `${location.origin}/${slug}`;
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
    if (isQr && catalog) QRCode.toDataURL(menuUrl, { width: 768, margin: 4, errorCorrectionLevel: 'M' })
      .then(setQr).catch(() => setStatus('No se pudo generar el QR. Recarga la página.'));
  }, [menuUrl]);
  if (!catalog || !validRoute) return <main className="customer-empty"><h1>Restaurante no encontrado</h1><a className="btn" href="/restaurante-demo">Abrir restaurante demo</a></main>;
  if (isQr) return <main className="print-card"><h1>{catalog.name}</h1><p>Escanea para ver el menú</p>{qr && <img src={qr} width="320" height="320" alt="Código QR del menú" />}<p className="qr-url">{menuUrl}</p><p>Necesitas conexión la primera vez que abres el menú.</p><div className="actions no-print"><button className="btn" onClick={() => print()}>Imprimir QR</button><a className="btn" href={qr} download={`${slug}-qr.png`}>Descargar PNG</a><a className="btn" href={`/${slug}`}>Abrir menú</a></div>{location.protocol !== 'https:' && <p>QR de red local: conecta primero el celular del cliente al mismo hotspot. No es una dirección pública de Internet.</p>}</main>;
  return <div className="pages-edition"><Menu initialCatalog={catalog}/><aside className="pages-status" role="status"><p>{status}</p><a href={`/${slug}/qr`}>Ver e imprimir QR</a></aside></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
