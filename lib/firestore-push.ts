import { z } from 'zod';
import {entitlements} from './entitlements';
import { FirestoreRest, FirestoreError, firestoreId, firestoreHashId, type FirestoreWrite } from './firestore-rest';
import { digest } from './security';
import type { AuthSecurity } from './auth-security';
import { NotificationSettings } from './restaurant-preferences';
import { FcmSender, pushRetryAt } from './push-delivery';

type Preference = 'newOrder' | 'customerCancelled' | 'soldOut' | 'dailySummary' | 'inactivity';
type Device = { tokenCiphertext: string; sessionEpoch: number; sessionBinding: string; registeredAt: string; expiresAt: string };
type Job = { eventId: string; preference: Preference; createdAt: string; expiresAt: string; nextAttemptAt: string; attempt: number; delivered: string[] };
export const PushRegistration = z.object({ token: z.string().min(20).max(4096).regex(/^[A-Za-z0-9_:.-]+$/), platform: z.enum(['web', 'android']) }).strict();

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
    const registryPath = `${this.root}/private/pushRegistry`, registry = await this.db.get(registryPath);
    const path = `${this.root}/pushDevices/${id}`, old = await this.db.get<Device>(path);
    const devices = await this.db.list(`${this.root}/pushDevices`, 21);
    if (!old && devices.documents.length >= 20) throw Error('Se alcanzó el límite de 20 dispositivos. Desactiva uno antes de agregar otro.');
    const now = new Date();
    await this.db.commit([
      { path: registryPath, data: { updatedAt: now }, ...(registry ? { updateTime: registry.updateTime } : { exists: false }) },
      { path, data: { tokenCiphertext: await this.security.encrypt(input.token), platform: input.platform, sessionEpoch, sessionBinding: await digest(sessionBinding), registeredAt: old?.data.registeredAt || now, expiresAt: new Date(now.getTime() + 30 * 86_400_000) }, ...(old ? { updateTime: old.updateTime } : { exists: false }) },
      // A shared phone can only receive messages for its most recently registered restaurant.
      { path: `platformConfig/pushTokens/entries/${id}`, data: { restaurantId: this.restaurantId, expiresAt: new Date(now.getTime() + 30 * 86_400_000) } },
    ]);
    return { id, restaurantId: this.restaurantId };
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
    for (const device of devices) if (Date.parse(device.data.expiresAt) <= now.getTime() || device.data.sessionEpoch !== auth?.data.sessionEpoch || root?.data.access?.active !== true) {
      await this.db.commit([{ path: device.path, delete: true, updateTime: device.updateTime }]);
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
      const delivered = new Set(job.data.delivered); let retry = false, deferred = false;
      for (const device of devices) {
        const id = device.path.split('/').at(-1)!;
        if (delivered.has(id) || Date.parse(device.data.expiresAt) <= now.getTime() || device.data.sessionEpoch !== auth?.data.sessionEpoch || Date.parse(device.data.registeredAt) > Date.parse(job.data.createdAt)) continue;
        if (budget.remaining <= 0 || Date.now() >= budget.deadline) { deferred = true; break; }
        const owner = await this.db.get<{ restaurantId: string }>(`platformConfig/pushTokens/entries/${id}`);
        if (owner?.data.restaurantId !== this.restaurantId) continue;
        const currentDevice = await this.db.get(device.path);
        if (!currentDevice || currentDevice.updateTime !== device.updateTime) continue;
        budget.remaining--;
        const result = await sender.send({ token: await this.security.decrypt(device.data.tokenCiphertext), eventId: job.data.eventId, restaurantId: this.restaurantId });
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
