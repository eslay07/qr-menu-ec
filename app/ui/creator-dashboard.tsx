'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Building2,
  ExternalLink,
  KeyRound,
  LogOut,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { Feature } from '@/lib/contracts';
import Turnstile from './turnstile';
import CreatorRecovery from './creator-recovery';
import { MfaPanel } from './dashboard';

type Restaurant = {
  id: string;
  revision: number;
  name: string;
  active: boolean;
  features: Feature[];
  maxDishes: number;
  sampleMenuEnabled: boolean;
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
type ManagedDomain = {
  primaryUrl?: string | null;
  aliases?: Array<{
    hostname: string;
    kind: string;
    status: string;
    lastError?: string | null;
  }>;
  custom?: null | { hostname: string; status: string };
  cnameTarget?: string | null;
  capacity?: { used: number; warningAt: number; limit: number };
};
const featureOptions: { value: Feature; label: string }[] = [
  { value: 'orders', label: 'Pedidos por QR y reportes' },
  { value: 'promotions', label: 'Campañas y precios promocionales' },
];

let creatorCsrfToken = '';
async function creatorApi(path: string, method = 'GET', data?: unknown) {
  const headers: Record<string, string> =
    data === undefined ? {} : { 'Content-Type': 'application/json' };
  if (!['GET', 'HEAD'].includes(method) && creatorCsrfToken)
    headers['X-CSRF-Token'] = creatorCsrfToken;
  const response = await fetch(`/api/creator/${path}`, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = (await response.json()) as any;
  if (body?.csrfToken) creatorCsrfToken = body.csrfToken;
  if (!response.ok)
    throw Error(body.error || 'No se pudo completar la operación.');
  return body;
}

export default function CreatorDashboard() {
  const [recoveryToken] = useState(() => typeof location === 'undefined' ? '' : new URLSearchParams(location.hash.slice(1)).get('recover') || '');
  const [recoverAccount, setRecoverAccount] = useState(!!recoveryToken);
  const [emailRecoveryReady, setEmailRecoveryReady] = useState(false);
  useEffect(() => { if (recoveryToken) history.replaceState(null, '', location.pathname); }, [recoveryToken]);
  const [ready, setReady] = useState(false),
    [configured, setConfigured] = useState(false),
    [authenticated, setAuthenticated] = useState(false);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [credentials, setCredentials] = useState<Credentials | null>(null),
    [mfa, setMfa] = useState<any>(null),
    [domainSettings, setDomainSettings] = useState<any>(null),
    [turnstileToken, setTurnstileToken] = useState(''),
    [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null),
    [turnstileAttempt, setTurnstileAttempt] = useState(0);
  const load = useCallback(async () => {
    try {
      const session = await creatorApi('session');
      setConfigured(session.configured);
      setEmailRecoveryReady(session.recoveryEmailReady === true);
      setAuthenticated(session.authenticated);
      setTurnstileSiteKey(session.turnstileSiteKey || null);
      if (session.authenticated) {
        const [result, platformDomains] = await Promise.all([
          creatorApi('restaurants'),
          creatorApi('domain-settings'),
        ]);
        setRestaurants(result.restaurants);
        setDomainSettings(platformDomains);
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
    setError('');
    try {
      const values = new FormData(event.currentTarget);
      let authResult;
      if (configured)
        authResult = await creatorApi('login', 'POST', {
          password: values.get('password'),
          turnstileToken,
        });
      else {
        const result = await creatorApi('setup', 'POST', {
          setupToken: values.get('setupToken'),
          password: values.get('password'),
          email: values.get('email'),
          turnstileToken,
        });
        authResult = result;
        setCredentials({
          title: 'Recuperación del creador',
          recovery: result.recovery,
        });
      }
      if (authResult?.mfaRequired) {
        setMfa(authResult);
        setConfigured(true);
        return;
      }
      setAuthenticated(true);
      setConfigured(true);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTurnstileToken('');
      setTurnstileAttempt((value) => value + 1);
      setBusy(false);
    }
  }
  async function addRestaurant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const form = event.currentTarget,
        values = new FormData(form);
      const features = featureOptions
        .filter((m) => values.get(m.value) === 'on')
        .map((m) => m.value);
      const result = await creatorApi('restaurants', 'POST', {
        name: values.get('name'),
        ownerPassword: values.get('ownerPassword'),
        ownerEmail: values.get('ownerEmail'),
        features,
      });
      setCredentials({
        title: 'Acceso nuevo del dueño',
        code: result.code,
        password: String(values.get('ownerPassword')),
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
    features = item.features,
  ) {
    setBusy(true);
    setError('');
    try {
      await creatorApi(`restaurants/${item.id}/access`, 'PUT', {
        active,
        features,
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
    setError('');
    try {
      const result = await creatorApi(`restaurants/${item.id}/reset`, 'POST', {
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
    await creatorApi('logout', 'POST', {});
    setAuthenticated(false);
    setRestaurants([]);
  }
  if (!ready)
    return (
      <main className="skeleton-shell" aria-busy="true">
        <span className="sr-only" role="status">
          Abriendo panel privado…
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
  if (!authenticated && recoverAccount) return <CreatorRecovery siteKey={turnstileSiteKey} enabled={emailRecoveryReady} token={recoveryToken} onBack={() => setRecoverAccount(false)} />;
  if (!authenticated && mfa)
    return (
      <MfaPanel
        enrollment={mfa.enrollment}
        busy={busy}
        error={error}
        onVerify={(code: string) => {
          setBusy(true);
          setError('');
          creatorApi('auth/mfa/verify', 'POST', { code })
            .then((result) => {
              setMfa(null);
              setAuthenticated(true);
              if (result.recoveryCodes)
                setCredentials({
                  title: 'Códigos de recuperación 2FA',
                  recovery: result.recoveryCodes.join('\n'),
                });
              return load();
            })
            .catch((failure) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
        onRecover={(code: string) => {
          setBusy(true);
          setError('');
          creatorApi('auth/mfa/recover', 'POST', { code })
            .then(() => {
              setMfa(null);
              setAuthenticated(true);
              return load();
            })
            .catch((failure) => setError(failure.message))
            .finally(() => setBusy(false));
        }}
      />
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
              ? 'Ingresa tu contraseña para administrar los accesos.'
              : 'Realiza una sola vez la instalación segura del creador.'}
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
            {!configured && (
              <label>
                Correo del creador
                <input name="email" type="email" required maxLength={254} />
                <small>Quedará cifrado y listo para verificación futura.</small>
              </label>
            )}
            <label>
              Contraseña del creador
              <input
                name="password"
                type="password"
                minLength={12}
                required
                autoComplete={configured ? 'current-password' : 'new-password'}
              />
              <small>Mínimo 12 caracteres.</small>
            </label>
            <Turnstile
              siteKey={turnstileSiteKey}
              onToken={setTurnstileToken}
              resetKey={turnstileAttempt}
            />
            <button disabled={busy} className="btn primary" type="submit">
              {busy
                ? 'Verificando…'
                : configured
                  ? 'Entrar'
                  : 'Activar panel privado'}
            </button>
          </form>
          {configured && <button className="text-button" onClick={() => setRecoverAccount(true)}>Recuperar mi cuenta por correo</button>}
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
        {error && (
          <div className="notice error feedback-toast" role="alert">
            {error}
          </div>
        )}
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
            <p className="eyebrow">DOMINIO GLOBAL OPCIONAL</p>
            <h2>Direcciones futuras de QR Menu</h2>
            <p className="muted">
              Al disponer del dominio global, escribe aquí su host base. Se
              preparará automáticamente un alias por restaurante sin quitar
              sus enlaces actuales.
            </p>
            {domainSettings?.status && (
              <p className="badge">Estado: {domainSettings.status}</p>
            )}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setBusy(true);
              setError('');
              creatorApi('domain-settings', 'PUT', {
                baseHostname: form.get('baseHostname'),
              })
                .then(setDomainSettings)
                .catch((failure) => setError(failure.message))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Dominio base
              <input
                name="baseHostname"
                placeholder="menus.qrmenuec.com"
                defaultValue={domainSettings?.baseHostname || ''}
                required
              />
            </label>
            <button className="btn primary" disabled={busy}>
              {busy ? 'Guardando…' : 'Preparar aliases globales'}
            </button>
          </form>
        </section>
        <section className="card creator-create">
          <div>
            <p className="eyebrow">NUEVO CLIENTE</p>
            <h2>Crear restaurante</h2>
            <p className="muted">
              El dueño recibe su código, contraseña y acceso únicamente a su
              propio local. Cada cuenta incluye una dirección permanente; un
              dominio comprado por el cliente puede configurarse como servicio
              adicional.
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
              <label>
                Correo del dueño
                <input name="ownerEmail" type="email" required maxLength={254} />
              </label>
            </div>
            <fieldset>
              <legend>Funciones permitidas</legend>
              <div className="creator-modes">
                {featureOptions.map((m) => (
                  <label className="check-label" key={m.value}>
                    <input
                      type="checkbox"
                      name={m.value}
                      defaultChecked={false}
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
              className={`card restaurant-admin ${item.active ? '' : 'suspended'}`}
              key={item.id}
            >
              <div className="restaurant-title">
                <Building2 />
                <div>
                  <h3>{item.name}</h3>
                  <code>{item.id}</code>
                </div>
                <span className={`badge ${item.active ? '' : 'amber'}`}>
                  {item.active ? 'Habilitado' : 'Suspendido'}
                </span>
              </div>
              <p>
                Menú publicado: versión{' '}
                {item.publishedVersion || 'sin publicar'}
              </p>
              <p>
                Dirección incluida:{' '}
                <a href={`/r/${item.id}/menu`} target="_blank">
                  Abrir dirección permanente
                </a>
              </p>
              <RestaurantDomains restaurant={item} />
              <OwnerEmailEditor restaurant={item} />
                <SampleMenuSettings restaurant={item} onSaved={load} />
              <div className="creator-modes">
                {featureOptions.map((m) => (
                  <label className="check-label" key={m.value}>
                    <input
                      type="checkbox"
                      disabled={!item.active}
                      checked={item.features.includes(m.value)}
                      onChange={(e) => {
                        const features = e.target.checked
                          ? [...item.features, m.value]
                          : item.features.filter((x) => x !== m.value);
                        setAccess(item, item.active, features);
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
                  className={`btn ${item.active ? 'danger' : ''}`}
                  onClick={() => setAccess(item, !item.active, item.features)}
                >
                  <Power size={15} />
                  {item.active ? 'Suspender dueño' : 'Habilitar dueño'}
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

function OwnerEmailEditor({ restaurant }: { restaurant: Restaurant }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  return <details className="owner-email-editor"><summary>Correo de acceso del dueño</summary>
    <p>Asigna el correo que usará para entrar con su contraseña. Al cambiarlo se cerrarán sus sesiones abiertas.</p>
    <form onSubmit={async event => {
      event.preventDefault();
      const email = new FormData(event.currentTarget).get('email');
      setBusy(true); setNotice('');
      try { await creatorApi(`restaurants/${restaurant.id}/email`, 'PUT', { email }); setNotice('Correo guardado. El dueño ya puede entrar con correo y contraseña.'); }
      catch (error) { setNotice((error as Error).message); }
      finally { setBusy(false); }
    }}><label>Correo del dueño<input type="email" name="email" autoComplete="email" required maxLength={254} /></label>
      <button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Guardar correo de acceso'}</button>
      {notice && <p role="status">{notice}</p>}
    </form>
  </details>;
}

function SampleMenuSettings({ restaurant, onSaved }: { restaurant: Restaurant; onSaved: () => Promise<void> }) {
  const [limit, setLimit] = useState(restaurant.maxDishes);
  const [enabled, setEnabled] = useState(restaurant.sampleMenuEnabled);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { setLimit(restaurant.maxDishes); setEnabled(restaurant.sampleMenuEnabled); }, [restaurant.maxDishes, restaurant.sampleMenuEnabled]);
  return <details className="owner-email-editor"><summary>Capacidad y carta de ejemplo</summary>
    <p>El límite se aplica al guardar, publicar, restaurar y cargar ejemplos. No puede ser menor que una carta existente.</p>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setNotice('');
      try {
        await creatorApi(`restaurants/${restaurant.id}/sample-config`, 'PUT', { revision: restaurant.revision, maxDishes: limit, sampleMenuEnabled: enabled });
        await onSaved(); setNotice('Capacidad y ejemplo guardados correctamente.');
      } catch (error) { setNotice((error as Error).message); }
      finally { setBusy(false); }
    }}>
      <label>Máximo de platos (1 a 150)<input type="number" min={1} max={150} required value={limit} onChange={event => setLimit(Number(event.target.value))} /></label>
      <label className="check-label"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Habilitar “Cargar ejemplo profesional”</label>
      <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar capacidad'}</button>
      {notice && <p role="status">{notice}</p>}
    </form>
  </details>;
}

function RestaurantDomains({ restaurant }: { restaurant: Restaurant }) {
  const [domain, setDomain] = useState<ManagedDomain | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<ManagedDomain>) => {
    setBusy(true);
    setError('');
    try {
      setDomain(await action());
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="domain-manager"
      onToggle={(event) => {
        if (event.currentTarget.open && !domain)
          run(() =>
            creatorApi(`restaurants/${restaurant.id}/hostname`, 'POST'),
          );
      }}
    >
      <summary>Administrar direcciones y dominio propio</summary>
      {busy && <p role="status">Consultando Cloudflare…</p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {domain?.primaryUrl && (
        <p>
          Dirección principal: <a href={domain.primaryUrl}>{domain.primaryUrl}</a>
        </p>
      )}
      {domain?.capacity && (
        <p>
          Workers gratuitos: {domain.capacity.used}/{domain.capacity.limit}
          {domain.capacity.used >= domain.capacity.warningAt
            ? ' · Capacidad cercana al límite.'
            : ''}
        </p>
      )}
      <ul>
        {domain?.aliases?.map((alias) => (
          <li key={alias.hostname}>
            <code>{alias.hostname}</code> · {alias.kind} · {alias.status}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          run(() =>
            creatorApi(
              `restaurants/${restaurant.id}/custom-domain`,
              'PUT',
              { hostname: values.get('hostname') },
            ),
          );
        }}
      >
        <label>
          Dominio propio del cliente
          <input
            name="hostname"
            placeholder="menu.restaurante.com"
            defaultValue={domain?.custom?.hostname || ''}
            required
          />
          <small>
            El cliente creará un CNAME hacia{' '}
            {domain?.cnameTarget || 'el destino configurado en Cloudflare'}.
          </small>
        </label>
        <div className="actions">
          <button className="btn primary" disabled={busy}>
            Conectar dominio
          </button>
          {domain?.custom && (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    creatorApi(
                      `restaurants/${restaurant.id}/custom-domain`,
                      'POST',
                      {},
                    ),
                  )
                }
              >
                Verificar certificado
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    creatorApi(
                      `restaurants/${restaurant.id}/custom-domain`,
                      'DELETE',
                      {},
                    ),
                  )
                }
              >
                Quitar dominio
              </button>
            </>
          )}
        </div>
      </form>
    </details>
  );
}
