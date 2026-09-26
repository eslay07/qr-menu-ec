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

const restaurants: Record<string, Catalog> = {
  'restaurante-demo': Catalog.parse(demo),
};
const path = location.pathname.replace(/\/+$/, '') || '/';
const slug = ['/', '/menu', '/demo'].includes(path)
  ? 'restaurante-demo'
  : path.split('/')[1];
const catalog = restaurants[slug];
const isQr = path === `/${slug}/qr`;
const validRoute = ['/', '/menu', '/demo', `/${slug}`, `/${slug}/qr`].includes(
  path,
);

function App() {
  const [status, setStatus] = useState(
    'Menú online actualizado desde Cloudflare.',
  );
  const [qrs, setQrs] = useState<
    {
      kind: 'web';
      label: string;
      subtitle: string;
      payload: string;
      image: string;
    }[]
  >([]);
  const webUrl = `https://qr-menu-ec.pages.dev/${slug}`;
  const payloads = catalog
    ? [
        {
          kind: 'web' as const,
          label: 'MENÚ CON INTERNET',
          subtitle: 'fotos y experiencia completa',
          payload: webUrl,
        },
      ]
    : [];
  useEffect(() => {
    if (!catalog || !validRoute) return;
    document.title = `${catalog.name} · QR Menu EC`;
  }, []);
  useEffect(() => {
    if (isQr && payloads.length)
      Promise.all(
        payloads.map(async (item) => ({
          ...item,
          image: await QRCode.toDataURL(item.payload, {
            width: 768,
            margin: 4,
            errorCorrectionLevel: 'M',
          }),
        })),
      )
        .then(setQrs)
        .catch(() =>
          setStatus('No se pudieron generar los QR. Recarga la página.'),
        );
  }, [isQr]);
  if (!catalog || !validRoute)
    return (
      <main className="customer-empty">
        <h1>Restaurante no encontrado</h1>
        <a className="btn" href="/restaurante-demo">
          Abrir restaurante demo
        </a>
      </main>
    );
  if (isQr)
    return (
      <main className="print-cards">
        <header className="print-card-heading">
          <h1>{catalog.name}</h1>
          <p>Escanea para abrir la experiencia visual completa.</p>
          <div className="actions no-print">
            <button className="btn" onClick={() => print()}>
              Imprimir QR
            </button>
            <a className="btn" href={`/${slug}`}>
              Abrir menú visual
            </a>
          </div>
        </header>
        <div className="print-card-grid">
          {qrs.map((qr, index) => (
            <article className={`print-card ${qr.kind}`} key={qr.kind}>
              <p className="eyebrow">{qr.label}</p>
              <h2>{catalog.name}</h2>
              <p>{qr.subtitle}</p>
              <img
                src={qr.image}
                width="360"
                height="360"
                alt={`Código QR de ${qr.label.toLowerCase()}`}
              />
              <strong>Abre el menú interactivo</strong>
              <details className="qr-payload no-print">
                <summary>Ver enlace incluido</summary>
                <pre>{qr.payload}</pre>
              </details>
              <a
                className="btn no-print"
                href={qr.image}
                download={`${slug}-${qr.kind}.png`}
              >
                Descargar PNG
              </a>
            </article>
          ))}
        </div>
      </main>
    );
  return (
    <div className="pages-edition">
      <Menu initialCatalog={catalog} />
      <aside className="pages-status" role="status">
        <p>{status}</p>
        <a href={`/${slug}/qr`}>Ver e imprimir QR</a>
      </aside>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
