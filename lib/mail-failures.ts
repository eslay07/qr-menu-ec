import { localFirestore, type DataEnv } from './application-repository';
import type { AuthSecurity } from './auth-security';
import { FirestoreRest } from './firestore-rest';

export async function purgeExpiredMailFailures(db: FirestoreRest, now = new Date()) {
  for (let batch = 0; batch < 20; batch++) {
    const rows = await db.query('platformConfig/mailFailures/entries', [{ field: 'expiresAt', op: 'LESS_THAN_OR_EQUAL', value: now.toISOString() }], 200);
    if (!rows.length) break;
    await db.commit(rows.map(row => ({ path: row.path, delete: true, updateTime: row.updateTime })));
  }
}

type Failure = { id: string; createdAt: string; expiresAt: string; status: 'failed' | 'sending' | 'sent'; encrypted: string };
export class MailFailures {
  constructor(private env: DataEnv, private security: AuthSecurity) {}
  private path(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Registro inválido.'); return `platformConfig/mailFailures/entries/${id}`; }
  async record(to: string, subject: string, html: string) {
    if (html.length > 32000 || subject.length > 200) throw Error('Correo demasiado grande.');
    const id = crypto.randomUUID();
    const data: Failure = { id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), status: 'failed', encrypted: await this.security.encrypt(JSON.stringify({ to, subject, html })) };
    const db = localFirestore(this.env);
    if (db) await db.commit([{ path: this.path(id), data, exists: false }]);
    else await this.env.DB.prepare('INSERT INTO application (id,revision,data) VALUES (?,0,?)').bind(`__mail_failure:${id}`, JSON.stringify(data)).run();
    return id;
  }
  async list() {
    const db = localFirestore(this.env);
    const rows = db ? (await db.list<Failure>('platformConfig/mailFailures/entries', 50, undefined, 'createdAt desc')).documents.map(row => row.data)
      : (await this.env.DB.prepare("SELECT data FROM application WHERE id GLOB '__mail_failure:*' ORDER BY rowid DESC LIMIT 50").all<{ data: string }>()).results.map(row => JSON.parse(row.data) as Failure);
    return rows.map(({ encrypted: _secret, ...row }) => ({ ...row, expired: Date.parse(row.expiresAt) <= Date.now() }));
  }
  async cleanup(now = new Date()) {
    const db = localFirestore(this.env);
    if (db) return purgeExpiredMailFailures(db, now);
    await this.env.DB.prepare("DELETE FROM application WHERE id GLOB '__mail_failure:*' AND json_extract(data,'$.expiresAt') <= ?").bind(now.toISOString()).run();
  }
  async retry(id: string) {
    const path = this.path(id), db = localFirestore(this.env);
    const doc = db ? await db.get<Failure>(path) : null;
    const row = db ? null : await this.env.DB.prepare('SELECT revision,data FROM application WHERE id=?').bind(`__mail_failure:${id}`).first<{ revision: number; data: string }>();
    const data: Failure | undefined = doc?.data || (row ? JSON.parse(row.data) : undefined);
    if (!data || data.status !== 'failed' || Date.parse(data.expiresAt) <= Date.now()) throw Error('Correo vencido o ya procesado. Genera una recuperación nueva.');
    if (db) await db.commit([{ path, data: { status: 'sending' }, mask: ['status'], updateTime: doc!.updateTime }]);
    else {
      const claim = await this.env.DB.prepare('UPDATE application SET revision=revision+1,data=? WHERE id=? AND revision=?').bind(JSON.stringify({ ...data, status: 'sending' }), `__mail_failure:${id}`, row!.revision).run();
      if (!claim.meta.changes) throw Error('Reenvío concurrente.');
    }
    const message = JSON.parse(await this.security.decrypt(data.encrypted)) as { to: string; subject: string; html: string };
    await this.security.audit(null, 'creator', 'email.manual-retry', 'success', Date.now(), id);
    let status: Failure['status'] = 'failed';
    try { await this.security.deliverEmail(message.to, message.subject, message.html, false); status = 'sent'; }
    finally {
      if (db) await db.commit([{ path, data: { status, ...(status === 'sent' ? { encrypted: '' } : {}) }, mask: status === 'sent' ? ['status', 'encrypted'] : ['status'] }]);
      else await this.env.DB.prepare('UPDATE application SET revision=revision+1,data=? WHERE id=?').bind(JSON.stringify({ ...data, status, encrypted: status === 'sent' ? '' : data.encrypted }), `__mail_failure:${id}`).run();
    }
  }
}
