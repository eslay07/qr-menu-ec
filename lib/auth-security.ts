import {
  decryptSensitive,
  digest,
  encryptSensitive,
  randomToken,
} from './security';

export type AuthScope = 'creator' | 'owner';
export type SecurityEnv = {
  DB: D1Database;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  DATA_ENCRYPTION_KEY?: string;
  EMAIL_VERIFICATION_ENABLED?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};

const ownerCookie = '__Host-qrmenu_owner';
const creatorCookie = '__Host-qrmenu_creator';
const challengeCookie = '__Host-qrmenu_challenge';
const cookieValue = (request: Request, name: string) =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || '';
const secureCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

export type ActiveSession = {
  csrfToken: string;
  absoluteExpiresAt: string;
};

export class AuthSecurity {
  constructor(private env: SecurityEnv) {}

  get turnstileSiteKey() {
    return this.env.TURNSTILE_SITE_KEY || null;
  }

  get encryptionReady() {
    return !!this.env.DATA_ENCRYPTION_KEY;
  }

  get emailVerificationEnabled() {
    return this.env.EMAIL_VERIFICATION_ENABLED === 'true';
  }

  async encrypt(value: string) {
    if (!this.env.DATA_ENCRYPTION_KEY)
      throw Error('El cifrado de seguridad no está configurado.');
    return encryptSensitive(value, this.env.DATA_ENCRYPTION_KEY);
  }

  async decrypt(value: string) {
    if (!this.env.DATA_ENCRYPTION_KEY)
      throw Error('El cifrado de seguridad no está configurado.');
    return decryptSensitive(value, this.env.DATA_ENCRYPTION_KEY);
  }

  cookieName(scope: AuthScope) {
    return scope === 'creator' ? creatorCookie : ownerCookie;
  }

  clearSessionCookie(scope: AuthScope) {
    return secureCookie(this.cookieName(scope), '', 0);
  }

  clearChallengeCookie() {
    return secureCookie(challengeCookie, '', 0);
  }

  async createSession(scope: AuthScope, restaurantId: string | null) {
    const token = randomToken() + randomToken();
    const csrfToken = randomToken();
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();
    const absoluteExpiresAt = new Date(
      now.getTime() + 12 * 60 * 60_000,
    ).toISOString();
    await this.env.DB.prepare(
      'INSERT INTO auth_sessions (id_hash,scope,restaurant_id,csrf_token,created_at,last_seen_at,idle_expires_at,absolute_expires_at,revoked_at) VALUES (?,?,?,?,?,?,?,?,NULL)',
    )
      .bind(
        await digest(token),
        scope,
        restaurantId,
        csrfToken,
        now.toISOString(),
        now.toISOString(),
        idleExpiresAt,
        absoluteExpiresAt,
      )
      .run();
    return {
      csrfToken,
      absoluteExpiresAt,
      cookie: secureCookie(this.cookieName(scope), token, 12 * 60 * 60),
    };
  }

  async session(
    request: Request,
    scope: AuthScope,
    restaurantId: string | null,
  ): Promise<ActiveSession | null> {
    const token = cookieValue(request, this.cookieName(scope));
    if (!token) return null;
    const now = new Date();
    const row = await this.env.DB.prepare(
      'SELECT csrf_token,idle_expires_at,absolute_expires_at,revoked_at FROM auth_sessions WHERE id_hash = ? AND scope = ? AND restaurant_id IS ?',
    )
      .bind(await digest(token), scope, restaurantId)
      .first<{
        csrf_token: string;
        idle_expires_at: string;
        absolute_expires_at: string;
        revoked_at: string | null;
      }>();
    if (
      !row ||
      row.revoked_at ||
      Date.parse(row.idle_expires_at) <= now.getTime() ||
      Date.parse(row.absolute_expires_at) <= now.getTime()
    )
      return null;
    await this.env.DB.prepare(
      'UPDATE auth_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id_hash = ?',
    )
      .bind(
        now.toISOString(),
        new Date(now.getTime() + 30 * 60_000).toISOString(),
        await digest(token),
      )
      .run();
    return {
      csrfToken: row.csrf_token,
      absoluteExpiresAt: row.absolute_expires_at,
    };
  }

  async requireCsrf(request: Request, session: ActiveSession | null) {
    if (!session) return false;
    const origin = request.headers.get('origin');
    const url = new URL(request.url);
    if (!origin || origin !== url.origin) return false;
    return request.headers.get('x-csrf-token') === session.csrfToken;
  }

  async revokeSession(request: Request, scope: AuthScope) {
    const token = cookieValue(request, this.cookieName(scope));
    if (!token) return;
    await this.env.DB.prepare(
      'UPDATE auth_sessions SET revoked_at = ? WHERE id_hash = ?',
    )
      .bind(new Date().toISOString(), await digest(token))
      .run();
  }

  async revokeSubject(scope: AuthScope, restaurantId: string | null) {
    await this.env.DB.prepare(
      'UPDATE auth_sessions SET revoked_at = ? WHERE scope = ? AND restaurant_id IS ? AND revoked_at IS NULL',
    )
      .bind(new Date().toISOString(), scope, restaurantId)
      .run();
  }

  async listSessions(scope: AuthScope, restaurantId: string | null) {
    const rows = await this.env.DB.prepare(
      'SELECT id_hash,created_at,last_seen_at,absolute_expires_at FROM auth_sessions WHERE scope = ? AND restaurant_id IS ? AND revoked_at IS NULL AND absolute_expires_at > ? ORDER BY last_seen_at DESC LIMIT 20',
    )
      .bind(scope, restaurantId, new Date().toISOString())
      .all<{
        id_hash: string;
        created_at: string;
        last_seen_at: string;
        absolute_expires_at: string;
      }>();
    return rows.results.map((row) => ({
      id: row.id_hash,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.absolute_expires_at,
    }));
  }

  async revokeSessionById(
    scope: AuthScope,
    restaurantId: string | null,
    idHash: string,
  ) {
    await this.env.DB.prepare(
      'UPDATE auth_sessions SET revoked_at = ? WHERE id_hash = ? AND scope = ? AND restaurant_id IS ?',
    )
      .bind(new Date().toISOString(), idHash, scope, restaurantId)
      .run();
  }

  async challenge(
    scope: AuthScope,
    restaurantId: string | null,
    kind: 'mfa_login' | 'mfa_setup',
    payload: Record<string, unknown> = {},
  ) {
    const token = randomToken() + randomToken();
    const now = new Date();
    await this.env.DB.prepare(
      'INSERT INTO auth_challenges (id_hash,scope,restaurant_id,kind,payload,attempts,expires_at,created_at) VALUES (?,?,?,?,?,0,?,?)',
    )
      .bind(
        await digest(token),
        scope,
        restaurantId,
        kind,
        JSON.stringify(payload),
        new Date(now.getTime() + 5 * 60_000).toISOString(),
        now.toISOString(),
      )
      .run();
    return { cookie: secureCookie(challengeCookie, token, 5 * 60) };
  }

  async readChallenge(request: Request, scope: AuthScope, restaurantId: string | null) {
    const token = cookieValue(request, challengeCookie);
    if (!token) return null;
    const hash = await digest(token);
    const row = await this.env.DB.prepare(
      'SELECT kind,payload,attempts,expires_at FROM auth_challenges WHERE id_hash = ? AND scope = ? AND restaurant_id IS ?',
    )
      .bind(hash, scope, restaurantId)
      .first<{
        kind: 'mfa_login' | 'mfa_setup';
        payload: string;
        attempts: number;
        expires_at: string;
      }>();
    if (!row || row.attempts >= 5 || Date.parse(row.expires_at) <= Date.now())
      return null;
    return { hash, kind: row.kind, payload: JSON.parse(row.payload) as Record<string, unknown> };
  }

  async failChallenge(hash: string) {
    await this.env.DB.prepare(
      'UPDATE auth_challenges SET attempts = attempts + 1 WHERE id_hash = ?',
    )
      .bind(hash)
      .run();
  }

  async consumeChallenge(hash: string) {
    await this.env.DB.prepare('DELETE FROM auth_challenges WHERE id_hash = ?')
      .bind(hash)
      .run();
  }

  async issueActionToken(
    scope: AuthScope,
    restaurantId: string | null,
    kind: 'email_verify' | 'password_reset',
    payload: Record<string, unknown> = {},
  ) {
    const token = randomToken() + randomToken();
    const now = new Date();
    await this.env.DB.prepare(
      'INSERT INTO auth_challenges (id_hash,scope,restaurant_id,kind,payload,attempts,expires_at,created_at) VALUES (?,?,?,?,?,0,?,?)',
    )
      .bind(
        await digest(token),
        scope,
        restaurantId,
        kind,
        JSON.stringify(payload),
        new Date(now.getTime() + 30 * 60_000).toISOString(),
        now.toISOString(),
      )
      .run();
    return token;
  }

  async consumeActionToken(
    token: string,
    scope: AuthScope,
    restaurantId: string | null,
    kind: 'email_verify' | 'password_reset',
  ) {
    const hash = await digest(token);
    const row = await this.env.DB.prepare(
      'SELECT payload,expires_at FROM auth_challenges WHERE id_hash = ? AND scope = ? AND restaurant_id IS ? AND kind = ?',
    )
      .bind(hash, scope, restaurantId, kind)
      .first<{ payload: string; expires_at: string }>();
    if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
    await this.consumeChallenge(hash);
    return JSON.parse(row.payload) as Record<string, unknown>;
  }

  async sendEmail(to: string, subject: string, html: string) {
    if (
      !this.emailVerificationEnabled ||
      !this.env.RESEND_API_KEY ||
      !this.env.EMAIL_FROM
    )
      throw Error('La verificación por correo todavía no está activada.');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.env.EMAIL_FROM,
        to: [to],
        subject,
        html,
      }),
    });
    if (!response.ok) throw Error('No se pudo enviar el correo de seguridad.');
  }

  private async clientKey(request: Request, subject: string) {
    const address = request.headers.get('cf-connecting-ip') || 'unknown';
    return digest(`${subject}:${address}`);
  }

  private async consumeLimit(
    keyHash: string,
    bucket: string,
    limit: number,
    windowMs: number,
  ) {
    const now = Date.now();
    const row = await this.env.DB.prepare(
      'SELECT count,reset_at FROM rate_limits WHERE key_hash = ? AND bucket = ?',
    )
      .bind(keyHash, bucket)
      .first<{ count: number; reset_at: string }>();
    if (!row || Date.parse(row.reset_at) <= now) {
      await this.env.DB.prepare(
        'INSERT OR REPLACE INTO rate_limits (key_hash,bucket,count,reset_at) VALUES (?,?,1,?)',
      )
        .bind(keyHash, bucket, new Date(now + windowMs).toISOString())
        .run();
      return { allowed: true, retryAfter: 0 };
    }
    if (row.count >= limit)
      return {
        allowed: false,
        retryAfter: Math.max(
          1,
          Math.ceil((Date.parse(row.reset_at) - now) / 1000),
        ),
      };
    await this.env.DB.prepare(
      'UPDATE rate_limits SET count = count + 1 WHERE key_hash = ? AND bucket = ?',
    )
      .bind(keyHash, bucket)
      .run();
    return { allowed: true, retryAfter: 0 };
  }

  async rateLimitAccountAndIp(
    request: Request,
    bucket: string,
    account: string,
    accountLimit: number,
    ipLimit: number,
    windowMs: number,
  ) {
    const address = request.headers.get('cf-connecting-ip') || 'unknown';
    const accountResult = await this.consumeLimit(
      await digest(`account:${bucket}:${account}`),
      `${bucket}:account`,
      accountLimit,
      windowMs,
    );
    const ipResult = await this.consumeLimit(
      await digest(`ip:${bucket}:${address}`),
      `${bucket}:ip`,
      ipLimit,
      windowMs,
    );
    return accountResult.allowed ? ipResult : accountResult;
  }

  async rateLimit(
    request: Request,
    bucket: string,
    subject: string,
    limit: number,
    windowMs: number,
  ) {
    return this.consumeLimit(
      await this.clientKey(request, subject),
      bucket,
      limit,
      windowMs,
    );
  }

  async verifyTurnstile(token: unknown, request: Request) {
    if (!this.env.TURNSTILE_SECRET_KEY) return true;
    if (typeof token !== 'string' || !token) return false;
    const form = new FormData();
    form.set('secret', this.env.TURNSTILE_SECRET_KEY);
    form.set('response', token);
    const address = request.headers.get('cf-connecting-ip');
    if (address) form.set('remoteip', address);
    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form },
    );
    const result = (await response.json()) as { success?: boolean };
    return response.ok && result.success === true;
  }

  async audit(
    restaurantId: string | null,
    actor: string,
    action: string,
    outcome: 'success' | 'failure',
    startedAt: number,
    detail?: string,
  ) {
    await this.env.DB.prepare(
      'INSERT INTO audit_events (id,restaurant_id,actor,action,outcome,duration_ms,created_at,detail) VALUES (?,?,?,?,?,?,?,?)',
    )
      .bind(
        crypto.randomUUID(),
        restaurantId,
        actor,
        action,
        outcome,
        Math.max(0, Date.now() - startedAt),
        new Date().toISOString(),
        detail?.slice(0, 500) || null,
      )
      .run();
  }

  async anonymousActor(request: Request) {
    const address = request.headers.get('cf-connecting-ip') || 'unknown';
    const agent = request.headers.get('user-agent') || 'unknown';
    return `anonymous:${(await digest(`${address}:${agent}`)).slice(0, 16)}`;
  }

  async cleanup() {
    const now = new Date().toISOString();
    const auditCutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
    await this.env.DB.batch([
      this.env.DB.prepare('DELETE FROM auth_sessions WHERE absolute_expires_at <= ? OR revoked_at IS NOT NULL').bind(now),
      this.env.DB.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').bind(now),
      this.env.DB.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').bind(now),
      this.env.DB.prepare('DELETE FROM audit_events WHERE created_at <= ?').bind(auditCutoff),
    ]);
  }
}
