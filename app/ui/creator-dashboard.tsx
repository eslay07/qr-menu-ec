"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Building2,
  ExternalLink,
  KeyRound,
  LogOut,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { Mode } from "@/lib/contracts";

type Restaurant = {
  id: string;
  revision: number;
  name: string;
  active: boolean;
  modes: Mode[];
  publishedVersion: number;
  createdAt: string;
};
type Credentials = {
  title: string;
  code?: string;
  password?: string;
  recovery: string;
  ownerUrl?: string;
  menuUrl?: string;
};
const modeOptions: { value: Mode; label: string }[] = [
  { value: "web", label: "Menú online" },
  { value: "local", label: "Servidor en red local" },
];

async function creatorApi(path: string, method = "GET", data?: unknown) {
  const response = await fetch(`/api/creator/${path}`, {
    method,
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = (await response.json()) as any;
  if (!response.ok)
    throw Error(body.error || "No se pudo completar la operación.");
  return body;
}

export default function CreatorDashboard() {
  const [ready, setReady] = useState(false),
    [configured, setConfigured] = useState(false),
    [authenticated, setAuthenticated] = useState(false);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [credentials, setCredentials] = useState<Credentials | null>(null);
  const load = useCallback(async () => {
    try {
      const session = await creatorApi("session");
      setConfigured(session.configured);
      setAuthenticated(session.authenticated);
      if (session.authenticated) {
        const result = await creatorApi("restaurants");
        setRestaurants(result.restaurants);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const values = new FormData(event.currentTarget);
      if (configured)
        await creatorApi("login", "POST", { password: values.get("password") });
      else {
        const result = await creatorApi("setup", "POST", {
          setupToken: values.get("setupToken"),
          password: values.get("password"),
        });
        setCredentials({
          title: "Recuperación del creador",
          recovery: result.recovery,
        });
      }
      setAuthenticated(true);
      setConfigured(true);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function addRestaurant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = event.currentTarget,
        values = new FormData(form);
      const modes = modeOptions
        .filter((m) => values.get(m.value) === "on")
        .map((m) => m.value);
      const result = await creatorApi("restaurants", "POST", {
        name: values.get("name"),
        ownerPassword: values.get("ownerPassword"),
        modes,
      });
      setCredentials({
        title: "Acceso nuevo del dueño",
        code: result.code,
        password: String(values.get("ownerPassword")),
        recovery: result.recovery,
        ownerUrl: result.ownerUrl,
        menuUrl: result.menuUrl,
      });
      form.reset();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function setAccess(
    item: Restaurant,
    active = item.active,
    modes = item.modes,
  ) {
    setBusy(true);
    setError("");
    try {
      await creatorApi(`restaurants/${item.id}/access`, "PUT", {
        active,
        modes,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resetPassword(item: Restaurant) {
    const password = prompt(
      `Nueva contraseña para ${item.name} (mínimo 12 caracteres):`,
    );
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      const result = await creatorApi(`restaurants/${item.id}/reset`, "POST", {
        password,
      });
      setCredentials({
        title: `Acceso restablecido: ${item.name}`,
        code: item.id,
        password,
        recovery: result.recovery,
        ownerUrl: `${location.origin}/r/${item.id}/`,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    await creatorApi("logout", "POST", {});
    setAuthenticated(false);
    setRestaurants([]);
  }
  if (!ready)
    return (
      <main className="creator-auth">
        <ShieldCheck size={42} />
        <h1>Abriendo panel privado…</h1>
      </main>
    );
  if (!authenticated)
    return (
      <main className="creator-auth">
        <section className="creator-login card">
          <ShieldCheck size={42} />
          <p className="eyebrow">CONTROL CENTRAL</p>
          <h1>Panel privado del creador</h1>
          <p>
            {configured
              ? "Ingresa tu contraseña para administrar los accesos."
              : "Realiza una sola vez la instalación segura del creador."}
          </p>
          {error && <div className="notice error">{error}</div>}
          <form onSubmit={submitAuth}>
            {!configured && (
              <label>
                Código de instalación
                <input
                  name="setupToken"
                  required
                  autoComplete="one-time-code"
                />
              </label>
            )}
            <label>
              Contraseña del creador
              <input
                name="password"
                type="password"
                minLength={12}
                required
                autoComplete={configured ? "current-password" : "new-password"}
              />
              <small>Mínimo 12 caracteres.</small>
            </label>
            <button disabled={busy} className="btn primary" type="submit">
              {busy
                ? "Verificando…"
                : configured
                  ? "Entrar"
                  : "Activar panel privado"}
            </button>
          </form>
        </section>
      </main>
    );
  return (
    <div className="creator-shell">
      <header className="creator-top">
        <div>
          <p className="eyebrow">QR MENU EC · CONTROL CENTRAL</p>
          <h1>Restaurantes y accesos</h1>
          <p>
            Solo tú puedes crear, suspender o restablecer las cuentas de los
            dueños.
          </p>
        </div>
        <button className="btn" onClick={logout}>
          <LogOut size={16} />
          Salir
        </button>
      </header>
      <main className="creator-main">
        {error && <div className="notice error">{error}</div>}
        {credentials && (
          <section className="card creator-credentials">
            <div>
              <p className="eyebrow">GUARDAR AHORA</p>
              <h2>{credentials.title}</h2>
              <p>Estos datos sensibles se muestran una sola vez.</p>
            </div>
            <button
              className="icon-button"
              onClick={() => setCredentials(null)}
              aria-label="Cerrar"
            >
              ×
            </button>
            {credentials.code && (
              <p>
                <span>Código del restaurante</span>
                <code>{credentials.code}</code>
              </p>
            )}
            {credentials.password && (
              <p>
                <span>Contraseña temporal elegida</span>
                <code>{credentials.password}</code>
              </p>
            )}
            <p>
              <span>Código de recuperación</span>
              <code>{credentials.recovery}</code>
            </p>
            {credentials.ownerUrl && (
              <a className="btn" href={credentials.ownerUrl} target="_blank">
                Abrir cuenta del dueño <ExternalLink size={15} />
              </a>
            )}
          </section>
        )}
        <section className="card creator-create">
          <div>
            <p className="eyebrow">NUEVO CLIENTE</p>
            <h2>Crear restaurante</h2>
            <p className="muted">
              El dueño recibe su código, contraseña y acceso únicamente a su
              propio local. Cada cuenta incluye una dirección permanente; un
              dominio comprado por el cliente puede configurarse como servicio adicional.
            </p>
          </div>
          <form onSubmit={addRestaurant}>
            <div className="form-grid">
              <label>
                Nombre del restaurante
                <input name="name" required maxLength={80} />
              </label>
              <label>
                Contraseña inicial del dueño
                <input
                  name="ownerPassword"
                  type="password"
                  minLength={12}
                  required
                />
              </label>
            </div>
            <fieldset>
              <legend>Funciones permitidas</legend>
              <div className="creator-modes">
                {modeOptions.map((m, i) => (
                  <label className="check-label" key={m.value}>
                    <input
                      type="checkbox"
                      name={m.value}
                      defaultChecked={i === 0}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <button disabled={busy} className="btn primary" type="submit">
              <Plus size={17} />
              Crear acceso
            </button>
          </form>
        </section>
        <section className="creator-list-head">
          <div>
            <h2>{restaurants.length} restaurantes</h2>
            <p className="muted">
              El estado se aplica inmediatamente al panel web y al APK.
            </p>
          </div>
          <button className="btn" onClick={load}>
            <RefreshCw size={15} />
            Actualizar
          </button>
        </section>
        <section className="creator-restaurants">
          {restaurants.map((item) => (
            <article
              className={`card restaurant-admin ${item.active ? "" : "suspended"}`}
              key={item.id}
            >
              <div className="restaurant-title">
                <Building2 />
                <div>
                  <h3>{item.name}</h3>
                  <code>{item.id}</code>
                </div>
                <span className={`badge ${item.active ? "" : "amber"}`}>
                  {item.active ? "Habilitado" : "Suspendido"}
                </span>
              </div>
              <p>
                Menú publicado: versión{" "}
                {item.publishedVersion || "sin publicar"}
              </p>
              <p>
                Dirección incluida:{" "}
                <a href={`/r/${item.id}/menu`} target="_blank">
                  Abrir dirección permanente
                </a>
              </p>
              <div className="creator-modes">
                {modeOptions.map((m) => (
                  <label className="check-label" key={m.value}>
                    <input
                      type="checkbox"
                      disabled={!item.active}
                      checked={item.modes.includes(m.value)}
                      onChange={(e) => {
                        const modes = e.target.checked
                          ? [...item.modes, m.value]
                          : item.modes.filter((x) => x !== m.value);
                        if (modes.length) setAccess(item, item.active, modes);
                      }}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
              <div className="actions">
                <a className="btn primary" href={`/r/${item.id}/`}>
                  <ExternalLink size={15} />
                  Abrir como creador
                </a>
                <button className="btn" onClick={() => resetPassword(item)}>
                  <KeyRound size={15} />
                  Nueva clave
                </button>
                <button
                  className={`btn ${item.active ? "danger" : ""}`}
                  onClick={() => setAccess(item, !item.active, item.modes)}
                >
                  <Power size={15} />
                  {item.active ? "Suspender dueño" : "Habilitar dueño"}
                </button>
              </div>
            </article>
          ))}
          {!restaurants.length && (
            <div className="card empty">
              <Building2 />
              <h3>Todavía no hay restaurantes</h3>
              <p>Crea el primer cliente arriba.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
