import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Utensils } from 'lucide-react';
import { activePromotion, money, type Catalog, type Dish } from '@/lib/contracts';

export default function Promotions({ catalog, media, onChoose, disabled }: {
  catalog: Catalog; media: (url: string) => string; onChoose: (dish: Dish) => void; disabled: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const offers = catalog.promotions.filter(p => activePromotion(catalog, p.dishId)?.id === p.id);
  if (!offers.length) return null;
  function move(next: number) {
    const element = track.current?.children[next] as HTMLElement | undefined;
    if (element && track.current) track.current.scrollTo({
      left: element.offsetLeft - (track.current.children[0] as HTMLElement).offsetLeft,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }
  return <section className="offers" aria-label="Promociones destacadas" aria-roledescription="carrusel">
    <div className="offers-heading"><div><span className="eyebrow">PARA DISFRUTAR HOY</span><h2>Un antojo a buen precio</h2></div>
      {offers.length > 1 && <div className="offers-controls">
        <button className="icon-button" aria-label="Promoción anterior" disabled={index === 0} onClick={() => move(index - 1)}><ArrowLeft size={18} /></button>
        <span aria-live="polite">{index + 1} / {offers.length}</span>
        <button className="icon-button" aria-label="Siguiente promoción" disabled={index === offers.length - 1} onClick={() => move(index + 1)}><ArrowRight size={18} /></button>
      </div>}
    </div>
    <div className="promotion-carousel" ref={track} onScroll={() => {
      const el = track.current;
      if (!el) return;
      const first = el.children[0] as HTMLElement;
      const limit = el.scrollWidth - el.clientWidth;
      const nearest = [...el.children].reduce((best, item, i) =>
        Math.abs(Math.min((item as HTMLElement).offsetLeft - first.offsetLeft, limit) - el.scrollLeft) <
        Math.abs(Math.min((el.children[best] as HTMLElement).offsetLeft - first.offsetLeft, limit) - el.scrollLeft) ? i : best, 0);
      setIndex(nearest);
    }}>
      {offers.map((promotion, position) => {
        const dish = catalog.dishes.find(d => d.id === promotion.dishId)!;
        const image = promotion.image || dish.image;
        return <article className={`promotion-banner offer-color-${position % 3}`} key={promotion.id} aria-label={`${position + 1} de ${offers.length}: ${promotion.title}`}>
          <div className="promotion-copy"><span className="promotion-badge">{promotion.badge || 'Especial de hoy'}</span>
            <h3>{promotion.title}</h3><p>{promotion.description}</p>
            <div className="promotion-price"><strong>{money(promotion.promotionalPriceCents ?? dish.priceCents)}</strong>
              {promotion.promotionalPriceCents !== null && <del>{money(dish.priceCents)}</del>}</div>
            <button className="offer-action" disabled={!dish.available || disabled} onClick={() => onChoose(dish)}>{dish.available ? 'Elegir promoción' : 'Agotado'} <ArrowRight size={16} /></button>
          </div>
          {image ? <img src={media(image)} alt={dish.name} loading="lazy" /> : <div className="promotion-placeholder"><Utensils size={42} /><span>Hecho para ti</span></div>}
        </article>;
      })}
    </div>
    {offers.length > 1 && <p className="offers-hint">Desliza para descubrir más promociones <ArrowRight size={14} /></p>}
  </section>;
}
