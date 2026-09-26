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
  digest,
  constantEqual,
  verifyLicense,
  b64,
  unb64,
} from './security';
import type { Store, State } from './store';
import { createOrderRecord, reportFor, type OrderStore } from './orders';
import { orderPdf } from './order-pdf';
import type { DomainService } from './domains';

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
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > max)
    throw Error('El archivo supera el tamaño permitido.');
  return JSON.parse(new TextDecoder().decode(bytes));
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
    createdAt: s.createdAt,
  };
}
function assetIds(c: Catalog) {
  return [c.logo, ...c.dishes.map((d) => d.image)]
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
      });

    if (path === 'demo-order' && method === 'POST') {
      if (!opts.orderStore)
        return json({ error: 'Pedidos no disponibles.' }, 503);
      const created = await createOrderRecord(
        await body(req),
        demoCatalog,
        '__demo__',
        demoCatalog.name,
        0,
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
        password: { salt, hash: await passwordHash(input.password, salt) },
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
    const isAuthed = async () =>
      opts.forcedRole === 'creator' ||
      (s ? await authenticated(req, s) : false);
    if (path === 'session' && method === 'GET')
      return json({
        configured: !!s,
        authenticated:
          s && (opts.ownerAccess !== false || opts.forcedRole === 'creator')
            ? await isAuthed()
            : false,
        suspended:
          !!s && opts.ownerAccess === false && opts.forcedRole !== 'creator',
        platformSetup: !!opts.platformUser || opts.forcedRole === 'creator',
        runtime: opts.runtime,
      });
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
      if (s.failures.until > Date.now())
        return json({ error: 'Demasiados intentos. Espera 15 minutos.' }, 429);
      const input = await body(req);
      let valid = false;
      if (path === 'login') {
        const login = z
          .object({
            code: z.string().min(1).max(80),
            password: z.string().min(1).max(128),
          })
          .parse(input);
        valid =
          constantEqual(login.code, s.restaurantId) &&
          constantEqual(
            await passwordHash(login.password, s.password.salt),
            s.password.hash,
          );
      } else
        valid = constantEqual(
          await digest(z.string().max(128).parse(input.recovery)),
          s.recoveryHash,
        );
      if (!valid) {
        s.failures.count++;
        if (s.failures.count >= 5) s.failures.until = Date.now() + 900_000;
        await save();
        return json({ error: 'Credenciales incorrectas.' }, 401);
      }
      s.failures = { count: 0, until: 0 };
      let recovery: string | undefined;
      if (path === 'recover') {
        const password = z.string().min(12).max(128).parse(input.password);
        s.password.salt = randomToken();
        s.password.hash = await passwordHash(password, s.password.salt);
        s.sessionEpoch++;
        recovery = randomToken();
        s.recoveryHash = await digest(recovery);
      }
      await save();
      return json({ ok: true, recovery }, 200, {
        'Set-Cookie': cookie(
          await tokenFor(s, Date.now() + ownerSessionMs),
          req,
        ),
      });
    }

    const role: 'creator' | 'owner' =
      opts.forcedRole === 'creator' ||
      (opts.platformUser && opts.platformUser === s.ownerId)
        ? 'creator'
        : 'owner';
    const features =
      role === 'creator'
        ? (['orders'] as Feature[])
        : opts.grantedFeatures || s.access?.features || [];
    if (path === 'menu' && method === 'GET') {
      if (!s.published)
        return json(
          { error: 'El restaurante todavía no ha publicado su menú.' },
          404,
        );
      return json({
        ...s.published,
        catalog: s.published.catalog,
        restaurantId: s.restaurantId,
        ordersEnabled: s.settings.ordersEnabled && features.includes('orders'),
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
      const created = await createOrderRecord(
        await body(req),
        s.published.catalog,
        s.restaurantId,
        s.published.catalog.name,
        s.published.version,
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
    if (path === 'logout' && method === 'POST') {
      s.sessionEpoch++;
      await save();
      return json({ ok: true }, 200, {
        'Set-Cookie': `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
      });
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
      if (!opts.domains)
        return json({ error: 'Dominios personalizados no disponibles.' }, 503);
      const input = z.object({ hostname: z.string() }).parse(await body(req));
      return json(await opts.domains.put(s.restaurantId, input.hostname));
    }
    if (path === 'domain/verify' && method === 'POST') {
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
      s.draft = Catalog.parse(value.catalog);
      await save();
      return json({ revision: stored.revision + 1 });
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
      const payload = domains?.free
        ? `https://${domains.free.hostname}/menu`
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
      const orders = await opts.orderStore.list(s.restaurantId, {
        status: url.searchParams.get('status') || undefined,
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
        query: url.searchParams.get('query') || undefined,
        limit: 2000,
      });
      return json({ orders });
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
      400,
    );
  }
}
