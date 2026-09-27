import { handleApi } from '../../lib/api';
import { cloudStore } from '../../lib/cloud-store';
import {
  handleCreatorApi,
  isCreatorRequest,
  type CentralEnv,
} from '../../lib/central-api';
import type { Feature } from '../../lib/contracts';
import { D1OrderStore } from '../../lib/orders';
import { DomainService } from '../../lib/domains';
import { AuthSecurity } from '../../lib/auth-security';

type Env = CentralEnv & {
  ASSETS: Fetcher;
  LICENSE_PUBLIC_KEY?: string;
  PLATFORM_MENU_DOMAIN?: string;
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_CNAME_TARGET?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_WORKERS_SUBDOMAIN?: string;
  CORE_WORKER_SERVICE?: string;
  DATA_ENCRYPTION_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  EMAIL_VERIFICATION_ENABLED?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};
const restaurantPath = /^\/r\/([a-f0-9-]{36})(\/.*)?$/;

function secureResponse(response: Response) {
  const secured = new Response(response.body, response);
  secured.headers.set('Strict-Transport-Security', 'max-age=31536000');
  secured.headers.set('X-Content-Type-Options', 'nosniff');
  secured.headers.set('X-Frame-Options', 'DENY');
  secured.headers.set('Referrer-Policy', 'no-referrer');
  secured.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  secured.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  secured.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  secured.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  return secured;
}

async function routeRequest(request: Request, env: Env) {
  const security = new AuthSecurity(env);
  const url = new URL(request.url);
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 308);
  }
  if (url.pathname.startsWith('/api/creator/'))
    return handleCreatorApi(request, env);
  const match = url.pathname.match(restaurantPath);
  const hostRow = !match
    ? await env.DB.prepare(
        "SELECT restaurant_id,kind FROM restaurant_hosts WHERE hostname = ? AND status = 'active'",
      )
        .bind(url.hostname.toLowerCase())
        .first<{ restaurant_id: string; kind: string }>()
    : null;
  const id = match?.[1] || hostRow?.restaurant_id;
  const scopedPath = match?.[2] || url.pathname;
  if (
    id &&
    !scopedPath.startsWith('/api/') &&
    (hostRow || (match && scopedPath === '/menu'))
  ) {
    const primary = await env.DB.prepare(
      "SELECT hostname FROM restaurant_hosts WHERE restaurant_id = ? AND status = 'active' AND hostname <> ? ORDER BY priority DESC, created_at DESC LIMIT 1",
    )
      .bind(id, url.hostname.toLowerCase())
      .first<{ hostname: string }>();
    if (primary) {
      url.protocol = 'https:';
      url.hostname = primary.hostname;
      if (match) url.pathname = scopedPath;
      return Response.redirect(url.toString(), 302);
    }
  }
  if (id && scopedPath.startsWith('/api/v1/')) {
    const store = cloudStore(id, env),
      stored = await store.read();
    const creator = await isCreatorRequest(request, env);
    url.pathname = scopedPath;
    const scopedRequest = new Request(url, request);
    return handleApi(scopedRequest, store, {
      publicKey: env.LICENSE_PUBLIC_KEY || '',
      setupToken: '',
      platformUser: undefined,
      runtime: 'cloud',
      forcedRole: creator ? 'creator' : undefined,
      grantedFeatures: (stored?.state.access?.features || []) as Feature[],
      ownerAccess: stored?.state.access?.active !== false,
      basePath: match ? `/r/${id}` : '',
      orderStore: new D1OrderStore(env.DB),
      publicMenuUrl: `https://${url.hostname}${match ? `/r/${id}` : ''}/menu`,
      domains: new DomainService(env),
      security,
    });
  }
  if (
    url.pathname.startsWith('/api/v1/demo-order') ||
    url.pathname.startsWith('/api/v1/order/')
  )
    return handleApi(request, cloudStore('__demo__', env), {
      publicKey: env.LICENSE_PUBLIC_KEY || '',
      setupToken: '',
      runtime: 'cloud',
      orderStore: new D1OrderStore(env.DB),
      security,
    });
  if (id && hostRow && scopedPath === '/')
    return Response.redirect(`${url.origin}/menu`, 302);
  if (url.pathname === '/')
    return Response.redirect(`${url.origin}/creator`, 302);
  if (
    url.pathname === '/creator' ||
    url.pathname === '/owner' ||
    url.pathname === '/demo' ||
    url.pathname.startsWith('/order/') ||
    (!!id &&
      (['/', '/menu', '/preview'].includes(scopedPath) ||
        scopedPath.startsWith('/order/')))
  ) {
    url.pathname = '/';
    return env.ASSETS.fetch(new Request(url, request));
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    const startedAt = Date.now();
    const response = secureResponse(await routeRequest(request, env));
    if (new URL(request.url).pathname.startsWith('/api/')) {
      const security = new AuthSecurity(env);
      context.waitUntil(
        security
          .anonymousActor(request)
          .then((actor) =>
            security.audit(
              null,
              actor,
              `${request.method} ${new URL(request.url).pathname}`,
              response.status < 400 ? 'success' : 'failure',
              startedAt,
              `status=${response.status}`,
            ),
          )
          .catch(() => undefined),
      );
      if (Date.now() - startedAt > 1_000)
        console.warn('slow_request', {
          path: new URL(request.url).pathname,
          durationMs: Date.now() - startedAt,
        });
    }
    return response;
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE orders SET alias = '' WHERE demo = 0 AND alias <> '' AND public_expires_at <= ?",
      ).bind(now),
      env.DB.prepare(
        'DELETE FROM orders WHERE demo = 1 AND public_expires_at <= ?',
      ).bind(now),
    ]);
    await new AuthSecurity(env).cleanup();
  },
};
