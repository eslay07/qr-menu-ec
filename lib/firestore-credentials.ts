import { SignJWT, importPKCS8 } from 'jose';
import { z } from 'zod';

// Independent Worker secret; never reuse or broaden the Auth service account.
export function firestoreBearer(projectId: string, secret: string, scope = 'https://www.googleapis.com/auth/datastore') {
  const account = z.object({ project_id: z.string(), client_email: z.string().check(z.email()), private_key: z.string().min(1) }).parse(JSON.parse(secret));
  if (account.project_id !== projectId) throw Error('El proyecto de la credencial Firestore no coincide.');
  let cached: { token: string; expires: number } | undefined;
  return async () => {
    if (cached && cached.expires > Date.now()) return cached.token;
    const key = await importPKCS8(account.private_key, 'RS256');
    const assertion = await new SignJWT({ scope }).setProtectedHeader({ alg: 'RS256' }).setIssuer(account.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(key);
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: unknown; error_description?: unknown };
      throw Object.assign(new Error('Credencial Firestore no disponible.'), {
        status: response.status,
        code: typeof error.error === 'string' && /^[a-z_]{1,80}$/.test(error.error) ? error.error : 'OAUTH_ERROR',
        reason: error.error_description === 'Invalid JWT Signature.' ? 'INVALID_JWT_SIGNATURE' : 'UNCLASSIFIED_OAUTH_ERROR',
      });
    }
    const data = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).parse(await response.json());
    cached = { token: data.access_token, expires: Date.now() + Math.max(0, data.expires_in - 60) * 1000 };
    return cached.token;
  };
}
