import { z } from 'zod';
import {
  Feature,
  blankCatalog,
  defaultSettings,
  normalizeCatalog,
  normalizeSettings,
} from './contracts';
import {
  constantEqual,
  digest,
  passwordHash,
  passwordIterations,
  randomToken,
  totpSecret,
  verifyTotp,
} from './security';
import type { State } from './store';
import { DomainService, type DomainEnv } from './domains';
import { AuthSecurity, type ActiveSession } from './auth-security';

export type CentralEnv = DomainEnv & {
  DB: D1Database;
  CREATOR_SETUP_TOKEN: string;
  LICENSE_PUBLIC_KEY?: string;
  DATA_ENCRYPTION_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  EMAIL_VERIFICATION_ENABLED?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  CREATOR_RECOVERY_EMAIL?: string;
  PUBLIC_APP_ORIGIN?: string;
  OWNER_EMAIL_MIGRATION?: string;
};
type CreatorState = {
  password: { salt: string; hash: string; iterations?: number };
  recoveryHash: string;
  sessionEpoch: number;
  failures: { count: number; until: number };
  createdAt: string;
  security?: State['security'];
};
const normalizeFeatures = (features?: string[]) =>
  (features || []).filter(
    (feature): feature is Feature =>
      feature === 'orders' || feature === 'promotions',
  );
const creatorId = '__creator__';
const cookieName = 'qrmenu_creator_session';
const responseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const json = (
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...responseHeaders, ...extra },
  });
const cookie = (value: string, request: Request) =>
  `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
const clearCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`;
async function requestBody(request: Request) {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 20_000)
    throw Error('La solicitud supera el tamaño permitido.');
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function readCreator(env: CentralEnv) {
  const row = await env.DB.prepare(
    'SELECT revision,data FROM application WHERE id = ?',
  )
    .bind(creatorId)
    .first<{ revision: number; data: string }>();
  return row
    ? { revision: row.revision, state: JSON.parse(row.data) as CreatorState }
    : null;
}
async function saveCreator(
  env: CentralEnv,
  state: CreatorState,
  revision: number | null,
) {
  const result =
    revision === null
      ? await env.DB.prepare(
          'INSERT OR IGNORE INTO application (id,revision,data) VALUES (?,0,?)',
        )
          .bind(creatorId, JSON.stringify(state))
          .run()
      : await env.DB.prepare(
          'UPDATE application SET revision = revision + 1, data = ? WHERE id = ? AND revision = ?',
        )
          .bind(JSON.stringify(state), creatorId, revision)
          .run();
  return result.meta.changes === 1;
}
async function creatorToken(state: CreatorState, expires: number) {
  return `${expires}.${await digest(`${state.password.hash}:${state.sessionEpoch}:${expires}`)}`;
}
async function creatorAuthenticated(request: Request, state: CreatorState) {
  const raw =
    request.headers
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) || '';
  const expires = Number(raw.split('.')[0]);
  return (
    expires > Date.now() &&
    expires < Date.now() + 86_400_001 &&
    constantEqual(raw, await creatorToken(state, expires))
  );
}
export async function isCreatorRequest(request: Request, env: CentralEnv) {
  const creator = await readCreator(env);
  if (!creator) return false;
  if (env.DATA_ENCRYPTION_KEY)
    return !!(await new AuthSecurity(env).session(request, 'creator', null));
  return creatorAuthenticated(request, creator.state);
}

export async function handleCreatorApi(
  request: Request,
  env: CentralEnv,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/creator\/?/, '');
    const method = request.method;
    const security = env.DATA_ENCRYPTION_KEY ? new AuthSecurity(env) : null;
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin)
        return json({ error: 'Origen no permitido.' }, 403);
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        return json({ error: 'Se requiere JSON.' }, 415);
    }
    const creator = await readCreator(env);
    let activeSession: ActiveSession | null | undefined;
    const secureSession = async () => {
      if (activeSession !== undefined) return activeSession;
      activeSession = security
        ? await security.session(request, 'creator', null)
        : null;
      return activeSession;
    };
    if (path === 'session' && method === 'GET') {
      const authenticated = creator
        ? security
          ? !!(await secureSession())
          : await creatorAuthenticated(request, creator.state)
        : false;
      return json({
        configured: !!creator,
        authenticated,
        csrfToken: authenticated ? (await secureSession())?.csrfToken || null : null,
        mfaConfigured: !!creator?.state.security?.totpEnabledAt,
        turnstileSiteKey: security?.turnstileSiteKey || null,
        recoveryEmailReady: !!env.CREATOR_RECOVERY_EMAIL && !!security?.emailDeliveryReady,
      });
    }
    if (path === 'setup' && method === 'POST') {
      if (creator)
        return json(
          { error: 'El panel del creador ya está configurado.' },
          409,
        );
      const input = z
        .object({
          setupToken: z.string().min(20).max(200),
          password: z.string().min(12).max(128),
          email: z.string().email().max(254).optional(),
          turnstileToken: z.string().max(4096).optional(),
        })
        .strict()
        .parse(await requestBody(request));
      if (security && !(await security.verifyTurnstile(input.turnstileToken, request)))
        return json({ error: 'No se pudo verificar que seas una persona.' }, 403);
      if (
        !env.CREATOR_SETUP_TOKEN ||
        !constantEqual(input.setupToken, env.CREATOR_SETUP_TOKEN)
      )
        return json({ error: 'Código de instalación incorrecto.' }, 403);
      const salt = randomToken(),
        recovery = randomToken();
      const state: CreatorState = {
        password: {
          salt,
          hash: await passwordHash(input.password, salt),
          iterations: passwordIterations,
        },
        recoveryHash: await digest(recovery),
        sessionEpoch: 0,
        failures: { count: 0, until: 0 },
        createdAt: new Date().toISOString(),
        security:
          input.email && security
            ? {
                emailCiphertext: await security.encrypt(input.email.toLowerCase()),
                emailHash: await digest(input.email.toLowerCase()),
              }
            : undefined,
      };
      if (!(await saveCreator(env, state, null)))
        return json({ error: 'El panel ya fue configurado.' }, 409);
      if (security) {
        const secret = totpSecret();
        const challenge = await security.challenge('creator', null, 'mfa_setup', {
          secretCiphertext: await security.encrypt(secret),
        });
        return json(
          {
            recovery,
            mfaRequired: true,
            enrollment: {
              secret,
              uri: `otpauth://totp/${encodeURIComponent('QR Menu EC:Creador')}?secret=${secret}&issuer=${encodeURIComponent('QR Menu EC')}`,
            },
          },
          201,
          { 'Set-Cookie': challenge.cookie },
        );
      }
      return json({ recovery }, 201, {
        'Set-Cookie': cookie(
          await creatorToken(state, Date.now() + 86_400_000),
          request,
        ),
      });
    }
    if (!creator)
      return json({ error: 'Configura primero el panel del creador.' }, 404);
    if (path === 'recovery/request' && method === 'POST' && security) {
      const input = z.object({ turnstileToken: z.string().max(4096) }).strict().parse(await requestBody(request));
      const rate = await security.rateLimitAccountAndIp(request, 'creator-recovery', 'creator', 3, 10, 60 * 60_000);
      if (!rate.allowed) return json({ error: 'Espera antes de solicitar otro enlace.' }, 429);
      if (!await security.verifyTurnstile(input.turnstileToken, request))
        return json({ error: 'Completa nuevamente la verificación de seguridad.' }, 403);
      if (!env.CREATOR_RECOVERY_EMAIL || !security.emailDeliveryReady)
        return json({ error: 'El envío de recuperación todavía no está configurado.' }, 503);
      const recipient = z.string().email().parse(env.CREATOR_RECOVERY_EMAIL);
      const actionToken = await security.issueActionToken('creator', null, 'password_reset', { passwordHash: creator.state.password.hash });
      const recoveryUrl = new URL('/creator', env.PUBLIC_APP_ORIGIN || 'https://qr-menu-ec.consola.workers.dev');
      recoveryUrl.hash = `recover=${encodeURIComponent(actionToken)}`;
      await security.deliverEmail(recipient, 'Recupera tu cuenta de QR Menu EC',
        `<p>Solicitaste recuperar tu cuenta de creador.</p><p><a href="${recoveryUrl.href}">Crear una nueva contraseña</a></p><p>Este enlace caduca en 30 minutos y solo puede usarse una vez. Al recuperar la cuenta configurarás nuevamente tu autenticador. Si no lo solicitaste, ignora este mensaje.</p>`);
      await security.audit(null, 'creator:recovery', 'auth.recovery.request', 'success', Date.now());
      return json({ ok: true, message: 'Enlace enviado a tu correo de recuperación. Revisa también spam.' });
    }
    if (path === 'recovery/reset' && method === 'POST' && security) {
      const input = z.object({ token: z.string().min(30).max(200), password: z.string().min(12).max(128), turnstileToken: z.string().max(4096) }).strict().parse(await requestBody(request));
      const rate = await security.rateLimit(request, 'creator-reset', 'creator', 10, 60 * 60_000);
      if (!rate.allowed) return json({ error: 'Demasiados intentos. Intenta más tarde.' }, 429);
      if (!await security.verifyTurnstile(input.turnstileToken, request)) return json({ error: 'Completa nuevamente la verificación de seguridad.' }, 403);
      const token = await security.takeActionToken(input.token, 'creator', null, 'password_reset');
      if (!token || JSON.parse(token.payload).passwordHash !== creator.state.password.hash)
        return json({ error: 'El enlace venció o ya fue utilizado. Solicita otro.' }, 400);
      const salt = randomToken();
      creator.state.password = { salt, hash: await passwordHash(input.password, salt), iterations: passwordIterations };
      creator.state.security = { ...creator.state.security, totpCiphertext: undefined, totpEnabledAt: undefined, recoveryCodeHashes: undefined };
      creator.state.failures = { count: 0, until: 0 };
      creator.state.sessionEpoch++;
      if (!await saveCreator(env, creator.state, creator.revision)) return json({ error: 'La cuenta cambió. Solicita un enlace nuevo.' }, 409);
      await security.revokeSubject('creator', null);
      await env.DB.prepare("DELETE FROM auth_challenges WHERE scope = 'creator'").run();
      await security.audit(null, 'creator:recovery', 'auth.recovery.completed', 'success', Date.now());
      return json({ ok: true }, 200, { 'Set-Cookie': security.clearSessionCookie('creator') });
    }
    if (path === 'login' && method === 'POST') {
      const rate = security
        ? await security.rateLimitAccountAndIp(
            request,
            'creator-login',
            'creator',
            5,
            20,
            15 * 60_000,
          )
        : { allowed: true, retryAfter: 0 };
      if (!rate.allowed)
        return json(
          { error: 'Demasiados intentos. Intenta nuevamente más tarde.' },
          429,
          { 'Retry-After': String(rate.retryAfter) },
        );
      if (creator.state.failures.until > Date.now())
        return json({ error: 'Demasiados intentos. Espera 15 minutos.' }, 429);
      const input = z
        .object({
          password: z.string().min(1).max(128),
          turnstileToken: z.string().max(4096).optional(),
        })
        .strict()
        .parse(await requestBody(request));
      if (security && !(await security.verifyTurnstile(input.turnstileToken, request)))
        return json({ error: 'No se pudo verificar que seas una persona.' }, 403);
      const valid = constantEqual(
        await passwordHash(
          input.password,
          creator.state.password.salt,
          creator.state.password.iterations || 100_000,
        ),
        creator.state.password.hash,
      );
      if (!valid) {
        await security?.audit(
          null,
          'creator:anonymous',
          'auth.login.failed',
          'failure',
          0,
        );
        creator.state.failures.count++;
        if (creator.state.failures.count >= 5)
          creator.state.failures.until = Date.now() + 900_000;
        await saveCreator(env, creator.state, creator.revision);
        return json({ error: 'Contraseña incorrecta.' }, 401);
      }
      creator.state.failures = { count: 0, until: 0 };
      if (security) {
        if (
          !creator.state.password.iterations ||
          creator.state.password.iterations < passwordIterations
        ) {
          creator.state.password.salt = randomToken();
          creator.state.password.hash = await passwordHash(
            input.password,
            creator.state.password.salt,
          );
          creator.state.password.iterations = passwordIterations;
        }
        const kind = creator.state.security?.totpCiphertext
          ? 'mfa_login'
          : 'mfa_setup';
        let enrollment: { secret: string; uri: string } | undefined;
        let payload: Record<string, unknown> = {};
        if (kind === 'mfa_setup') {
          const secret = totpSecret();
          payload = { secretCiphertext: await security.encrypt(secret) };
          enrollment = {
            secret,
            uri: `otpauth://totp/${encodeURIComponent('QR Menu EC:Creador')}?secret=${secret}&issuer=${encodeURIComponent('QR Menu EC')}`,
          };
        }
        await saveCreator(env, creator.state, creator.revision);
        const challenge = await security.challenge('creator', null, kind, payload);
        return json(
          { mfaRequired: true, enrollment },
          200,
          { 'Set-Cookie': challenge.cookie },
        );
      }
      await saveCreator(env, creator.state, creator.revision);
      return json({ ok: true }, 200, {
        'Set-Cookie': cookie(
          await creatorToken(creator.state, Date.now() + 86_400_000),
          request,
        ),
      });
    }
    if (path === 'auth/mfa/verify' && method === 'POST' && security) {
      const input = z
        .object({ code: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(await requestBody(request));
      const challenge = await security.readChallenge(request, 'creator', null);
      if (!challenge)
        return json({ error: 'El desafío venció. Inicia sesión otra vez.' }, 401);
      const ciphertext =
        challenge.kind === 'mfa_setup'
          ? String(challenge.payload.secretCiphertext || '')
          : creator.state.security?.totpCiphertext || '';
      const secret = await security.decrypt(ciphertext);
      if (!(await verifyTotp(secret, input.code))) {
        await security.failChallenge(challenge.hash);
        return json({ error: 'Código de autenticación incorrecto.' }, 401);
      }
      let recoveryCodes: string[] | undefined;
      if (challenge.kind === 'mfa_setup') {
        recoveryCodes = Array.from({ length: 10 }, () =>
          `${randomToken().slice(0, 5)}-${randomToken().slice(0, 5)}`,
        );
        creator.state.security = {
          ...creator.state.security,
          totpCiphertext: ciphertext,
          totpEnabledAt: new Date().toISOString(),
          recoveryCodeHashes: await Promise.all(recoveryCodes.map(digest)),
        };
        await saveCreator(env, creator.state, creator.revision);
      }
      await security.consumeChallenge(challenge.hash);
      const session = await security.createSession('creator', null);
      return json(
        { ok: true, csrfToken: session.csrfToken, recoveryCodes },
        200,
        { 'Set-Cookie': session.cookie },
      );
    }
    if (path === 'auth/mfa/recover' && method === 'POST' && security) {
      const input = z
        .object({ code: z.string().trim().min(8).max(100) })
        .strict()
        .parse(await requestBody(request));
      const challenge = await security.readChallenge(request, 'creator', null);
      if (!challenge)
        return json({ error: 'El desafío venció. Inicia sesión otra vez.' }, 401);
      const hash = await digest(input.code);
      const codes = creator.state.security?.recoveryCodeHashes || [];
      const index = codes.findIndex((candidate) => constantEqual(candidate, hash));
      if (index < 0) {
        await security.failChallenge(challenge.hash);
        return json({ error: 'Código de recuperación incorrecto.' }, 401);
      }
      creator.state.security = {
        ...creator.state.security,
        recoveryCodeHashes: codes.filter((_, candidate) => candidate !== index),
      };
      await saveCreator(env, creator.state, creator.revision);
      await security.consumeChallenge(challenge.hash);
      const session = await security.createSession('creator', null);
      return json({ ok: true, csrfToken: session.csrfToken }, 200, {
        'Set-Cookie': session.cookie,
      });
    }
    const creatorIsAuthenticated = security
      ? !!(await secureSession())
      : await creatorAuthenticated(request, creator.state);
    if (!creatorIsAuthenticated)
      return json({ error: 'Inicia sesión como creador.' }, 401);
    if (
      security &&
      method !== 'GET' &&
      method !== 'HEAD' &&
      !(await security.requireCsrf(request, await secureSession()))
    )
      return json({ error: 'La sesión de seguridad cambió. Recarga la página.' }, 403);
    if (path === 'logout' && method === 'POST') {
      if (security) {
        await security.revokeSession(request, 'creator');
        return json({ ok: true }, 200, {
          'Set-Cookie': security.clearSessionCookie('creator'),
        });
      }
      creator.state.sessionEpoch++;
      await saveCreator(env, creator.state, creator.revision);
      return json({ ok: true }, 200, { 'Set-Cookie': clearCookie });
    }
    if (path === 'restaurants' && method === 'GET') {
      const rows = await env.DB.prepare(
        'SELECT id,revision,data FROM application WHERE id <> ? ORDER BY id',
      )
        .bind(creatorId)
        .all<{ id: string; revision: number; data: string }>();
      const restaurants = rows.results.map((row) => {
        const state = JSON.parse(row.data) as State;
        state.draft = normalizeCatalog(state.draft);
        state.settings = normalizeSettings(state.settings);
        return {
          id: row.id,
          revision: row.revision,
          name: state.draft.name,
          active: state.access?.active !== false,
          features: normalizeFeatures(state.access?.features),
          publishedVersion: state.published?.version || 0,
          createdAt: state.createdAt,
        };
      });
      return json({ restaurants });
    }
    if (path === 'domain-settings' && method === 'GET')
      return json(await new DomainService(env).platformConfig());
    if (path === 'domain-settings' && method === 'PUT') {
      const input = z
        .object({ baseHostname: z.string().trim().toLowerCase() })
        .strict()
        .parse(await requestBody(request));
      return json(
        await new DomainService(env).configurePlatformDomain(
          input.baseHostname,
        ),
      );
    }
    if (path === 'restaurants' && method === 'POST') {
      const input = z
        .object({
          name: z.string().trim().min(1).max(80),
          ownerPassword: z.string().min(12).max(128),
          ownerEmail: z.string().email().max(254),
          features: z.array(Feature).max(2).default([]),
        })
        .parse(await requestBody(request));
      const id = crypto.randomUUID(),
        salt = randomToken(),
        recovery = randomToken();
      const settings = structuredClone(defaultSettings);
      const ownerEmailHash = await digest(input.ownerEmail.trim().toLowerCase());
      const duplicateEmail = await env.DB.prepare("SELECT id FROM application WHERE id <> '__creator__' AND json_extract(data, '$.security.emailHash') = ? LIMIT 1").bind(ownerEmailHash).first();
      if (duplicateEmail) return json({ error: 'Ese correo ya tiene un restaurante asignado.' }, 409);
      settings.webUrl = `${url.origin}/r/${id}/menu`;
      const state: State = {
        schemaVersion: 1,
        restaurantId: id,
        ownerId: `owner:${id}`,
        draft: { ...blankCatalog, name: input.name },
        settings,
        published: null,
        license: null,
        password: {
          salt,
          hash: await passwordHash(input.ownerPassword, salt),
          iterations: passwordIterations,
        },
        recoveryHash: await digest(recovery),
        sessionEpoch: 0,
        failures: { count: 0, until: 0 },
        createdAt: new Date().toISOString(),
        access: { active: true, features: input.features },
        security: security
          ? {
              emailCiphertext: await security.encrypt(
                input.ownerEmail.toLowerCase(),
              ),
              emailHash: ownerEmailHash,
            }
          : undefined,
      };
      const result = await env.DB.prepare(
        'INSERT OR IGNORE INTO application (id,revision,data) VALUES (?,0,?)',
      )
        .bind(id, JSON.stringify(state))
        .run();
      if (result.meta.changes !== 1)
        throw Error('No se pudo crear el restaurante.');
      settings.webUrl = await new DomainService(env).provisionFree(
        id,
        input.name,
        url.origin,
      );
      state.settings = settings;
      await env.DB.prepare(
        'UPDATE application SET revision = revision + 1, data = ? WHERE id = ?',
      )
        .bind(JSON.stringify(state), id)
        .run();
      return json(
        {
          id,
          code: id,
          recovery,
          ownerUrl: `${url.origin}/r/${id}/`,
          menuUrl: settings.webUrl,
        },
        201,
      );
    }
    const accessMatch = path.match(/^restaurants\/([a-f0-9-]{36})\/access$/);
    if (accessMatch && method === 'PUT') {
      const input = z
        .object({
          active: z.boolean(),
          features: z.array(Feature).max(2),
        })
        .parse(await requestBody(request));
      const row = await env.DB.prepare(
        'SELECT revision,data FROM application WHERE id = ?',
      )
        .bind(accessMatch[1])
        .first<{ revision: number; data: string }>();
      if (!row) return json({ error: 'Restaurante no encontrado.' }, 404);
      const state = JSON.parse(row.data) as State;
      if (state.access?.active !== false && !input.active) state.sessionEpoch++;
      state.access = { active: input.active, features: input.features };
      const result = await env.DB.prepare(
        'UPDATE application SET revision = revision + 1, data = ? WHERE id = ? AND revision = ?',
      )
        .bind(JSON.stringify(state), accessMatch[1], row.revision)
        .run();
      if (result.meta.changes !== 1)
        return json(
          { error: 'Otro cambio ocurrió al mismo tiempo. Recarga.' },
          409,
        );
      return json({ ok: true });
    }
    const hostnameMatch = path.match(
      /^restaurants\/([a-f0-9-]{36})\/hostname$/,
    );
    if (hostnameMatch && method === 'POST') {
      const row = await env.DB.prepare('SELECT data FROM application WHERE id = ?')
        .bind(hostnameMatch[1])
        .first<{ data: string }>();
      if (!row) return json({ error: 'Restaurante no encontrado.' }, 404);
      const state = JSON.parse(row.data) as State;
      await new DomainService(env).provisionFree(
        hostnameMatch[1],
        state.draft.name,
        url.origin,
      );
      return json(await new DomainService(env).get(hostnameMatch[1]));
    }
    const customDomainMatch = path.match(
      /^restaurants\/([a-f0-9-]{36})\/custom-domain$/,
    );
    if (customDomainMatch && method === 'PUT') {
      const input = z
        .object({ hostname: z.string() })
        .strict()
        .parse(await requestBody(request));
      return json(
        await new DomainService(env).put(customDomainMatch[1], input.hostname),
      );
    }
    if (customDomainMatch && method === 'POST')
      return json(await new DomainService(env).verify(customDomainMatch[1]));
    if (customDomainMatch && method === 'DELETE')
      return json(
        await new DomainService(env).removeCustom(customDomainMatch[1]),
      );
    const emailMatch = path.match(/^restaurants\/([a-f0-9-]{36})\/email$/);
    if (emailMatch && method === 'PUT' && security) {
      const input = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict().parse(await requestBody(request));
      const emailHash = await digest(input.email);
      const duplicate = await env.DB.prepare("SELECT id FROM application WHERE id <> ? AND id <> '__creator__' AND json_extract(data, '$.security.emailHash') = ? LIMIT 1").bind(emailMatch[1], emailHash).first();
      if (duplicate) return json({ error: 'Ese correo pertenece a otro restaurante.' }, 409);
      const row = await env.DB.prepare('SELECT revision,data FROM application WHERE id = ?').bind(emailMatch[1]).first<{ revision: number; data: string }>();
      if (!row) return json({ error: 'Restaurante no encontrado.' }, 404);
      const state = JSON.parse(row.data) as State;
      state.security = { ...state.security, emailHash, emailCiphertext: await security.encrypt(input.email), emailVerifiedAt: undefined };
      const result = await env.DB.prepare('UPDATE application SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(state), emailMatch[1], row.revision).run();
      if (result.meta.changes !== 1) return json({ error: 'La cuenta cambió. Recarga e intenta otra vez.' }, 409);
      await security.revokeSubject('owner', emailMatch[1]);
      return json({ ok: true });
    }
    const resetMatch = path.match(/^restaurants\/([a-f0-9-]{36})\/reset$/);
    if (resetMatch && method === 'POST') {
      const input = z
        .object({ password: z.string().min(12).max(128) })
        .parse(await requestBody(request));
      const row = await env.DB.prepare(
        'SELECT revision,data FROM application WHERE id = ?',
      )
        .bind(resetMatch[1])
        .first<{ revision: number; data: string }>();
      if (!row) return json({ error: 'Restaurante no encontrado.' }, 404);
      const state = JSON.parse(row.data) as State;
      const salt = randomToken(),
        recovery = randomToken();
      state.password = {
        salt,
        hash: await passwordHash(input.password, salt),
        iterations: passwordIterations,
      };
      state.security = {
        ...state.security,
        totpCiphertext: undefined,
        totpEnabledAt: undefined,
        recoveryCodeHashes: undefined,
      };
      if (security) await security.revokeSubject('owner', resetMatch[1]);
      state.recoveryHash = await digest(recovery);
      state.sessionEpoch++;
      state.failures = { count: 0, until: 0 };
      const result = await env.DB.prepare(
        'UPDATE application SET revision = revision + 1, data = ? WHERE id = ? AND revision = ?',
      )
        .bind(JSON.stringify(state), resetMatch[1], row.revision)
        .run();
      if (result.meta.changes !== 1)
        return json(
          { error: 'Otro cambio ocurrió al mismo tiempo. Recarga.' },
          409,
        );
      return json({ recovery });
    }
    return json({ error: 'Ruta no encontrada.' }, 404);
  } catch (error) {
    return json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues.map((issue) => issue.message).join(' ')
            : error instanceof Error
              ? error.message
              : 'No se pudo completar la operación.',
      },
      400,
    );
  }
}
