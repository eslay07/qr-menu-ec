import { z } from 'zod';
import { AuthSecurity } from './auth-security';
import type { CentralEnv } from './central-api';
import { digest, passwordHash, passwordIterations, randomToken } from './security';
import type { Store } from './store';
import { ApplicationRepository, localFirestore } from './application-repository';
import { FirestoreRestaurantStore } from './firestore-store';
import { firestoreId } from './firestore-rest';

export const ownerLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  turnstileToken: z.string().max(4096),
  rememberDevice: z.boolean().optional(),
}).strict();
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function handleOwnerAuth(request: Request, env: CentralEnv, loadStore: (id: string) => Store) {
  const security = new AuthSecurity(env);
  if (request.method === 'GET') {
    if (env.OWNER_EMAIL_MIGRATION) await migrateOwnerEmail(env, security);
    return json({ turnstileSiteKey: security.turnstileSiteKey });
  }
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return json({ error: 'Origen no permitido.' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return json({ error: 'Se requiere JSON.' }, 415);
  if (!security.encryptionReady) return json({ error: 'Acceso temporalmente no disponible.' }, 503);
  try {
    const raw = await request.text();
    if (raw.length > 6000) return json({ error: 'Solicitud demasiado grande.' }, 413);
    const input = ownerLoginSchema.parse(JSON.parse(raw));
    const emailHash = await digest(input.email);
    const rate = await security.rateLimitAccountAndIp(request, 'owner-email-login', emailHash, 5, 20, 15 * 60_000);
    if (!rate.allowed) return json({ error: 'Demasiados intentos. Espera unos minutos.' }, 429, { 'Retry-After': String(rate.retryAfter) });
    if (!await security.verifyTurnstile(input.turnstileToken, request))
      return json({ error: 'Completa nuevamente la verificación de seguridad.' }, 403);
    const rows = await new ApplicationRepository(env).findByEmail(emailHash);
    const store = rows.length === 1 ? loadStore(rows[0].id) : null;
    const stored = await store?.read();
    if (!store || !stored) {
      await passwordHash(input.password, 'unregistered-owner');
      return json({ error: 'Correo o contraseña incorrectos.' }, 401);
    }
    const state = stored.state;
    if (state.failures.until > Date.now()) return json({ error: 'Demasiados intentos. Espera unos minutos.' }, 429);
    const valid = state.access?.active !== false && await security.authenticatePassword(state, 'owner', state.restaurantId, input.password);
    if (!valid || state.access?.active === false) {
      state.failures.count++;
      if (state.failures.count >= 5) state.failures.until = Date.now() + 900_000;
      await store.commit(state, stored.revision);
      return json({ error: 'Correo o contraseña incorrectos.' }, 401);
    }
    if (!security.usesFirebase && (!state.password.iterations || state.password.iterations < passwordIterations)) {
      const salt = randomToken();
      state.password = { salt, hash: await passwordHash(input.password, salt), iterations: passwordIterations };
    }
    state.failures = { count: 0, until: 0 };
    if (!await store.commit(state, stored.revision)) return json({ error: 'Intenta ingresar nuevamente.' }, 409);
    const session = await security.createSession('owner', state.restaurantId);
    await security.audit(state.restaurantId, `owner:${state.restaurantId}`, 'auth.email-login', 'success', Date.now());
    const response = json({ ownerUrl: `/r/${state.restaurantId}/` }, 200, { 'Set-Cookie': session.cookie });
    if (input.rememberDevice) {
      const device = await security.createDevice(state.restaurantId);
      response.headers.append('Set-Cookie', device.cookie);
    }
    return response;
  } catch (error) {
    return json({ error: error instanceof z.ZodError ? 'Revisa tu correo y contraseña.' : 'No se pudo iniciar sesión. Intenta nuevamente.' }, 400);
  }
}

export async function handleOwnerDevice(request: Request, env: CentralEnv, loadStore: (id: string) => Store) {
  const security = new AuthSecurity(env);
  const path = new URL(request.url).pathname;
  if (path === '/api/owner/device-session' && request.method === 'GET') {
    const device = await security.device(request);
    return json({ remembered: !!device, csrfToken: device?.csrf_token || null });
  }
  if (path !== '/api/owner/device-session/refresh' || request.method !== 'POST')
    return json({ error: 'Ruta no encontrada.' }, 404);
  if (request.headers.get('origin') !== new URL(request.url).origin ||
      request.headers.get('content-type') !== 'application/json' ||
      !/^[a-zA-Z0-9]{20,64}$/.test(request.headers.get('x-csrf-token') || ''))
    return json({ error: 'Solicitud no autorizada.' }, 403);
  const current = await security.device(request);
  if (!current) return json({ error: 'Vuelve a iniciar sesión.' }, 401);
  const stored = await loadStore(current.restaurant_id).read();
  if (!stored || stored.state.access?.active === false) return json({ error: 'Acceso no disponible.' }, 403);
  if (!await security.rememberedDeviceValid(current.restaurant_id, current.created_at)) {
    await security.revokeSubject('owner', current.restaurant_id);
    return json({ error: 'La contraseña cambió. Vuelve a iniciar sesión.' }, 401, { 'Set-Cookie': security.clearDeviceCookie() });
  }
  const rotated = await security.rotateDevice(request, request.headers.get('x-csrf-token')!);
  if (!rotated) return json({ error: 'Vuelve a iniciar sesión.' }, 401);
  await security.resumeRememberedOwner(rotated.restaurantId);
  const session = await security.createSession('owner', rotated.restaurantId);
  const response = json({ ownerUrl: `/r/${rotated.restaurantId}/` }, 200, { 'Set-Cookie': session.cookie });
  response.headers.append('Set-Cookie', rotated.cookie);
  return response;
}

export async function handleOwnerRecovery(request: Request, env: CentralEnv, loadStore: (id: string) => Store) {
  const security = new AuthSecurity(env);
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Origen no permitido.' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Se requiere JSON.' }, 415);
  try {
    const raw = await request.text();
    if (raw.length > 6000) return json({ error: 'Solicitud demasiado grande.' }, 413);
    const input = z.object({ email: z.string().trim().toLowerCase().email().max(254), turnstileToken: z.string().max(4096) }).strict().parse(JSON.parse(raw));
    const hash = await digest(input.email);
    const rate = await security.rateLimitAccountAndIp(request, 'owner-email-recovery', hash, 3, 10, 3_600_000);
    if (!rate.allowed) return json({ error: 'Espera antes de solicitar otro enlace.' }, 429);
    if (!await security.verifyTurnstile(input.turnstileToken, request)) return json({ error: 'Completa nuevamente la verificación de seguridad.' }, 403);
    if (!security.usesFirebase) return json({ error: 'La recuperación por correo aún no está disponible.' }, 503);
    const rows = await new ApplicationRepository(env).findByEmail(hash);
    if (rows.length === 1) {
      const current = await loadStore(rows[0].id).read();
      if (current && current.state.access?.active !== false) {
        try {
          await security.requestFirebasePasswordReset(current.state, 'owner', current.state.restaurantId);
          await security.audit(current.state.restaurantId, 'owner:recovery', 'auth.firebase-recovery.request', 'success', Date.now());
        } catch {
          await security.audit(current.state.restaurantId, 'owner:recovery', 'auth.firebase-recovery.request', 'failure', Date.now());
        }
      }
    }
    // Identical response whether registered, suspended or delivery failed.
    return json({ ok: true, message: 'Si el correo tiene una cuenta activa, recibirás un enlace. Revisa spam; si no llega, contacta al administrador.' });
  } catch { return json({ error: 'Revisa el correo e intenta nuevamente.' }, 400); }
}

// Operator-supplied, one-time migration. Never reads the email or restaurant
// from the request; the configuration is removed after deployment verification.
async function migrateOwnerEmail(env: CentralEnv, security: AuthSecurity) {
  const migration = z.object({ id: z.string().min(1), restaurantId: z.string().uuid(), email: z.string().trim().toLowerCase().email() })
    .strict().parse(JSON.parse(env.OWNER_EMAIL_MIGRATION!));
  const firestore = localFirestore(env);
  if (firestore) {
    const path = `migrationRuns/${firestoreId(migration.id)}`;
    if (await firestore.get(path)) return;
    const store = new FirestoreRestaurantStore(firestore, migration.restaurantId, { async mediaGet() { throw Error('Sin archivos en migración de correo.'); }, async mediaPut() { throw Error('Sin archivos en migración de correo.'); } });
    const current = await store.read();
    if (!current) throw Error('Restaurante de migración no encontrado.');
    await security.updateFirebaseEmail(current.state, migration.email);
    current.state.security = { ...current.state.security, emailHash: await digest(migration.email), emailCiphertext: await security.encrypt(migration.email), emailVerifiedAt: undefined };
    current.state.sessionEpoch++;
    await security.revokeSubject('owner', migration.restaurantId);
    await security.revokeDevicesForRestaurant(migration.restaurantId);
    if (!await store.commit(current.state, current.revision, [{ path, data: { completedAt: new Date(), restaurantId: migration.restaurantId, kind: 'owner-email' }, exists: false }])) throw Error('La cuenta cambió durante la migración. Intenta nuevamente.');
    return;
  }
  const done = await env.DB.prepare('SELECT id FROM security_migrations WHERE id = ?').bind(migration.id).first();
  if (done) return;
  const emailHash = await digest(migration.email);
  const ciphertext = await security.encrypt(migration.email);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE application SET data = json_set(data, '$.security.emailHash', ?, '$.security.emailCiphertext', ?, '$.security.emailVerifiedAt', NULL), revision = revision + 1 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM security_migrations WHERE id = ?)").bind(emailHash, ciphertext, migration.restaurantId, migration.id),
    env.DB.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE scope = 'owner' AND restaurant_id = ? AND NOT EXISTS (SELECT 1 FROM security_migrations WHERE id = ?)").bind(now, migration.restaurantId, migration.id),
    env.DB.prepare('INSERT OR IGNORE INTO security_migrations (id,completed_at) SELECT ?,? WHERE EXISTS (SELECT 1 FROM application WHERE id = ?)').bind(migration.id, now, migration.restaurantId),
  ]);
}
