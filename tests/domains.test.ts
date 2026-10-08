import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainService } from '../lib/domains';

type HostRow = {
  hostname: string;
  restaurant_id: string;
  kind: 'free' | 'custom' | 'platform';
  status: string;
  cloudflare_id: string | null;
  validation_data: string | null;
  created_at: string;
};

function fakeDb(initial: HostRow[] = []) {
  const rows = [...initial];
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...input: unknown[]) {
          values = input;
          return statement;
        },
        async first<T>() {
          if(sql.includes("restaurant_id=? AND kind='platform'"))return rows.find(row=>row.restaurant_id===values[0] && row.kind==='platform') as T|undefined;
          if (sql.includes("restaurant_id = ? AND kind = 'free'"))
            return rows.find(
              (row) => row.restaurant_id === values[0] && row.kind === 'free',
            ) as T | undefined;
          if (sql.includes('WHERE hostname = ?'))
            return rows.find((row) => row.hostname === values[0]) as
              | T
              | undefined;
          if (sql.includes("restaurant_id = ? AND kind = 'custom'"))
            return rows.find(
              (row) => row.restaurant_id === values[0] && row.kind === 'custom',
            ) as T | undefined;
          return undefined;
        },
        async all<T>() {
          return {
            results: rows.filter((row) => row.restaurant_id === values[0]),
          } as { results: T[] };
        },
        async run() {
          if(sql.startsWith('INSERT OR IGNORE INTO restaurant_hosts')) {
            if(rows.some(row=>row.hostname===values[0] || (row.restaurant_id===values[1]&&row.kind==='platform')))return {meta:{changes:0}};
            rows.push({hostname:String(values[0]),restaurant_id:String(values[1]),kind:'platform',status:'pending_route',cloudflare_id:null,validation_data:null,created_at:String(values[2])});return {meta:{changes:1}};
          }
          if (sql.startsWith('INSERT INTO restaurant_hosts')) {
            if (sql.includes("'active'"))
              rows.push({
                hostname: String(values[0]),
                restaurant_id: String(values[1]),
                kind: 'free',
                status: 'active',
                cloudflare_id: null,
                validation_data: null,
                created_at: String(values[3]),
              });
            else
              rows.push({
                hostname: String(values[0]),
                restaurant_id: String(values[1]),
                kind: 'custom',
                status: String(values[2]),
                cloudflare_id: String(values[3]),
                validation_data: String(values[4]),
                created_at: String(values[5]),
              });
          } else if (sql.startsWith('DELETE FROM restaurant_hosts')) {
            const index = rows.findIndex(
              (row) => row.restaurant_id === values[0] && row.kind === 'custom',
            );
            if (index >= 0) rows.splice(index, 1);
          } else if (sql.startsWith('UPDATE restaurant_hosts')) {
            const row = rows.find((item) => item.hostname === values[3]);
            if (row) {
              row.status = String(values[0]);
              row.validation_data = String(values[1]);
            }
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
  return { db: db as unknown as D1Database, rows };
}

test('free hostnames normalize names and resolve collisions', async () => {
  const { db, rows } = fakeDb([
    {
      hostname: 'la-mesa.menus.test',
      restaurant_id: 'existing',
      kind: 'free',
      status: 'active',
      cloudflare_id: null,
      validation_data: null,
      created_at: new Date().toISOString(),
    },
  ]);
  const service = new DomainService({
    DB: db,
    PLATFORM_MENU_DOMAIN: 'menus.test',
  });
  const url = await service.provisionFree(
    'abcdef12-0000-0000-0000-000000000000',
    'La Mésa',
    'https://platform.test',
  );
  assert.equal(url, 'https://la-mesa-2.menus.test/menu');
  assert.equal(rows[0].restaurant_id,'existing');
  assert.equal(rows.at(-1)?.status,'pending_route');
  assert.equal(
    rows.at(-1)?.restaurant_id,
    'abcdef12-0000-0000-0000-000000000000',
  );
});

test('custom hostname waits for both hostname and certificate', async () => {
  const { db } = fakeDb();
  const originalFetch = globalThis.fetch;
  let verification = 0;
  globalThis.fetch = async (_input, init) => {
    const result =
      init?.method === 'POST'
        ? { id: 'cf-host', status: 'pending', ssl: { status: 'pending' } }
        : verification++ === 0
          ? { id: 'cf-host', status: 'active', ssl: { status: 'pending' } }
          : { id: 'cf-host', status: 'active', ssl: { status: 'active' } };
    return Response.json({ success: true, result });
  };
  try {
    const service = new DomainService({
      DB: db,
      PLATFORM_MENU_DOMAIN: 'menus.test',
      CLOUDFLARE_ZONE_ID: 'zone',
      CLOUDFLARE_API_TOKEN: 'token',
      CLOUDFLARE_CNAME_TARGET: 'customers.menus.test',
    });
    await service.put('restaurant', 'menu.restaurante.com');
    const pending = await service.verify('restaurant');
    assert.equal(pending.custom?.status, 'pending_validation');
    assert.equal(
      (pending.custom?.validation as { ssl: { status: string } }).ssl.status,
      'pending',
    );
    const active = await service.verify('restaurant');
    assert.equal(active.custom?.status, 'active');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
