import { SignJWT, importPKCS8, importX509, jwtVerify } from 'jose';
import { z } from 'zod';

export type FirebaseAuthEnv = {
  AUTH_PROVIDER?: 'legacy' | 'firebase';
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_API_KEY?: string;
  // Worker secret, never VITE_*, never a browser bundle.
  FIREBASE_SERVICE_ACCOUNT?: string;
};

const accountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.string().email(),
  private_key: z.string().min(1),
});
const userSchema = z.object({
  localId: z.string().min(1),
  email: z.string().optional(),
  disabled: z.boolean().optional(),
  validSince: z.string().optional(),
});
export class FirebaseAuthFailure extends Error {
  constructor(readonly code: string) {
    super('No se pudo verificar el acceso. Intenta nuevamente.');
  }
}

/** Server-only adapter: no Firestore, Storage, FCM or Firebase Admin Node runtime. */
export class FirebaseAuthProvider {
  private account;
  private accessToken?: { value: string; until: number };
  private certificates?: { values: Record<string, string>; until: number };

  constructor(private env: FirebaseAuthEnv, private transport: typeof fetch = fetch) {
    if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_API_KEY || !env.FIREBASE_SERVICE_ACCOUNT)
      throw new FirebaseAuthFailure('AUTH_NOT_CONFIGURED');
    this.account = accountSchema.parse(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT));
    if (this.account.project_id !== env.FIREBASE_PROJECT_ID)
      throw new FirebaseAuthFailure('PROJECT_MISMATCH');
  }

  private async request(url: string, body?: unknown, bearer?: string) {
    const response = await this.transport.call(globalThis, url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json() as Record<string, any>;
    if (!response.ok) throw new FirebaseAuthFailure(String(data.error?.message || 'PROVIDER_UNAVAILABLE').split(' : ')[0]);
    return data;
  }

  private async bearer() {
    if (this.accessToken && this.accessToken.until > Date.now()) return this.accessToken.value;
    const key = await importPKCS8(this.account.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/identitytoolkit' })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(this.account.client_email)
      .setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(key);
    const response = await this.transport.call(globalThis, 'https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new FirebaseAuthFailure('ADMIN_UNAVAILABLE');
    const data = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await response.json());
    this.accessToken = { value: data.access_token, until: Date.now() + Math.max(0, data.expires_in - 60) * 1000 };
    return data.access_token;
  }

  private async admin(operation: string, body: unknown) {
    return this.request(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(this.env.FIREBASE_PROJECT_ID!)}${operation}`, body, await this.bearer());
  }

  async signIn(email: string, password: string, expectedUid: string) {
    const result = await this.request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(this.env.FIREBASE_API_KEY!)}`, {
      email, password, returnSecureToken: true,
    });
    if (result.localId !== expectedUid || typeof result.idToken !== 'string')
      throw new FirebaseAuthFailure('ACCOUNT_MISMATCH');
    return result.idToken as string;
  }

  async createUser(uid: string, email: string, password: string) {
    // Do not adopt or overwrite an existing Firebase account just because its
    // email matches a legacy owner. Conflicts require an explicit operator review.
    const result = await this.admin('/accounts', { localId: uid, email, password, emailVerified: false });
    if (result.localId !== uid) throw new FirebaseAuthFailure('ACCOUNT_MISMATCH');
  }

  async requestPasswordReset(email: string, expectedUid: string) {
    const user = await this.lookup(expectedUid);
    if (!user || user.disabled || user.email?.toLowerCase() !== email.toLowerCase())
      throw new FirebaseAuthFailure('ACCOUNT_MISMATCH');
    // Firebase sends the email and hosts the reset page on firebaseapp.com.
    // No domain purchase, Resend secret or client-visible reset token required.
    await this.request(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(this.env.FIREBASE_API_KEY!)}`, {
      requestType: 'PASSWORD_RESET', email,
    });
  }

  async rememberedDeviceValid(uid: string, createdAt: string) {
    const created = Date.parse(createdAt);
    if (!Number.isFinite(created)) return false;
    const user = await this.lookup(uid);
    return !!user && !user.disabled && Number(user.validSince || 0) <= Math.floor(created / 1000);
  }

  async updateUser(uid: string, changes: { password?: string; email?: string; disableUser?: boolean }) {
    await this.admin('/accounts:update', { localId: uid, ...changes, validSince: String(Math.floor(Date.now() / 1000)) });
  }

  async lookup(uid: string) {
    const result = await this.admin('/accounts:lookup', { localId: [uid] });
    const users = z.array(userSchema).parse(result.users || []);
    return users.find((user) => user.localId === uid) || null;
  }

  async createSession(idToken: string) {
    const result = await this.admin(':createSessionCookie', { idToken, validDuration: '43200' });
    if (typeof result.sessionCookie !== 'string') throw new FirebaseAuthFailure('INVALID_SESSION');
    return result.sessionCookie as string;
  }

  async verifySession(cookie: string, expectedUid: string) {
    try {
      if (!this.certificates || this.certificates.until <= Date.now()) {
        const result = await this.request('https://www.googleapis.com/identitytoolkit/v3/relyingparty/publicKeys');
        this.certificates = { values: z.record(z.string(), z.string()).parse(result), until: Date.now() + 300_000 };
      }
      const { payload } = await jwtVerify(cookie, async (header) => {
        if (header.alg !== 'RS256' || !header.kid || !this.certificates?.values[header.kid])
          throw new FirebaseAuthFailure('INVALID_SESSION');
        return importX509(this.certificates.values[header.kid], 'RS256');
      }, {
        algorithms: ['RS256'], issuer: `https://session.firebase.google.com/${this.env.FIREBASE_PROJECT_ID}`,
        audience: this.env.FIREBASE_PROJECT_ID, requiredClaims: ['exp', 'iat', 'sub', 'auth_time'],
      });
      if (payload.sub !== expectedUid || typeof payload.auth_time !== 'number' || payload.auth_time > Date.now() / 1000)
        return false;
      const user = await this.lookup(expectedUid);
      return !!user && !user.disabled && Number(user.validSince || 0) <= payload.auth_time;
    } catch { return false; }
  }

  async signInRememberedOwner(uid: string) {
    const user = await this.lookup(uid);
    if (!user || user.disabled) throw new FirebaseAuthFailure('ACCOUNT_UNAVAILABLE');
    const token = await this.clientToken(uid);
    const result = await this.request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(this.env.FIREBASE_API_KEY!)}`, {
      token, returnSecureToken: true,
    });
    if (typeof result.idToken !== 'string') throw new FirebaseAuthFailure('INVALID_SESSION');
    return result.idToken as string;
  }

  async clientToken(uid: string) {
    return new SignJWT({ uid })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(this.account.client_email).setSubject(this.account.client_email)
      .setAudience('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit')
      .setIssuedAt().setExpirationTime('5m').sign(await importPKCS8(this.account.private_key, 'RS256'));
  }
}
