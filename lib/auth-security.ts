import {
  decryptSensitive,
  digest,
  encryptSensitive,
  randomToken,
  constantEqual,
  passwordHash,
} from './security';
import { FirebaseAuthFailure, FirebaseAuthProvider, type FirebaseAuthEnv } from './firebase-auth-provider';
import { mailFrom, validateMailRecipient } from './mail-config';
import { MailFailures } from './mail-failures';
import type { State } from './store';
import { localFirestore, type DataEnv } from './application-repository';
import { FirestoreSecurityRepository, type Grant, type Challenge } from './firestore-security';

export type AuthScope = 'creator' | 'owner';
export type SecurityEnv = FirebaseAuthEnv & DataEnv & {
  DB: D1Database;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  DATA_ENCRYPTION_KEY?: string;
  CREATOR_RECOVERY_EMAIL?: string;
  EMAIL_VERIFICATION_ENABLED?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  MAIL_DOMAIN?: string;
  MAIL_SANDBOX?: string;
  MAIL_SANDBOX_TO?: string;
};

const ownerCookie = '__Host-qrmenu_owner';
const creatorCookie = '__Host-qrmenu_creator';
const challengeCookie = '__Host-qrmenu_challenge';
const deviceCookie = '__Host-qrmenu_device';
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

const firebaseProviders = new WeakMap<SecurityEnv, FirebaseAuthProvider>();

export class AuthSecurity {
  private provider?: FirebaseAuthProvider;
  private pendingTokens = new Map<string, string>();
  private persistence?: FirestoreSecurityRepository;
  constructor(private env: SecurityEnv) {
    const firestore = localFirestore(env);
    if (firestore) this.persistence = new FirestoreSecurityRepository(firestore);
    if (env.AUTH_PROVIDER === 'firebase') {
      if (!env.DATA_ENCRYPTION_KEY) throw new FirebaseAuthFailure('ENCRYPTION_REQUIRED');
      this.provider = firebaseProviders.get(env) || new FirebaseAuthProvider(env);
      firebaseProviders.set(env, this.provider);
    }
  }

  get usesFirebase() { return !!this.provider; }
  async requestFirebasePasswordReset(state: Pick<State, 'security'>, scope: AuthScope, restaurantId: string | null) {
    if (!this.provider || !state.security?.emailCiphertext || state.security.firebaseUid !== this.uid(scope, restaurantId))
      throw new FirebaseAuthFailure('ACCOUNT_NOT_MIGRATED');
    return this.provider.requestPasswordReset(await this.decrypt(state.security.emailCiphertext), this.uid(scope, restaurantId));
  }
  async rememberedDeviceValid(restaurantId: string, createdAt: string) {
    return !this.provider || this.provider.rememberedDeviceValid(this.uid('owner', restaurantId), createdAt);
  }
  firebaseUid(scope: AuthScope, restaurantId: string | null) {
    return this.provider ? this.uid(scope, restaurantId) : null;
  }
  async firebaseClientToken(request: Request, scope: AuthScope, restaurantId: string | null) {
    const session = await this.session(request, scope, restaurantId);
    if (!this.provider || !session || !await this.requireCsrf(request, session))
      throw new FirebaseAuthFailure('SESSION_REQUIRED');
    return this.provider.clientToken(this.uid(scope, restaurantId));
  }
  private subject(scope: AuthScope, restaurantId: string | null) {
    return scope === 'creator' ? '__creator__' : restaurantId!;
  }
  private uid(scope: AuthScope, restaurantId: string | null) {
    return scope === 'creator' ? 'qrmenu-creator' : `owner:${restaurantId}`;
  }

  async authenticatePassword(state: Pick<State, 'password' | 'security'>, scope: AuthScope, restaurantId: string | null, password: string) {
    if (!this.provider)
      return constantEqual(await passwordHash(password, state.password.salt, state.password.iterations || 100_000), state.password.hash);
    let effectiveSecurity = state.security;
    let legacyVerified = false;
    if (!effectiveSecurity?.emailCiphertext) {
      const configuredEmail = this.env.CREATOR_RECOVERY_EMAIL?.trim().toLowerCase();
      if (scope !== 'creator' || restaurantId !== null || effectiveSecurity?.firebaseUid || !state.password.hash ||
          !configuredEmail || configuredEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail))
        throw new FirebaseAuthFailure('EMAIL_REQUIRED');
      legacyVerified = constantEqual(await passwordHash(password, state.password.salt, state.password.iterations || 100_000), state.password.hash);
      if (!legacyVerified) return false;
      // Server-owned recovery address only; never accept a login-supplied email.
      // Keep the existing TOTP and do not mutate state until Firebase succeeds.
      effectiveSecurity = { ...effectiveSecurity, emailCiphertext: await this.encrypt(configuredEmail), emailHash: await digest(configuredEmail) };
    }
    const email = await this.decrypt(effectiveSecurity.emailCiphertext!);
    const uid = this.uid(scope, restaurantId);
    if (effectiveSecurity.firebaseUid && effectiveSecurity.firebaseUid !== uid) throw new FirebaseAuthFailure('ACCOUNT_MISMATCH');
    try {
      if (!effectiveSecurity.firebaseUid) {
        if (!legacyVerified && !constantEqual(await passwordHash(password, state.password.salt, state.password.iterations || 100_000), state.password.hash)) return false;
        // Legacy hashes use a custom chained PBKDF2 format: migrate only after
        // a successful password check, never relabel them as Firebase hashes.
        const existing = await this.provider.lookup(uid);
        if (!existing) await this.provider.createUser(uid, email, password.normalize('NFKC'));
        else if (existing.email?.toLowerCase() !== email.toLowerCase()) throw new FirebaseAuthFailure('ACCOUNT_MISMATCH');
      }
      const idToken = await this.provider.signIn(email, password.normalize('NFKC'), uid);
      state.security = { ...effectiveSecurity, firebaseUid: uid };
      state.password = { salt: '', hash: '', iterations: 0 };
      this.pendingTokens.set(this.subject(scope, restaurantId), idToken);
      return true;
    } catch (error) {
      if (error instanceof FirebaseAuthFailure && ['INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'USER_DISABLED', 'EMAIL_NOT_FOUND'].includes(error.code)) return false;
      throw error;
    }
  }

  async setFirebasePassword(state: Pick<State, 'password' | 'security'>, scope: AuthScope, restaurantId: string | null, password: string) {
    if (!this.provider || !state.security?.emailCiphertext) throw new FirebaseAuthFailure('AUTH_NOT_CONFIGURED');
    const uid = this.uid(scope, restaurantId);
    const email = await this.decrypt(state.security.emailCiphertext);
    if (state.security.firebaseUid === uid) await this.provider.updateUser(uid, { password: password.normalize('NFKC') });
    else if (!state.security.firebaseUid) await this.provider.createUser(uid, email, password.normalize('NFKC'));
    else throw new FirebaseAuthFailure('ACCOUNT_MISMATCH');
    state.security.firebaseUid = uid;
    state.password = { salt: '', hash: '', iterations: 0 };
    this.pendingTokens.set(this.subject(scope, restaurantId), await this.provider.signIn(email, password.normalize('NFKC'), uid));
  }

  async passwordChallengePayload(scope: AuthScope, restaurantId: string | null) {
    if (!this.provider) return {};
    const token = this.pendingTokens.get(this.subject(scope, restaurantId));
    if (!token) throw new FirebaseAuthFailure('PASSWORD_REQUIRED');
    return { firebaseIdTokenCiphertext: await this.encrypt(token) };
  }

  async resumePasswordChallenge(payload: Record<string, unknown>, scope: AuthScope, restaurantId: string | null) {
    if (!this.provider) return;
    if (typeof payload.firebaseIdTokenCiphertext !== 'string') throw new FirebaseAuthFailure('PASSWORD_REQUIRED');
    this.pendingTokens.set(this.subject(scope, restaurantId), await this.decrypt(payload.firebaseIdTokenCiphertext));
  }

  async resumeRememberedOwner(restaurantId: string) {
    if (!this.provider) return;
    this.pendingTokens.set(restaurantId, await this.provider.signInRememberedOwner(this.uid('owner', restaurantId)));
  }

  async updateFirebaseEmail(state: Pick<State, 'security'>, email: string) {
    if (this.provider && state.security?.firebaseUid) await this.provider.updateUser(state.security.firebaseUid, { email });
  }

  get turnstileSiteKey() {
    return this.env.TURNSTILE_SITE_KEY || null;
  }

  get encryptionReady() {
    return !!this.env.DATA_ENCRYPTION_KEY;
  }

  get emailVerificationEnabled() {
    return this.env.EMAIL_VERIFICATION_ENABLED === 'true';
  }

  get emailDeliveryReady() {
    return !!this.env.RESEND_API_KEY && !!mailFrom(this.env);
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

  clearDeviceCookie() { return secureCookie(deviceCookie, '', 0); }

  async createDevice(restaurantId: string, sessionHash?: string) {
    const token = randomToken() + randomToken();
    const csrfToken = randomToken();
    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + 180 * 86_400_000).toISOString();
    if (this.persistence) {
      await this.persistence.create('devices', { ...(sessionHash ? {session_hash:sessionHash,family_session_hash:sessionHash}:{}), id_hash: await digest(token), scope: 'owner', restaurant_id: restaurantId, csrf_token: csrfToken, created_at: now.toISOString(), last_seen_at: now.toISOString(), idle_expires_at: new Date(now.getTime() + 30 * 86_400_000).toISOString(), absolute_expires_at: absoluteExpiresAt, revoked_at: null });
      if(sessionHash && !await this.persistence.bindDeviceSession(await digest(token),sessionHash)){await this.persistence.revoke('devices','owner',restaurantId,await digest(token));await this.persistence.revoke('sessions','owner',restaurantId,sessionHash);throw Error('La sesión fue revocada durante el acceso.');}
      return { cookie: secureCookie(deviceCookie, token, 180 * 86_400), csrfToken };
    }
    await this.env.DB.prepare('INSERT INTO owner_devices (id_hash,restaurant_id,csrf_token,created_at,last_seen_at,idle_expires_at,absolute_expires_at,revoked_at) VALUES (?,?,?,?,?,?,?,NULL)')
      .bind(await digest(token), restaurantId, csrfToken, now.toISOString(), now.toISOString(), new Date(now.getTime() + 30 * 86_400_000).toISOString(), absoluteExpiresAt).run();
    return { cookie: secureCookie(deviceCookie, token, 180 * 86_400), csrfToken };
  }

  async device(request: Request) {
    const token = cookieValue(request, deviceCookie);
    if (!token) return null;
    const hash = await digest(token);
    const now = new Date().toISOString();
    if (this.persistence) {
      const row = await this.persistence.get<Grant>('devices', hash);
      return row && row.scope === 'owner' && row.restaurant_id && this.persistence.valid(row) && !await this.persistence.familyRevoked(row) ? { ...row, restaurant_id: row.restaurant_id } : null;
    }
    const row = await this.env.DB.prepare('SELECT id_hash,restaurant_id,csrf_token,created_at,idle_expires_at,absolute_expires_at FROM owner_devices WHERE id_hash = ? AND revoked_at IS NULL AND idle_expires_at > ? AND absolute_expires_at > ?')
      .bind(hash, now, now).first<{ id_hash: string; restaurant_id: string; csrf_token: string; created_at: string; idle_expires_at: string; absolute_expires_at: string }>();
    return row || null;
  }

  async rotateDevice(request: Request, csrfToken: string) {
    if (request.headers.get('origin') !== new URL(request.url).origin) return null;
    const row = await this.device(request);
    if (!row || row.csrf_token !== csrfToken) return null;
    const deviceRate = await this.consumeLimit(await digest(`${row.restaurant_id}:${row.absolute_expires_at}`), 'device-refresh', 20, 15 * 60_000);
    if (!deviceRate.allowed) return null;
    const nextToken = randomToken() + randomToken();
    const nextCsrf = randomToken();
    const now = new Date();
    if (this.persistence) {
      if (!await this.persistence.rotateDevice(row.id_hash, csrfToken, await digest(nextToken), nextCsrf)) return null;
      return { restaurantId: row.restaurant_id, cookie: secureCookie(deviceCookie, nextToken, Math.max(1, Math.floor((Date.parse(row.absolute_expires_at) - now.getTime()) / 1000))) };
    }
    const result = await this.env.DB.prepare('UPDATE owner_devices SET id_hash = ?,csrf_token = ?,last_seen_at = ?,idle_expires_at = ? WHERE id_hash = ? AND csrf_token = ? AND revoked_at IS NULL AND idle_expires_at > ? AND absolute_expires_at > ?')
      .bind(await digest(nextToken), nextCsrf, now.toISOString(), new Date(now.getTime() + 30 * 86_400_000).toISOString(), row.id_hash, csrfToken, now.toISOString(), now.toISOString()).run();
    if (result.meta.changes !== 1) return null;
    return { restaurantId: row.restaurant_id, cookie: secureCookie(deviceCookie, nextToken, Math.max(1, Math.floor((Date.parse(row.absolute_expires_at) - now.getTime()) / 1000))) };
  }

  async bindDeviceSession(request:Request,sessionHash:string):Promise<boolean> {
    if(!this.persistence)return true;
    const token=cookieValue(request,deviceCookie);if(!token)return false;
    return this.persistence.bindDeviceSession(await digest(token),sessionHash);
  }
  async presentedOwnerSessionRevoked(request:Request,restaurantId:string) {
    const token=cookieValue(request,ownerCookie);if(!token || !this.persistence)return false;
    const grant=await this.persistence.get<Grant>('sessions',await digest(token));
    return !!grant && grant.scope==='owner' && grant.restaurant_id===restaurantId && (!!grant.revoked_at || Date.parse(grant.absolute_expires_at)<=Date.now());
  }
  async rememberedSessionRevoked(device: {session_hash?:string; id_hash:string}) {
    if(!this.persistence)return false;
    if(await this.persistence.familyRevoked(device as Grant))return true;
    if(!device.session_hash)return false;
    const session=await this.persistence.get<Grant>('sessions',device.session_hash);
    return !session || !!session.revoked_at || Date.parse(session.absolute_expires_at)<=Date.now() || await this.persistence.familyRevoked(session);
  }
  async revokeDevice(request: Request) {
    const token = cookieValue(request, deviceCookie);
    if (!token) return;
    if (this.persistence) {
      const row=await this.persistence.get<Grant>('devices',await digest(token));
      if(row?.restaurant_id && (row.family_session_hash || row.session_hash))await this.persistence.revokeSessionFamily('owner',row.restaurant_id,(row.family_session_hash || row.session_hash)!);
      await this.persistence.mutate<Grant>('devices', await digest(token), row => ({ ...row, revoked_at: new Date().toISOString() })); return;
    }
    await this.env.DB.prepare('UPDATE owner_devices SET revoked_at = ? WHERE id_hash = ?')
      .bind(new Date().toISOString(), await digest(token)).run();
  }

  async revokeDevicesForRestaurant(restaurantId: string) {
    if (this.persistence) return this.persistence.revoke('devices', 'owner', restaurantId);
    await this.env.DB.prepare('UPDATE owner_devices SET revoked_at = ? WHERE restaurant_id = ? AND revoked_at IS NULL')
      .bind(new Date().toISOString(), restaurantId).run();
  }

  async listDevices(restaurantId: string) {
    if (this.persistence) return (await this.persistence.list('devices', 'owner', restaurantId)).filter(row => this.persistence!.valid(row)).sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at)).slice(0, 20).map(row => ({ id: row.id_hash, createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.absolute_expires_at }));
    const now = new Date().toISOString();
    const rows = await this.env.DB.prepare('SELECT id_hash,created_at,last_seen_at,absolute_expires_at FROM owner_devices WHERE restaurant_id = ? AND revoked_at IS NULL AND idle_expires_at > ? AND absolute_expires_at > ? ORDER BY last_seen_at DESC LIMIT 20')
      .bind(restaurantId, now, now).all<{ id_hash: string; created_at: string; last_seen_at: string; absolute_expires_at: string }>();
    return rows.results.map(row => ({ id: row.id_hash, createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.absolute_expires_at }));
  }

  async revokeDeviceById(restaurantId: string, idHash: string) {
    if (this.persistence) {const row=await this.persistence.get<Grant>('devices',idHash);if(row?.restaurant_id===restaurantId && (row.family_session_hash || row.session_hash))await this.persistence.revokeSessionFamily('owner',restaurantId,(row.family_session_hash || row.session_hash)!);return this.persistence.revoke('devices','owner',restaurantId,idHash);}
    await this.env.DB.prepare('UPDATE owner_devices SET revoked_at = ? WHERE restaurant_id = ? AND id_hash = ?')
      .bind(new Date().toISOString(), restaurantId, idHash).run();
  }

  async createSession(scope: AuthScope, restaurantId: string | null) {
    let token = randomToken() + randomToken();
    if (this.provider) {
      const idToken = this.pendingTokens.get(this.subject(scope, restaurantId));
      if (!idToken) throw new FirebaseAuthFailure('PASSWORD_REQUIRED');
      token = await this.provider.createSession(idToken);
      if (!await this.provider.verifySession(token, this.uid(scope, restaurantId))) throw new FirebaseAuthFailure('INVALID_SESSION');
      this.pendingTokens.delete(this.subject(scope, restaurantId));
    }
    const csrfToken = randomToken();
    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();
    const absoluteExpiresAt = new Date(
      now.getTime() + 12 * 60 * 60_000,
    ).toISOString();
    if (this.persistence) {
      await this.persistence.create('sessions', { id_hash: await digest(token), scope, restaurant_id: restaurantId, csrf_token: csrfToken, created_at: now.toISOString(), last_seen_at: now.toISOString(), idle_expires_at: idleExpiresAt, absolute_expires_at: absoluteExpiresAt, revoked_at: null });
      return { sessionHash: await digest(token), csrfToken, absoluteExpiresAt, cookie: secureCookie(this.cookieName(scope), token, 12 * 60 * 60) };
    }
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
      sessionHash: await digest(token),
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
    if (this.provider && !await this.provider.verifySession(token, this.uid(scope, restaurantId))) return null;
    const now = new Date();
    if (this.persistence) {
      const grant = await this.persistence.get<Grant>('sessions',await digest(token));
      if(!grant || await this.persistence.familyRevoked(grant))return null;
      let accepted: ActiveSession | null = null;
      const valid = await this.persistence.mutate<Grant>('sessions', await digest(token), row => {
        if (row.scope !== scope || row.restaurant_id !== restaurantId || !this.persistence!.valid(row)) return false;
        accepted = { csrfToken: row.csrf_token, absoluteExpiresAt: row.absolute_expires_at };
        return { ...row, last_seen_at: now.toISOString(), idle_expires_at: new Date(now.getTime() + 30 * 60_000).toISOString() };
      });
      return valid && !await this.persistence.familyRevoked(grant) ? accepted : null;
    }
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
    if (this.persistence) {const row=await this.persistence.get<Grant>('sessions',await digest(token));if(row?.scope===scope)await this.persistence.revokeSessionFamily(scope,row.restaurant_id,await digest(token));return;}
    await this.env.DB.prepare(
      'UPDATE auth_sessions SET revoked_at = ? WHERE id_hash = ?',
    )
      .bind(new Date().toISOString(), await digest(token))
      .run();
  }

  async revokeSubject(scope: AuthScope, restaurantId: string | null) {
    if (this.persistence) return this.persistence.revoke('sessions', scope, restaurantId);
    await this.env.DB.prepare(
      'UPDATE auth_sessions SET revoked_at = ? WHERE scope = ? AND restaurant_id IS ? AND revoked_at IS NULL',
    )
      .bind(new Date().toISOString(), scope, restaurantId)
      .run();
  }

  async listSessions(scope: AuthScope, restaurantId: string | null) {
    if (this.persistence) return (await this.persistence.list('sessions', scope, restaurantId)).filter(row => this.persistence!.valid(row)).sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at)).slice(0, 20).map(row => ({ id: row.id_hash, createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.absolute_expires_at }));
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
    if (this.persistence) return this.persistence.revokeSessionFamily(scope,restaurantId,idHash);
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
    if (this.persistence) {
      await this.persistence.create('challenges', { id_hash: await digest(token), scope, restaurant_id: restaurantId, kind, payload: JSON.stringify(payload), attempts: 0, expires_at: new Date(now.getTime() + 5 * 60_000).toISOString(), created_at: now.toISOString() });
      return { cookie: secureCookie(challengeCookie, token, 5 * 60) };
    }
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
    if (this.persistence) {
      const row = await this.persistence.get<Challenge>('challenges', hash);
      if (!row || row.scope !== scope || row.restaurant_id !== restaurantId || !['mfa_login', 'mfa_setup'].includes(row.kind) || row.attempts >= 5 || Date.parse(row.expires_at) <= Date.now()) return null;
      return { hash, kind: row.kind as 'mfa_login' | 'mfa_setup', payload: JSON.parse(row.payload) as Record<string, unknown> };
    }
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
    if (this.persistence) { await this.persistence.mutate<Challenge>('challenges', hash, row => ({ ...row, attempts: row.attempts + 1 })); return; }
    await this.env.DB.prepare(
      'UPDATE auth_challenges SET attempts = attempts + 1 WHERE id_hash = ?',
    )
      .bind(hash)
      .run();
  }

  async consumeChallenge(hash: string) {
    if (this.persistence) { if (!await this.persistence.take(hash)) throw Error('El desafío venció o ya fue utilizado.'); return; }
    const consumed = await this.env.DB.prepare('DELETE FROM auth_challenges WHERE id_hash = ? RETURNING id_hash')
      .bind(hash).first();
    if (!consumed) throw Error('El desafío venció o ya fue utilizado.');
  }

  async issueActionToken(
    scope: AuthScope,
    restaurantId: string | null,
    kind: 'email_verify' | 'password_reset',
    payload: Record<string, unknown> = {},
  ) {
    const token = randomToken() + randomToken();
    const now = new Date();
    if (this.persistence) {
      await this.persistence.create('challenges', { id_hash: await digest(token), scope, restaurant_id: restaurantId, kind, payload: JSON.stringify(payload), attempts: 0, expires_at: new Date(now.getTime() + 30 * 60_000).toISOString(), created_at: now.toISOString() });
      return token;
    }
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
    if (this.persistence) { const row = await this.persistence.take(hash, scope, restaurantId, kind); return row ? JSON.parse(row.payload) as Record<string, unknown> : null; }
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
    if (!this.emailVerificationEnabled)
      throw Error('La verificación por correo todavía no está activada.');
    return this.deliverEmail(to, subject, html);
  }

  async deliverEmail(to: string, subject: string, html: string, recordFailure = true) {
    validateMailRecipient(this.env, to);
    if (!this.emailDeliveryReady) throw Error('El envío de correos todavía no está configurado.');
    const from = mailFrom(this.env);
    const idempotencyKey = (await digest(`${from}:${to}:${subject}:${html}`)).replace(/[^a-zA-Z0-9]/g, '');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `qrmenu-${idempotencyKey}` },
          body: JSON.stringify({ from, to: [to], subject, html }),
          signal: AbortSignal.timeout(8_000),
        });
        if (response.ok) return;
        if (response.status !== 429 && response.status < 500) break;
      } catch { /* A timeout may follow delivery: reuse the idempotency key. */ }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
    }
    await this.audit(null, 'system:email', 'email.delivery-failed', 'failure', Date.now(), 'Retries exhausted; no recipient or recovery token logged.');
    if (recordFailure && this.encryptionReady) await new MailFailures(this.env, this).record(to, subject, html);
    throw Error('No se pudo enviar el correo de seguridad. Solicita ayuda al administrador.');
  }

  async takeActionToken(token: string, scope: AuthScope, restaurantId: string | null, kind: 'password_reset') {
    if (this.persistence) { const row = await this.persistence.take(await digest(token), scope, restaurantId, kind); return row ? { payload: row.payload } : null; }
    return this.env.DB.prepare(
      'DELETE FROM auth_challenges WHERE id_hash = ? AND scope = ? AND restaurant_id IS ? AND kind = ? AND expires_at > ? RETURNING payload',
    ).bind(await digest(token), scope, restaurantId, kind, new Date().toISOString()).first<{ payload: string }>();
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
    if (this.persistence) return this.persistence.consumeLimit(keyHash, bucket, limit, windowMs);
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
    if (this.persistence) return this.persistence.audit({ restaurantId, actor, action, outcome, durationMs: Math.max(0, Date.now() - startedAt), createdAt: new Date(), detail: detail?.slice(0, 500) || null });
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
    await new MailFailures(this.env, this).cleanup();
    if (this.persistence) return this.persistence.cleanup();
    const now = new Date().toISOString();
    const auditCutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
    await this.env.DB.batch([
      this.env.DB.prepare('DELETE FROM auth_sessions WHERE absolute_expires_at <= ? OR idle_expires_at <= ? OR revoked_at IS NOT NULL').bind(now, now),
      this.env.DB.prepare('DELETE FROM owner_devices WHERE absolute_expires_at <= ? OR idle_expires_at <= ? OR revoked_at IS NOT NULL').bind(now, now),
      this.env.DB.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').bind(now),
      this.env.DB.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').bind(now),
      this.env.DB.prepare('DELETE FROM audit_events WHERE created_at <= ?').bind(auditCutoff),
    ]);
  }
  async clearCreatorChallenges() {
    if (this.persistence) return this.persistence.clearChallenges('creator');
    await this.env.DB.prepare("DELETE FROM auth_challenges WHERE scope = 'creator'").run();
  }
}
