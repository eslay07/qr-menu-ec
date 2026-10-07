'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  Download,
  Minus,
  Plus,
  QrCode,
  Search,
  Share2,
  ShoppingBag,
  Utensils,
  WifiOff,
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  activePromotion,
  type Catalog,
  type Dish,
  money,
  demoCatalog,
} from '@/lib/contracts';
import { api, restaurantBase } from './client';
import Turnstile from './turnstile';
import Promotions from './promotions';
import { useDialogBehavior } from './dialog-behavior';
import { revealIssue } from './reveal-issue';

type CartLine = {
  id: string;
  dishId: string;
  quantity: number;
  selections: Array<{ groupId: string; optionIds: string[] }>;
  note: string;
};
type Confirmation = {
  order: any;
  publicUrl: string;
  pdfUrl: string;
  qrPayload: string;
};

export default function Menu({
  preview = false,
  demo = false,
  initialCatalog,
}: {
  preview?: boolean;
  demo?: boolean;
  initialCatalog?: Catalog;
}) {
  const base = restaurantBase(),
    media = (value: string) =>
      value.startsWith('/api/v1/media/') ? base + value : value;
  const [catalog, setCatalog] = useState<Catalog | null>(
      initialCatalog ?? (demo ? demoCatalog : null),
    ),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0),
    [ordersEnabled, setOrdersEnabled] = useState(demo),
    [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null),
    [turnstileToken, setTurnstileToken] = useState(''),
    [turnstileAttempt, setTurnstileAttempt] = useState(0);
  const [query, setQuery] = useState(''),
    [cat, setCat] = useState('all'),
    [visibleDishes, setVisibleDishes] = useState(30),
    [cart, setCart] = useState<CartLine[]>([]),
    [bag, setBag] = useState(false),
    [configuring, setConfiguring] = useState<Dish | null>(null),
    [editingLine, setEditingLine] = useState<CartLine | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [alias, setAlias] = useState(''),
    [busy, setBusy] = useState(false),
    [qrSvg, setQrSvg] = useState('');
  const [attemptedOrder, setAttemptedOrder] = useState(false);
  useDialogBehavior(bag || !!configuring, () => { setBag(false); setConfiguring(null); });
  useEffect(() => {
    if (demo || initialCatalog) return;
    api(preview ? 'state' : 'menu')
      .then((value) => {
        setCatalog(preview ? value.draft : value.catalog);
        setVersion(value.version || 0);
        setOrdersEnabled(value.ordersEnabled === true);
        setTurnstileSiteKey(value.turnstileSiteKey || null);
      })
      .catch((e) => setError(e.message));
  }, [demo, preview, initialCatalog]);
  const priced = useMemo(
    () =>
      cart
        .map((line) => priceLine(line, catalog!))
        .filter(Boolean) as PricedLine[],
    [cart, catalog],
  );
  const total = priced.reduce((sum, line) => sum + line.totalCents, 0),
    units = cart.reduce((sum, line) => sum + line.quantity, 0);
  const startDish = (dish: Dish) => {
    const line = {
      id: crypto.randomUUID(),
      dishId: dish.id,
      quantity: 1,
      selections: dish.modifierGroups.map((group) => ({
        groupId: group.id,
        optionIds: [],
      })),
      note: '',
    };
    if (!dish.modifierGroups.length)
      setCart((items) => addOrCombine(items, line));
    else {
      setEditingLine(line);
      setConfiguring(dish);
    }
  };
  const confirmOrder = async () => {
    setAttemptedOrder(true);
    if (!catalog) return;
    if (!cart.length || !priced.length) {
      setError('Añade al menos un plato antes de confirmar tu pedido.');
      revealIssue('#order-error');
      return;
    }
    if (!alias.trim()) {
      setError('Escribe tu nombre o alias para identificar el pedido.');
      revealIssue('#order-alias');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api(demo ? 'demo-order' : 'orders', 'POST', {
        alias,
        lines: cart.map(({ dishId, quantity, selections, note }) => ({
          dishId,
          quantity,
          selections,
          note,
        })),
        demo,
        expectedTotalCents: total,
        turnstileToken: turnstileToken || undefined,
      });
      setConfirmation(result);
      setBag(false);
      setQrSvg('');
    } catch (e) {
      setError((e as Error).message);
      revealIssue('#order-error');
    } finally {
      setTurnstileToken('');
      setTurnstileAttempt((value) => value + 1);
      setBusy(false);
    }
  };
  if (error && !catalog)
    return (
      <main className="customer-empty">
        <WifiOff />
        <h1>El menú no está disponible</h1>
        <p>{error}</p>
        <button className="btn" onClick={() => location.reload()}>
          Volver a intentar
        </button>
      </main>
    );
  if (!catalog)
    return (
      <main className="skeleton-shell" aria-busy="true">
        <span className="sr-only" role="status">
          Preparando el menú…
        </span>
        <div className="skeleton-line" />
        <div className="skeleton-block" />
        <div className="skeleton-grid">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
      </main>
    );
  if (confirmation)
    return (
      <ConfirmationScreen
        value={confirmation}
        qrSvg={qrSvg}
        setQrSvg={setQrSvg}
        onBack={() => {
          setConfirmation(null);
          setCart([]);
          setAlias('');
        }}
      />
    );
  const matches = catalog.dishes.filter(dish =>
    (cat === 'all' || dish.categoryId === cat) &&
    `${dish.name} ${dish.description} ${dish.modifierGroups.flatMap(group => group.options.map(option => option.name)).join(' ')}`
      .toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  const visibleIds = new Set(matches.slice(0, visibleDishes).map(dish => dish.id));
  return (
    <div
      className="customer"
      style={{ '--restaurant-color': catalog.color } as React.CSSProperties}
    >
      {(preview || demo) && (
        <div className="preview-ribbon">
          {demo
            ? 'Demostración de pedido configurable'
            : 'Vista previa del borrador'}
          <a href={base || '/'}>Volver al panel</a>
        </div>
      )}
      <header className="customer-header">
        <div className="customer-brand">
          {catalog.logo ? (
            <img src={media(catalog.logo)} alt="" />
          ) : (
            <Utensils />
          )}
          <span>
            {catalog.name}
            <small>COCINA QUE NOS REÚNE</small>
          </span>
        </div>
        <button
          className="bag-icon"
          aria-label="Ver mi pedido"
          onClick={() => setBag(true)}
        >
          <ShoppingBag />
          {units > 0 && <b>{units}</b>}
        </button>
      </header>
      <section className="customer-intro">
        <span className="eyebrow">ELIGE. CONFIGURA. DISFRUTA.</span>
        <h1>Tu pedido, justo como lo quieres.</h1>
        <p>{catalog.tagline}</p>
        <div className="customer-meta">
          Precios en USD <span>•</span> Pedido confirmado frente al mesero
        </div>
      </section>
      <Promotions catalog={catalog} media={media} onChoose={startDish} disabled={preview} />
      <div className="menu-controls">
        <label className="search">
          <Search />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setVisibleDishes(30); }}
            placeholder="¿Qué se te antoja?"
            aria-label="Buscar platos"
          />
        </label>
        <div className="category-tabs">
          <button
            className={cat === 'all' ? 'selected' : ''}
            onClick={() => { setCat('all'); setVisibleDishes(30); }}
          >
            Todo el menú
          </button>
          {catalog.categories.map((category) => (
            <button
              key={category.id}
              className={cat === category.id ? 'selected' : ''}
              onClick={() => { setCat(category.id); setVisibleDishes(30); }}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>
      <main className="customer-dishes">
        {catalog.categories
          .filter((category) => cat === 'all' || cat === category.id)
          .map((category) => {
            const dishes = catalog.dishes.filter(
              (dish) =>
                dish.categoryId === category.id &&
                visibleIds.has(dish.id),
            );
            return dishes.length ? (
              <section key={category.id}>
                <div className="section-title">
                  <h2>{category.name}</h2>
                  <span className="muted">{dishes.length} opciones</span>
                </div>
                <div className="dish-grid">
                  {dishes.map((dish) => (
                    (() => {
                      const promotion = activePromotion(catalog, dish.id);
                      return (
                    <article
                      className={`dish-card ${dish.available ? '' : 'unavailable'}`}
                      key={dish.id}
                    >
                      <div className="dish-photo">
                        {dish.image ? (
                          <img src={media(dish.image)} alt={dish.name} loading="lazy" decoding="async" />
                        ) : (
                          <span className="no-photo">
                            <Utensils />
                            <span>Hecho en nuestra cocina</span>
                          </span>
                        )}
                        {!dish.available && (
                          <span className="photo-badge">Agotado</span>
                        )}
                        {promotion && (
                          <span className="photo-badge promo">
                            {promotion.badge || 'Promoción'}
                          </span>
                        )}
                      </div>
                      <div className="dish-body">
                        <h3 className="dish-title">{dish.name}</h3>
                        <p>{dish.description}</p>
                        {dish.modifierGroups.length > 0 && (
                          <div className="dish-options-summary">
                            Personalizable ·{' '}
                            {dish.modifierGroups
                              .map((group) => group.name)
                              .join(' · ')}
                          </div>
                        )}
                        <div className="dish-bottom">
                          <span className="dish-price">
                            {promotion?.promotionalPriceCents !== null &&
                              promotion?.promotionalPriceCents !== undefined && (
                                <del>{money(dish.priceCents)}</del>
                              )}
                            <strong>
                              {money(
                                promotion?.promotionalPriceCents ??
                                  dish.priceCents,
                              )}
                            </strong>
                          </span>
                          <button
                            className="add-dish"
                            disabled={!dish.available || preview}
                            aria-label={`Añadir ${dish.name}`}
                            onClick={() => startDish(dish)}
                          >
                            <Plus />
                          </button>
                        </div>
                      </div>
                    </article>
                      );
                    })()
                  ))}
                </div>
              </section>
            ) : null;
          })}
        {matches.length > visibleDishes && <button className="btn" onClick={() => setVisibleDishes(count => count + 30)}>Mostrar 30 platos más de {matches.length}</button>}
      </main>
      <footer className="customer-footer">
        <p>Confirma tu pedido y muéstrale la pantalla al mesero.</p>
        <small>QR Menu EC {version > 0 && `· Versión ${version}`}</small>
      </footer>
      {units > 0 && !bag && (
        <button className="selection-bar" onClick={() => setBag(true)}>
          <ShoppingBag />
          <span>Revisar mi pedido</span>
          <strong>{money(total)}</strong>
        </button>
      )}
      {bag && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal order-review"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-review-title"
          >
            <button className="close-button" onClick={() => setBag(false)}>
              <ArrowLeft />
              Volver al menú
            </button>
            <h2 id="order-review-title">Revisa tu pedido</h2>
            <p className="muted">
              Revisa los platos y muéstrale tu pedido al mesero al confirmar.
            </p>
            {error && <div id="order-error" className="notice error" role="alert" tabIndex={-1}>{error}</div>}
            {!cart.length && <p className={attemptedOrder ? 'notice error' : 'notice'}>Tu pedido está vacío. Vuelve al menú y añade un plato.</p>}
            {priced.map((line) => (
              <div className="selection-row configured" key={line.id}>
                <div>
                  <strong>{line.dish.name}</strong>
                  {line.options.map((option) => (
                    <small key={`${option.groupId}-${option.optionId}`}>
                      {option.groupName}: {option.optionName}
                      {option.priceDeltaCents
                        ? ` (+${money(option.priceDeltaCents)})`
                        : ''}
                    </small>
                  ))}
                  {line.note && <small>Nota: {line.note}</small>}
                  <button
                    className="text-button"
                    onClick={() => {
                      setEditingLine(cart.find((item) => item.id === line.id)!);
                      setConfiguring(line.dish);
                      setBag(false);
                    }}
                  >
                    Editar opciones
                  </button>
                </div>
                <div className="quantity">
                  <button
                    aria-label={`Quitar ${line.dish.name}`}
                    onClick={() => setCart(changeQuantity(cart, line.id, -1))}
                  >
                    <Minus />
                  </button>
                  {line.quantity}
                  <button
                    aria-label={`Añadir ${line.dish.name}`}
                    onClick={() => setCart(changeQuantity(cart, line.id, 1))}
                  >
                    <Plus />
                  </button>
                </div>
                <strong>{money(line.totalCents)}</strong>
              </div>
            ))}
            <div className="selection-total">
              <span>Total</span>
              <strong>{money(total)}</strong>
            </div>
            {ordersEnabled && !preview ? (
              <>
                <label>
                  Nombre o alias
                  <input
                    id="order-alias"
                    aria-invalid={attemptedOrder && !alias.trim()}
                    aria-describedby={attemptedOrder && !alias.trim() ? 'order-alias-error' : undefined}
                    style={attemptedOrder && !alias.trim() ? { border: '2px solid #b42318', background: '#fff4f2' } : undefined}
                    maxLength={80}
                    required
                    aria-required="true"
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    placeholder="Ej. Ana"
                  />
                  {attemptedOrder && !alias.trim() && <small id="order-alias-error" role="status">Falta tu nombre o alias.</small>}
                </label>
                <Turnstile
                  siteKey={turnstileSiteKey}
                  onToken={setTurnstileToken}
                  resetKey={turnstileAttempt}
                />
                <button
                  className="btn primary confirm-order"
                  disabled={busy}
                  onClick={confirmOrder}
                >
                  <Check />
                  {busy ? 'Confirmando…' : 'Confirmar pedido'}
                </button>
                <small className="muted">
                  La confirmación aparecerá en los reportes del restaurante.
                </small>
              </>
            ) : (
              <div className="notice warning">
                El restaurante todavía no tiene habilitada la confirmación de
                pedidos.
              </div>
            )}
            <button
              className="text-button"
              onClick={() => {
                setCart([]);
                setBag(false);
              }}
            >
              Vaciar selección
            </button>
          </section>
        </div>
      )}
      {configuring && editingLine && (
        <Configurator
          dish={configuring}
          line={editingLine}
          onCancel={() => {
            setConfiguring(null);
            setEditingLine(null);
          }}
          onSave={(line) => {
            setCart((items) =>
              addOrCombine(
                items.filter((item) => item.id !== line.id),
                line,
              ),
            );
            setConfiguring(null);
            setEditingLine(null);
          }}
        />
      )}
    </div>
  );
}

function Configurator({
  dish,
  line,
  onCancel,
  onSave,
}: {
  dish: Dish;
  line: CartLine;
  onCancel: () => void;
  onSave: (line: CartLine) => void;
}) {
  const [value, setValue] = useState<CartLine>(structuredClone(line)),
    [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const selected = (groupId: string) =>
    value.selections.find((item) => item.groupId === groupId)?.optionIds || [];
  const toggle = (groupId: string, optionId: string, single: boolean) =>
    setValue({
      ...value,
      selections: value.selections.map((selection) =>
        selection.groupId !== groupId
          ? selection
          : {
              ...selection,
              optionIds: single
                ? [optionId]
                : selection.optionIds.includes(optionId)
                  ? selection.optionIds.filter((id) => id !== optionId)
                  : [...selection.optionIds, optionId],
            },
      ),
    });
  const save = () => {
    setAttempted(true);
    for (const group of dish.modifierGroups) {
      const count = selected(group.id).length;
      if (count < group.minSelections || count > group.maxSelections) {
        setError(
          `Elige ${group.minSelections === group.maxSelections ? group.minSelections : `entre ${group.minSelections} y ${group.maxSelections}`} en “${group.name}”.`,
        );
        revealIssue('.configurator [aria-invalid="true"]');
        return;
      }
    }
    onSave(value);
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal configurator"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dish-configurator-title"
      >
        <div className="section-title">
          <div>
            <span className="eyebrow">PERSONALIZA</span>
            <h2 id="dish-configurator-title">{dish.name}</h2>
          </div>
          <button className="close-button" onClick={onCancel}>
            <span aria-hidden="true">×</span> Cerrar
          </button>
        </div>
        {error && <div className="notice error" role="alert">{error}</div>}
        {dish.modifierGroups.map((group) => (
          <fieldset className="choice-group" key={group.id}
            aria-invalid={attempted && (selected(group.id).length < group.minSelections || selected(group.id).length > group.maxSelections)}
            aria-describedby={attempted && (selected(group.id).length < group.minSelections || selected(group.id).length > group.maxSelections) ? `choice-error-${group.id}` : undefined}
            style={attempted && (selected(group.id).length < group.minSelections || selected(group.id).length > group.maxSelections) ? { border: '2px solid #b42318', background: '#fff4f2' } : undefined}>
            <legend>
              {group.name}
              <small>
                {group.description} ·{' '}
                {group.minSelections ? 'Obligatorio' : 'Opcional'}
              </small>
            </legend>
            {attempted && (selected(group.id).length < group.minSelections || selected(group.id).length > group.maxSelections) && <p id={`choice-error-${group.id}`} role="status">Revisa esta selección: elige entre {group.minSelections} y {group.maxSelections} opciones.</p>}
            {group.options.map((option) => (
              <label
                className={`choice-option ${selected(group.id).includes(option.id) ? 'chosen' : ''}`}
                key={option.id}
              >
                <input
                  type={group.selection === 'single' ? 'radio' : 'checkbox'}
                  name={group.id}
                  disabled={!option.available}
                  checked={selected(group.id).includes(option.id)}
                  onChange={() =>
                    toggle(group.id, option.id, group.selection === 'single')
                  }
                />
                <span>
                  <strong>{option.name}</strong>
                  {!option.available && <small>Agotado</small>}
                </span>
                <b>
                  {option.priceDeltaCents
                    ? `+${money(option.priceDeltaCents)}`
                    : 'Incluido'}
                </b>
              </label>
            ))}
          </fieldset>
        ))}
        <label>
          Nota para este plato
          <textarea
            maxLength={240}
            rows={2}
            placeholder="Ej. sin azúcar"
            value={value.note}
            onChange={(e) => setValue({ ...value, note: e.target.value })}
          />
        </label>
        <button className="btn primary" onClick={save}>
          Añadir configurado
        </button>
      </section>
    </div>
  );
}

function ConfirmationScreen({
  value,
  qrSvg,
  setQrSvg,
  onBack,
}: {
  value: Confirmation;
  qrSvg: string;
  setQrSvg: (value: string) => void;
  onBack: () => void;
}) {
  const order = value.order;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(order.status === 'cancelled');
  const [cancelError, setCancelError] = useState('');
  useDialogBehavior(cancelOpen, () => { if (!cancelling) setCancelOpen(false); });
  const cancelOrder = async () => {
    setCancelling(true); setCancelError('');
    try {
      const response = await fetch(value.pdfUrl.replace(/\/pdf$/, '/cancel'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error || 'No se pudo cancelar.');
      setCancelled(true); setCancelOpen(false); setQrSvg('');
    } catch (error) { setCancelError((error as Error).message); revealIssue('#cancel-order-error'); }
    finally { setCancelling(false); }
  };
  const share = async () => {
    const response = await fetch(value.pdfUrl),
      blob = await response.blob(),
      file = new File([blob], `pedido-${order.number}.pdf`, {
        type: 'application/pdf',
      });
    if (
      navigator.share &&
      (!navigator.canShare || navigator.canShare({ files: [file] }))
    )
      await navigator.share({
        title: `Pedido ${order.number}`,
        text: `Pedido confirmado en ${order.restaurantName}`,
        files: [file],
        url: value.publicUrl,
      });
    else
      window.open(
        `https://wa.me/?text=${encodeURIComponent(`Pedido ${order.number} - ${value.publicUrl}`)}`,
        '_blank',
      );
  };
  const showQr = async () => {
    if (!qrSvg)
      setQrSvg(
        await QRCode.toDataURL(value.qrPayload, {
          width: 300,
          margin: 3,
          errorCorrectionLevel: 'M',
        }),
      );
  };
  return (
    <main className="order-confirmation">
      <section className="confirmation-sheet">
        <div className="confirmation-mark">
          <Check />
        </div>
        <p className="eyebrow" role="status">{cancelled ? 'PEDIDO CANCELADO' : 'PEDIDO CONFIRMADO'}</p>
        <h1>{cancelled ? 'Este pedido fue cancelado' : 'Muéstrale este pedido al mesero'}</h1>
        <div className="confirmation-number">{order.number}</div>
        <p>
          {new Date(order.createdAt).toLocaleString('es-EC')}
          {order.alias ? ` · ${order.alias}` : ''}
        </p>
        <div className="confirmation-lines">
          {order.lines.map((line: any) => (
            <article key={line.id}>
              <div>
                <strong>
                  {line.quantity} × {line.dishName}
                </strong>
                {line.options.map((option: any) => (
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
        {qrSvg && (
          <div className="order-handoff-qr">
            <img src={qrSvg} alt={`QR del pedido ${order.number}`} />
            <strong>El mesero puede escanear este QR</strong>
            <small>Abre el mismo detalle y su PDF durante 24 horas.</small>
          </div>
        )}
        <div className="confirmation-actions">
          {!cancelled && <button className="btn" onClick={() => setCancelOpen(true)}>Cancelar pedido</button>}
          {cancelOpen && <div className="modal-backdrop"><section className="card" role="dialog" aria-modal="true" aria-labelledby="cancel-order-title">
            <h2 id="cancel-order-title">¿Cancelar {order.number} por {money(order.totalCents)}?</h2>
            <p>Confirma con el mesero si ya empezó la preparación.</p>
            {cancelError && <p id="cancel-order-error" role="alert" className="notice error">{cancelError}</p>}
            <button className="btn" autoFocus disabled={cancelling} onClick={() => setCancelOpen(false)}>Volver</button>
            <button className="btn danger" disabled={cancelling} onClick={cancelOrder}>{cancelling ? 'Cancelando…' : 'Sí, cancelar pedido'}</button>
          </section></div>}
          {!cancelled && <button className="btn primary" onClick={showQr}>
            <QrCode /> {qrSvg ? 'QR listo' : 'Generar QR para el mesero'}
          </button>}
          {!cancelled && <button className="btn" onClick={share}>
            <Share2 />
            Compartir PDF / WhatsApp
          </button>}
          <a className="btn" href={value.pdfUrl} target="_blank">
            <Download />
            Abrir PDF
          </a>
        </div>
        {!cancelled && <div className="photo-hint">
          <Camera />
          <span>
            Si el mesero no escanea el QR, puede tomar una foto de esta
            pantalla.
          </span>
        </div>}
        <button className="text-button no-photo" onClick={onBack}>
          Salir y comenzar otro pedido
        </button>
      </section>
    </main>
  );
}

type PricedLine = {
  id: string;
  dish: Dish;
  quantity: number;
  options: Array<{
    groupId: string;
    groupName: string;
    optionId: string;
    optionName: string;
    priceDeltaCents: number;
  }>;
  note: string;
  unitCents: number;
  totalCents: number;
  promotionalPriceCents: number | null;
};
function priceLine(line: CartLine, catalog: Catalog): PricedLine | null {
  const dish = catalog.dishes.find((item) => item.id === line.dishId);
  if (!dish) return null;
  const options = line.selections.flatMap((selection) => {
    const group = dish.modifierGroups.find(
      (item) => item.id === selection.groupId,
    );
    return selection.optionIds.flatMap((optionId) => {
      const option = group?.options.find((item) => item.id === optionId);
      return group && option
        ? [
            {
              groupId: group.id,
              groupName: group.name,
              optionId: option.id,
              optionName: option.name,
              priceDeltaCents: option.priceDeltaCents,
            },
          ]
        : [];
    });
  });
  const promotion = activePromotion(catalog, dish.id);
  const promotionalPriceCents = promotion?.promotionalPriceCents ?? null;
  const unitCents =
    (promotionalPriceCents ?? dish.priceCents) +
    options.reduce((sum, option) => sum + option.priceDeltaCents, 0);
  return {
    id: line.id,
    dish,
    quantity: line.quantity,
    options,
    note: line.note,
    unitCents,
    totalCents: unitCents * line.quantity,
    promotionalPriceCents,
  };
}
function addOrCombine(lines: CartLine[], incoming: CartLine) {
  const signature = (line: CartLine) =>
    JSON.stringify({
      dishId: line.dishId,
      selections: line.selections,
      note: line.note.trim(),
    });
  const found = lines.find((line) => signature(line) === signature(incoming));
  return found
    ? lines.map((line) =>
        line.id === found.id
          ? {
              ...line,
              quantity: Math.min(99, line.quantity + incoming.quantity),
            }
          : line,
      )
    : [...lines, incoming];
}
function changeQuantity(lines: CartLine[], id: string, delta: number) {
  return lines
    .map((line) =>
      line.id === id ? { ...line, quantity: line.quantity + delta } : line,
    )
    .filter((line) => line.quantity > 0);
}
