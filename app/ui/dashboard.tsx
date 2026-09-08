"use client";
import { useEffect, useState, useRef } from "react";
import {
  QrCode,
  Utensils,
  Wifi,
  Settings as SettingsIcon,
  ShieldCheck,
  HardDrive,
  ArrowUpRight,
  Plus,
  Search,
  Eye,
  Save,
  Upload,
  Download,
  Lock,
  Globe,
  FileText,
  Monitor,
  Smartphone,
  Router,
  Check,
  Trash2,
  Pencil,
  ChevronDown,
  LogOut,
  ArrowUp,
  ArrowDown,
  type LucideIcon,
} from "lucide-react";
import {
  type Catalog,
  type Settings,
  type Mode,
  demoCatalog,
  blankCatalog,
  defaultSettings,
  money,
  buildOfflineText,
  OFFLINE_TEXT_QR_MAX_BYTES,
} from "@/lib/contracts";
import { api, download, uploadPhoto } from "./client";
import QRCode from "qrcode";
type PanelState = {
  restaurantId: string;
  revision: number;
  draft: Catalog;
  settings: Settings;
  published: null | {
    version: number;
    at: string;
    catalog: Catalog;
    mode: Mode;
  };
  offlinePrintedVersion: number | null;
  offlineReprintRequired: boolean;
  licensedModes: Mode[];
  hasLicense: boolean;
  role: "creator" | "owner";
};
const nav: [LucideIcon, string][] = [
  [Utensils, "Mi menú"],
  [QrCode, "Códigos QR"],
  [Wifi, "Acceso de clientes"],
  [HardDrive, "Equipos"],
  [SettingsIcon, "Mi restaurante"],
  [ShieldCheck, "Licencia y respaldos"],
];
const modeInfo: {
  id: Mode;
  title: string;
  desc: string;
  icon: LucideIcon;
  recommended?: boolean;
}[] = [
  {
    id: "dual_web_vcard",
    title: "Acceso doble",
    desc: "Dos QR: menú visual por internet y carta en texto sin conexión.",
    icon: QrCode,
    recommended: true,
  },
  {
    id: "web",
    title: "Solo menú web",
    desc: "Modalidad anterior con un único QR web.",
    icon: Globe,
  },
  {
    id: "text",
    title: "Texto dividido",
    desc: "Modalidad anterior de texto en uno o varios QR.",
    icon: FileText,
  },
  {
    id: "local",
    title: "Red local",
    desc: "Modalidad anterior dentro de la red del restaurante.",
    icon: Wifi,
  },
];
type Dish = Catalog["dishes"][0];
export default function Dashboard() {
  const [tab, setTab] = useState("Mi menú"),
    [session, setSession] = useState<{
      configured: boolean;
      authenticated: boolean;
      platformSetup: boolean;
      runtime: string;
    } | null>(null),
    [state, setState] = useState<PanelState | null>(null),
    [draft, setDraft] = useState<Catalog>(blankCatalog),
    [settings, setSettings] = useState<Settings>(defaultSettings),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [editing, setEditing] = useState<Dish | null>(null),
    [showCategories, setShowCategories] = useState(false),
    [recovery, setRecovery] = useState(""),
    [recoverMode, setRecoverMode] = useState(false),
    [codes, setCodes] = useState<any>(null),
    [health, setHealth] = useState<any>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty =
    !!state && JSON.stringify(draft) !== JSON.stringify(state.draft);
  async function reload() {
    const session = await api("session");
    setSession(session);
    if (session.authenticated) {
      const s = await api("state");
      setState(s);
      setDraft(s.draft);
      setSettings(s.settings);
    }
  }
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft() {
    await api("draft", "PUT", { revision: state!.revision, catalog: draft });
    setCodes(null);
    await reload();
    setMessage(
      "Borrador guardado. Publica y vuelve a generar los QR para incluir estos cambios.",
    );
  }
  async function saveSettings() {
    await api("settings", "PUT", { revision: state!.revision, settings });
    const s = await api("state");
    setState(s);
    setSettings(s.settings);
    setCodes(null);
    setMessage(
      settings.mode === "text"
        ? "QR de texto elegido. Publica el menú para generar las tarjetas sin internet."
        : "Configuración guardada. Vuelve a generar las tarjetas QR.",
    );
  }
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const life = new AbortController();
    const tool = {
      name: "get_menu_editor_state",
      description: "Lee el borrador visible y sus cambios sin publicar.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input: unknown) => {
        if (!input || typeof input !== "object" || Object.keys(input).length)
          throw Error("No se admiten parámetros.");
        return {
          tab,
          restaurantId: state?.restaurantId || null,
          draft: session?.authenticated ? draft : null,
          dirty,
        };
      },
    };
    Promise.resolve(context.registerTool(tool, { signal: life.signal })).catch(
      () => {},
    );
    return () => life.abort();
  }, [draft, state, tab, dirty, session]);
  useEffect(() => {
    if (dirty) setCodes(null);
  }, [dirty]);
  function field(key: keyof Catalog, value: any) {
    setDraft((d) => ({ ...d, [key]: value }));
  }
  function order<T>(list: T[], index: number, delta: number) {
    const copy = [...list];
    if (index + delta < 0 || index + delta >= list.length) return copy;
    [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]];
    return copy;
  }
  function editNew() {
    setEditing({
      id: crypto.randomUUID(),
      name: "",
      description: "",
      categoryId: draft.categories[0].id,
      priceCents: 0,
      available: true,
      image: "",
    });
  }
  const shown = draft.dishes.filter(
    (d) =>
      (category === "all" || category === d.categoryId) &&
      (d.name + " " + d.description)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const offlinePreview = buildOfflineText(draft, settings);
  function applyEditing() {
    if (!editing) return;
    const exists = draft.dishes.some((d) => d.id === editing.id),
      next = {
        ...draft,
        dishes: exists
          ? draft.dishes.map((d) => (d.id === editing.id ? editing : d))
          : [...draft.dishes, editing],
      };
    const nextCard = buildOfflineText(next, settings);
    if (
      settings.mode === "dual_web_vcard" &&
      !nextCard.fits &&
      (!exists || nextCard.bytes >= offlinePreview.bytes)
    ) {
      setError(
        `No se puede aplicar: el QR sin internet ocuparía ${nextCard.bytes} de ${OFFLINE_TEXT_QR_MAX_BYTES} bytes. El exceso aparece con “${nextCard.offendingDish || editing.name}”.`,
      );
      return;
    }
    setDraft(next);
    setEditing(null);
  }
  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="wordmark" href="/">
          <QrCode />
          <span>
            qr<span className="lime">menú</span>
            <small>HECHO PARA TU RESTAURANTE</small>
          </span>
        </a>
        <div className="restaurant-switch">
          <span className="avatar">{draft.name[0]}</span>
          <div>
            {draft.name}
            <small>Ecuador · USD</small>
          </div>
        </div>
        <p className="nav-label">TU ESPACIO</p>
        <nav>
          {nav.map(([Icon, label]) => (
            <button
              key={label}
              className={tab === label ? "active" : ""}
              onClick={() => setTab(label)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" />
          Tu menú, a tu manera<small>Internet + texto sin conexión</small>
          {session?.authenticated && (
            <button
              className="logout"
              onClick={() =>
                run(async () => {
                  await api("logout", "POST", {});
                  setState(null);
                  await reload();
                })
              }
            >
              <LogOut size={14} />
              Cerrar sesión
            </button>
          )}
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            Tu restaurante <span className="muted">/ {tab}</span>
          </span>
          <span className="badge">
            {state?.published
              ? `Publicado · v${state.published.version} · ${state.role === "creator" ? "Creador" : "Dueño"}`
              : "Panel del dueño"}
          </span>
        </header>
        <section className="page-heading">
          <div>
            <p className="eyebrow">TODO EMPIEZA CON UN BUEN PLATO</p>
            <h1>{tab}</h1>
            <p className="muted">
              {tab === "Mi menú"
                ? "Una carta siempre al día. Una mejor experiencia en cada mesa."
                : tab === "Acceso de clientes"
                  ? "Dos caminos claros: visual con internet y básico sin conexión."
                  : "Todo lo que necesitas, en un solo lugar."}
            </p>
          </div>
          {state && (
            <div className="actions">
              <a className="btn" href="/preview" target="_blank">
                <Eye size={17} />
                Vista previa
              </a>
              <button
                className="btn primary"
                disabled={
                  busy ||
                  dirty ||
                  (settings.mode === "dual_web_vcard" && !offlinePreview.fits)
                }
                onClick={() =>
                  run(async () => {
                    await api("publish", "POST", { revision: state.revision });
                    setCodes(null);
                    await reload();
                    setMessage(
                      settings.mode === "dual_web_vcard"
                        ? "Menú web actualizado. Regenera e imprime el QR de texto offline; el QR web no cambia."
                        : settings.mode === "text"
                          ? "Menú publicado. Genera y vuelve a imprimir los QR para llevar esta versión a las mesas."
                          : "Menú publicado. Los clientes verán esta versión al abrirlo de nuevo.",
                    );
                  })
                }
              >
                <Upload size={17} />
                Publicar menú
              </button>
            </div>
          )}
        </section>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button className="text-button" onClick={() => setError("")}>
              Cerrar
            </button>
          </div>
        )}
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        {state?.offlineReprintRequired &&
          settings.mode === "dual_web_vcard" && (
            <div className="notice warning" role="status">
              <strong>Reimpresión pendiente.</strong> El QR de texto impreso no
              corresponde a la versión publicada {state.published?.version}.
            </div>
          )}
        {recovery && (
          <div className="card recovery">
            <h3>Guarda tu código de recuperación</h3>
            <p>
              Solo se muestra ahora. Permite recuperar el acceso sin internet.
            </p>
            <code>{recovery}</code>
            <button
              className="btn"
              onClick={() =>
                download("recuperacion-qr-menu.txt", recovery, "text/plain")
              }
            >
              Descargar código
            </button>
            <button className="text-button" onClick={() => setRecovery("")}>
              Ya lo guardé
            </button>
          </div>
        )}
        {!state ? (
          <>
            <div className="hero-strip">
              <div>
                <span className="badge light">BIENVENIDO A QR MENÚ</span>
                <h2>
                  Tu carta. Tu estilo.
                  <br />
                  En cada mesa.
                </h2>
                <p>
                  Prepara tus platos, publica y entrega dos accesos claros para
                  cada cliente.
                </p>
                <a className="btn white" href="/demo">
                  Ver un menú de ejemplo <ArrowUpRight size={18} />
                </a>
              </div>
              <img
                src="/demo/encebollado.jpg"
                alt="Encebollado ecuatoriano. Fotografía de demostración."
              />
            </div>
            <div className="onboard-grid">
              <section className="card">
                <span className="eyebrow">TU APLICACIÓN CENTRAL</span>
                <h2>
                  {session?.configured
                    ? recoverMode
                      ? "Recuperar acceso"
                      : "Bienvenido de nuevo"
                    : "Prepara tu restaurante"}
                </h2>
                <p className="muted">
                  {session?.configured
                    ? "Entra con el código de tu local y la contraseña del dueño."
                    : "Crea el acceso privado del dueño. Después podrás importar tu licencia."}
                </p>
                {session && (
                  <form
                    ref={formRef}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      run(async () => {
                        const b = await api(
                          !session.configured
                            ? "setup"
                            : recoverMode
                              ? "recover"
                              : "login",
                          "POST",
                          Object.fromEntries(f),
                        );
                        if (b.recovery) setRecovery(b.recovery);
                        await reload();
                      });
                    }}
                  >
                    {!session.configured && (
                      <label>
                        Nombre del restaurante
                        <input
                          name="name"
                          required
                          maxLength={80}
                          placeholder="Ej. La Mesa"
                        />
                      </label>
                    )}
                    {!session.configured && !session.platformSetup && (
                      <label>
                        Código de instalación
                        <input name="setupToken" required autoComplete="off" />
                        <small>Lo encontrarás en el equipo servidor.</small>
                      </label>
                    )}
                    {session.configured && !recoverMode && (
                      <label>
                        Código del restaurante
                        <input
                          name="code"
                          required
                          maxLength={80}
                          autoComplete="username"
                          placeholder="Código entregado al dueño"
                        />
                      </label>
                    )}
                    {recoverMode && (
                      <label>
                        Código de recuperación
                        <input name="recovery" required autoComplete="off" />
                      </label>
                    )}
                    <label>
                      {recoverMode
                        ? "Nueva contraseña"
                        : "Contraseña del dueño"}
                      <input
                        name="password"
                        type="password"
                        required
                        minLength={!session.configured || recoverMode ? 12 : 1}
                        maxLength={128}
                        autoComplete={
                          session.configured && !recoverMode
                            ? "current-password"
                            : "new-password"
                        }
                      />
                      <small>
                        {!session.configured || recoverMode
                          ? "Al menos 12 caracteres. Guárdala en un lugar seguro."
                          : ""}
                      </small>
                    </label>
                    <button
                      disabled={busy}
                      className="btn primary"
                      type="submit"
                    >
                      {busy
                        ? "Un momento…"
                        : !session.configured
                          ? "Crear mi restaurante"
                          : recoverMode
                            ? "Restablecer acceso"
                            : "Entrar al panel"}
                    </button>
                    {session.configured && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setRecoverMode(!recoverMode)}
                      >
                        {recoverMode
                          ? "Volver al inicio de sesión"
                          : "Olvidé mi contraseña"}
                      </button>
                    )}
                  </form>
                )}
              </section>
              <section className="card">
                <h3>Acceso principal con dos QR</h3>
                {modeInfo.map(
                  ({ id, title, desc, icon: Icon, recommended }) => (
                    <div className="feature-line" key={id}>
                      <Icon size={22} />
                      <div>
                        <strong>{title}</strong>
                        {recommended && (
                          <span className="badge recommended">
                            Predeterminada
                          </span>
                        )}
                        <p className="muted">{desc}</p>
                      </div>
                    </div>
                  ),
                )}
                <div className="notice">
                  El cliente elige manualmente: menú visual con internet o carta
                  en texto sin conexión.
                </div>
              </section>
            </div>
          </>
        ) : (
          <>
            {tab === "Mi menú" && (
              <>
                <div className="summary-grid">
                  <div className="summary-item">
                    <span className="muted">Platos en tu carta</span>
                    <strong>
                      {draft.dishes.length}
                      <small>/ 150 disponibles</small>
                    </strong>
                  </div>
                  <div className="summary-item">
                    <span className="muted">Listos para servir</span>
                    <strong>
                      {draft.dishes.filter((d) => d.available).length}
                      <small>platos disponibles</small>
                    </strong>
                  </div>
                  <div className="summary-item">
                    <span className="muted">Tu modalidad</span>
                    <strong className="mode-name">
                      {modeInfo.find((m) => m.id === settings.mode)?.title}
                      <small>
                        {state.licensedModes.includes(settings.mode)
                          ? "Licencia activa"
                          : "Pendiente de activación"}
                      </small>
                    </strong>
                  </div>
                </div>
                <div className="editor-toolbar">
                  <label className="search">
                    <Search size={18} />
                    <input
                      aria-label="Buscar en tu carta"
                      placeholder="Buscar un plato…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <div className="actions">
                    <button
                      className="btn"
                      onClick={() => setShowCategories(!showCategories)}
                    >
                      Categorías <ChevronDown size={16} />
                    </button>
                    <button
                      className="btn primary"
                      disabled={draft.dishes.length >= 150}
                      onClick={editNew}
                    >
                      <Plus size={17} />
                      Añadir plato
                    </button>
                  </div>
                </div>
                {showCategories && (
                  <section className="card categories-editor">
                    <h3>Ordena tu carta</h3>
                    {draft.categories.map((c, i) => (
                      <div className="category-row" key={c.id}>
                        <input
                          aria-label="Nombre de categoría"
                          maxLength={50}
                          value={c.name}
                          onChange={(e) =>
                            field(
                              "categories",
                              draft.categories.map((x) =>
                                x.id === c.id
                                  ? { ...x, name: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                        <button
                          className="icon-button"
                          aria-label="Subir categoría"
                          onClick={() =>
                            field("categories", order(draft.categories, i, -1))
                          }
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Bajar categoría"
                          onClick={() =>
                            field("categories", order(draft.categories, i, 1))
                          }
                        >
                          <ArrowDown size={16} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Eliminar categoría vacía"
                          disabled={
                            draft.categories.length === 1 ||
                            draft.dishes.some((d) => d.categoryId === c.id)
                          }
                          onClick={() =>
                            field(
                              "categories",
                              draft.categories.filter((x) => x.id !== c.id),
                            )
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="btn"
                      disabled={draft.categories.length >= 30}
                      onClick={() =>
                        field("categories", [
                          ...draft.categories,
                          { id: crypto.randomUUID(), name: "Nueva categoría" },
                        ])
                      }
                    >
                      <Plus size={16} />
                      Nueva categoría
                    </button>
                  </section>
                )}
                <div className="category-tabs">
                  <button
                    className={category === "all" ? "selected" : ""}
                    onClick={() => setCategory("all")}
                  >
                    Toda la carta <b>{draft.dishes.length}</b>
                  </button>
                  {draft.categories.map((c) => (
                    <button
                      key={c.id}
                      className={category === c.id ? "selected" : ""}
                      onClick={() => setCategory(c.id)}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
                <div className="menu-list">
                  {shown.map((d) => (
                    <article className="menu-row" key={d.id}>
                      {d.image ? (
                        <img src={d.image} alt={d.name} />
                      ) : (
                        <span className="row-placeholder">
                          <Utensils />
                        </span>
                      )}
                      <div className="row-info">
                        <span className="eyebrow">
                          {
                            draft.categories.find((c) => c.id === d.categoryId)
                              ?.name
                          }
                        </span>
                        <h3>{d.name}</h3>
                        <p className="muted">
                          {d.description || "Sin descripción"}
                        </p>
                      </div>
                      <strong>{money(d.priceCents)}</strong>
                      <button
                        className={
                          "availability " + (d.available ? "available" : "")
                        }
                        aria-pressed={d.available}
                        onClick={() =>
                          field(
                            "dishes",
                            draft.dishes.map((x) =>
                              x.id === d.id
                                ? { ...x, available: !x.available }
                                : x,
                            ),
                          )
                        }
                      >
                        <span />
                        {d.available ? "Disponible" : "Agotado"}
                      </button>
                      <button
                        className="icon-button"
                        aria-label={"Editar " + d.name}
                        onClick={() => setEditing({ ...d })}
                      >
                        <Pencil size={17} />
                      </button>
                      <div className="reorder">
                        <button
                          className="icon-button"
                          aria-label={"Subir " + d.name}
                          onClick={() =>
                            field(
                              "dishes",
                              order(draft.dishes, draft.dishes.indexOf(d), -1),
                            )
                          }
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={"Bajar " + d.name}
                          onClick={() =>
                            field(
                              "dishes",
                              order(draft.dishes, draft.dishes.indexOf(d), 1),
                            )
                          }
                        >
                          <ArrowDown size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                  {!shown.length && (
                    <div className="empty">
                      <Utensils size={38} />
                      <h3>
                        {draft.dishes.length
                          ? "No encontramos ese plato"
                          : "Tu próximo gran menú empieza aquí"}
                      </h3>
                      <p>
                        Añade tus platos o carga una carta de ejemplo para
                        explorar el editor.
                      </p>
                      <div className="actions">
                        <button className="btn primary" onClick={editNew}>
                          Añadir mi primer plato
                        </button>
                        {!draft.dishes.length && (
                          <button
                            className="btn"
                            onClick={() => {
                              setDraft({ ...demoCatalog, name: draft.name });
                              setMessage(
                                "Ejemplo cargado como borrador. La foto es ilustrativa.",
                              );
                            }}
                          >
                            Cargar ejemplo
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="save-bar">
                  <span>
                    {dirty ? "Tienes cambios sin guardar" : "Borrador guardado"}
                    <small>Publicar actualiza el menú de tus clientes.</small>
                  </span>
                  <button
                    className="btn primary"
                    disabled={!dirty || busy}
                    onClick={() => run(saveDraft)}
                  >
                    <Save size={17} />
                    Guardar borrador
                  </button>
                </div>
              </>
            )}
            {tab === "Acceso de clientes" && (
              <>
                <div className="section-title">
                  <h2>¿Cómo compartes tu menú?</h2>
                  <span className="muted">
                    El acceso doble es el predeterminado; las modalidades
                    anteriores siguen disponibles
                  </span>
                </div>
                <div className="mode-grid">
                  {modeInfo.map(
                    ({ id, title, desc, icon: Icon, recommended }) => (
                      <button
                        className={
                          "card mode-card " +
                          (settings.mode === id ? "chosen" : "")
                        }
                        key={id}
                        onClick={() => {
                          if (
                            !state.licensedModes.includes(id) &&
                            id !== settings.mode
                          ) {
                            setTab("Licencia y respaldos");
                            return;
                          }
                          setSettings({ ...settings, mode: id });
                        }}
                      >
                        <div className="mode-card-top">
                          <Icon size={24} />
                          {state.licensedModes.includes(id) ? (
                            <Check size={18} />
                          ) : (
                            <Lock size={16} />
                          )}
                        </div>
                        <h3>{title}</h3>
                        <p className="muted">{desc}</p>
                        <span className="badge">
                          {recommended
                            ? "Predeterminada"
                            : state.licensedModes.includes(id)
                              ? "Habilitada"
                              : "Requiere licencia"}
                        </span>
                      </button>
                    ),
                  )}
                </div>
                {settings.mode === "dual_web_vcard" && (
                  <>
                    <section className="card settings-section">
                      <h2>Menú con internet</h2>
                      <label>
                        Dirección HTTPS permanente de Cloudflare
                        <input
                          type="url"
                          placeholder="https://menu.turestaurante.com/restaurante"
                          value={settings.webUrl}
                          onChange={(e) =>
                            setSettings({ ...settings, webUrl: e.target.value })
                          }
                        />
                      </label>
                      <p className="muted">
                        Este QR no cambia cuando publicas platos, fotos o
                        precios. Sin conexión, el navegador mostrará su error
                        normal y la tarjeta indica usar el otro QR.
                      </p>
                    </section>
                    <section className="card settings-section">
                      <h2>Menú sin internet</h2>
                      <p className="muted">
                        La cámara mostrará texto plano con símbolos visuales. No
                        intentará guardar un contacto; aquí controlas el
                        contenido exacto del QR.
                      </p>
                      <div className="form-grid">
                        <label>
                          Título
                          <input
                            maxLength={80}
                            placeholder={draft.name}
                            value={settings.offlineCard.title}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                offlineCard: {
                                  ...settings.offlineCard,
                                  title: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Mensaje inicial
                          <input
                            maxLength={160}
                            value={settings.offlineCard.intro}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                offlineCard: {
                                  ...settings.offlineCard,
                                  intro: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Teléfono
                          <input
                            maxLength={40}
                            value={settings.offlineCard.phone}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                offlineCard: {
                                  ...settings.offlineCard,
                                  phone: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Dirección
                          <input
                            maxLength={180}
                            value={settings.offlineCard.address}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                offlineCard: {
                                  ...settings.offlineCard,
                                  address: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Horario
                          <input
                            maxLength={120}
                            value={settings.offlineCard.hours}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                offlineCard: {
                                  ...settings.offlineCard,
                                  hours: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Despedida
                          <input
                            maxLength={160}
                            value={settings.offlineCard.farewell}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                offlineCard: {
                                  ...settings.offlineCard,
                                  farewell: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Separador
                          <input
                            maxLength={24}
                            value={settings.offlineCard.separator}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                offlineCard: {
                                  ...settings.offlineCard,
                                  separator: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Viñetas
                          <div className="inline-fields">
                            <input
                              aria-label="Viñeta de categoría"
                              maxLength={8}
                              value={settings.offlineCard.categoryBullet}
                              onChange={(e) =>
                                setSettings({
                                  ...settings,
                                  offlineCard: {
                                    ...settings.offlineCard,
                                    categoryBullet: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              aria-label="Viñeta de plato"
                              maxLength={8}
                              value={settings.offlineCard.dishBullet}
                              onChange={(e) =>
                                setSettings({
                                  ...settings,
                                  offlineCard: {
                                    ...settings.offlineCard,
                                    dishBullet: e.target.value,
                                  },
                                })
                              }
                            />
                          </div>
                        </label>
                      </div>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={settings.offlineCard.includeDescriptions}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              offlineCard: {
                                ...settings.offlineCard,
                                includeDescriptions: e.target.checked,
                              },
                            })
                          }
                        />
                        Incluir descripciones mientras quepan
                      </label>
                      <div
                        className={
                          "capacity " + (offlinePreview.fits ? "ok" : "over")
                        }
                      >
                        <div>
                          <strong>
                            {offlinePreview.bytes} / {OFFLINE_TEXT_QR_MAX_BYTES}{" "}
                            bytes
                          </strong>
                          <span>
                            {offlinePreview.fits
                              ? `${offlinePreview.remaining} bytes disponibles`
                              : "El contenido esencial no cabe"}
                          </span>
                        </div>
                        <progress
                          max={OFFLINE_TEXT_QR_MAX_BYTES}
                          value={Math.min(
                            offlinePreview.bytes,
                            OFFLINE_TEXT_QR_MAX_BYTES,
                          )}
                        />
                        {offlinePreview.omittedDescriptions.length > 0 && (
                          <p>
                            Descripciones omitidas solo en el texto offline:{" "}
                            {offlinePreview.omittedDescriptions.join(", ")}.
                          </p>
                        )}
                        {offlinePreview.compacted && (
                          <p>
                            Se redujeron adornos para conservar categorías,
                            nombres y precios.
                          </p>
                        )}
                        {offlinePreview.offendingDish && (
                          <p>
                            Plato que provoca el exceso:{" "}
                            <strong>{offlinePreview.offendingDish}</strong>.
                          </p>
                        )}
                      </div>
                      <button
                        className="btn primary"
                        disabled={busy || !offlinePreview.fits}
                        onClick={() => run(saveSettings)}
                      >
                        <Save size={17} />
                        Guardar acceso doble
                      </button>
                    </section>
                    <div className="dual-preview-grid">
                      <section className="card">
                        <h3>Vista previa del menú web</h3>
                        {settings.webUrl ? (
                          <>
                            <div className="web-preview">
                              <Globe size={35} />
                              <strong>{draft.name}</strong>
                              <span>
                                Fotografías · buscador · categorías · selección
                              </span>
                              <a
                                className="btn"
                                href={settings.webUrl}
                                target="_blank"
                              >
                                Abrir dirección configurada
                              </a>
                            </div>
                          </>
                        ) : (
                          <div className="empty">
                            <Globe />
                            <p>Configura la dirección HTTPS de Cloudflare.</p>
                          </div>
                        )}
                      </section>
                      <section className="card">
                        <h3>Vista previa exacta del texto</h3>
                        <pre className="offline-text-preview">
                          {offlinePreview.payload}
                        </pre>
                      </section>
                    </div>
                  </>
                )}
                {settings.mode === "text" && (
                  <section className="card settings-section">
                    <h2>Menú dentro del QR</h2>
                    <p className="muted">
                      Modalidad anterior: divide la carta en varias partes
                      numeradas cuando es necesario.
                    </p>
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() => run(saveSettings)}
                    >
                      <Save size={17} />
                      Guardar modalidad anterior
                    </button>
                  </section>
                )}
                {settings.mode === "web" && (
                  <section className="card settings-section">
                    <h2>Dirección del menú web</h2>
                    <label>
                      Dirección HTTPS
                      <input
                        type="url"
                        placeholder="https://menu.turestaurante.com/menu"
                        value={settings.webUrl}
                        onChange={(e) =>
                          setSettings({ ...settings, webUrl: e.target.value })
                        }
                      />
                    </label>
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() => run(saveSettings)}
                    >
                      <Save size={17} />
                      Guardar acceso web
                    </button>
                  </section>
                )}
                {settings.mode === "local" && (
                  <section className="card settings-section">
                    <h2>Cómo abren el menú tus clientes</h2>
                    <p className="muted">
                      Esta configuración se aplica a la modalidad anterior de
                      red local.
                    </p>
                    {[
                      [
                        "automatic_preferred",
                        "Automático cuando sea compatible",
                        "El portal presenta el menú después de conectar.",
                      ],
                      [
                        "guided",
                        "Guiado",
                        "Una bienvenida y el botón “Ver menú” acompañan al cliente.",
                      ],
                    ].map(([id, title, desc]) => (
                      <label
                        className={
                          "radio-card " +
                          (settings.accessExperience === id ? "chosen" : "")
                        }
                        key={id}
                      >
                        <input
                          type="radio"
                          name="experience"
                          checked={settings.accessExperience === id}
                          onChange={() =>
                            setSettings({
                              ...settings,
                              accessExperience:
                                id as Settings["accessExperience"],
                            })
                          }
                        />
                        <span>
                          <strong>{title}</strong>
                          <small>{desc}</small>
                        </span>
                      </label>
                    ))}
                    <div className="form-grid">
                      <label>
                        Nombre de red Wi-Fi
                        <input
                          value={settings.ssid}
                          maxLength={32}
                          onChange={(e) =>
                            setSettings({ ...settings, ssid: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Contraseña de invitados
                        <input
                          type="password"
                          value={settings.wifiPassword}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              wifiPassword: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Dirección local
                        <input
                          value={settings.localUrl}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              localUrl: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() => run(saveSettings)}
                    >
                      Guardar acceso local
                    </button>
                  </section>
                )}
                <div className="steps-strip">
                  {settings.mode === "dual_web_vcard" ? (
                    <>
                      <span>
                        <b>1</b>El cliente elige
                      </span>
                      <span>
                        <b>2</b>Escanea internet u offline
                      </span>
                      <span>
                        <b>3</b>Consulta el menú
                      </span>
                    </>
                  ) : (
                    <>
                      <span>
                        <b>1</b>Escanea el QR
                      </span>
                      <span>
                        <b>2</b>Abre el acceso
                      </span>
                      <span>
                        <b>3</b>Disfruta el menú
                      </span>
                    </>
                  )}
                </div>
              </>
            )}
            {tab === "Códigos QR" && (
              <>
                <section className="card">
                  <h2>Dos accesos para cada mesa</h2>
                  <p className="muted">
                    El QR web permanece igual en cada publicación. El texto sin
                    internet contiene precios y debe regenerarse e imprimirse
                    cuando cambie la carta.
                  </p>
                  <div className="actions">
                    <button
                      className="btn primary"
                      disabled={
                        busy ||
                        dirty ||
                        (settings.mode === "dual_web_vcard" &&
                          !offlinePreview.fits)
                      }
                      onClick={() =>
                        run(async () => {
                          const result = await api("qr");
                          for (const c of result.codes) {
                            if (!c.svg)
                              c.svg = await QRCode.toString(c.payload, {
                                type: "svg",
                                errorCorrectionLevel: "M",
                                margin: 4,
                                width: 360,
                              });
                          }
                          setCodes(result);
                        })
                      }
                    >
                      <QrCode size={17} />
                      Generar tarjetas
                    </button>
                    {codes && (
                      <button className="btn" onClick={() => window.print()}>
                        <Download size={17} />
                        Imprimir / Guardar PDF
                      </button>
                    )}
                    {codes?.mode === "dual_web_vcard" && (
                      <button
                        className="btn"
                        onClick={() =>
                          run(async () => {
                            await api("qr/printed", "POST", {});
                            await reload();
                            setMessage(
                              `Versión ${codes.version} marcada como impresa.`,
                            );
                          })
                        }
                      >
                        <Check size={17} />
                        Marcar QR offline como impreso
                      </button>
                    )}
                  </div>
                  {settings.mode === "dual_web_vcard" && (
                    <div className="notice">
                      <strong>Imprime ambos QR al frente y separados.</strong>{" "}
                      Rotula uno “MENÚ CON INTERNET” y el otro “MENÚ SIN
                      INTERNET”. No existe un tercer QR ni cambio automático.
                    </div>
                  )}
                </section>
                {codes && (
                  <div
                    className={
                      "qr-cards printable " +
                      (codes.mode === "dual_web_vcard"
                        ? "dual-mode"
                        : codes.mode === "text"
                          ? "text-mode"
                          : "")
                    }
                  >
                    {codes.codes.map((c: any, i: number) => (
                      <article
                        className={"qr-card " + (c.kind || "legacy")}
                        key={c.kind || i}
                      >
                        <span className="eyebrow">
                          {c.label || "BIENVENIDO A NUESTRA MESA"}
                        </span>
                        <h2>{codes.name}</h2>
                        <p>
                          {c.subtitle ||
                            (codes.mode === "local"
                              ? "Escanea. Conecta. Elige."
                              : codes.mode === "text"
                                ? "Escanea para leer nuestra carta sin internet"
                                : "Escanea y descubre nuestro menú")}
                        </p>
                        <div
                          className="qr-svg"
                          dangerouslySetInnerHTML={{ __html: c.svg }}
                        />
                        {c.kind === "web" && (
                          <>
                            <strong>Usa este QR si tienes internet</strong>
                            <small>
                              Fotos, buscador, categorías y selección de platos.
                            </small>
                          </>
                        )}
                        {c.kind === "offline_text" && (
                          <>
                            <strong>Usa este QR si no tienes internet</strong>
                            <small>
                              {c.bytes} bytes · corrección M · precios de esta
                              impresión
                            </small>
                            <details className="qr-payload no-print">
                              <summary>Ver texto offline exacto</summary>
                              <pre>{codes.offlineText}</pre>
                            </details>
                          </>
                        )}
                        {codes.mode === "local" && (
                          <>
                            <strong>{codes.settings.ssid}</strong>
                            <small>{codes.settings.localUrl}</small>
                          </>
                        )}
                        {codes.mode === "text" && (
                          <small>
                            Parte {i + 1} de {codes.codes.length} · {c.bytes}{" "}
                            bytes
                          </small>
                        )}
                        <small>
                          Versión publicada {codes.version} · QR Menú
                        </small>
                        <button
                          className="btn no-print"
                          onClick={() =>
                            download(
                              `menu-${c.kind || codes.mode}-v${codes.version}.svg`,
                              c.svg,
                              "image/svg+xml",
                            )
                          }
                        >
                          Descargar QR SVG
                        </button>
                      </article>
                    ))}
                  </div>
                )}
                {codes?.mode === "dual_web_vcard" && (
                  <section className="card qr-report no-print">
                    <h3>Reporte del paquete</h3>
                    <p>
                      Web: {codes.codes[0].bytes} bytes · Texto offline:{" "}
                      {codes.offlineBytes} / {OFFLINE_TEXT_QR_MAX_BYTES} bytes ·
                      quedan {codes.remaining}.
                    </p>
                    <p>
                      Descripciones omitidas solo en el texto offline:{" "}
                      {codes.omittedDescriptions.length
                        ? codes.omittedDescriptions.join(", ")
                        : "ninguna"}
                      .
                    </p>
                    <p>
                      Versión impresa registrada:{" "}
                      {state.offlinePrintedVersion ?? "ninguna"} · versión
                      generada: {codes.version}.
                    </p>
                  </section>
                )}
              </>
            )}
            {tab === "Equipos" && (
              <>
                <section className="card">
                  <h2>¿Dónde vive tu menú?</h2>
                  <p className="muted">
                    Selecciona el equipo que guarda tu carta. En red local, el
                    portal necesita un router compatible.
                  </p>
                  <div className="mode-grid device-grid">
                    {(
                      [
                        [
                          "router",
                          "Router servidor",
                          Router,
                          "GL-MT3000 / OpenWrt",
                        ],
                        [
                          "windows10",
                          "PC Windows 10",
                          Monitor,
                          "Servicio local + router",
                        ],
                        [
                          "windows7",
                          "PC Windows 7",
                          Monitor,
                          "Edición heredada + router",
                        ],
                        [
                          "android",
                          "Celular Android",
                          Smartphone,
                          "Android 10 o posterior + router",
                        ],
                      ] as const
                    ).map(([id, title, Icon, desc]) => (
                      <button
                        className={
                          "card mode-card " +
                          (settings.server === id ? "chosen" : "")
                        }
                        key={id}
                        onClick={() => setSettings({ ...settings, server: id })}
                      >
                        <Icon />
                        <h3>{title}</h3>
                        <p className="muted">{desc}</p>
                      </button>
                    ))}
                  </div>
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() => run(saveSettings)}
                  >
                    Guardar equipo
                  </button>
                  <div className="notice">
                    El hotspot Android independiente permite abrir la dirección
                    manualmente. La apertura del portal no está certificada para
                    un hotspot común.
                  </div>
                </section>
                <section className="card settings-section">
                  <div className="section-title">
                    <h2>Estado de la instalación</h2>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        run(async () => setHealth(await api("health")))
                      }
                    >
                      Comprobar servidor actual
                    </button>
                  </div>
                  <div className="status-list">
                    <p>
                      <span>Servidor de esta aplicación</span>
                      <strong>
                        {session?.runtime === "cloud"
                          ? "Versión alojada"
                          : "Servidor local"}
                      </strong>
                    </p>
                    <p>
                      <span>Publicación</span>
                      <strong>
                        {state.published
                          ? `Versión ${state.published.version}`
                          : "Sin publicar"}
                      </strong>
                    </p>
                    <p>
                      <span>Portal y apertura automática</span>
                      <span className="badge amber">
                        Pendiente de prueba en el restaurante
                      </span>
                    </p>
                    <p>
                      <span>Certificación de equipos</span>
                      <span className="badge amber">Pendiente</span>
                    </p>
                    {health && (
                      <p>
                        <span>Última respuesta del servidor</span>
                        <strong>
                          {new Date(health.checkedAt).toLocaleTimeString(
                            "es-EC",
                          )}
                        </strong>
                      </p>
                    )}
                  </div>
                  <p className="muted">
                    Esta comprobación no configura el router ni certifica su
                    Wi-Fi. El instalador debe probar la conexión con teléfonos
                    reales.
                  </p>
                </section>
              </>
            )}
            {tab === "Mi restaurante" && (
              <section className="card settings-section">
                <h2>Una carta con tu identidad</h2>
                <div className="form-grid">
                  <label>
                    Nombre comercial
                    <input
                      maxLength={80}
                      value={draft.name}
                      onChange={(e) => field("name", e.target.value)}
                    />
                  </label>
                  <label>
                    Frase de bienvenida
                    <input
                      maxLength={180}
                      value={draft.tagline}
                      onChange={(e) => field("tagline", e.target.value)}
                    />
                  </label>
                  <label>
                    Color de tu restaurante
                    <div className="color-input">
                      <input
                        type="color"
                        value={draft.color}
                        onChange={(e) => field("color", e.target.value)}
                      />
                      <code>{draft.color}</code>
                    </div>
                  </label>
                  <label>
                    Logotipo opcional
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          run(async () => field("logo", await uploadPhoto(f)));
                      }}
                    />
                    {draft.logo && (
                      <>
                        <img
                          className="logo-preview"
                          src={draft.logo}
                          alt="Logotipo"
                        />
                        <button
                          className="text-button"
                          onClick={() => field("logo", "")}
                        >
                          Quitar logotipo
                        </button>
                      </>
                    )}
                  </label>
                </div>
                <p className="muted">
                  Español · Ecuador · USD. Los precios se muestran tal como los
                  defines.
                </p>
                <button
                  className="btn primary"
                  disabled={busy || !dirty}
                  onClick={() => run(saveDraft)}
                >
                  Guardar identidad
                </button>
              </section>
            )}
            {tab === "Licencia y respaldos" && (
              <>
                <div className="onboard-grid">
                  <section className="card">
                    <ShieldCheck size={29} />
                    <h2>Tu licencia</h2>
                    <p className="muted">
                      Un pago, una modalidad. Amplía cuando lo necesites.
                    </p>
                    <label>
                      Identificador del restaurante
                      <code className="id-block">{state.restaurantId}</code>
                      <small>
                        Compártelo con el vendedor para emitir tu licencia.
                      </small>
                    </label>
                    {modeInfo.map((m) => (
                      <div className="status-line" key={m.id}>
                        <span>{m.title}</span>
                        <span className="badge">
                          {state.licensedModes.includes(m.id)
                            ? "Activa"
                            : "No adquirida"}
                        </span>
                      </div>
                    ))}
                    <label className="file-button">
                      <Upload size={16} />
                      Importar licencia firmada
                      <input
                        type="file"
                        accept="application/json,.json"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f)
                            run(async () => {
                              await api(
                                "license",
                                "POST",
                                JSON.parse(await f.text()),
                              );
                              await reload();
                              setMessage(
                                "Licencia validada. Ya puedes usar las modalidades adquiridas.",
                              );
                            });
                        }}
                      />
                    </label>
                    <small>
                      Solo el vendedor puede habilitar modalidades. No necesitas
                      internet para verificar la firma en el servidor local.
                    </small>
                  </section>
                  <section className="card">
                    <HardDrive size={29} />
                    <h2>Tu menú siempre contigo</h2>
                    <p className="muted">
                      Respalda el borrador, las fotos y la configuración. Guarda
                      primero los cambios pendientes.
                    </p>
                    <button
                      className="btn"
                      disabled={busy || dirty}
                      onClick={() =>
                        run(async () => {
                          const b = await api("backup");
                          download(
                            `qr-menu-${new Date().toISOString().slice(0, 10)}.json`,
                            JSON.stringify(b),
                          );
                          setMessage(
                            "Respaldo descargado con sus fotos. Incluye la contraseña de invitados: guárdalo en un lugar privado.",
                          );
                        })
                      }
                    >
                      <Download size={16} />
                      Descargar respaldo completo
                    </button>
                    <label className="file-button">
                      <Upload size={16} />
                      Restaurar o transferir un menú
                      <input
                        type="file"
                        accept="application/json,.json"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (
                            f &&
                            window.confirm(
                              "Se reemplazará el borrador y su configuración. La publicación actual, contraseña y licencia se conservan. ¿Restaurar?",
                            )
                          )
                            run(async () => {
                              if (f.size > 30000000)
                                throw Error("El respaldo supera 30 MB.");
                              const b = await api(
                                "restore",
                                "POST",
                                JSON.parse(await f.text()),
                              );
                              await reload();
                              setMessage(b.notice);
                            });
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <div className="notice">
                      Restaurar no publica automáticamente. Revisa tu carta
                      antes de compartirla.
                    </div>
                  </section>
                </div>
                <section className="card settings-section">
                  <h3>Una fuente principal, todos tus dispositivos</h3>
                  <p className="muted">
                    Abre este mismo panel desde tus dispositivos para editar el
                    mismo borrador. Para cambiar de servidor, exporta el
                    respaldo e impórtalo en el equipo nuevo. No hay
                    sincronización automática entre servidores desconectados.
                  </p>
                </section>
              </>
            )}
          </>
        )}
        {editing && (
          <div className="modal-backdrop">
            <form
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-label="Editar plato"
              onSubmit={(e) => {
                e.preventDefault();
                applyEditing();
              }}
            >
              <div className="section-title">
                <h2>
                  {draft.dishes.some((d) => d.id === editing.id)
                    ? "Editar plato"
                    : "Un nuevo favorito"}
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
                Nombre del plato
                <input
                  required
                  autoFocus
                  value={editing.name}
                  maxLength={90}
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
                    max="99999.99"
                    step="0.01"
                    required
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
                    {draft.categories.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Foto opcional
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      run(async () =>
                        setEditing({ ...editing, image: await uploadPhoto(f) }),
                      );
                  }}
                />
                {editing.image && (
                  <>
                    <img
                      className="detail-photo"
                      src={editing.image}
                      alt="Foto del plato"
                    />
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setEditing({ ...editing, image: "" })}
                    >
                      Quitar foto
                    </button>
                  </>
                )}
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={editing.available}
                  onChange={(e) =>
                    setEditing({ ...editing, available: e.target.checked })
                  }
                />
                Disponible para servir
              </label>
              <div className="actions">
                <button className="btn primary" type="submit" disabled={busy}>
                  Aplicar al borrador
                </button>
                {draft.dishes.some((d) => d.id === editing.id) && (
                  <button
                    className="btn danger"
                    type="button"
                    onClick={() => {
                      if (window.confirm("¿Quitar este plato del borrador?")) {
                        field(
                          "dishes",
                          draft.dishes.filter((d) => d.id !== editing.id),
                        );
                        setEditing(null);
                      }
                    }}
                  >
                    <Trash2 size={16} />
                    Eliminar
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
