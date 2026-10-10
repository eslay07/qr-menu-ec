import { scalarText } from './scalar-text';
import { z } from 'zod';
import { FirestoreError } from './firestore-rest';
import { ApplicationRepository, localFirestore, type DataEnv } from './application-repository';
import { FirestoreDomainRepository } from './firestore-domains';

export type DomainEnv = DataEnv & {
  DB: D1Database;
  PLATFORM_MENU_DOMAIN?: string;
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_CNAME_TARGET?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_WORKERS_SUBDOMAIN?: string;
  CORE_WORKER_SERVICE?: string;
};
export type DomainRecord = {
  hostname: string;
  restaurantId: string;
  kind: 'free' | 'workers_dev' | 'platform' | 'custom';
  status: string;
  cloudflareId: string | null;
  validation: unknown;
  provider: string;
  serviceName: string | null;
  priority: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string | null;
};

const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,63}$/,
    'Usa un subdominio como menu.restaurante.com.',
  );
export function slugFor(value: string) {
  return (
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'restaurante'
  );
}

export class DomainService {
  private firestore?: FirestoreDomainRepository;
  constructor(private env: DomainEnv) { const db = localFirestore(env); if (db) this.firestore = new FirestoreDomainRepository(db); }
  private record(restaurantId: string, hostname: string, kind: DomainRecord['kind'], values: Partial<DomainRecord> = {}): DomainRecord {
    return { restaurantId, hostname, kind, status: 'pending_validation', cloudflareId: null, validation: null, provider: 'platform_zone', serviceName: null, priority: kind === 'custom' ? 30 : kind === 'workers_dev' ? 10 : 20, lastError: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...values };
  }
  async provisionFree(
    restaurantId: string,
    name: string,
    fallbackOrigin: string,
  ) {
    const existing = this.firestore ? (await this.firestore.list(restaurantId)).find(row => ['workers_dev', 'free', 'platform'].includes(row.kind)) : await this.env.DB.prepare(
      "SELECT hostname,status,kind FROM restaurant_hosts WHERE restaurant_id = ? AND kind IN ('workers_dev','free') ORDER BY priority DESC LIMIT 1",
    )
      .bind(restaurantId)
      .first<{ hostname: string; status:string;kind:string }>();
    if (existing) {if (existing.status!=='active') {if(existing.kind==='workers_dev')return this.resumeWorkersDev(restaurantId,existing.hostname);throw Error('La dirección reservada está pendiente de verificación.');}return `https://${existing.hostname}/menu`;}
    if (
      this.env.CLOUDFLARE_ACCOUNT_ID &&
      this.env.CLOUDFLARE_API_TOKEN &&
      this.env.CLOUDFLARE_WORKERS_SUBDOMAIN
    )
      return this.provisionWorkersDev(restaurantId, name);
    if (!this.env.PLATFORM_MENU_DOMAIN)
      return `${fallbackOrigin}/r/${restaurantId}/menu`;
    const hostname=await this.reservePlatformHost(restaurantId,name,this.env.PLATFORM_MENU_DOMAIN.toLowerCase());
    return 'https://'+hostname+'/menu';
  }
  private async reservePlatformHost(restaurantId:string,name:string,domain:string) {
    const canonicalKey='platformConfig/hostnameKinds/entries/'+restaurantId+'-platform';
    const existing=this.firestore ? await this.firestore.db.get<{hostname:string}>(canonicalKey) : null;
    const legacy=this.firestore?null:await this.env.DB.prepare("SELECT hostname FROM restaurant_hosts WHERE restaurant_id=? AND kind='platform'").bind(restaurantId).first<{hostname:string}>();
    const previous=existing?.data.hostname || legacy?.hostname;
    if(previous) {
      if(!previous.endsWith('.'+domain))throw Error('La dirección anterior se conserva. La migración de dominio requiere un procedimiento específico.');
      return previous;
    }
    const base=slugFor(name);
    for(let index=1;index<=1000;index++) {
      const hostname=(index===1?base:base+'-'+index)+'.'+domain;
      const record=this.record(restaurantId,hostname,'platform',{status:'pending_route'});
      if(this.firestore) {
        try{await this.firestore.db.commit([{path:'hostnames/'+hostname,data:record,exists:false},{path:canonicalKey,data:{hostname},exists:false}]);return hostname;}
        catch(error){if(!(error instanceof FirestoreError && error.conflict))throw error;const saved=await this.firestore.db.get<{hostname:string}>(canonicalKey);if(saved){if(!saved.data.hostname.endsWith('.'+domain))throw Error('La dirección anterior se conserva.');return saved.data.hostname;}}
      }else{
        const inserted=await this.env.DB.prepare("INSERT OR IGNORE INTO restaurant_hosts (hostname,restaurant_id,kind,status,provider,priority,created_at,updated_at) VALUES (?,?,'platform','pending_route','platform_zone',20,?,?)").bind(hostname,restaurantId,record.createdAt,record.updatedAt).run();
        if(inserted.meta.changes===1)return hostname;
        const saved=await this.env.DB.prepare("SELECT hostname FROM restaurant_hosts WHERE restaurant_id=? AND kind='platform'").bind(restaurantId).first<{hostname:string}>();
        if(saved){if(!saved.hostname.endsWith('.'+domain))throw Error('La dirección anterior se conserva.');return saved.hostname;}
      }
    }
    throw Error('No se pudo reservar la dirección gratuita.');
  }


  async existingPublicPath(restaurantId:string,origin:string) {
    if(!this.firestore)return null;
    const row=await this.firestore.db.get<{slug:string}>('restaurantPublicPaths/'+restaurantId);
    if(!row || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.data.slug))return null;
    return origin+'/m/'+row.data.slug;
  }
  async reservePublicPath(restaurantId: string, name: string, origin: string) {
    if (!this.firestore) return origin + '/r/' + restaurantId + '/menu';
    const db = this.firestore.db;
    const canonicalPath = 'restaurantPublicPaths/' + restaurantId;
    const existing = await db.get<{slug:string}>(canonicalPath);
    if(existing) return origin + '/m/' + existing.data.slug;
    const base=slugFor(name);
    for(let index=1;index<=1000;index++) {
      const slug=index===1?base:base+'-'+index;
      try {await db.commit([{path:'menuAliases/'+slug,data:{restaurantId,slug},exists:false},{path:canonicalPath,data:{restaurantId,slug},exists:false}]);return origin+'/m/'+slug;}
      catch(error) {if(!(error instanceof FirestoreError && error.conflict))throw error; const saved=await db.get<{slug:string}>(canonicalPath);if(saved)return origin+'/m/'+saved.data.slug;}
    }
    throw Error('No se pudo reservar la dirección pública.');
  }
  private async verifyWorkersDev(hostname:string,serviceName:string) {
    if (!this.env.CLOUDFLARE_ACCOUNT_ID || !this.env.CLOUDFLARE_API_TOKEN || !this.env.CLOUDFLARE_WORKERS_SUBDOMAIN || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(serviceName) || hostname !== serviceName+'.'+this.env.CLOUDFLARE_WORKERS_SUBDOMAIN.toLowerCase()+'.workers.dev') throw Error('No se puede verificar la dirección reservada.');
    const scriptUrl='https://api.cloudflare.com/client/v4/accounts/'+this.env.CLOUDFLARE_ACCOUNT_ID+'/workers/scripts/'+serviceName;
    const settings=await fetch(scriptUrl+'/settings',{headers:{Authorization:'Bearer '+this.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(15000)});
    const config=await settings.json() as {success?:boolean;result?:{bindings?:Array<{type?:string;name?:string;service?:string;environment?:string}>}};
    if(!settings.ok || !config.success || !config.result?.bindings?.some(b=>b.type==='service' && b.name==='CORE' && b.service===(this.env.CORE_WORKER_SERVICE || 'qr-menu-ec') && (!b.environment || b.environment==='production'))) throw Error('El Worker reservado no tiene una ruta CORE verificada.');
    const enabled = await fetch(scriptUrl + '/subdomain', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, previews_enabled: false }),
      signal: AbortSignal.timeout(15000),
    });
    if (!enabled.ok || !(await enabled.json() as { success?: boolean }).success)
      throw Error('Cloudflare no pudo activar la dirección workers.dev.');
    // The public menu may not exist yet. The owner shell checks TLS and the
    // CORE service route without exposing or publishing a restaurant draft.
    let ready = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
          // Workers supports manual/follow only. A 3xx response fails probe.ok,
          // so manual keeps verification on this exact HTTPS hostname.
          const probe = await fetch(`https://${hostname}/owner`, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
        ready = probe.ok && (probe.headers.get('content-type') || '').includes('text/html');
        await probe.body?.cancel();
        if (ready) break;
      } catch { /* Propagation can precede TLS readiness. Keep the reservation pending. */ }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
    if (!ready) throw Error('La dirección necesita verificación HTTPS antes de activarse.');
  }
  private async resumeWorkersDev(restaurantId:string,hostname:string) {
    const reserved=this.firestore ? await this.firestore.lookup(hostname) : await this.env.DB.prepare("SELECT * FROM restaurant_hosts WHERE hostname=? AND restaurant_id=? AND kind='workers_dev'").bind(hostname,restaurantId).first<Record<string,unknown>>().then(row=>row?this.map(row):null);
    if(!reserved || reserved.restaurantId!==restaurantId || reserved.kind!=='workers_dev')throw Error('No se puede reutilizar la dirección de otro restaurante.');
    const serviceName=reserved.serviceName;
    if(!serviceName)throw Error('La dirección reservada necesita revisión del operador.');
    await this.verifyWorkersDev(hostname,serviceName);
    const now=new Date().toISOString();
    if(this.firestore)await this.firestore.save({...reserved,status:'active',lastError:null,updatedAt:now});
    else await this.env.DB.prepare("UPDATE restaurant_hosts SET status='active',last_error=NULL,updated_at=? WHERE hostname=? AND restaurant_id=? AND kind='workers_dev' AND status IN ('provisioning','error')").bind(now,hostname,restaurantId).run();
    return 'https://'+hostname+'/menu';
  }
  private async provisionWorkersDev(restaurantId: string, name: string) {
    const base = slugFor(name).slice(0, 50);
    const subdomain = this.env.CLOUDFLARE_WORKERS_SUBDOMAIN!.toLowerCase();
    const candidates = [base];
    for (let index = 2; index <= 20; index++)
      candidates.push(`${base}-${index}`.slice(0, 63));
    for (const serviceName of candidates) {
      const hostname = `${serviceName}.${subdomain}.workers.dev`;
      const firestoreCollision = this.firestore ? await this.firestore.lookup(hostname) : null;
      const collision = this.firestore ? (firestoreCollision ? { restaurant_id: firestoreCollision.restaurantId } : null) : await this.env.DB.prepare(
        'SELECT restaurant_id FROM restaurant_hosts WHERE hostname = ?',
      )
        .bind(hostname)
        .first<{ restaurant_id: string }>();
      if (collision) {
        if(collision.restaurant_id !== restaurantId)continue;
        if(firestoreCollision?.status==='active')return 'https://'+hostname+'/menu';
        return this.resumeWorkersDev(restaurantId,hostname);
      }
      const scriptUrl='https://api.cloudflare.com/client/v4/accounts/'+this.env.CLOUDFLARE_ACCOUNT_ID+'/workers/scripts/'+serviceName;
      const check=await fetch(scriptUrl,{headers:{Authorization:'Bearer '+this.env.CLOUDFLARE_API_TOKEN}});
      if(check.ok)continue;
      if(check.status!==404)throw Error('No se pudo verificar que el nombre del Worker esté libre.');
      const reservation=this.record(restaurantId,hostname,'workers_dev',{status:'provisioning',provider:'cloudflare_workers',serviceName});
      if(this.firestore) {
        try {await this.firestore.db.commit([{path:'hostnames/'+hostname,data:reservation,exists:false},{path:'platformConfig/hostnameKinds/entries/'+restaurantId+'-workers_dev',data:{hostname},exists:false}]);}
        catch(error) {if(error instanceof FirestoreError && error.conflict)continue;throw error;}
      } else {
        const reserved=await this.env.DB.prepare("INSERT OR IGNORE INTO restaurant_hosts (hostname,restaurant_id,kind,status,provider,service_name,priority,created_at,updated_at) VALUES (?,?,'workers_dev','provisioning','cloudflare_workers',?,10,?,?)").bind(hostname,restaurantId,serviceName,reservation.createdAt,reservation.updatedAt).run();
        if(reserved.meta.changes!==1)continue;
      }
      try {
        const form = new FormData();
        form.set(
          'metadata',
          new Blob([
            JSON.stringify({
              main_module: 'index.js',
              compatibility_date: '2026-05-15',
              bindings: [
                {
                  type: 'service',
                  name: 'CORE',
                  service: this.env.CORE_WORKER_SERVICE || 'qr-menu-ec',
                  environment: 'production',
                },
              ],
            }),
          ], { type: 'application/json' }),
        );
        form.set(
          'index.js',
          new Blob(
            [
              'export default { async fetch(request, env) { return env.CORE.fetch(request); } };',
            ],
            { type: 'application/javascript+module' },
          ),
          'index.js',
        );
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${this.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${serviceName}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
            },
            body: form,
          },
        );
        const result = (await response.json()) as {
          success?: boolean;
          errors?: Array<{ message?: string }>;
        };
        if (!response.ok || !result.success) {
          if (response.status === 409) continue;
          throw Error(
            result.errors?.map((error) => error.message).join(' ') ||
              'Cloudflare no pudo crear la dirección gratuita.',
          );
        }
        await this.verifyWorkersDev(hostname,serviceName);
        const now = new Date().toISOString();
        if (this.firestore) {
          await this.firestore.save(this.record(restaurantId, hostname, 'workers_dev', { status: 'active', provider: 'cloudflare_workers', serviceName }));
          return `https://${hostname}/menu`;
        }
        await this.env.DB.prepare(
          "UPDATE restaurant_hosts SET status='active',service_name=?,last_error=NULL,updated_at=? WHERE hostname=? AND restaurant_id=? AND status='provisioning'",
        )
          .bind(serviceName, now, hostname, restaurantId)
          .run();
        return `https://${hostname}/menu`;
      } catch (error) {
        const now = new Date().toISOString();
        if (this.firestore) {
          await this.firestore.save(this.record(restaurantId, hostname, 'workers_dev', { status: 'error', provider: 'cloudflare_workers', serviceName, lastError: error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido' }));
          throw error;
        }
        await this.env.DB.prepare(
          "UPDATE restaurant_hosts SET status='error',service_name=?,last_error=?,updated_at=? WHERE hostname=? AND restaurant_id=? AND status='provisioning'",
        )
          .bind(
            serviceName,
            error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido',
            now,
            hostname,
            restaurantId,
          )
          .run();
        throw error;
      }
    }
    throw Error('No se pudo reservar un nombre gratuito para el restaurante.');
  }
  private map(row: Record<string, unknown>): DomainRecord {
    return {
      hostname: String(row.hostname),
      restaurantId: String(row.restaurant_id),
      kind: row.kind as DomainRecord['kind'],
      status: String(row.status),
      cloudflareId: row.cloudflare_id ? scalarText(row.cloudflare_id) : null,
      validation: row.validation_data
        ? JSON.parse(scalarText(row.validation_data))
        : null,
      provider: scalarText(row.provider || 'legacy'),
      serviceName: row.service_name ? scalarText(row.service_name) : null,
      priority: Number(row.priority || 0),
      lastError: row.last_error ? scalarText(row.last_error) : null,
      createdAt: String(row.created_at),
      updatedAt: row.updated_at ? scalarText(row.updated_at) : null,
    };
  }
  async get(restaurantId: string) {
    if (this.firestore) {
      const records = await this.firestore.list(restaurantId);
      const active = records.filter(item => item.status === 'active');
      return { primary: active[0] || null, primaryUrl: active[0] ? `https://${active[0].hostname}/menu` : null, aliases: records, free: records.find(item => ['platform', 'workers_dev', 'free'].includes(item.kind)) || null, custom: records.find(item => item.kind === 'custom') || null, cnameTarget: this.env.CLOUDFLARE_CNAME_TARGET || null, capacity: { used: await this.firestore.capacity(), warningAt: 90, limit: 100 } };
    }
    const rows = await this.env.DB.prepare(
      'SELECT * FROM restaurant_hosts WHERE restaurant_id = ? ORDER BY priority DESC, created_at DESC',
    )
      .bind(restaurantId)
      .all<Record<string, unknown>>();
    const records = rows.results.map((row) => this.map(row));
    const active = records.filter((item) => item.status === 'active');
    const count = await this.env.DB.prepare(
      "SELECT COUNT(*) AS total FROM restaurant_hosts WHERE kind = 'workers_dev'",
    ).first<{ total: number }>();
    return {
      primary: active[0] || null,
      primaryUrl: active[0] ? `https://${active[0].hostname}/menu` : null,
      aliases: records,
      free:
        records.find((item) =>
          ['platform', 'workers_dev', 'free'].includes(item.kind),
        ) || null,
      custom: records.find((item) => item.kind === 'custom') || null,
      cnameTarget: this.env.CLOUDFLARE_CNAME_TARGET || null,
      capacity: {
        used: Number(count?.total || 0),
        warningAt: 90,
        limit: 100,
      },
    };
  }
  private async cloudflare(path: string, init?: RequestInit) {
    if (!this.env.CLOUDFLARE_ZONE_ID || !this.env.CLOUDFLARE_API_TOKEN)
      throw Error('Cloudflare for SaaS no está configurado.');
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${this.env.CLOUDFLARE_ZONE_ID}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
          ...Object.fromEntries(new Headers(init?.headers).entries()),
        },
      },
    );
    const value = (await response.json()) as {
      success: boolean;
      result?: Record<string, unknown>;
      errors?: Array<{ message: string }>;
    };
    if (!response.ok || !value.success)
      throw Error(
        value.errors?.map((item) => item.message).join(' ') ||
          'Cloudflare no pudo completar la operación.',
      );
    return value.result || {};
  }
  async put(restaurantId: string, value: unknown) {
    const hostname = hostnameSchema.parse(value);
    if (
      this.env.PLATFORM_MENU_DOMAIN &&
      hostname.endsWith(`.${this.env.PLATFORM_MENU_DOMAIN.toLowerCase()}`)
    )
      throw Error('Ese nombre pertenece al dominio gratuito de la plataforma.');
    const existingHost = this.firestore ? await this.firestore.lookup(hostname) : null;
    const duplicate = this.firestore ? (existingHost ? { restaurant_id: existingHost.restaurantId } : null) : await this.env.DB.prepare(
      'SELECT restaurant_id FROM restaurant_hosts WHERE hostname = ?',
    )
      .bind(hostname)
      .first<{ restaurant_id: string }>();
    if (duplicate && duplicate.restaurant_id !== restaurantId)
      throw Error('Ese dominio ya pertenece a otro restaurante.');
    const existingCustom = this.firestore ? (await this.firestore.list(restaurantId)).find(row => row.kind === 'custom') : null;
    const current = this.firestore ? (existingCustom ? { hostname: existingCustom.hostname, cloudflare_id: existingCustom.cloudflareId } : null) : await this.env.DB.prepare(
      "SELECT hostname,cloudflare_id FROM restaurant_hosts WHERE restaurant_id = ? AND kind = 'custom'",
    )
      .bind(restaurantId)
      .first<{ hostname: string; cloudflare_id: string | null }>();
    if (current?.hostname === hostname) return this.get(restaurantId);
    const result = await this.cloudflare('/custom_hostnames', {
      method: 'POST',
      body: JSON.stringify({
        hostname,
        ssl: {
          method: 'http',
          type: 'dv',
          settings: { min_tls_version: '1.2' },
        },
      }),
    });
    if (this.firestore) {
      const ssl = result.ssl as { status?: string } | undefined;
      await this.firestore.save(this.record(restaurantId, hostname, 'custom', { status: result.status === 'active' && ssl?.status === 'active' ? 'active' : 'pending_validation', cloudflareId: scalarText(result.id || ''), validation: result, provider: 'cloudflare_for_saas' }));
      if (current?.cloudflare_id) await this.cloudflare(`/custom_hostnames/${scalarText(current.cloudflare_id)}`, { method: 'DELETE' });
      return this.get(restaurantId);
    }
    if (current?.cloudflare_id)
      await this.cloudflare(`/custom_hostnames/${scalarText(current.cloudflare_id)}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    await this.env.DB.prepare(
      "DELETE FROM restaurant_hosts WHERE restaurant_id = ? AND kind = 'custom'",
    )
      .bind(restaurantId)
      .run();
    await this.env.DB.prepare(
      "INSERT INTO restaurant_hosts (hostname,restaurant_id,kind,status,cloudflare_id,validation_data,provider,priority,created_at,updated_at) VALUES (?,?,'custom',?,?,?,'cloudflare_for_saas',30,?,?)",
    )
      .bind(
        hostname,
        restaurantId,
        scalarText(result.status || 'pending_validation'),
        scalarText(result.id || ''),
        JSON.stringify(result),
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
    return this.get(restaurantId);
  }
  async verify(restaurantId: string) {
    if (this.firestore) {
      const current = (await this.firestore.list(restaurantId)).find(row => row.kind === 'custom');
      if (!current?.cloudflareId) throw Error('Primero registra el dominio personalizado.');
      const result = await this.cloudflare(`/custom_hostnames/${current.cloudflareId}`);
      const ssl = result.ssl as { status?: string } | undefined;
      await this.firestore.save({ ...current, status: result.status === 'active' && ssl?.status === 'active' ? 'active' : 'pending_validation', validation: result, updatedAt: new Date().toISOString() });
      return this.get(restaurantId);
    }
    const current = await this.env.DB.prepare(
      "SELECT * FROM restaurant_hosts WHERE restaurant_id = ? AND kind = 'custom'",
    )
      .bind(restaurantId)
      .first<Record<string, unknown>>();
    if (!current?.cloudflare_id)
      throw Error('Primero registra el dominio personalizado.');
    const result = await this.cloudflare(
      `/custom_hostnames/${scalarText(current.cloudflare_id)}`,
    );
    const ssl = result.ssl as Record<string, unknown> | undefined;
    const ready = result.status === 'active' && ssl?.status === 'active';
    await this.env.DB.prepare(
      'UPDATE restaurant_hosts SET status = ?, validation_data = ?, updated_at = ? WHERE hostname = ?',
    )
      .bind(
        ready ? 'active' : 'pending_validation',
        JSON.stringify(result),
        new Date().toISOString(),
        current.hostname,
      )
      .run();
    return this.get(restaurantId);
  }

  async removeCustom(restaurantId: string) {
    if (this.firestore) {
      const current = (await this.firestore.list(restaurantId)).find(row => row.kind === 'custom');
      if (current?.cloudflareId) await this.cloudflare(`/custom_hostnames/${current.cloudflareId}`, { method: 'DELETE' });
      await this.firestore.removeCustom(restaurantId);
      return this.get(restaurantId);
    }
    const current = await this.env.DB.prepare(
      "SELECT cloudflare_id FROM restaurant_hosts WHERE restaurant_id = ? AND kind = 'custom'",
    )
      .bind(restaurantId)
      .first<{ cloudflare_id: string | null }>();
    if (current?.cloudflare_id)
      await this.cloudflare(`/custom_hostnames/${scalarText(current.cloudflare_id)}`, {
        method: 'DELETE',
      });
    await this.env.DB.prepare(
      "DELETE FROM restaurant_hosts WHERE restaurant_id = ? AND kind = 'custom'",
    )
      .bind(restaurantId)
      .run();
    return this.get(restaurantId);
  }

  async platformConfig() {
    if (this.firestore) return await this.firestore.platformConfig() || { baseHostname: this.env.PLATFORM_MENU_DOMAIN || null, zoneId: this.env.CLOUDFLARE_ZONE_ID || null, status: this.env.PLATFORM_MENU_DOMAIN ? 'configured' : 'not_configured', validation: null, updatedAt: null };
    const row = await this.env.DB.prepare(
      "SELECT * FROM platform_domain_config WHERE id = 'primary'",
    ).first<Record<string, unknown>>();
    return row
      ? {
          baseHostname: row.base_hostname ? scalarText(row.base_hostname) : null,
          zoneId: row.zone_id ? scalarText(row.zone_id) : null,
          status: String(row.status),
          validation: row.validation_data
            ? JSON.parse(scalarText(row.validation_data))
            : null,
          updatedAt: String(row.updated_at),
        }
      : {
          baseHostname: this.env.PLATFORM_MENU_DOMAIN || null,
          zoneId: this.env.CLOUDFLARE_ZONE_ID || null,
          status: this.env.PLATFORM_MENU_DOMAIN ? 'configured' : 'not_configured',
          validation: null,
          updatedAt: null,
        };
  }

  async configurePlatformDomain(value: unknown) {
    const baseHostname = hostnameSchema.parse(value);
    if (!this.env.CLOUDFLARE_ZONE_ID)
      throw Error('Configura CLOUDFLARE_ZONE_ID antes de activar el dominio global.');
    if (this.firestore) {
      await this.firestore.setPlatformConfig({ baseHostname, zoneId: this.env.CLOUDFLARE_ZONE_ID, status: 'ready_for_route', validation: { route: `*.${baseHostname}/*`, worker: this.env.CORE_WORKER_SERVICE || 'qr-menu-ec' }, updatedAt: new Date() });
      for (const row of await new ApplicationRepository(this.env).list()) {
        const state = JSON.parse(row.data) as { draft: { name: string } };
        await this.reservePlatformHost(row.id,state.draft.name,baseHostname);
      }
      return this.platformConfig();
    }
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      "INSERT OR REPLACE INTO platform_domain_config (id,base_hostname,zone_id,status,validation_data,updated_at) VALUES ('primary',?,?, 'ready_for_route', ?, ?)",
    )
      .bind(
        baseHostname,
        this.env.CLOUDFLARE_ZONE_ID,
        JSON.stringify({
          route: `*.${baseHostname}/*`,
          worker: this.env.CORE_WORKER_SERVICE || 'qr-menu-ec',
          note: 'Activa la ruta comodín y el DNS proxied en Cloudflare.',
        }),
        now,
      )
      .run();
    const rows = await this.env.DB.prepare(
      "SELECT id,data FROM application WHERE id <> '__creator__'",
    ).all<{ id: string; data: string }>();
    for (const row of rows.results) {
      const state = JSON.parse(row.data) as { draft?: { name?: string } };
      await this.reservePlatformHost(row.id,state.draft?.name || 'restaurante',baseHostname);
    }
    return this.platformConfig();
  }
}
