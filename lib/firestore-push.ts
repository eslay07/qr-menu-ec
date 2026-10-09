import { z } from 'zod';
import {entitlements} from './entitlements';
import { FirestoreRest, FirestoreError, firestoreId, firestoreHashId, type FirestoreWrite } from './firestore-rest';
import { digest } from './security';
import type { AuthSecurity } from './auth-security';
import { NotificationSettings } from './restaurant-preferences';
import { FcmSender, pushRetryAt, firebaseInstallationId, type PushTargetType } from './push-delivery';

type Preference = 'newOrder' | 'customerCancelled' | 'soldOut' | 'dailySummary' | 'inactivity';
const eventLabels: Record<Preference, string> = { newOrder:'Nuevo pedido recibido', customerCancelled:'Pedido cancelado por el comensal', soldOut:'Producto agotado', dailySummary:'Resumen diario de pedidos', inactivity:'Alerta de inactividad' };
type SessionGrant = {idHash:string;scope:string;restaurantId:string|null;csrfToken:string;revokedAt:string|null;absoluteExpiresAt:string;idleExpiresAt:string;familySessionHash?:string};
type Device = { platform?:'web'|'android';targetType?:PushTargetType;registrationKeyHash?:string; sessionGrantHash?:string;sessionFamilyHash?:string; tokenCiphertext: string; sessionEpoch: number; sessionBinding: string; registeredAt: string; expiresAt: string };
type Job = { eventId: string; preference: Preference; createdAt: string; expiresAt: string; nextAttemptAt: string; attempt: number; delivered: string[] };
export const PushRegistration = z.object({ token: z.string().min(20).max(4096).regex(/^[A-Za-z0-9_:.-]+$/), platform: z.enum(['web', 'android']), targetType:z.enum(['token','fid']).default('token'), registrationKey:z.uuid().optional() }).strict().superRefine((value,context)=>{ if(value.targetType==='fid'&&!firebaseInstallationId.test(value.token))context.addIssue({code:'custom',path:['token'],message:'FID inválido.'}); if(value.registrationKey&&value.platform!=='web')context.addIssue({code:'custom',path:['registrationKey'],message:'La clave web no corresponde a Android.'}); });

export function pushJob(restaurantId: string, eventId: string, preference: Preference, now = new Date()): FirestoreWrite {
  return { path: `restaurants/${firestoreId(restaurantId)}/pushJobs/${firestoreId(eventId)}`, exists: false,
    data: { eventId, preference, createdAt: now, expiresAt: new Date(now.getTime() + 3_600_000), nextAttemptAt: now, attempt: 0, delivered: [] } };
}

// All paths remain server-only under the existing default-deny rules.
export class FirestorePush {
  readonly root: string;
  constructor(private db: FirestoreRest, readonly restaurantId: string, private security: Pick<AuthSecurity, 'encrypt' | 'decrypt'>) {
    this.root = `restaurants/${firestoreId(restaurantId)}`;
  }
  async register(value: unknown, sessionEpoch: number, sessionBinding: string) {
    const input = PushRegistration.parse(value), id = firestoreHashId(await digest(input.token));
    const sessions=await this.db.query<SessionGrant>('platformConfig/sessionGrants/entries',[{field:'scope',value:'owner'},{field:'restaurantId',value:this.restaurantId},{field:'csrfToken',value:sessionBinding}],2);
    if(sessions.length!==1)throw Error('La sesión de notificaciones no está disponible.');
    const session=sessions[0], familyHash=session.data.familySessionHash || session.data.idHash;
    if(Date.parse(session.data.idleExpiresAt)<=Date.now() || !await this.sessionDeliveryValid(session.data.idHash))throw Error('La sesión de notificaciones fue revocada o venció.');
    const family=familyHash===session.data.idHash?session:await this.db.get<SessionGrant>(this.sessionPath(familyHash));
    if(!family || family.data.revokedAt || Date.parse(family.data.absoluteExpiresAt)<=Date.now())throw Error('La sesión de notificaciones fue revocada o venció.');
    const registryPath = `${this.root}/private/pushRegistry`, registry = await this.db.get(registryPath);
    const path = `${this.root}/pushDevices/${id}`, old = await this.db.get<Device>(path);
    const devices = await this.db.list<Device>(`${this.root}/pushDevices`, 21);
    const bindingHash = await digest(sessionBinding);
    const registrationKeyHash = input.registrationKey ? await digest(input.registrationKey) : undefined;
    const replacements = input.platform === 'web' && registrationKeyHash ? devices.documents.filter(device => device.path !== path && device.data.platform === 'web' && (device.data.sessionFamilyHash === familyHash || device.data.sessionBinding === bindingHash) && (device.data.registrationKeyHash === registrationKeyHash || !device.data.registrationKeyHash)) : [];
    const ownerships = await Promise.all(replacements.map(device => this.db.get<{restaurantId:string}>(`platformConfig/pushTokens/entries/${device.path.split('/').at(-1)!}`)));
    const replacementDeletes = replacements.map(device=>({path:device.path,delete:true,updateTime:device.updateTime}));
    const ownershipDeletes = ownerships.filter(owner=>owner?.data.restaurantId===this.restaurantId).map(owner=>({path:owner!.path,delete:true,updateTime:owner!.updateTime}));
    if (!old && devices.documents.length - replacements.length >= 20) throw Error('Se alcanzó el límite de 20 dispositivos. Desactiva uno antes de agregar otro.');
    const now = new Date();
    await this.db.commit([
      ...replacementDeletes, ...ownershipDeletes,
      {path:session.path,data:{familySessionHash:familyHash},mask:['familySessionHash'],updateTime:session.updateTime},
      ...(family.path!==session.path?[{path:family.path,data:{},mask:[],updateTime:family.updateTime}]:[]),
      { path: registryPath, data: { updatedAt: now }, ...(registry ? { updateTime: registry.updateTime } : { exists: false }) },
      { path, data: { targetType:input.targetType,...(registrationKeyHash?{registrationKeyHash}:{}),tokenCiphertext: await this.security.encrypt(input.token), platform: input.platform, sessionGrantHash:session.data.idHash,sessionFamilyHash:familyHash,sessionEpoch, sessionBinding: await digest(sessionBinding), registeredAt: old?.data.registeredAt || now, expiresAt: new Date(now.getTime() + 30 * 86_400_000) }, ...(old ? { updateTime: old.updateTime } : { exists: false }) },
      // A shared phone can only receive messages for its most recently registered restaurant.
      { path: `platformConfig/pushTokens/entries/${id}`, data: { restaurantId: this.restaurantId, expiresAt: new Date(now.getTime() + 30 * 86_400_000) } },
    ]);
    return { id, restaurantId: this.restaurantId };
  }
  private sessionPath(hash:string){return 'platformConfig/sessionGrants/entries/'+firestoreHashId(hash);}
  private async sessionDeliveryValid(hash:string,now=new Date()) {
    const session=await this.db.get<SessionGrant>(this.sessionPath(hash));
    if(!session || session.data.scope!=='owner' || session.data.restaurantId!==this.restaurantId || session.data.revokedAt || Date.parse(session.data.absoluteExpiresAt)<=now.getTime())return false;
    const rootHash=session.data.familySessionHash || session.data.idHash;
    const root=rootHash===hash?session:await this.db.get<SessionGrant>(this.sessionPath(rootHash));
    return !!root && root.data.scope==='owner' && root.data.restaurantId===this.restaurantId && !root.data.revokedAt && Date.parse(root.data.absoluteExpiresAt)>now.getTime();
  }
  private async legacyBindings() {
    const rows=await this.db.query<SessionGrant>('platformConfig/sessionGrants/entries',[{field:'scope',value:'owner'},{field:'restaurantId',value:this.restaurantId}],1000);
    const bindings=new Map<string,string|null>();
    for(const row of rows){const binding=await digest(row.data.csrfToken);bindings.set(binding,bindings.has(binding)?null:row.data.idHash);}
    return bindings;
  }
  async revokeSessionFamily(hash:string) {
    const session=await this.db.get<SessionGrant>(this.sessionPath(hash));
    if(session && (session.data.scope!=='owner' || session.data.restaurantId!==this.restaurantId))return;
    const rootHash=session?.data.familySessionHash || hash;
    const grants=await this.db.query<SessionGrant>('platformConfig/sessionGrants/entries',[{field:'scope',value:'owner'},{field:'restaurantId',value:this.restaurantId}],1000);
    const bindings=new Set(await Promise.all(grants.filter(g=>(g.data.familySessionHash || g.data.idHash)===rootHash).map(g=>digest(g.data.csrfToken))));
    for(let attempt=0;attempt<3;attempt++){
      const devices=(await this.db.list<Device>(this.root+'/pushDevices',20)).documents.filter(d=>d.data.sessionFamilyHash===rootHash || d.data.sessionGrantHash===hash || bindings.has(d.data.sessionBinding));
      if(!devices.length)return;
      try{await this.db.commit(devices.map(d=>({path:d.path,delete:true,updateTime:d.updateTime})));return;}
      catch(error){if(!(error instanceof FirestoreError&&error.conflict))throw error;}
    }
  }
  async revokeDeviceFamily(hash:string) {
    const device=await this.db.get<{scope:string;restaurantId:string;familySessionHash?:string;sessionHash?:string}>('platformConfig/deviceGrants/entries/'+firestoreHashId(hash));
    if(!device || device.data.scope!=='owner' || device.data.restaurantId!==this.restaurantId)return;
    const root=device.data.familySessionHash || device.data.sessionHash;
    if(root)await this.revokeSessionFamily(root);
  }
  async revokeSession(sessionBinding: string) {
    const binding = await digest(sessionBinding);
    const rows = await this.db.query<Device>(`${this.root}/pushDevices`, [{ field: 'sessionBinding', value: binding }], 20);
    if (rows.length) await this.db.commit(rows.map(row => ({ path: row.path, delete: true, updateTime: row.updateTime })));
  }
  async revoke(token: string) {
    const id = firestoreHashId(await digest(z.string().min(20).max(4096).parse(token)));
    const row = await this.db.get(`${this.root}/pushDevices/${id}`);
    if (row) await this.db.commit([{ path: row.path, delete: true, updateTime: row.updateTime }]);
  }
  async dispatch(sender: FcmSender, now = new Date(), budget = { remaining: 20, deadline: Date.now() + 25_000 }) {
    const root = await this.db.get<{ access: { active: boolean; plan?:'basic'|'medium'|'premium' } }>(this.root);
    const auth = await this.db.get<{ sessionEpoch: number }>(`${this.root}/private/auth`);
    const settings = NotificationSettings.parse((await this.db.get(`${this.root}/settings/notifications`))?.data || {});
    const devices = (await this.db.list<Device>(`${this.root}/pushDevices`, 20)).documents;
    let legacy:Promise<Map<string,string|null>>|undefined;
    const allowed=async(device:Device)=>{const hash=device.sessionGrantHash || (await (legacy ||= this.legacyBindings())).get(device.sessionBinding);return !!hash && this.sessionDeliveryValid(hash,now);};
    for (const device of devices) if (Date.parse(device.data.expiresAt) <= now.getTime() || device.data.sessionEpoch !== auth?.data.sessionEpoch || root?.data.access?.active !== true || !await allowed(device.data)) {
      try{await this.db.commit([{ path: device.path, delete: true, updateTime: device.updateTime }]);}catch(error){if(!(error instanceof FirestoreError&&error.conflict))throw error;}
    }
    const jobs = await this.db.query<Job>(`${this.root}/pushJobs`, [{ field: 'nextAttemptAt', op: 'LESS_THAN_OR_EQUAL', value: now }], 20);
    for (const job of jobs) {
      if (budget.remaining <= 0 || Date.now() >= budget.deadline) break;
      if (Date.parse(job.data.expiresAt) <= now.getTime() || job.data.attempt >= 6 || !settings[job.data.preference] || root?.data.access?.active !== true || !entitlements(root.data.access).push) {
        if (job.data.attempt >= 6) console.warn('push_delivery_exhausted');
        await this.db.commit([{ path: job.path, delete: true, updateTime: job.updateTime }]); continue;
      }
      // CAS lease prevents concurrent requests and cron from delivering together.
      try { await this.db.commit([{ path: job.path, data: { nextAttemptAt: new Date(now.getTime() + 10 * 60_000) }, mask: ['nextAttemptAt'], updateTime: job.updateTime }]); }
      catch (error) { if (error instanceof FirestoreError && error.conflict) continue; throw error; }
      const leased = await this.db.get<Job>(job.path);
      if (!leased) continue;
      const notification = await this.db.get<{ title: string; message: string }>(`${this.root}/notifications/${job.data.eventId}`);
      const delivered = new Set(job.data.delivered); let retry = false, deferred = false;
      for (const device of devices) {
        const id = device.path.split('/').at(-1)!;
        if (delivered.has(id) || Date.parse(device.data.expiresAt) <= now.getTime() || device.data.sessionEpoch !== auth?.data.sessionEpoch || Date.parse(device.data.registeredAt) > Date.parse(job.data.createdAt)) continue;
        if (budget.remaining <= 0 || Date.now() >= budget.deadline) { deferred = true; break; }
        const owner = await this.db.get<{ restaurantId: string }>(`platformConfig/pushTokens/entries/${id}`);
        if (owner?.data.restaurantId !== this.restaurantId) continue;
        const currentDevice = await this.db.get(device.path);
        if (!currentDevice) continue;
        // A concurrent token refresh is not a delivery and must not erase the
        // event. Retry against the fresh snapshot; logout still revokes it.
        if (currentDevice.updateTime !== device.updateTime) { deferred = true; continue; }
        // Re-read session/family immediately before delivery; token snapshots
        // alone cannot authorize a session revoked during queue preparation.
        if(!await allowed(device.data)){try{await this.db.commit([{path:device.path,delete:true,updateTime:currentDevice.updateTime}]);}catch(error){if(!(error instanceof FirestoreError&&error.conflict))throw error;}continue;}
        budget.remaining--;
        const result = await sender.send({ targetType:device.data.targetType || 'token', token: await this.security.decrypt(device.data.tokenCiphertext), eventId: job.data.eventId, restaurantId: this.restaurantId, title: notification?.data.title.slice(0,120) || eventLabels[job.data.preference], body: notification?.data.message.slice(0,600) || `${eventLabels[job.data.preference]}. Abre este aviso para consultar el detalle.` });
        console.info('push_delivery_result', { eventId:job.data.eventId, result });
        if (result === 'retry') retry = true;
        else delivered.add(id);
        if (result === 'invalid-token') await this.db.commit([{ path: device.path, delete: true, updateTime: device.updateTime }]);
      }
      await this.db.commit([retry || deferred
        ? { path: job.path, data: { delivered: [...delivered], attempt: job.data.attempt + (retry ? 1 : 0), nextAttemptAt: pushRetryAt(retry ? job.data.attempt + 1 : 1, now.getTime()) }, mask: ['delivered', 'attempt', 'nextAttemptAt'], updateTime: leased.updateTime }
        : { path: job.path, delete: true, updateTime: leased.updateTime }]);
    }
  }
}
