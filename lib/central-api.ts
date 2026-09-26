import { z } from 'zod';
import {
  Feature,
  blankCatalog,
  defaultSettings,
  normalizeCatalog,
  normalizeSettings,
} from './contracts';
import { constantEqual, digest, passwordHash, randomToken } from './security';
import type { State } from './store';
import { DomainService, type DomainEnv } from './domains';

export type CentralEnv = DomainEnv & {
  DB: D1Database;
  CREATOR_SETUP_TOKEN: string;
  LICENSE_PUBLIC_KEY?: string;
};
type CreatorState = {
  password: { salt: string; hash: string };
  recoveryHash: string;
  sessionEpoch: number;
  failures: { count: number; until: number };
  createdAt: string;
};
const normalizeFeatures = (features?: string[]) =>
  (features || []).filter(
    (feature): feature is Feature => feature === 'orders',
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
  return !!creator && (await creatorAuthenticated(request, creator.state));
}

export async function handleCreatorApi(
  request: Request,
  env: CentralEnv,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/creator\/?/, '');
    const method = request.method;
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin)
        return json({ error: 'Origen no permitido.' }, 403);
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        return json({ error: 'Se requiere JSON.' }, 415);
    }
    const creator = await readCreator(env);
    if (path === 'session' && method === 'GET')
      return json({
        configured: !!creator,
        authenticated: creator
          ? await creatorAuthenticated(request, creator.state)
          : false,
      });
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
        })
        .parse(await requestBody(request));
      if (
        !env.CREATOR_SETUP_TOKEN ||
        !constantEqual(input.setupToken, env.CREATOR_SETUP_TOKEN)
      )
        return json({ error: 'Código de instalación incorrecto.' }, 403);
      const salt = randomToken(),
        recovery = randomToken();
      const state: CreatorState = {
        password: { salt, hash: await passwordHash(input.password, salt) },
        recoveryHash: await digest(recovery),
        sessionEpoch: 0,
        failures: { count: 0, until: 0 },
        createdAt: new Date().toISOString(),
      };
      if (!(await saveCreator(env, state, null)))
        return json({ error: 'El panel ya fue configurado.' }, 409);
      return json({ recovery }, 201, {
        'Set-Cookie': cookie(
          await creatorToken(state, Date.now() + 86_400_000),
          request,
        ),
      });
    }
    if (!creator)
      return json({ error: 'Configura primero el panel del creador.' }, 404);
    if (path === 'login' && method === 'POST') {
      if (creator.state.failures.until > Date.now())
        return json({ error: 'Demasiados intentos. Espera 15 minutos.' }, 429);
      const input = z
        .object({ password: z.string().min(1).max(128) })
        .parse(await requestBody(request));
      const valid = constantEqual(
        await passwordHash(input.password, creator.state.password.salt),
        creator.state.password.hash,
      );
      if (!valid) {
        creator.state.failures.count++;
        if (creator.state.failures.count >= 5)
          creator.state.failures.until = Date.now() + 900_000;
        await saveCreator(env, creator.state, creator.revision);
        return json({ error: 'Contraseña incorrecta.' }, 401);
      }
      creator.state.failures = { count: 0, until: 0 };
      await saveCreator(env, creator.state, creator.revision);
      return json({ ok: true }, 200, {
        'Set-Cookie': cookie(
          await creatorToken(creator.state, Date.now() + 86_400_000),
          request,
        ),
      });
    }
    if (!(await creatorAuthenticated(request, creator.state)))
      return json({ error: 'Inicia sesión como creador.' }, 401);
    if (path === 'logout' && method === 'POST') {
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
    if (path === 'restaurants' && method === 'POST') {
      const input = z
        .object({
          name: z.string().trim().min(1).max(80),
          ownerPassword: z.string().min(12).max(128),
          features: z.array(Feature).max(1).default([]),
        })
        .parse(await requestBody(request));
      const id = crypto.randomUUID(),
        salt = randomToken(),
        recovery = randomToken();
      const settings = structuredClone(defaultSettings);
      settings.webUrl = `${url.origin}/r/${id}/menu`;
      const state: State = {
        schemaVersion: 1,
        restaurantId: id,
        ownerId: `owner:${id}`,
        draft: { ...blankCatalog, name: input.name },
        settings,
        published: null,
        license: null,
        password: { salt, hash: await passwordHash(input.ownerPassword, salt) },
        recoveryHash: await digest(recovery),
        sessionEpoch: 0,
        failures: { count: 0, until: 0 },
        createdAt: new Date().toISOString(),
        access: { active: true, features: input.features },
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
          features: z.array(Feature).max(1),
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
      state.password = { salt, hash: await passwordHash(input.password, salt) };
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
