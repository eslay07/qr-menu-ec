import { handleApi } from '../../lib/api';
import { cloudStore } from '../../lib/cloud-store';
import {
  handleCreatorApi,
  isCreatorRequest,
  type CentralEnv,
} from '../../lib/central-api';
import type { Feature } from '../../lib/contracts';
import { D1OrderStore } from '../../lib/orders';
import { localFirestore } from '../../lib/application-repository';
import { FirestoreOrderStore } from '../../lib/firestore-orders';
import { RestaurantPreferences } from '../../lib/restaurant-preferences';
import { FirestoreBusinessRepository } from '../../lib/firestore-business';
import { FirestoreDomainRepository } from '../../lib/firestore-domains';
import { firestoreMaintenance } from '../../lib/firestore-maintenance';
import { FirestoreBackupRepository } from '../../lib/firestore-backups';
import { DomainService } from '../../lib/domains';
import { AuthSecurity } from '../../lib/auth-security';
import { handleOwnerAuth, handleOwnerDevice, handleOwnerRecovery } from '../../lib/owner-auth';
import { FirestorePush } from '../../lib/firestore-push';
import { FcmSender } from '../../lib/push-delivery';
import { firestoreBearer } from '../../lib/firestore-credentials';
import { writesFrozen, maintenanceResponse } from '../../lib/write-freeze';
import { PublicMenuCache } from '../../lib/public-menu-cache';
import { FirestoreError } from '../../lib/firestore-rest';
const menuCaches = new WeakMap<object, PublicMenuCache>();
function menuCache(env: object) {
  let cache = menuCaches.get(env);
  if (!cache) { cache = new PublicMenuCache(); menuCaches.set(env, cache); }
  return cache;
}
function quotaResponse(request: Request) {
  const message = 'El servicio está temporalmente limitado. Intenta más tarde; tus datos se conservan.';
  const headers = { 'Cache-Control': 'no-store', 'Retry-After': '60' };
  if (new URL(request.url).pathname.includes('/api/')) return Response.json({ error: message }, { status: 503, headers });
  return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Servicio temporalmente limitado</title><main><h1>Intenta más tarde</h1><p>${message}</p></main></html>`, { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}

type Env = CentralEnv & {
  MAINTENANCE_MODE?: string;
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
  FCM_ENABLED?: string;
  FIREBASE_FCM_SERVICE_ACCOUNT?: string;
};
const restaurantPath = /^\/r\/([a-f0-9-]{36})(\/.*)?$/;

export function auditRoute(path: string) {
  // Public order URLs are bearer links: never retain their token in logs.
  return path.replace(/\/order\/[^/]+/g, '/order/:token').replace(/\/r\/[a-f0-9-]{36}/g, '/r/:restaurant');
}

function secureResponse(response: Response, firebaseAuth = false, push = false) {
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
    `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://challenges.cloudflare.com${firebaseAuth ? ' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com' : ''}${push ? ' https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://fcm.googleapis.com' : ''}; frame-src https://challenges.cloudflare.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  );
  return secured;
}

async function deliverRestaurantPush(env: Env, restaurantId: string) {
  const db = localFirestore(env);
  if (!db || env.FCM_ENABLED !== 'true' || !env.FIREBASE_FCM_SERVICE_ACCOUNT || !env.FIREBASE_PROJECT_ID || writesFrozen(env)) return;
  const sender = new FcmSender(env.FIREBASE_PROJECT_ID, firestoreBearer(env.FIREBASE_PROJECT_ID, env.FIREBASE_FCM_SERVICE_ACCOUNT, 'https://www.googleapis.com/auth/firebase.messaging'));
  await new FirestorePush(db, restaurantId, new AuthSecurity(env)).dispatch(sender, new Date(), {remaining:20,deadline:Date.now()+25_000});
}

async function routeRequest(request: Request, env: Env, context: ExecutionContext) {
  const firestore = localFirestore(env);
  const orderStore = firestore ? new FirestoreOrderStore(firestore) : new D1OrderStore(env.DB);
  const security = new AuthSecurity(env);
  const url = new URL(request.url);
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 308);
  }
  if (request.method === 'GET' && /\/menu\/$/.test(url.pathname)) {
    url.pathname = url.pathname.slice(0, -1);
    return Response.redirect(url.toString(), 308);
  }
  // Static downloads and login shells do not require a database lookup.
  if (['GET', 'HEAD'].includes(request.method) && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/downloads/') || url.pathname === '/firebase-messaging-sw.js')) return env.ASSETS.fetch(request);
  if (request.method === 'GET' && ['/owner', '/creator', '/demo'].includes(url.pathname)) {
    const assetUrl = new URL('/', url);
    return env.ASSETS.fetch(new Request(assetUrl, request));
  }
  if (url.pathname.startsWith('/api/creator/'))
    return handleCreatorApi(request, env);
  if (url.pathname === '/api/owner/login') return handleOwnerAuth(request, env, id => cloudStore(id, env));
  if (url.pathname === '/api/owner/recovery') return handleOwnerRecovery(request, env, id => cloudStore(id, env));
  if (url.pathname.startsWith('/api/owner/device-session')) return handleOwnerDevice(request, env, id => cloudStore(id, env));
  const match = url.pathname.match(restaurantPath);
  const firestoreHost = firestore && !match ? await new FirestoreDomainRepository(firestore).lookup(url.hostname.toLowerCase()) : null;
  const hostRow = firestore ? (firestoreHost?.status === 'active' ? { restaurant_id: firestoreHost.restaurantId, kind: firestoreHost.kind } : null) : !match
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
    const primary = firestore ? await new FirestoreDomainRepository(firestore).primary(id) : await env.DB.prepare(
      "SELECT hostname FROM restaurant_hosts WHERE restaurant_id = ? AND status = 'active' ORDER BY priority DESC, created_at DESC LIMIT 1",
    )
      .bind(id)
      .first<{ hostname: string }>();
    if (primary && primary.hostname !== url.hostname.toLowerCase()) {
      url.protocol = 'https:';
      url.hostname = primary.hostname;
      if (match) url.pathname = scopedPath;
      return Response.redirect(url.toString(), 302);
    }
  }
  if (id && scopedPath.startsWith('/api/v1/')) {
    const store = cloudStore(id, env);
    if (firestore && store.readMenu) {
      const readMenu = store.readMenu.bind(store);
      store.readMenu = () => menuCache(env).read(id, readMenu);
    }
    const access = firestore
      ? (await firestore.get<{ access?: { active?: boolean; features?: Feature[] } }>(`restaurants/${id}`))?.data.access
      : (await store.read())?.state.access;
    const creator = await isCreatorRequest(request, env);
    url.pathname = scopedPath;
    const scopedRequest = new Request(url, request);
    const response = await handleApi(scopedRequest, store, {
      publicKey: env.LICENSE_PUBLIC_KEY || '',
      setupToken: '',
      platformUser: undefined,
      runtime: 'cloud',
      forcedRole: creator ? 'creator' : undefined,
      grantedFeatures: (access?.features || []) as Feature[],
      ownerAccess: access?.active !== false,
      basePath: match ? `/r/${id}` : '',
      orderStore,
      preferences: firestore ? new RestaurantPreferences(firestore, id, security) : undefined,
      business: firestore ? new FirestoreBusinessRepository(firestore, id) : undefined,
      push: firestore && env.FCM_ENABLED === 'true' ? new FirestorePush(firestore, id, security) : undefined,
      backups: firestore ? new FirestoreBackupRepository(firestore, id, store) : undefined,
      publicMenuUrl: `https://${url.hostname}${match ? `/r/${id}` : ''}/menu`,
      domains: new DomainService(env),
      security,
    });
    if (!['GET', 'HEAD'].includes(request.method) && response.ok) menuCache(env).invalidate(id);
    // Deliver new events promptly; cron remains the bounded retry fallback.
    // A private inbox refresh can recover outstanding events only after Auth.
    if (response.ok && ((request.method === 'GET' && scopedPath === '/api/v1/notifications') ||
        (!['GET','HEAD'].includes(request.method) && /^\/api\/v1\/(orders(?:\/|$)|order\/[^/]+\/cancel$|draft$)/.test(scopedPath)))) {
      context.waitUntil(deliverRestaurantPush(env,id).catch(error => console.warn('push_delivery_pending', error instanceof Error ? error.name : 'Error')));
    }
    return response;
  }
  if (
    url.pathname.startsWith('/api/v1/demo-order') ||
    url.pathname.startsWith('/api/v1/order/')
  )
    return handleApi(request, cloudStore('__demo__', env), {
      publicKey: env.LICENSE_PUBLIC_KEY || '',
      setupToken: '',
      runtime: 'cloud',
      orderStore,
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
    // Before routing, redirects, auth, assets, audit or any database access.
    // Applies equally to UUID routes, aliases, custom hosts and Android WebView.
    if (writesFrozen(env)) return maintenanceResponse(request);
    const startedAt = Date.now();
    let routed: Response;
    try { routed = await routeRequest(request, env, context); }
    catch (error) {
      if (!(error instanceof FirestoreError) || error.status !== 429) throw error;
      routed = quotaResponse(request);
    }
    if (routed.status === 400 && routed.headers.get('Content-Type')?.includes('application/json')) {
      const result = await routed.clone().json().catch(() => null) as { error?: string } | null;
      if (result?.error?.includes('Firestore operation failed (429,')) routed = quotaResponse(request);
    }
    const response = secureResponse(routed, env.AUTH_PROVIDER === 'firebase', env.FCM_ENABLED === 'true');
    if (new URL(request.url).pathname.endsWith('/firebase-messaging-sw.js')) {
      response.headers.set('Service-Worker-Allowed', '/');
      response.headers.set('Cache-Control', 'no-cache');
    }
    if (new URL(request.url).pathname.startsWith('/api/')) {
      const security = new AuthSecurity(env);
      context.waitUntil(
        security
          .anonymousActor(request)
          .then((actor) =>
            security.audit(
              null,
              actor,
              `${request.method} ${auditRoute(new URL(request.url).pathname)}`,
              response.status < 400 ? 'success' : 'failure',
              startedAt,
              `status=${response.status}`,
            ),
          )
          .catch(() => undefined),
      );
      if (Date.now() - startedAt > 1_000)
        console.warn('slow_request', {
          path: auditRoute(new URL(request.url).pathname),
          durationMs: Date.now() - startedAt,
        });
    }
    return response;
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    if (writesFrozen(env)) return;
    const firestore = localFirestore(env);
    if (firestore) {
      if (new Date(_controller.scheduledTime).getUTCMinutes() === 0) await firestoreMaintenance(firestore, new Date(), id => new FirestoreBackupRepository(firestore, id, cloudStore(id, env)));
      if (env.FCM_ENABLED === 'true' && env.FIREBASE_FCM_SERVICE_ACCOUNT && env.FIREBASE_PROJECT_ID) {
        const sender = new FcmSender(env.FIREBASE_PROJECT_ID, firestoreBearer(env.FIREBASE_PROJECT_ID, env.FIREBASE_FCM_SERVICE_ACCOUNT, 'https://www.googleapis.com/auth/firebase.messaging'));
        // One bounded queue query, not a full restaurant scan every minute.
        const due = await firestore.query('pushJobs', [{ field: 'nextAttemptAt', op: 'LESS_THAN_OR_EQUAL', value: new Date() }], 100, { allDescendants: true });
        const restaurants = new Set(due.filter(row => /^restaurants\/[^/]+\/pushJobs\/[^/]+$/.test(row.path)).map(row => row.path.split('/')[1]));
        const budget = { remaining: 20, deadline: Date.now() + 25_000 };
        for (const id of [...restaurants].slice(0, 5)) {
          if (budget.remaining <= 0 || Date.now() >= budget.deadline) break;
          await new FirestorePush(firestore, id, new AuthSecurity(env)).dispatch(sender, new Date(), budget);
        }
      }
      return;
    }
    if (new Date(_controller.scheduledTime).getUTCMinutes() !== 0) return;
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
