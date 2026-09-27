import { z } from 'zod';
import { AuthSecurity } from './auth-security';
import type { CentralEnv } from './central-api';
import { constantEqual, digest, passwordHash, passwordIterations, randomToken } from './security';
import type { Store } from './store';

export const ownerLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  turnstileToken: z.string().max(4096),
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
    const rows = await env.DB.prepare("SELECT id FROM application WHERE id <> '__creator__' AND json_extract(data, '$.security.emailHash') = ? LIMIT 2")
      .bind(emailHash).all<{ id: string }>();
    const store = rows.results.length === 1 ? loadStore(rows.results[0].id) : null;
    const stored = await store?.read();
    if (!store || !stored) {
      await passwordHash(input.password, 'unregistered-owner');
      return json({ error: 'Correo o contraseña incorrectos.' }, 401);
    }
    const state = stored.state;
    if (state.failures.until > Date.now()) return json({ error: 'Demasiados intentos. Espera unos minutos.' }, 429);
    const valid = constantEqual(await passwordHash(input.password, state.password.salt, state.password.iterations || 100_000), state.password.hash);
    if (!valid || state.access?.active === false) {
      state.failures.count++;
      if (state.failures.count >= 5) state.failures.until = Date.now() + 900_000;
      await store.commit(state, stored.revision);
      return json({ error: 'Correo o contraseña incorrectos.' }, 401);
    }
    if (!state.password.iterations || state.password.iterations < passwordIterations) {
      const salt = randomToken();
      state.password = { salt, hash: await passwordHash(input.password, salt), iterations: passwordIterations };
    }
    state.failures = { count: 0, until: 0 };
    if (!await store.commit(state, stored.revision)) return json({ error: 'Intenta ingresar nuevamente.' }, 409);
    const session = await security.createSession('owner', state.restaurantId);
    await security.audit(state.restaurantId, `owner:${state.restaurantId}`, 'auth.email-login', 'success', Date.now());
    return json({ ownerUrl: `/r/${state.restaurantId}/` }, 200, { 'Set-Cookie': session.cookie });
  } catch (error) {
    return json({ error: error instanceof z.ZodError ? 'Revisa tu correo y contraseña.' : 'No se pudo iniciar sesión. Intenta nuevamente.' }, 400);
  }
}

// Operator-supplied, one-time migration. Never reads the email or restaurant
// from the request; the configuration is removed after deployment verification.
async function migrateOwnerEmail(env: CentralEnv, security: AuthSecurity) {
  const migration = z.object({ id: z.string().min(1), restaurantId: z.string().uuid(), email: z.string().trim().toLowerCase().email() })
    .strict().parse(JSON.parse(env.OWNER_EMAIL_MIGRATION!));
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
