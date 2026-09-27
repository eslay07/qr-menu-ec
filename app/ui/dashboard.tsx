'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCodeGenerator from 'qrcode';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  Download,
  Globe,
  LogOut,
  Pencil,
  Plus,
  QrCode,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  Upload,
  Utensils,
  Megaphone,
} from 'lucide-react';
import {
  type Catalog,
  type Dish,
  type Feature,
  type ModifierGroup,
  type Promotion,
  type Settings,
  blankCatalog,
  defaultSettings,
  demoCatalog,
  money,
} from '@/lib/contracts';
import { api, download, restaurantBase, uploadPhoto } from './client';
import Turnstile from './turnstile';
import PhotoPicker from './photo-picker';
import OwnerLauncher from './owner-launcher';
import { useDialogBehavior } from './dialog-behavior';

type PanelState = {
  restaurantId: string;
  revision: number;
  draft: Catalog;
  settings: Settings;
  published: null | { version: number; at: string; catalog: Catalog };
  role: 'creator' | 'owner';
  features: Feature[];
};
type DomainState = {
  primary?: null | { hostname: string; status: string };
  primaryUrl?: string | null;
  aliases?: Array<{ hostname: string; kind: string; status: string }>;
  free: null | { hostname: string; status: string };
  custom: null | { hostname: string; status: string; validation?: any };
  cnameTarget: string | null;
  capacity?: { used: number; warningAt: number; limit: number };
};
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export default function Dashboard() {
  const base = restaurantBase();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [tab, setTab] = useState('Carta'),
    [session, setSession] = useState<any>(null),
    [state, setState] = useState<PanelState | null>(null);
  const [draft, setDraft] = useState<Catalog>(blankCatalog),
    [settings, setSettings] = useState<Settings>(defaultSettings);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [editing, setEditing] = useState<Dish | null>(null);
  const [codes, setCodes] = useState<any>(null),
    [domain, setDomain] = useState<DomainState | null>(null),
    [reportData, setReportData] = useState<any>(null);
  const [recovery, setRecovery] = useState(''),
    [recoverMode, setRecoverMode] = useState(false),
    [mfa, setMfa] = useState<any>(null);
  const dirty =
    !!state && JSON.stringify(draft) !== JSON.stringify(state.draft);
  const settingsDirty =
    !!state && JSON.stringify(settings) !== JSON.stringify(state.settings);
  const pendingRef = useRef(false);
  useDialogBehavior(!!editing, () => { if (!photoBusy && !busy) setEditing(null); });
  pendingRef.current = dirty || settingsDirty;
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 6500);
    return () => clearTimeout(timer);
  }, [message]);

  async function loadState(force = false, preserve?: 'draft' | 'settings') {
    const current = await api('session');
    setSession(current);
    if (!current.authenticated) {
      setState(null);
      return;
    }
    if (pendingRef.current && !force) return;
    const loaded = await api('state');
    setState(loaded);
    if (preserve !== 'draft') setDraft(loaded.draft);
    if (preserve !== 'settings') setSettings(loaded.settings);
    setCodes(null);
  }
  useEffect(() => {
    loadState(true).catch((e) => setError(e.message));
    const timer = window.setInterval(async () => {
      try {
        const current = await api('session');
        setSession(current);
        if (!current.authenticated) setState(null);
      } catch {}
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft() {
    await api('draft', 'PUT', { revision: state!.revision, catalog: draft });
    await loadState(true, 'settings');
    setMessage(
      'Borrador guardado. Publica para actualizar el menú de tus clientes.',
    );
  }
  async function saveSettings() {
    await api('settings', 'PUT', { revision: state!.revision, settings });
    await loadState(true, 'draft');
    setMessage('Configuración guardada.');
  }
  async function publish() {
    if (dirty) await saveDraft();
    const latest = await api('state');
    await api('publish', 'POST', { revision: latest.revision });
    await loadState(true, 'settings');
    setMessage('Menú publicado correctamente.');
  }
  async function loadDomains() {
    setDomain(await api('domain'));
  }
  async function loadReports(query = '') {
    setReportData(await api(`reports/orders${query}`));
  }
  useEffect(() => {
    if (state && tab === 'Compartir')
      loadDomains().catch((e) => setError(e.message));
    if (
      state &&
      tab === 'Pedidos' &&
      state.features.includes('orders')
    )
      loadReports().catch((e) => setError(e.message));
  }, [tab, !!state]);
  useEffect(() => {
    if (
      tab !== 'Compartir' ||
      !domain?.custom ||
      domain.custom.status === 'active'
    )
      return;
    let cancelled = false,
      attempt = 0,
      timer = 0;
    const poll = async () => {
      try {
        const next = await api('domain/verify', 'POST', {});
        if (cancelled) return;
        setDomain(next);
        if (next.custom?.status === 'active') {
          setMessage('Dominio y certificado activos.');
          return;
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
      if (!cancelled) {
        const delays = [5_000, 10_000, 20_000, 30_000, 60_000];
        timer = window.setTimeout(
          poll,
          delays[Math.min(attempt++, delays.length - 1)],
        );
      }
    };
    timer = window.setTimeout(poll, 5_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, domain?.custom?.hostname, domain?.custom?.status]);

  if (!session)
    return (
      <main className="skeleton-shell" aria-busy="true">
        <span className="sr-only" role="status">
          Abriendo tu restaurante…
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
  if (!state)
    if (mfa)
      return (
        <MfaPanel
          enrollment={mfa.enrollment}
          busy={busy}
          error={error}
          onVerify={(code: string) =>
            run(async () => {
              const result = await api('auth/mfa/verify', 'POST', { code });
              setMfa(null);
              if (result.recoveryCodes)
                setRecovery(result.recoveryCodes.join('\n'));
              await loadState(true);
            })
          }
          onRecover={(code: string) =>
            run(async () => {
              await api('auth/mfa/recover', 'POST', { code });
              setMfa(null);
              await loadState(true);
            })
          }
        />
      );
    else if (session.configured && session.runtime === 'cloud') return <OwnerLauncher />;
    else
    return (
      <Auth
        session={session}
        busy={busy}
        error={error}
        recoverMode={recoverMode}
        setRecoverMode={setRecoverMode}
        recovery={recovery}
        onSubmit={(form: FormData) =>
          run(async () => {
            const result = await api(
              !session.configured ? 'setup' : recoverMode ? 'recover' : 'login',
              'POST',
              Object.fromEntries(form),
            );
            if (result.recovery) setRecovery(result.recovery);
            if (result.mfaRequired) {
              setMfa(result);
              return;
            }
            await loadState(true);
          })
        }
      />
    );

  const updateGroup = (
    groupId: string,
    change: (group: ModifierGroup) => ModifierGroup,
  ) =>
    editing &&
    setEditing({
      ...editing,
      modifierGroups: editing.modifierGroups.map((group) =>
        group.id === groupId ? change(group) : group,
      ),
    });
  const categoryName = (id: string) =>
    draft.categories.find((category) => category.id === id)?.name || id;
  const nav = [
    'Carta',
    ...(state.features.includes('promotions') ? ['Promociones'] : []),
    ...(state.features.includes('orders') ? ['Pedidos'] : []),
    'Compartir',
    'Ajustes',
  ];

  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="wordmark" href={base || '/'}>
          <QrCode />
          <span>
            QR Menu <span className="lime">EC</span>
            <small>HECHO PARA TU RESTAURANTE</small>
          </span>
        </a>
        <div className="restaurant-switch">
          <span className="avatar">{draft.name[0]}</span>
          <div>
            {draft.name}
            <small>Online · USD</small>
          </div>
        </div>
        <p className="nav-label">TU ESPACIO</p>
        <nav>
          {nav.map((item) => (
            <button
              key={item}
              className={tab === item ? 'active' : ''}
              onClick={() => setTab(item)}
            >
              {item === 'Carta' ? (
                <Utensils />
              ) : item === 'Promociones' ? (
                <Megaphone />
              ) : item === 'Pedidos' ? (
                <BarChart3 />
              ) : item === 'Compartir' ? (
                <Globe />
              ) : (
                <SettingsIcon />
              )}
              {item}
            </button>
          ))}
        </nav>
        <button
          className="logout"
          onClick={() =>
            run(async () => {
              await api('logout', 'POST', {});
              await loadState(true);
            })
          }
        >
          <LogOut size={15} />
          Cerrar sesión
        </button>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            <span className="status-dot" />
            Panel conectado
          </span>
          <div className="actions">
            <span className="muted">
              {state.published
                ? `Publicación ${state.published.version}`
                : 'Sin publicar'}
            </span>
            <button
              className="btn primary"
              disabled={busy || settingsDirty}
              onClick={() => run(publish)}
            >
              Publicar menú
            </button>
          </div>
        </header>
        <div className="page-heading">
          <div>
            <span className="eyebrow">{tab.toUpperCase()}</span>
            <h1>{tab}</h1>
          </div>
        </div>
        {error && (
          <div className="notice error feedback-toast" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="notice feedback-toast" role="status" aria-live="polite">
            {message}
          </div>
        )}

        {tab === 'Carta' && (
          <>
            <section className="summary-grid">
              <div className="summary-item">
                <span>Platos</span>
                <strong>{draft.dishes.length}</strong>
              </div>
              <div className="summary-item">
                <span>Disponibles</span>
                <strong>
                  {draft.dishes.filter((dish) => dish.available).length}
                </strong>
              </div>
              <div className="summary-item">
                <span>Configurables</span>
                <strong>
                  {
                    draft.dishes.filter((dish) => dish.modifierGroups.length)
                      .length
                  }
                </strong>
              </div>
            </section>
            <div className="editor-toolbar">
              <div>
                <h2>Tu carta</h2>
                <p className="muted">
                  Añade fotos, precios y opciones. Publica cuando tu carta esté lista.
                </p>
              </div>
              <div className="actions">
                <button
                  className="btn"
                  onClick={() => setDraft({ ...demoCatalog, name: draft.name })}
                >
                  Cargar ejemplo profesional
                </button>
                <button
                  className="btn primary"
                  onClick={() =>
                    setEditing({
                      id: uid('plato'),
                      name: '',
                      description: '',
                      categoryId: draft.categories[0].id,
                      priceCents: 0,
                      available: true,
                      image: '',
                      modifierGroups: [],
                    })
                  }
                >
                  <Plus size={16} />
                  Añadir plato
                </button>
              </div>
            </div>
            <section className="menu-list">
              {draft.dishes.map((dish) => (
                <article className="menu-row" key={dish.id}>
                  {dish.image ? (
                    <img src={dish.image} alt="" />
                  ) : (
                    <span className="row-placeholder">
                      <Utensils />
                    </span>
                  )}
                  <div className="row-info">
                    <span className="eyebrow">
                      {categoryName(dish.categoryId)}
                    </span>
                    <h3>{dish.name}</h3>
                    <p>{dish.description}</p>
                    {dish.modifierGroups.length > 0 && (
                      <small>
                        {dish.modifierGroups.length} grupos ·{' '}
                        {dish.modifierGroups.reduce(
                          (sum, group) => sum + group.options.length,
                          0,
                        )}{' '}
                        opciones
                      </small>
                    )}
                  </div>
                  <strong>{money(dish.priceCents)}</strong>
                  <button
                    className={`availability ${dish.available ? 'available' : ''}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        dishes: draft.dishes.map((item) =>
                          item.id === dish.id
                            ? { ...item, available: !item.available }
                            : item,
                        ),
                      })
                    }
                  >
                    <span />
                    {dish.available ? 'Disponible' : 'Agotado'}
                  </button>
                  <button
                    className="btn edit-dish-button"
                    aria-label={`Editar ${dish.name}`}
                    onClick={() => setEditing(structuredClone(dish))}
                  >
                    <Pencil size={16} /> Editar
                  </button>
                </article>
              ))}
            </section>
            <div className="save-bar">
              <span>
                {dirty ? 'Tienes cambios sin guardar' : 'Borrador guardado'}
                <small>Los cambios se hacen públicos al publicar.</small>
              </span>
              <button
                className="btn primary"
                disabled={!dirty || busy}
                onClick={() => run(saveDraft)}
              >
                <Save size={16} />
                {busy ? 'Guardando…' : dirty ? 'Guardar borrador' : 'Guardado ✓'}
              </button>
            </div>
          </>
        )}

        {tab === 'Promociones' && state.features.includes('promotions') && (
          <PromotionsEditor
            catalog={draft}
            setCatalog={setDraft}
            busy={busy}
            save={() => run(saveDraft)}
          />
        )}

        {tab === 'Compartir' && (
          <section className="card">
            <h2>QR permanente del menú</h2>
            <p className="muted">
              Un único QR HTTPS, sin datos de red ni credenciales.
            </p>
            <div className="actions">
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => run(async () => setCodes(await api('qr')))}
              >
                <QrCode size={16} />
                Generar QR
              </button>
              {codes && (
                <button className="btn" onClick={() => window.print()}>
                  <Download size={16} />
                  Imprimir
                </button>
              )}
            </div>
            {codes?.codes.map((code: any) => (
              <article className="qr-card" key={code.payload}>
                <span className="eyebrow">MENÚ ONLINE</span>
                <h2>{codes.name}</h2>
                <img
                  className="qr-image"
                  src={`data:image/svg+xml,${encodeURIComponent(code.svg)}`}
                  alt={`QR del menú de ${codes.name}`}
                />
                <strong>Escanea para ver el menú</strong>
                <small>{code.payload}</small>
                <button
                  className="btn no-print"
                  onClick={() =>
                    download(
                      `menu-${codes.version}.svg`,
                      code.svg,
                      'image/svg+xml',
                    )
                  }
                >
                  Descargar SVG
                </button>
              </article>
            ))}
          </section>
        )}

        {tab === 'Compartir' && (
          <>
            <section className="card settings-section">
              <h2>Dirección online gratuita</h2>
              <p className="muted">
                Se genera automáticamente y permanece como alias aunque conectes
                un dominio propio.
              </p>
              <code className="id-block">
                {domain?.primaryUrl || domain?.free
                  ? domain?.primaryUrl || `https://${domain?.free?.hostname}/menu`
                  : settings.webUrl || `${location.origin}${base}/menu`}
              </code>
              {domain?.capacity && (
                <p className="muted">
                  Direcciones gratuitas utilizadas: {domain.capacity.used} de{' '}
                  {domain.capacity.limit}
                  {domain.capacity.used >= domain.capacity.warningAt
                    ? ' · Se recomienda activar el dominio global de QR Menu.'
                    : ''}
                </p>
              )}
            </section>
            <section className="card settings-section">
              <h2>Dominio propio</h2>
              {domain?.custom && (
                <div className="notice">
                  <p>
                    <strong>{domain.custom.hostname}</strong> ·{' '}
                    {domain.custom.status}
                  </p>
                  <p>
                    Certificado:{' '}
                    <strong>
                      {domain.custom.validation?.ssl?.status || 'pendiente'}
                    </strong>
                  </p>
                  <p>
                    CNAME hacia{' '}
                    <code>
                      {domain.cnameTarget || 'configuración pendiente'}
                    </code>
                  </p>
                </div>
              )}
              {!domain?.custom && (
                <div className="notice">
                  El creador puede conectar y verificar un dominio propio para
                  este restaurante desde el panel central.
                </div>
              )}
            </section>
            <section className="card settings-section">
              <h2>Pedidos por QR y reportes</h2>
              {state.features.includes('orders') ? (
                <>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={settings.ordersEnabled}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          ordersEnabled: e.target.checked,
                        })
                      }
                    />
                    Permitir que los clientes confirmen pedidos
                  </label>
                  <p className="muted">
                    La confirmación mostrará el pedido completo para enseñárselo
                    al mesero y lo añadirá a tus reportes.
                  </p>
                  <button
                    className="btn primary"
                    disabled={!settingsDirty || busy}
                    onClick={() => run(saveSettings)}
                  >
                    {busy
                      ? 'Guardando…'
                      : settingsDirty
                        ? 'Guardar configuración'
                        : 'Guardado ✓'}
                  </button>
                </>
              ) : (
                <div className="notice warning">
                  El creador todavía no ha habilitado esta función para el
                  restaurante.
                </div>
              )}
            </section>
          </>
        )}

        {tab === 'Pedidos' &&
          (state.features.includes('orders') ? (
            <Reports
              data={reportData}
              refresh={(query) => run(() => loadReports(query))}
              cancel={(id) =>
                run(async () => {
                  await api(`orders/${id}/status`, 'PATCH', {
                    status: 'cancelled',
                  });
                  await loadReports();
                })
              }
            />
          ) : (
            <section className="card empty">
              <BarChart3 />
              <h3>Función no habilitada</h3>
              <p>
                El creador debe activar Pedidos por QR para este restaurante.
              </p>
            </section>
          ))}

        {tab === 'Ajustes' && (
          <section className="card settings-section">
            <h2>Identidad del restaurante</h2>
            <div className="form-grid">
              <label>
                Nombre
                <input
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                Frase de bienvenida
                <input
                  maxLength={180}
                  value={draft.tagline}
                  onChange={(e) =>
                    setDraft({ ...draft, tagline: e.target.value })
                  }
                />
              </label>
              <label>
                Color
                <input
                  type="color"
                  value={draft.color}
                  onChange={(e) =>
                    setDraft({ ...draft, color: e.target.value })
                  }
                />
              </label>
              <label>
                Logotipo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      run(async () =>
                        setDraft({ ...draft, logo: await uploadPhoto(file) }),
                      );
                  }}
                />
              </label>
            </div>
            <button
              className="btn primary"
              disabled={!dirty || busy}
              onClick={() => run(saveDraft)}
            >
              {busy ? 'Guardando…' : dirty ? 'Guardar identidad' : 'Guardado ✓'}
            </button>
          </section>
        )}

        {tab === 'Ajustes' && (
          <SecuritySettings busy={busy} run={run} />
        )}

        {tab === 'Ajustes' && (
          <section className="onboard-grid">
            <article className="card">
              <h2>Descargar respaldo</h2>
              <p className="muted">
                Incluye carta, opciones, fotos y configuración.
              </p>
              <button
                className="btn"
                disabled={dirty || busy}
                onClick={() =>
                  run(async () => {
                    const value = await api('backup');
                    download(
                      `qr-menu-${new Date().toISOString().slice(0, 10)}.json`,
                      JSON.stringify(value),
                    );
                  })
                }
              >
                <Download size={16} />
                Descargar
              </button>
            </article>
            <article className="card">
              <h2>Restaurar</h2>
              <label className="file-button">
                <Upload size={16} />
                Elegir respaldo
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && confirm('¿Reemplazar el borrador actual?'))
                      run(async () => {
                        const result = await api(
                          'restore',
                          'POST',
                          JSON.parse(await file.text()),
                        );
                        await loadState(true);
                        setMessage(result.notice);
                      });
                    e.target.value = '';
                  }}
                />
              </label>
            </article>
          </section>
        )}
      </main>

      {editing && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal dish-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dish-editor-title"
            onSubmit={(e) => {
              e.preventDefault();
              if (photoBusy || busy) return;
              const exists = draft.dishes.some(
                (dish) => dish.id === editing.id,
              );
              const nextCatalog = {
                ...draft,
                dishes: exists
                  ? draft.dishes.map((dish) =>
                      dish.id === editing.id ? editing : dish,
                    )
                  : [...draft.dishes, editing],
              };
              run(async () => {
                await api('draft', 'PUT', { revision: state.revision, catalog: nextCatalog });
                await loadState(true, 'settings');
                setEditing(null);
                setMessage('Plato guardado. Pulsa Publicar menú para que lo vean tus clientes.');
              });
            }}
          >
            <div className="section-title">
              <h2 id="dish-editor-title">
                {draft.dishes.some((dish) => dish.id === editing.id)
                  ? 'Editar plato'
                  : 'Nuevo plato'}
              </h2>
              <button
                type="button"
                className="close-button"
                disabled={photoBusy || busy}
                onClick={() => setEditing(null)}
              >
                <span aria-hidden="true">×</span> Cerrar
              </button>
            </div>
            <PhotoPicker value={editing.image} onBusy={setPhotoBusy}
              onChange={image => setEditing(current => current ? { ...current, image } : current)} />
            <label>
              Nombre
              <input
                required
                autoFocus
                maxLength={90}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label>
              Descripción
              <textarea
                rows={3}
                maxLength={500}
                value={editing.description}
                onChange={(e) =>
                  setEditing({ ...editing, description: e.target.value })
                }
              />
            </label>
            <div className="form-grid">
              <label>
                Precio en USD
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={(editing.priceCents / 100).toString()}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      priceCents: Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </label>
              <label>
                Categoría
                <select
                  value={editing.categoryId}
                  onChange={(e) =>
                    setEditing({ ...editing, categoryId: e.target.value })
                  }
                >
                  {draft.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={editing.available}
                onChange={(e) =>
                  setEditing({ ...editing, available: e.target.checked })
                }
              />
              Disponible
            </label>
            <div className="modifier-builder">
              <div className="section-title">
                <div>
                  <h3>Opciones del plato</h3>
                  <p className="muted">
                    Bebidas, sabores, acompañamientos y extras.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      modifierGroups: [
                        ...editing.modifierGroups,
                        {
                          id: uid('grupo'),
                          name: 'Nuevo grupo',
                          description: '',
                          selection: 'single',
                          minSelections: 1,
                          maxSelections: 1,
                          options: [
                            {
                              id: uid('opcion'),
                              name: 'Nueva opción',
                              priceDeltaCents: 0,
                              available: true,
                            },
                          ],
                        },
                      ],
                    })
                  }
                >
                  <Plus size={15} />
                  Grupo
                </button>
              </div>
              {editing.modifierGroups.map((group, groupIndex) => (
                <section className="modifier-group" key={group.id}>
                  <div className="modifier-head">
                    <strong>Grupo {groupIndex + 1}</strong>
                    <div className="actions">
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => {
                          const groups = [...editing.modifierGroups];
                          [groups[groupIndex - 1], groups[groupIndex]] = [
                            groups[groupIndex],
                            groups[groupIndex - 1],
                          ];
                          setEditing({ ...editing, modifierGroups: groups });
                        }}
                        disabled={groupIndex === 0}
                      >
                        <ArrowUp />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => {
                          const groups = [...editing.modifierGroups];
                          [groups[groupIndex], groups[groupIndex + 1]] = [
                            groups[groupIndex + 1],
                            groups[groupIndex],
                          ];
                          setEditing({ ...editing, modifierGroups: groups });
                        }}
                        disabled={
                          groupIndex === editing.modifierGroups.length - 1
                        }
                      >
                        <ArrowDown />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        onClick={() =>
                          setEditing({
                            ...editing,
                            modifierGroups: editing.modifierGroups.filter(
                              (item) => item.id !== group.id,
                            ),
                          })
                        }
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </div>
                  <div className="form-grid">
                    <label>
                      Nombre
                      <input
                        value={group.name}
                        onChange={(e) =>
                          updateGroup(group.id, (item) => ({
                            ...item,
                            name: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Tipo
                      <select
                        value={group.selection}
                        onChange={(e) =>
                          updateGroup(group.id, (item) => ({
                            ...item,
                            selection: e.target.value as 'single' | 'multiple',
                            minSelections:
                              e.target.value === 'single'
                                ? Math.min(1, item.minSelections)
                                : item.minSelections,
                            maxSelections:
                              e.target.value === 'single'
                                ? 1
                                : Math.max(1, item.maxSelections),
                          }))
                        }
                      >
                        <option value="single">Una opción</option>
                        <option value="multiple">Varias opciones</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Descripción
                    <input
                      maxLength={180}
                      value={group.description}
                      onChange={(e) =>
                        updateGroup(group.id, (item) => ({
                          ...item,
                          description: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Mínimo
                      <input
                        type="number"
                        min="0"
                        max={group.options.length}
                        value={group.minSelections}
                        onChange={(e) =>
                          updateGroup(group.id, (item) => ({
                            ...item,
                            minSelections: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                    <label>
                      Máximo
                      <input
                        type="number"
                        min="1"
                        max={group.options.length}
                        disabled={group.selection === 'single'}
                        value={group.maxSelections}
                        onChange={(e) =>
                          updateGroup(group.id, (item) => ({
                            ...item,
                            maxSelections: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="modifier-options">
                    {group.options.map((option, optionIndex) => (
                      <div className="modifier-option" key={option.id}>
                        <input
                          aria-label={`Opción ${optionIndex + 1}`}
                          value={option.name}
                          onChange={(e) =>
                            updateGroup(group.id, (item) => ({
                              ...item,
                              options: item.options.map((candidate) =>
                                candidate.id === option.id
                                  ? { ...candidate, name: e.target.value }
                                  : candidate,
                              ),
                            }))
                          }
                        />
                        <label>
                          Recargo
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={(option.priceDeltaCents / 100).toString()}
                            onChange={(e) =>
                              updateGroup(group.id, (item) => ({
                                ...item,
                                options: item.options.map((candidate) =>
                                  candidate.id === option.id
                                    ? {
                                        ...candidate,
                                        priceDeltaCents: Math.round(
                                          Number(e.target.value) * 100,
                                        ),
                                      }
                                    : candidate,
                                ),
                              }))
                            }
                          />
                        </label>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={option.available}
                            onChange={(e) =>
                              updateGroup(group.id, (item) => ({
                                ...item,
                                options: item.options.map((candidate) =>
                                  candidate.id === option.id
                                    ? {
                                        ...candidate,
                                        available: e.target.checked,
                                      }
                                    : candidate,
                                ),
                              }))
                            }
                          />
                          Disponible
                        </label>
                        <button
                          type="button"
                          className="icon-button danger"
                          disabled={group.options.length === 1}
                          onClick={() =>
                            updateGroup(group.id, (item) => ({
                              ...item,
                              options: item.options.filter(
                                (candidate) => candidate.id !== option.id,
                              ),
                              maxSelections: Math.min(
                                item.maxSelections,
                                item.options.length - 1,
                              ),
                              minSelections: Math.min(
                                item.minSelections,
                                item.options.length - 1,
                              ),
                            }))
                          }
                        >
                          <Trash2 />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      updateGroup(group.id, (item) => ({
                        ...item,
                        options: [
                          ...item.options,
                          {
                            id: uid('opcion'),
                            name: 'Nueva opción',
                            priceDeltaCents: 0,
                            available: true,
                          },
                        ],
                        maxSelections:
                          item.selection === 'single' ? 1 : item.maxSelections,
                      }))
                    }
                  >
                    + Añadir opción
                  </button>
                </section>
              ))}
            </div>
            <div className="actions">
              <button className="btn primary" type="submit" disabled={photoBusy || busy}>
                <Check size={17} /> {busy ? 'Guardando plato…' : 'Guardar plato'}
              </button>
              {draft.dishes.some((dish) => dish.id === editing.id) && (
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy || photoBusy}
                  onClick={() => {
                    setDraft({
                      ...draft,
                      dishes: draft.dishes.filter(
                        (dish) => dish.id !== editing.id,
                      ),
                    });
                    setEditing(null);
                  }}
                >
                  Eliminar plato
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Auth({
  session,
  busy,
  error,
  recoverMode,
  setRecoverMode,
  recovery,
  onSubmit,
}: any) {
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileAttempt, setTurnstileAttempt] = useState(0);
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <QrCode size={40} />
        <h1>QR Menu EC</h1>
        <p>Tu menú profesional en una dirección permanente.</p>
      </div>
      <section className="card auth-card">
        <h2>
          {session.configured
            ? recoverMode
              ? 'Recuperar acceso'
              : 'Bienvenido'
            : 'Prepara tu restaurante'}
        </h2>
        {error && <div className="notice error">{error}</div>}
        {recovery && (
          <div className="notice recovery">
            <strong>Guarda tu código de recuperación</strong>
            <code>{recovery}</code>
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            form.delete('cf-turnstile-response');
            if (turnstileToken) form.set('turnstileToken', turnstileToken);
            try {
              await onSubmit(form);
            } finally {
              setTurnstileToken('');
              setTurnstileAttempt((value) => value + 1);
            }
          }}
        >
          {!session.configured && (
            <label>
              Nombre del restaurante
              <input name="name" required maxLength={80} />
            </label>
          )}
          {!session.configured && !session.platformSetup && (
            <label>
              Código de instalación
              <input name="setupToken" required />
            </label>
          )}
          {session.configured && !recoverMode && (
            <label>
              Código del restaurante
              <input name="code" required />
            </label>
          )}
          {recoverMode && (
            <label>
              Código de recuperación
              <input name="recovery" required />
            </label>
          )}
          <label>
            {recoverMode ? 'Nueva contraseña' : 'Contraseña'}
            <input
              name="password"
              type="password"
              required
              minLength={!session.configured || recoverMode ? 12 : 1}
            />
          </label>
          <Turnstile
            siteKey={session.turnstileSiteKey}
            onToken={setTurnstileToken}
            resetKey={turnstileAttempt}
          />
          <button className="btn primary" disabled={busy}>
            {busy
              ? 'Un momento…'
              : session.configured
                ? recoverMode
                  ? 'Restablecer'
                  : 'Entrar'
                : 'Crear restaurante'}
          </button>
          {session.configured && (
            <button
              type="button"
              className="text-button"
              onClick={() => setRecoverMode(!recoverMode)}
            >
              {recoverMode ? 'Volver' : 'Olvidé mi contraseña'}
            </button>
          )}
        </form>
      </section>
    </main>
  );
}

function SecuritySettings({
  busy,
  run,
}: {
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const [email, setEmail] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const load = async () => {
    const [emailState, sessionState] = await Promise.all([
      api('email'),
      api('sessions'),
    ]);
    setEmail(emailState);
    setSessions(sessionState.sessions || []);
  };
  useEffect(() => {
    load().catch(() => undefined);
  }, []);
  return (
    <section className="card settings-section">
      <h2>Seguridad de la cuenta</h2>
      <p className="muted">
        La sesión usa una cookie segura, vence tras 30 minutos sin actividad y
        tiene un máximo absoluto de 12 horas.
      </p>
      <div className="status-list">
        <p>
          Autenticación en dos pasos <strong>Activa</strong>
        </p>
        <p>
          Correo de seguridad{' '}
          <strong>
            {email?.verified
              ? 'Verificado'
              : email?.configured
                ? 'Pendiente'
                : 'No configurado'}
          </strong>
        </p>
      </div>
      {email?.configured && !email?.verified && (
        <button
          className="btn"
          disabled={busy || !email.verificationEnabled}
          onClick={() =>
            run(async () => {
              await api('email/verification', 'POST', {});
            })
          }
        >
          {email.verificationEnabled
            ? 'Enviar verificación'
            : 'Verificación por correo aún no activada'}
        </button>
      )}
      {email && !email.configured && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('email');
            run(async () => {
              await api('email', 'PUT', { email: value });
              await load();
            });
          }}
        >
          <label>
            Correo de seguridad
            <input name="email" type="email" required maxLength={254} />
          </label>
          <button className="btn primary" disabled={busy}>
            Guardar correo
          </button>
        </form>
      )}
      <details className="settings-section">
        <summary>Sesiones activas ({sessions.length})</summary>
        {sessions.map((session) => (
          <div className="status-line" key={session.id}>
            <span>
              Último uso: {new Date(session.lastSeenAt).toLocaleString('es-EC')}
            </span>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`sessions/${session.id}`, 'DELETE', {});
                  await load();
                })
              }
            >
              Cerrar sesión
            </button>
          </div>
        ))}
      </details>
    </section>
  );
}

export function MfaPanel({ enrollment, busy, error, onVerify, onRecover }: any) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (enrollment?.uri)
      QRCodeGenerator.toDataURL(enrollment.uri, { width: 260, margin: 2 }).then(
        setQr,
      );
  }, [enrollment?.uri]);
  return (
    <main className="auth-page">
      <section className="card auth-card" aria-labelledby="mfa-heading">
        <p className="eyebrow">SEGURIDAD</p>
        <h1 id="mfa-heading">
          {enrollment ? 'Protege tu cuenta' : 'Código de autenticación'}
        </h1>
        <p className="muted">
          {enrollment
            ? 'Escanea el QR con tu aplicación de autenticación y confirma el primer código.'
            : 'Escribe el código de seis dígitos de tu aplicación.'}
        </p>
        {enrollment && qr && (
          <img className="mfa-qr" src={qr} alt="QR para configurar autenticación de dos factores" />
        )}
        {enrollment?.secret && (
          <p className="mfa-secret">
            Clave manual <code>{enrollment.secret}</code>
          </p>
        )}
        {error && <div className="notice error" role="alert">{error}</div>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onVerify(String(new FormData(event.currentTarget).get('code')));
          }}
        >
          <label>
            Código de seis dígitos
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Verificando…' : 'Verificar y entrar'}
          </button>
        </form>
      {!enrollment && onRecover && (
        <details className="settings-section">
          <summary>Usar un código de recuperación</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onRecover(String(new FormData(event.currentTarget).get('code') || ''));
            }}
          >
            <label>
              Código de un solo uso
              <input name="code" required autoComplete="one-time-code" />
            </label>
            <button className="btn" disabled={busy}>
              Recuperar acceso
            </button>
          </form>
        </details>
      )}
      </section>
    </main>
  );
}

function PromotionsEditor({
  catalog,
  setCatalog,
  busy,
  save,
}: {
  catalog: Catalog;
  setCatalog: (catalog: Catalog) => void;
  busy: boolean;
  save: () => void;
}) {
  const toLocal = (value: string | null) => {
    if (!value) return '';
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Guayaquil',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(new Date(value))
      .replace(' ', 'T');
  };
  const fromLocal = (value: string) =>
    value ? new Date(`${value}:00-05:00`).toISOString() : null;
  const change = (id: string, update: Partial<Promotion>) =>
    setCatalog({
      ...catalog,
      promotions: catalog.promotions.map((promotion) =>
        promotion.id === id ? { ...promotion, ...update } : promotion,
      ),
    });
  const add = () => {
    const dish = catalog.dishes[0];
    if (!dish || catalog.promotions.length >= 8) return;
    setCatalog({
      ...catalog,
      promotions: [
        ...catalog.promotions,
        {
          id: uid('promo'),
          dishId: dish.id,
          title: `Descubre ${dish.name}`,
          description: 'Una recomendación especial de nuestra cocina.',
          badge: 'DESTACADO',
          image: '',
          promotionalPriceCents: null,
          startsAt: null,
          endsAt: null,
          enabled: false,
        },
      ],
    });
  };
  return (
    <section aria-labelledby="promotions-heading">
      <div className="editor-toolbar">
        <div>
          <p className="eyebrow">VENTAS Y VISIBILIDAD</p>
          <h2 id="promotions-heading">Campañas promocionales</h2>
          <p className="muted">
            Destaca hasta ocho platos con fechas y precio promocional opcional.
          </p>
        </div>
        <button
          className="btn primary"
          disabled={busy || !catalog.dishes.length || catalog.promotions.length >= 8}
          onClick={add}
        >
          <Plus size={16} /> Nueva campaña
        </button>
      </div>
      {!catalog.dishes.length && (
        <div className="notice">Añade un plato antes de crear promociones.</div>
      )}
      <div className="promotion-editor-list">
        {catalog.promotions.map((promotion, index) => (
          <details className="card promotion-editor" key={promotion.id} open={index === 0}>
            <summary>
              <span>
                <strong>{promotion.title}</strong>
                <small>
                  {catalog.dishes.find((dish) => dish.id === promotion.dishId)?.name ||
                    'Plato no disponible'}
                </small>
              </span>
              <span className={`badge ${promotion.enabled ? '' : 'amber'}`}>
                {promotion.enabled ? 'Activa' : 'Pausada'}
              </span>
            </summary>
            <div className="form-grid">
              <label>
                Título
                <input
                  maxLength={80}
                  value={promotion.title}
                  onChange={(event) => change(promotion.id, { title: event.target.value })}
                />
              </label>
              <label>
                Insignia
                <input
                  maxLength={30}
                  value={promotion.badge}
                  onChange={(event) => change(promotion.id, { badge: event.target.value })}
                />
              </label>
              <label>
                Plato
                <select
                  value={promotion.dishId}
                  onChange={(event) =>
                    change(promotion.id, { dishId: event.target.value })
                  }
                >
                  {catalog.dishes.map((dish) => (
                    <option key={dish.id} value={dish.id}>{dish.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Precio promocional opcional
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    promotion.promotionalPriceCents === null
                      ? ''
                      : promotion.promotionalPriceCents / 100
                  }
                  onChange={(event) =>
                    change(promotion.id, {
                      promotionalPriceCents: event.target.value
                        ? Math.round(Number(event.target.value) * 100)
                        : null,
                    })
                  }
                />
              </label>
              <label>
                Inicio · hora de Ecuador
                <input
                  type="datetime-local"
                  value={toLocal(promotion.startsAt)}
                  onChange={(event) =>
                    change(promotion.id, { startsAt: fromLocal(event.target.value) })
                  }
                />
              </label>
              <label>
                Final · hora de Ecuador
                <input
                  type="datetime-local"
                  value={toLocal(promotion.endsAt)}
                  onChange={(event) =>
                    change(promotion.id, { endsAt: fromLocal(event.target.value) })
                  }
                />
              </label>
            </div>
            <label>
              Descripción
              <textarea
                rows={3}
                maxLength={220}
                value={promotion.description}
                onChange={(event) =>
                  change(promotion.id, { description: event.target.value })
                }
              />
            </label>
            <label>
              Imagen opcional
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    change(promotion.id, { image: await uploadPhoto(file) });
                }}
              />
              <small>Si no eliges una, se utilizará la foto del plato.</small>
            </label>
            <div className="actions">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={promotion.enabled}
                  onChange={(event) =>
                    change(promotion.id, { enabled: event.target.checked })
                  }
                />
                Publicar esta campaña
              </label>
              <button
                className="btn danger"
                onClick={() =>
                  setCatalog({
                    ...catalog,
                    promotions: catalog.promotions.filter(
                      (candidate) => candidate.id !== promotion.id,
                    ),
                  })
                }
              >
                <Trash2 size={16} /> Eliminar
              </button>
            </div>
          </details>
        ))}
      </div>
      <div className="save-bar">
        <span>
          Configura tus campañas y guarda el borrador.
          <small>Los clientes las verán después de publicar el menú.</small>
        </span>
        <button className="btn primary" disabled={busy} onClick={save}>
          <Save size={16} /> {busy ? 'Guardando…' : 'Guardar promociones'}
        </button>
      </div>
    </section>
  );
}

function Reports({
  data,
  refresh,
  cancel,
}: {
  data: any;
  refresh: (query?: string) => void;
  cancel: (id: string) => void;
}) {
  const report = data?.report;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <>
      {!report ? (
        <section className="card empty">
          <BarChart3 />
          <h3>Cargando reportes…</h3>
        </section>
      ) : (
        <>
          <section className="summary-grid">
            <div className="summary-item">
              <span>Pedidos confirmados</span>
              <strong>{report.confirmedOrders}</strong>
            </div>
            <div className="summary-item">
              <span>Importe confirmado</span>
              <strong>{money(report.totalCents)}</strong>
            </div>
            <div className="summary-item">
              <span>Ticket promedio</span>
              <strong>{money(report.averageCents)}</strong>
            </div>
          </section>
          <div className="actions">
            <button className="btn" onClick={() => refresh('')}>
              Todo
            </button>
            <button
              className="btn"
              onClick={() =>
                refresh(
                  `?from=${encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString())}`,
                )
              }
            >
              7 días
            </button>
            <button
              className="btn"
              onClick={() =>
                refresh(
                  `?from=${encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString())}`,
                )
              }
            >
              30 días
            </button>
            <input
              aria-label="Desde"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <input
              aria-label="Hasta"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
            <button
              className="btn"
              disabled={!from && !to}
              onClick={() =>
                refresh(
                  `?${new URLSearchParams({ ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}), ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}) }).toString()}`,
                )
              }
            >
              Aplicar rango
            </button>
            <button
              className="btn"
              onClick={() =>
                download(
                  `pedidos-${new Date().toISOString().slice(0, 10)}.csv`,
                  ordersCsv(data.orders),
                  'text/csv',
                )
              }
            >
              Exportar CSV
            </button>
          </div>
          <section className="onboard-grid">
            <article className="card">
              <h2>Platos más pedidos</h2>
              {report.dishes.length ? (
                report.dishes.slice(0, 8).map((dish: any) => (
                  <div className="status-line" key={dish.id}>
                    <span>{dish.name}</span>
                    <strong>
                      {dish.quantity} · {money(dish.totalCents)}
                    </strong>
                  </div>
                ))
              ) : (
                <p className="muted">Todavía no hay pedidos.</p>
              )}
            </article>
            <article className="card">
              <h2>Platos menos pedidos</h2>
              {[...report.dishes]
                .sort((a: any, b: any) => a.quantity - b.quantity)
                .slice(0, 8)
                .map((dish: any) => (
                  <div className="status-line" key={dish.id}>
                    <span>{dish.name}</span>
                    <strong>{dish.quantity}</strong>
                  </div>
                ))}
            </article>
            <article className="card">
              <h2>Opciones preferidas</h2>
              {report.options.length ? (
                report.options.map((option: any) => (
                  <div className="status-line" key={option.id}>
                    <span>{option.name}</span>
                    <strong>{option.quantity}</strong>
                  </div>
                ))
              ) : (
                <p className="muted">Todavía no hay elecciones.</p>
              )}
            </article>
          </section>
          <section className="onboard-grid">
            <article className="card">
              <h2>Tendencia diaria</h2>
              {report.byDay.length ? (
                report.byDay.map((day: any) => (
                  <div className="status-line" key={day.day}>
                    <span>
                      {new Date(`${day.day}T12:00:00`).toLocaleDateString(
                        'es-EC',
                      )}
                    </span>
                    <strong>
                      {day.orders} · {money(day.totalCents)}
                    </strong>
                  </div>
                ))
              ) : (
                <p className="muted">Sin datos para este periodo.</p>
              )}
            </article>
            <article className="card">
              <h2>Horas con más pedidos</h2>
              {report.byHour.length ? (
                [...report.byHour]
                  .sort((a: any, b: any) => b.orders - a.orders)
                  .map((hour: any) => (
                    <div className="status-line" key={hour.hour}>
                      <span>{String(hour.hour).padStart(2, '0')}:00</span>
                      <strong>{hour.orders}</strong>
                    </div>
                  ))
              ) : (
                <p className="muted">Sin datos para este periodo.</p>
              )}
            </article>
          </section>
          <section className="card settings-section">
            <h2>Historial</h2>
            {data.orders.map((order: any) => (
              <article className="order-admin" key={order.id}>
                <div>
                  <strong>{order.number}</strong>
                  <small>
                    {new Date(order.createdAt).toLocaleString('es-EC')} ·{' '}
                    {order.alias || 'Sin alias'}
                  </small>
                </div>
                <span
                  className={`badge ${order.status === 'cancelled' ? 'amber' : ''}`}
                >
                  {order.status === 'cancelled' ? 'Cancelado' : 'Confirmado'}
                </span>
                <strong>{money(order.totalCents)}</strong>
                {order.status === 'confirmed' && (
                  <button
                    className="btn danger"
                    onClick={() => cancel(order.id)}
                  >
                    Cancelar
                  </button>
                )}
                <details className="order-admin-detail">
                  <summary>Ver detalle</summary>
                  {order.lines.map((line: any, index: number) => (
                    <div
                      className="order-admin-line"
                      key={`${line.dishId}-${index}`}
                    >
                      <strong>
                        {line.quantity} × {line.dishName}
                      </strong>
                      {line.options.map((option: any) => (
                        <small key={`${option.groupId}-${option.optionId}`}>
                          {option.groupName}: {option.optionName}
                        </small>
                      ))}
                      {line.note && <small>Nota: {line.note}</small>}
                      <span>{money(line.totalCents)}</span>
                    </div>
                  ))}
                </details>
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}
function ordersCsv(orders: any[]) {
  const quote = (value: unknown) =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [
    [
      'pedido',
      'fecha',
      'estado',
      'alias',
      'plato',
      'cantidad',
      'opciones',
      'nota',
      'total',
    ],
  ];
  for (const order of orders)
    for (const line of order.lines)
      rows.push([
        order.number,
        order.createdAt,
        order.status,
        order.alias,
        line.dishName,
        line.quantity,
        line.options
          .map((option: any) => `${option.groupName}: ${option.optionName}`)
          .join(' | '),
        line.note,
        (line.totalCents / 100).toFixed(2),
      ]);
  return rows.map((row) => row.map(quote).join(',')).join('\n');
}
