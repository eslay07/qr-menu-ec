'use client';
import { useEffect, useState } from 'react';
import { Download, Share2, Utensils } from 'lucide-react';
import type { OrderRecord } from '@/lib/orders';
import { money } from '@/lib/contracts';
import { api, restaurantBase } from './client';

export default function OrderView({
  token: suppliedToken,
}: {
  token?: string;
}) {
  const [order, setOrder] = useState<OrderRecord|null>(null),
    [error, setError] = useState('');
  const match =
      typeof location === 'undefined'
        ? null
        : location.pathname.match(/\/order\/([^/]+)/),
    token = suppliedToken || match?.[1] || '',
    base = restaurantBase();
  const pdfUrl = `${base}/api/v1/order/${encodeURIComponent(token)}/pdf`;
  useEffect(() => {
    api(`order/${encodeURIComponent(token)}`)
      .then((value) => setOrder(value.order))
      .catch((e) => setError(e.message));
  }, [token]);
  if (error)
    return (
      <main className="customer-empty">
        <Utensils />
        <h1>Pedido no disponible</h1>
        <p>{error}</p>
      </main>
    );
  if (!order)
    return (
      <main className="customer-empty">
        <Utensils />
        <h1>Abriendo pedido…</h1>
      </main>
    );
  const share = async () => {
    const response = await fetch(pdfUrl),
      blob = await response.blob(),
      file = new File([blob], `pedido-${order.number}.pdf`, {
        type: 'application/pdf',
      });
    if (
      navigator.share &&
      (!navigator.canShare || navigator.canShare({ files: [file] }))
    )
      await navigator.share({ title: `Pedido ${order.number}`, files: [file] });
    else
      window.open(
        `https://wa.me/?text=${encodeURIComponent(`Pedido ${order.number} - ${location.href}`)}`,
        '_blank',
      );
  };
  return (
    <main className="order-confirmation">
      <section className="confirmation-sheet">
        <p className="eyebrow">PEDIDO CONFIRMADO</p>
        <h1>{order.restaurantName}</h1>
        <div className="confirmation-number">{order.number}</div>
        <p>
          {new Date(order.createdAt).toLocaleString('es-EC')}
          {order.alias ? ` · ${order.alias}` : ''}
        </p>
        <div className="confirmation-lines">
          {order.lines.map((line) => (
            <article key={line.id}>
              <div>
                <strong>
                  {line.quantity} × {line.dishName}
                </strong>
                {line.options.map((option) => (
                  <small key={`${option.groupId}-${option.optionId}`}>
                    {option.groupName}: {option.optionName}
                  </small>
                ))}
                {line.note && <small>Nota: {line.note}</small>}
              </div>
              <strong>{money(line.totalCents)}</strong>
            </article>
          ))}
        </div>
        <div className="confirmation-total">
          <span>Total</span>
          <strong>{money(order.totalCents)}</strong>
        </div>
        <div className="confirmation-actions">
          <a className="btn primary" href={pdfUrl} target="_blank">
            <Download />
            Abrir PDF
          </a>
          <button className="btn" onClick={share}>
            <Share2 />
            Compartir
          </button>
        </div>
        <small>Este pedido no es una factura ni confirma el pago.</small>
      </section>
    </main>
  );
}
