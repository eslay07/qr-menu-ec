'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
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
} from 'lucide-react';
import {
  type Catalog,
  type Dish,
  type Feature,
  type ModifierGroup,
  type Settings,
  blankCatalog,
  defaultSettings,
  demoCatalog,
  money,
} from '@/lib/contracts';
import { api, download, restaurantBase, uploadPhoto } from './client';

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
  free: null | { hostname: string; status: string };
  custom: null | { hostname: string; status: string; validation?: any };
  cnameTarget: string | null;
};
const nav = [
  'Mi menú',
  'Códigos QR',
  'Acceso y pedidos',
  'Pedidos y reportes',
  'Mi restaurante',
  'Respaldos',
];
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export default function Dashboard() {
  const base = restaurantBase();
  const [tab, setTab] = useState('Mi menú'),
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
    [customDomain, setCustomDomain] = useState('');
  const dirty =
    !!state && JSON.stringify(draft) !== JSON.stringify(state.draft);
  const settingsDirty =
    !!state && JSON.stringify(settings) !== JSON.stringify(state.settings);
  const pendingRef = useRef(false);
  pendingRef.current = dirty || settingsDirty;

  async function loadState(force = false) {
    const current = await api('session');
    setSession(current);
    if (!current.authenticated) {
      setState(null);
      return;
    }
    if (pendingRef.current && !force) return;
    const loaded = await api('state');
    setState(loaded);
    setDraft(loaded.draft);
    setSettings(loaded.settings);
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
    await loadState(true);
    setMessage(
      'Borrador guardado. Publica para actualizar el menú de tus clientes.',
    );
  }
  async function saveSettings() {
    await api('settings', 'PUT', { revision: state!.revision, settings });
    await loadState(true);
    setMessage('Configuración guardada.');
  }
  async function publish() {
    if (dirty) await saveDraft();
    const latest = await api('state');
    await api('publish', 'POST', { revision: latest.revision });
    await loadState(true);
    setMessage('Menú publicado correctamente.');
  }
  async function loadDomains() {
    setDomain(await api('domain'));
  }
  async function loadReports(query = '') {
    setReportData(await api(`reports/orders${query}`));
  }
  useEffect(() => {
    if (state && tab === 'Acceso y pedidos')
      loadDomains().catch((e) => setError(e.message));
    if (
      state &&
      tab === 'Pedidos y reportes' &&
      state.features.includes('orders')
    )
      loadReports().catch((e) => setError(e.message));
  }, [tab, !!state]);
  useEffect(() => {
    if (
      tab !== 'Acceso y pedidos' ||
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
      <main className="customer-empty">
        <Utensils />
        <h1>Abriendo tu restaurante…</h1>
      </main>
    );
  if (!state)
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
              {item === 'Mi menú' ? (
                <Utensils />
              ) : item === 'Códigos QR' ? (
                <QrCode />
              ) : item === 'Pedidos y reportes' ? (
                <BarChart3 />
              ) : item === 'Acceso y pedidos' ? (
                <Globe />
              ) : item === 'Respaldos' ? (
                <ShieldCheck />
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
        {error && <div className="notice error">{error}</div>}
        {message && <div className="notice">{message}</div>}

        {tab === 'Mi menú' && (
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
                  Configura platos, elecciones y recargos.
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
                    className="icon-button"
                    aria-label={`Editar ${dish.name}`}
                    onClick={() => setEditing(structuredClone(dish))}
                  >
                    <Pencil />
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
                Guardar borrador
              </button>
            </div>
          </>
        )}

        {tab === 'Códigos QR' && (
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
                <div
                  className="qr-svg"
                  dangerouslySetInnerHTML={{ __html: code.svg }}
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

        {tab === 'Acceso y pedidos' && (
          <>
            <section className="card settings-section">
              <h2>Dirección online gratuita</h2>
              <p className="muted">
                Se genera automáticamente y permanece como alias aunque conectes
                un dominio propio.
              </p>
              <code className="id-block">
                {domain?.free
                  ? `https://${domain.free.hostname}/menu`
                  : settings.webUrl || `${location.origin}${base}/menu`}
              </code>
            </section>
            <section className="card settings-section">
              <h2>Dominio propio</h2>
              <label>
                Subdominio
                <input
                  placeholder="menu.restaurante.com"
                  value={customDomain}
                  onChange={(e) =>
                    setCustomDomain(e.target.value.toLowerCase())
                  }
                />
              </label>
              <div className="actions">
                <button
                  className="btn primary"
                  disabled={busy || !customDomain}
                  onClick={() =>
                    run(async () => {
                      setDomain(
                        await api('domain', 'PUT', { hostname: customDomain }),
                      );
                      setMessage(
                        'Dominio registrado. Crea el CNAME mostrado y verifica.',
                      );
                    })
                  }
                >
                  Conectar dominio
                </button>
                {domain?.custom && (
                  <button
                    className="btn"
                    onClick={() =>
                      run(async () =>
                        setDomain(await api('domain/verify', 'POST', {})),
                      )
                    }
                  >
                    Verificar ahora
                  </button>
                )}
              </div>
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
                    Guardar configuración
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

        {tab === 'Pedidos y reportes' &&
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

        {tab === 'Mi restaurante' && (
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
              Guardar identidad
            </button>
          </section>
        )}

        {tab === 'Respaldos' && (
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
        <div className="modal-backdrop">
          <form
            className="modal dish-editor"
            onSubmit={(e) => {
              e.preventDefault();
              const exists = draft.dishes.some(
                (dish) => dish.id === editing.id,
              );
              setDraft({
                ...draft,
                dishes: exists
                  ? draft.dishes.map((dish) =>
                      dish.id === editing.id ? editing : dish,
                    )
                  : [...draft.dishes, editing],
              });
              setEditing(null);
            }}
          >
            <div className="section-title">
              <h2>
                {draft.dishes.some((dish) => dish.id === editing.id)
                  ? 'Editar plato'
                  : 'Nuevo plato'}
              </h2>
              <button
                type="button"
                className="text-button"
                onClick={() => setEditing(null)}
              >
                Cerrar
              </button>
            </div>
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
              <button className="btn primary" type="submit">
                Aplicar al borrador
              </button>
              {draft.dishes.some((dish) => dish.id === editing.id) && (
                <button
                  type="button"
                  className="btn danger"
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
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
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
