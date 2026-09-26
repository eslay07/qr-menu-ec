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

type Env = CentralEnv & {
  ASSETS: Fetcher;
  LICENSE_PUBLIC_KEY?: string;
  PLATFORM_MENU_DOMAIN?: string;
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_CNAME_TARGET?: string;
};
const restaurantPath = /^\/r\/([a-f0-9-]{36})(\/.*)?$/;

export default {
  async fetch(request: Request, env: Env) {
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
    if (hostRow?.kind === 'free' && !scopedPath.startsWith('/api/')) {
      const custom = await env.DB.prepare(
        "SELECT hostname FROM restaurant_hosts WHERE restaurant_id = ? AND kind = 'custom' AND status = 'active'",
      )
        .bind(hostRow.restaurant_id)
        .first<{ hostname: string }>();
      if (custom) {
        url.protocol = 'https:';
        url.hostname = custom.hostname;
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
      });
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
  },
};
