import { z } from 'zod';
import QRCode from 'qrcode';
import {
  Catalog,
  Settings,
  blankCatalog,
  defaultSettings,
  demoCatalog,
  normalizeCatalog,
  normalizeSettings,
  type Feature,
} from './contracts';
import {
  randomToken,
  passwordHash,
  passwordIterations,
  digest,
  constantEqual,
  verifyLicense,
  b64,
  unb64,
  totpSecret,
  verifyTotp,
} from './security';
import type { Store, State } from './store';
import {
  PriceChangedError,
  createOrderRecord,
  reportFor,
  type OrderStore,
} from './orders';
import { orderPdf } from './order-pdf';
import { professionalSample } from './sample-menu';
import type { DomainService } from './domains';
import type { ActiveSession, AuthSecurity } from './auth-security';

export type ApiOptions = {
  publicKey: string;
  setupToken: string;
  platformUser?: string;
  runtime: string;
  forcedRole?: 'creator';
  ownerAccess?: boolean;
  basePath?: string;
  grantedFeatures?: Feature[];
  orderStore?: OrderStore;
  publicMenuUrl?: string;
  domains?: DomainService;
  security?: AuthSecurity;
};
const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const json = (
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...jsonHeaders, ...extra },
  });
const cookieName = 'qrmenu_session',
  ownerSessionMs = 30 * 24 * 60 * 60 * 1000;
async function tokenFor(s: State, expires: number) {
  return `${expires}.${await digest(`${s.password.hash}:${s.sessionEpoch}:${expires}`)}`;
}
async function authenticated(req: Request, s: State) {
  const raw =
    req.headers
      .get('cookie')
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) || '';
  const expires = Number(raw.split('.')[0]);
  return (
    expires > Date.now() &&
    expires < Date.now() + ownerSessionMs + 60_000 &&
    constantEqual(raw, await tokenFor(s, expires))
  );
}
function cookie(token: string, req: Request) {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ownerSessionMs / 1000}${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function body(req: Request, max = 2_000_000) {
  const type = req.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('application/json'))
    throw Error('El cuerpo debe enviarse como application/json.');
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > max)
    throw Error('El archivo supera el tamaño permitido.');
  return JSON.parse(new TextDecoder().decode(bytes));
}

function imageDimensions(bytes: Uint8Array, type: string) {
  if (type === 'image/png' && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type === 'image/webp' && bytes.length >= 30) {
    const chunk = new TextDecoder().decode(bytes.slice(12, 16));
    if (chunk === 'VP8X')
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
  }
  if (type === 'image/jpeg') {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if (marker >= 0xc0 && marker <= 0xc3)
        return {
          height: (bytes[offset + 5] << 8) + bytes[offset + 6],
          width: (bytes[offset + 7] << 8) + bytes[offset + 8],
        };
      offset += 2 + length;
    }
  }
  return null;
}
function normalizeState(s: State) {
  s.draft = normalizeCatalog(s.draft);
  s.settings = normalizeSettings(s.settings);
  if (s.published) s.published.catalog = normalizeCatalog(s.published.catalog);
  return s;
}
function publicState(
  s: State,
  revision: number,
  role: 'creator' | 'owner',
  features: Feature[],
) {
  return {
    restaurantId: s.restaurantId,
    revision,
    draft: s.draft,
    settings: s.settings,
    published: s.published,
    hasLicense: !!s.license,
    role,
    features,
    maxDishes: s.access?.maxDishes ?? 150,
    sampleMenuEnabled: s.access?.sampleMenuEnabled === true,
    createdAt: s.createdAt,
  };
}
function assetIds(c: Catalog) {
  return [
    c.logo,
    ...c.dishes.map((d) => d.image),
    ...c.promotions.map((promotion) => promotion.image),
  ]
    .filter((x) => /\/api\/v1\/media\/[a-f0-9-]{36}$/.test(x))
    .map((x) => x.split('/').pop()!);
}
function orderPublicUrl(req: Request, token: string, basePath = '') {
  return `${new URL(req.url).origin}${basePath}/order/${encodeURIComponent(token)}`;
}
function orderPdfUrl(req: Request, token: string, basePath = '') {
  return `${new URL(req.url).origin}${basePath}/api/v1/order/${encodeURIComponent(token)}/pdf`;
}
function ordersCsv(orders: Awaited<ReturnType<OrderStore['list']>>) {
  const quote = (value: unknown) =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows: unknown[][] = [
    [
      'pedido',
      'fecha',
      'estado',
      'alias',
      'plato',
      'cantidad',
      'opciones',
      'nota',
      'total_usd',
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
          .map((option) => `${option.groupName}: ${option.optionName}`)
          .join(' | '),
        line.note,
        (line.totalCents / 100).toFixed(2),
      ]);
  return rows.map((row) => row.map(quote).join(',')).join('\r\n');
}

export async function handleApi(
  req: Request,
  store: Store,
  opts: ApiOptions,
): Promise<Response> {
  try {
    const url = new URL(req.url),
      path = url.pathname.replace(/^\/api\/v1\/?/, ''),
      method = req.method;
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin)
        return json({ error: 'Origen no permitido.' }, 403);
      if (
        !req.headers.get('content-type')?.startsWith('application/json') &&
        !path.startsWith('media')
      )
        return json({ error: 'Se requiere JSON.' }, 415);
    }
    if (path === 'demo' && method === 'GET')
      return json({
        catalog: demoCatalog,
        version: 0,
        demo: true,
        ordersEnabled: true,
        turnstileSiteKey: opts.security?.turnstileSiteKey || null,
      });

    if (path === 'demo-order' && method === 'POST') {
      if (!opts.orderStore)
        return json({ error: 'Pedidos no disponibles.' }, 503);
      const input = await body(req);
      if (
        opts.security &&
        !(await opts.security.verifyTurnstile(input.turnstileToken, req))
      )
        return json({ error: 'No se pudo verificar que seas una persona.' }, 403);
      const created = await createOrderRecord(
        input,
        demoCatalog,
        '__demo__',
        demoCatalog.name,
        0,
        true,
        true,
      );
      await opts.orderStore.create(created.order, created.tokenHash);
      const publicUrl = orderPublicUrl(req, created.token, opts.basePath);
      return json(
        {
          order: created.order,
          publicUrl,
          pdfUrl: orderPdfUrl(req, created.token, opts.basePath),
          qrPayload: publicUrl,
        },
        201,
      );
    }
    const publicMatch = path.match(/^order\/([^/]+)(\/pdf)?$/);
    if (publicMatch && method === 'GET') {
      if (!opts.orderStore)
        return json({ error: 'Pedido no disponible.' }, 404);
      const order = await opts.orderStore.publicByTokenHash(
        await digest(decodeURIComponent(publicMatch[1])),
      );
      if (!order || new Date(order.publicExpiresAt).getTime() <= Date.now())
        return json({ error: 'Este pedido ya venció.' }, 410);
      if (publicMatch[2]) {
        const bytes = await orderPdf(order);
        return new Response(bytes as BodyInit, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="pedido-${order.number}.pdf"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      return json({ order });
    }

    const stored = await store.read(),
      s = stored?.state ? normalizeState(stored.state) : null;
    if (path === 'setup' && method === 'POST') {
      if (s)
        return json({ error: 'Este restaurante ya está configurado.' }, 409);
      const input = z
        .object({
          password: z.string().min(12).max(128),
          name: z.string().trim().min(1).max(80),
          setupToken: z.string().optional(),
        })
        .parse(await body(req));
      if (
        !opts.platformUser &&
        !(
          opts.setupToken &&
          constantEqual(input.setupToken || '', opts.setupToken)
        )
      )
        return json(
          { error: 'Introduce el código de instalación del servidor.' },
          403,
        );
      const salt = randomToken(),
        recovery = randomToken(),
        now = new Date().toISOString();
      const state: State = {
        schemaVersion: 1,
        restaurantId: crypto.randomUUID(),
        ownerId: opts.platformUser || 'local-owner',
        draft: { ...blankCatalog, name: input.name },
        settings: defaultSettings,
        published: null,
        license: null,
        password: {
          salt,
          hash: await passwordHash(input.password, salt),
          iterations: passwordIterations,
        },
        recoveryHash: await digest(recovery),
        sessionEpoch: 0,
        failures: { count: 0, until: 0 },
        createdAt: now,
      };
      if (!(await store.commit(state, null)))
        return json({ error: 'La instalación ya fue completada.' }, 409);
      return json({ recovery, restaurantId: state.restaurantId }, 201, {
        'Set-Cookie': cookie(
          await tokenFor(state, Date.now() + ownerSessionMs),
          req,
        ),
      });
    }
    let activeSession: ActiveSession | null | undefined;
    const securityScope = opts.forcedRole === 'creator' ? 'creator' : 'owner';
    const securityRestaurantId = opts.forcedRole === 'creator' ? null : s?.restaurantId || null;
    const secureSession = async () => {
      if (activeSession !== undefined) return activeSession;
      activeSession = opts.security
        ? await opts.security.session(req, securityScope, securityRestaurantId)
        : null;
      return activeSession;
    };
    const isAuthed = async () =>
      opts.security
        ? !!(await secureSession())
        : opts.forcedRole === 'creator' || (s ? await authenticated(req, s) : false);
    if (path === 'session' && method === 'GET')
      {
        const authenticated =
          !!s && (opts.ownerAccess !== false || opts.forcedRole === 'creator')
            ? await isAuthed()
            : false;
        const session = authenticated ? await secureSession() : null;
        return json({
          configured: !!s,
          authenticated,
          suspended:
            !!s && opts.ownerAccess === false && opts.forcedRole !== 'creator',
          platformSetup: !!opts.platformUser || opts.forcedRole === 'creator',
          runtime: opts.runtime,
          csrfToken: session?.csrfToken || null,
          mfaConfigured: !!s?.security?.totpEnabledAt,
          turnstileSiteKey: opts.security?.turnstileSiteKey || null,
        });
      }
    if (!s || !stored)
      return json({ error: 'Configura primero el restaurante.' }, 404);
    if (opts.ownerAccess === false && opts.forcedRole !== 'creator')
      return json(
        {
          error:
            'Este restaurante está suspendido. Comunícate con el administrador.',
        },
        403,
      );
    const save = async () => {
      if (!(await store.commit(s, stored.revision)))
        throw Error(
          'Otro dispositivo ha guardado cambios. Recarga antes de continuar.',
        );
    };

    if ((path === 'login' || path === 'recover') && method === 'POST') {
      const rate = opts.security
        ? await opts.security.rateLimitAccountAndIp(
            req,
            path,
            `${s.restaurantId}:${path}`,
            path === 'login' ? 5 : 3,
            path === 'login' ? 20 : 10,
            path === 'login' ? 15 * 60_000 : 60 * 60_000,
          )
        : { allowed: true, retryAfter: 0 };
      if (!rate.allowed)
        return json(
          { error: 'Demasiados intentos. Intenta nuevamente más tarde.' },
          429,
          { 'Retry-After': String(rate.retryAfter) },
        );
      if (s.failures.until > Date.now())
        return json({ error: 'Demasiados intentos. Espera 15 minutos.' }, 429);
      const input = await body(req);
      if (
        opts.security &&
        !(await opts.security.verifyTurnstile(input.turnstileToken, req))
      )
        return json({ error: 'No se pudo verificar que seas una persona.' }, 403);
      let valid = false;
      if (path === 'login') {
        const login = z
          .object({
            code: z.string().min(1).max(80),
            password: z.string().min(1).max(128),
            turnstileToken: z.string().max(4096).optional(),
          })
          .strict()
          .parse(input);
        valid =
          constantEqual(login.code, s.restaurantId) &&
          constantEqual(
            await passwordHash(
              login.password,
              s.password.salt,
              s.password.iterations || 100_000,
            ),
            s.password.hash,
          );
      } else
        valid = constantEqual(
          await digest(z.string().max(128).parse(input.recovery)),
          s.recoveryHash,
        );
      if (!valid) {
        await opts.security?.audit(
          s.restaurantId,
          'owner:anonymous',
          `auth.${path}.failed`,
          'failure',
          0,
        );
        s.failures.count++;
        if (s.failures.count >= 5) s.failures.until = Date.now() + 900_000;
        await save();
        return json({ error: 'Credenciales incorrectas.' }, 401);
      }
      s.failures = { count: 0, until: 0 };
      if (path === 'login' && opts.security?.encryptionReady) {
        if (!s.password.iterations || s.password.iterations < passwordIterations) {
          const password = z.object({ password: z.string() }).parse(input).password;
          s.password.salt = randomToken();
          s.password.hash = await passwordHash(password, s.password.salt);
          s.password.iterations = passwordIterations;
        }
      }
      let recovery: string | undefined;
      if (path === 'recover') {
        const password = z.string().min(12).max(128).parse(input.password);
        s.password.salt = randomToken();
        s.password.hash = await passwordHash(password, s.password.salt);
        s.password.iterations = passwordIterations;
        s.sessionEpoch++;
        recovery = randomToken();
        s.recoveryHash = await digest(recovery);
        if (opts.security?.encryptionReady) {
          await opts.security.revokeSubject('owner', s.restaurantId);
          await opts.security.revokeDevicesForRestaurant(s.restaurantId);
        }
      }
      await save();
      if (opts.security) {
        const session = await opts.security.createSession('owner', s.restaurantId);
        return json({ ok: true, recovery, csrfToken: session.csrfToken }, 200, {
          'Set-Cookie': session.cookie,
        });
      }
      return json({ ok: true, recovery }, 200, {
        'Set-Cookie': cookie(await tokenFor(s, Date.now() + ownerSessionMs), req),
      });
    }

    if (path === 'auth/mfa/verify' && method === 'POST' && opts.security) {
      if (!opts.security.encryptionReady)
        return json({ error: 'El cifrado de seguridad no está configurado.' }, 503);
      const input = z
        .object({ code: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(await body(req));
      const challenge = await opts.security.readChallenge(req, 'owner', s.restaurantId);
      if (!challenge) return json({ error: 'El desafío venció. Inicia sesión otra vez.' }, 401);
      const ciphertext =
        challenge.kind === 'mfa_setup'
          ? String(challenge.payload.secretCiphertext || '')
          : s.security?.totpCiphertext || '';
      const secret = await opts.security.decrypt(ciphertext);
      if (!(await verifyTotp(secret, input.code))) {
        await opts.security.failChallenge(challenge.hash);
        return json({ error: 'Código de autenticación incorrecto.' }, 401);
      }
      let recoveryCodes: string[] | undefined;
      if (challenge.kind === 'mfa_setup') {
        recoveryCodes = Array.from({ length: 10 }, () =>
          `${randomToken().slice(0, 5)}-${randomToken().slice(0, 5)}`,
        );
        s.security = {
          ...s.security,
          totpCiphertext: ciphertext,
          totpEnabledAt: new Date().toISOString(),
          recoveryCodeHashes: await Promise.all(recoveryCodes.map(digest)),
        };
        await save();
      }
      await opts.security.consumeChallenge(challenge.hash);
      const session = await opts.security.createSession('owner', s.restaurantId);
      return json(
        { ok: true, csrfToken: session.csrfToken, recoveryCodes },
        200,
        { 'Set-Cookie': session.cookie },
      );
    }

    if (path === 'auth/mfa/recover' && method === 'POST' && opts.security) {
      const input = z
        .object({ code: z.string().trim().min(8).max(100) })
        .strict()
        .parse(await body(req));
      const challenge = await opts.security.readChallenge(
        req,
        'owner',
        s.restaurantId,
      );
      if (!challenge)
        return json({ error: 'El desafío venció. Inicia sesión otra vez.' }, 401);
      const hash = await digest(input.code);
      const codes = s.security?.recoveryCodeHashes || [];
      const index = codes.findIndex((candidate) => constantEqual(candidate, hash));
      if (index < 0) {
        await opts.security.failChallenge(challenge.hash);
        return json({ error: 'Código de recuperación incorrecto.' }, 401);
      }
      s.security = {
        ...s.security,
        recoveryCodeHashes: codes.filter((_, candidate) => candidate !== index),
      };
      await save();
      await opts.security.consumeChallenge(challenge.hash);
      const session = await opts.security.createSession('owner', s.restaurantId);
      return json({ ok: true, csrfToken: session.csrfToken }, 200, {
        'Set-Cookie': session.cookie,
      });
    }

    if (path === 'email/verify' && method === 'GET' && opts.security) {
      const token = z.string().min(40).max(300).parse(url.searchParams.get('token'));
      const action = await opts.security.consumeActionToken(
        token,
        'owner',
        s.restaurantId,
        'email_verify',
      );
      if (!action)
        return json({ error: 'El enlace venció o ya fue utilizado.' }, 410);
      s.security = {
        ...s.security,
        emailVerifiedAt: new Date().toISOString(),
      };
      await save();
      return json({ ok: true, message: 'Correo verificado correctamente.' });
    }

    const role: 'creator' | 'owner' =
      opts.forcedRole === 'creator' ||
      (opts.platformUser && opts.platformUser === s.ownerId)
        ? 'creator'
        : 'owner';
    const features =
      role === 'creator'
        ? (['orders', 'promotions'] as Feature[])
        : opts.grantedFeatures || s.access?.features || [];
    if (path === 'menu' && method === 'GET') {
      if (!s.published)
        return json(
          { error: 'El restaurante todavía no ha publicado su menú.' },
          404,
        );
      return json({
        ...s.published,
        catalog: features.includes('promotions')
          ? s.published.catalog
          : { ...s.published.catalog, promotions: [] },
        restaurantId: s.restaurantId,
        ordersEnabled: s.settings.ordersEnabled && features.includes('orders'),
        turnstileSiteKey: opts.security?.turnstileSiteKey || null,
      });
    }
    if (path === 'orders' && method === 'POST') {
      if (
        !opts.orderStore ||
        !s.published ||
        !s.settings.ordersEnabled ||
        !features.includes('orders')
      )
        return json({ error: 'Los pedidos por QR no están habilitados.' }, 403);
      const orderRate = opts.security
        ? await opts.security.rateLimit(
            req,
            'orders',
            s.restaurantId,
            30,
            10 * 60_000,
          )
        : { allowed: true, retryAfter: 0 };
      if (!orderRate.allowed)
        return json(
          { error: 'Se alcanzó el límite temporal de pedidos. Intenta más tarde.' },
          429,
          { 'Retry-After': String(orderRate.retryAfter) },
        );
      const input = await body(req);
      if (
        opts.security &&
        !(await opts.security.verifyTurnstile(input.turnstileToken, req))
      )
        return json({ error: 'No se pudo verificar que seas una persona.' }, 403);
      const created = await createOrderRecord(
        input,
        s.published.catalog,
        s.restaurantId,
        s.published.catalog.name,
        s.published.version,
        false,
        features.includes('promotions'),
      );
      await opts.orderStore.create(created.order, created.tokenHash);
      const publicUrl = orderPublicUrl(req, created.token, opts.basePath);
      return json(
        {
          order: created.order,
          publicUrl,
          pdfUrl: orderPdfUrl(req, created.token, opts.basePath),
          qrPayload: publicUrl,
        },
        201,
      );
    }
    if (path.startsWith('media/') && method === 'GET') {
      const mediaId = z.string().uuid().parse(path.slice(6));
      const publicAsset =
        !!s.published && assetIds(s.published.catalog).includes(mediaId);
      if (!publicAsset && !(await isAuthed()))
        return json({ error: 'Acceso privado.' }, 401);
      const media = await store.mediaGet(mediaId);
      if (!media) return json({ error: 'Imagen no encontrada.' }, 404);
      return new Response(media.bytes as BodyInit, {
        headers: {
          'Content-Type': media.type,
          'Cache-Control': publicAsset ? 'public, max-age=86400' : 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (!(await isAuthed()))
      return json(
        { error: 'Inicia sesión para administrar el restaurante.' },
        401,
      );
    if (
      opts.security &&
      method !== 'GET' &&
      method !== 'HEAD' &&
      !(await opts.security.requireCsrf(req, await secureSession()))
    )
      return json({ error: 'La sesión de seguridad cambió. Recarga la página.' }, 403);
    if (path === 'logout' && method === 'POST') {
      if (opts.security) {
        await opts.security.revokeSession(req, securityScope);
        if (securityScope === 'owner') await opts.security.revokeDevice(req);
        const response = json({ ok: true }, 200, {
          'Set-Cookie': opts.security.clearSessionCookie(securityScope),
        });
        if (securityScope === 'owner') response.headers.append('Set-Cookie', opts.security.clearDeviceCookie());
        return response;
      }
      s.sessionEpoch++;
      await save();
      return json({ ok: true }, 200, {
        'Set-Cookie': `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
      });
    }
    if (path === 'email' && method === 'GET')
      return json({
        configured: !!s.security?.emailCiphertext,
        verified: !!s.security?.emailVerifiedAt,
        verificationEnabled: opts.security?.emailVerificationEnabled || false,
      });
    if (path === 'email' && method === 'PUT' && opts.security) {
      const input = z
        .object({ email: z.string().trim().email().max(254) })
        .strict()
        .parse(await body(req));
      const normalized = input.email.toLowerCase();
      s.security = {
        ...s.security,
        emailCiphertext: await opts.security.encrypt(normalized),
        emailHash: await digest(normalized),
        emailVerifiedAt: undefined,
      };
      await save();
      return json({ ok: true });
    }
    if (path === 'email/verification' && method === 'POST' && opts.security) {
      if (!s.security?.emailCiphertext)
        return json({ error: 'Esta cuenta todavía no tiene correo.' }, 409);
      const email = await opts.security.decrypt(s.security.emailCiphertext);
      const token = await opts.security.issueActionToken(
        'owner',
        s.restaurantId,
        'email_verify',
      );
      const link = `${url.origin}${opts.basePath || ''}/api/v1/email/verify?token=${encodeURIComponent(token)}`;
      await opts.security.sendEmail(
        email,
        'Verifica tu correo de QR Menu EC',
        `<p>Confirma tu correo para QR Menu EC.</p><p><a href="${link}">Verificar correo</a></p><p>El enlace vence en 30 minutos.</p>`,
      );
      return json({ ok: true });
    }
    if (path === 'sessions' && method === 'GET' && opts.security)
      return json({
        sessions: await opts.security.listSessions('owner', s.restaurantId),
      });
    if (path === 'devices' && method === 'GET' && opts.security)
      return json({ devices: await opts.security.listDevices(s.restaurantId) });
    const deviceMatch = path.match(/^devices\/([a-f0-9]{64})$/);
    if (deviceMatch && method === 'DELETE' && opts.security) {
      await opts.security.revokeDeviceById(s.restaurantId, deviceMatch[1]);
      return json({ ok: true });
    }
    const sessionMatch = path.match(/^sessions\/([a-f0-9]{64})$/);
    if (sessionMatch && method === 'DELETE' && opts.security) {
      await opts.security.revokeSessionById(
        'owner',
        s.restaurantId,
        sessionMatch[1],
      );
      return json({ ok: true });
    }
    if (path === 'state' && method === 'GET')
      return json(publicState(s, stored.revision, role, features));
    if (path === 'domain' && method === 'GET') {
      if (!opts.domains)
        return json({ free: null, custom: null, cnameTarget: null });
      let domains = await opts.domains.get(s.restaurantId);
      if (!domains.free) {
        await opts.domains.provisionFree(
          s.restaurantId,
          s.draft.name,
          url.origin,
        );
        domains = await opts.domains.get(s.restaurantId);
      }
      return json(domains);
    }
    if (path === 'domain' && method === 'PUT') {
      if (role !== 'creator')
        return json(
          { error: 'Solo el creador administra dominios propios.' },
          403,
        );
      if (!opts.domains)
        return json({ error: 'Dominios personalizados no disponibles.' }, 503);
      const input = z.object({ hostname: z.string() }).parse(await body(req));
      return json(await opts.domains.put(s.restaurantId, input.hostname));
    }
    if (path === 'domain/verify' && method === 'POST') {
      if (role !== 'creator')
        return json(
          { error: 'Solo el creador administra dominios propios.' },
          403,
        );
      if (!opts.domains)
        return json({ error: 'Dominios personalizados no disponibles.' }, 503);
      return json(await opts.domains.verify(s.restaurantId));
    }
    if (path === 'draft' && method === 'PUT') {
      const value = await body(req);
      if (value.revision !== stored.revision)
        return json(
          { error: 'Hay cambios de otro dispositivo. Recarga el editor.' },
          409,
        );
      const next = Catalog.parse(value.catalog);
      if (next.dishes.length > (s.access?.maxDishes ?? 150))
        return json({ error: `Este restaurante admite hasta ${s.access?.maxDishes ?? 150} platos.` }, 400);
      s.draft = next;
      await save();
      return json({ revision: stored.revision + 1 });
    }
    if (path === 'sample-menu' && method === 'POST') {
      if (s.access?.sampleMenuEnabled !== true)
        return json({ error: 'El creador aún no habilitó la carga de ejemplos.' }, 403);
      const input = z.object({ revision: z.number().int().min(0), confirm: z.literal(true) }).strict().parse(await body(req));
      if (input.revision !== stored.revision)
        return json({ error: 'La carta cambió. Recarga antes de reemplazar el borrador.' }, 409);
      s.draft = Catalog.parse(professionalSample(s.draft.name, s.access?.maxDishes ?? 150));
      await save();
      return json({ revision: stored.revision + 1, dishes: s.draft.dishes.length });
    }
    if (path === 'settings' && method === 'PUT') {
      const value = await body(req);
      if (value.revision !== stored.revision)
        return json({ error: 'La configuración cambió. Recarga.' }, 409);
      const settings = Settings.parse(value.settings);
      if (settings.ordersEnabled && !features.includes('orders'))
        return json(
          { error: 'El creador debe habilitar Pedidos por QR.' },
          403,
        );
      s.settings = settings;
      await save();
      return json({ revision: stored.revision + 1 });
    }
    if (path === 'publish' && method === 'POST') {
      const value = await body(req);
      if (value.revision !== stored.revision)
        return json(
          { error: 'Guarda o recarga los últimos cambios antes de publicar.' },
          409,
        );
      if (!s.draft.dishes.length)
        return json({ error: 'Añade al menos un plato.' }, 400);
      if (s.draft.dishes.length > (s.access?.maxDishes ?? 150))
        return json({ error: 'La carta supera el límite asignado por el creador.' }, 400);
      for (const mediaId of assetIds(s.draft))
        if (!(await store.mediaGet(mediaId)))
          return json(
            { error: 'Faltan fotos. Restaura el respaldo completo.' },
            400,
          );
      s.published = {
        version: (s.published?.version || 0) + 1,
        at: new Date().toISOString(),
        catalog: structuredClone(s.draft),
        mode: 'web',
        settings: structuredClone(s.settings),
      };
      await save();
      return json({ version: s.published.version });
    }
    if (path === 'license' && method === 'POST') {
      const value = await body(req);
      await verifyLicense(value, opts.publicKey, s.restaurantId);
      s.license = value;
      await save();
      return json({ ok: true });
    }
    if (path === 'media' && method === 'POST') {
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length > 1_000_000)
        return json({ error: 'Optimiza la foto a menos de 1 MB.' }, 413);
      const type = req.headers.get('content-type') || '';
      const magic =
        (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) ||
        (type === 'image/png' &&
          bytes[0] === 137 &&
          bytes[1] === 80 &&
          bytes[2] === 78 &&
          bytes[3] === 71) ||
        (type === 'image/webp' &&
          new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
          new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP');
      if (!magic)
        return json({ error: 'Solo fotos JPEG, PNG o WebP válidas.' }, 415);
      const dimensions = imageDimensions(bytes, type);
      if (
        !dimensions ||
        dimensions.width < 1 ||
        dimensions.height < 1 ||
        dimensions.width > 4096 ||
        dimensions.height > 4096 ||
        dimensions.width * dimensions.height > 12_000_000
      )
        return json(
          { error: 'La foto tiene dimensiones inválidas o demasiado grandes.' },
          415,
        );
      const mediaId = crypto.randomUUID();
      await store.mediaPut(mediaId, bytes, type);
      return json(
        { url: `${opts.basePath || ''}/api/v1/media/${mediaId}` },
        201,
      );
    }
    if (path === 'backup' && method === 'GET') {
      const media = [];
      for (const mediaId of new Set(assetIds(s.draft))) {
        const item = await store.mediaGet(mediaId);
        if (!item) throw Error('Falta una imagen del borrador.');
        media.push({ id: mediaId, type: item.type, data: b64(item.bytes) });
      }
      return json(
        {
          schemaVersion: 2,
          sourceId: s.restaurantId,
          exportedAt: new Date().toISOString(),
          draft: s.draft,
          settings: s.settings,
          media,
        },
        200,
        {
          'Content-Disposition': 'attachment; filename="qr-menu-respaldo.json"',
        },
      );
    }
    if (path === 'restore' && method === 'POST') {
      const raw = await body(req, 30_000_000),
        draft = normalizeCatalog(raw.draft),
        settings = normalizeSettings(raw.settings);
      if (draft.dishes.length > (s.access?.maxDishes ?? 150))
        return json({ error: 'El respaldo supera el límite de platos asignado a este restaurante.' }, 400);
      const mediaInput = z
        .array(
          z.object({
            id: z.string().uuid(),
            type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
            data: z.string().max(1_500_000),
          }),
        )
        .max(151)
        .parse(raw.media || []);
      const ids = new Set(mediaInput.map((item) => item.id));
      if (assetIds(draft).some((mediaId) => !ids.has(mediaId)))
        throw Error('El respaldo no incluye todas las fotos.');
      const remap = new Map<string, string>();
      for (const item of mediaInput) {
        const bytes = unb64(item.data);
        if (bytes.length > 1_000_000) throw Error('Una foto excede el límite.');
        const newId = crypto.randomUUID();
        remap.set(item.id, newId);
        await store.mediaPut(newId, bytes, item.type);
      }
      const mapAsset = (value: string) =>
        /\/api\/v1\/media\/[a-f0-9-]{36}$/.test(value)
          ? `${opts.basePath || ''}/api/v1/media/${remap.get(value.split('/').pop()!)}`
          : value;
      draft.logo = mapAsset(draft.logo);
      draft.dishes = draft.dishes.map((dish) => ({
        ...dish,
        image: mapAsset(dish.image),
      }));
      draft.promotions = draft.promotions.map((promotion) => ({
        ...promotion,
        image: mapAsset(promotion.image),
      }));
      s.draft = draft;
      s.settings = {
        ...settings,
        ordersEnabled: settings.ordersEnabled && features.includes('orders'),
      };
      await save();
      return json({
        ok: true,
        notice:
          'Borrador restaurado. Revisa y publica. El acceso y la identidad se conservan.',
      });
    }
    if (path === 'qr' && method === 'GET') {
      if (!s.published) return json({ error: 'Publica primero el menú.' }, 400);
      const domains = opts.domains
        ? await opts.domains.get(s.restaurantId)
        : null;
      const payload = domains?.primary
        ? `https://${domains.primary.hostname}/menu`
        : opts.publicMenuUrl ||
          s.settings.webUrl ||
          `${url.origin}${opts.basePath || ''}/menu`;
      const svg = await QRCode.toString(payload, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 4,
        width: 360,
      });
      return json({
        codes: [
          {
            kind: 'web',
            label: 'MENÚ ONLINE',
            subtitle: 'una dirección permanente',
            payload,
            bytes: new TextEncoder().encode(payload).length,
            svg,
          },
        ],
        mode: 'web',
        name: s.published.catalog.name,
        version: s.published.version,
        settings: s.settings,
      });
    }
    if (path === 'orders' && method === 'GET') {
      if (!opts.orderStore || !features.includes('orders'))
        return json({ error: 'Pedidos no disponibles.' }, 403);
      const limit = Math.min(
        100,
        Math.max(1, Number(url.searchParams.get('limit') || 50)),
      );
      const orders = await opts.orderStore.list(s.restaurantId, {
        status: url.searchParams.get('status') || undefined,
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
        query: url.searchParams.get('query') || undefined,
        limit,
      });
      return json({ orders, limit, hasMore: orders.length === limit });
    }
    const cancelMatch = path.match(/^orders\/([a-f0-9-]{36})\/status$/);
    if (cancelMatch && method === 'PATCH') {
      if (!opts.orderStore || !features.includes('orders'))
        return json({ error: 'Pedidos no disponibles.' }, 403);
      z.object({ status: z.literal('cancelled') }).parse(await body(req));
      if (
        !(await opts.orderStore.setStatus(
          s.restaurantId,
          cancelMatch[1],
          'cancelled',
        ))
      )
        return json({ error: 'El pedido no existe o ya fue cancelado.' }, 409);
      return json({ ok: true });
    }
    if (path === 'reports/orders.csv' && method === 'GET') {
      if (!opts.orderStore || !features.includes('orders'))
        return json({ error: 'Reportes no disponibles.' }, 403);
      const orders = await opts.orderStore.list(s.restaurantId, {
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
        limit: 5_000,
      });
      return new Response(ordersCsv(orders), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="pedidos.csv"',
          'Cache-Control': 'no-store',
        },
      });
    }
    if (path === 'reports/orders' && method === 'GET') {
      if (!opts.orderStore || !features.includes('orders'))
        return json({ error: 'Reportes no disponibles.' }, 403);
      const orders = await opts.orderStore.list(s.restaurantId, {
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
        limit: 500,
      });
      const report = reportFor(orders);
      const sold = new Map(report.dishes.map((dish) => [dish.id, dish]));
      report.dishes = s.draft.dishes
        .map(
          (dish) =>
            sold.get(dish.id) || {
              id: dish.id,
              name: dish.name,
              quantity: 0,
              totalCents: 0,
            },
        )
        .sort((a, b) => b.quantity - a.quantity || b.totalCents - a.totalCents);
      return json({ report, orders });
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
      error instanceof PriceChangedError ? 409 : 400,
    );
  }
}
