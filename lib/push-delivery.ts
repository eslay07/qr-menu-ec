import { z } from 'zod';

export type PushResult = 'sent' | 'invalid-token' | 'retry' | 'rejected';
export type PushMessage = { token: string; eventId: string; restaurantId: string };

// No customer names, order contents, WiFi secrets or bearer URLs on lock screens.
export class FcmSender {
  constructor(private project: string, private bearer: () => Promise<string>, private transport: typeof fetch = fetch) {
    if (!/^[a-z][a-z0-9-]{4,62}$/.test(project)) throw Error('Proyecto FCM inválido.');
  }
  async send(message: PushMessage): Promise<PushResult> {
    const parsed = z.object({ token: z.string().min(20).max(4096), eventId: z.string().max(256), restaurantId: z.string().uuid() }).strict().parse(message);
    try {
      const response = await this.transport.call(globalThis, `https://fcm.googleapis.com/v1/projects/${this.project}/messages:send`, {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${await this.bearer()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: {
          token: parsed.token,
          data: { eventId: parsed.eventId, restaurantId: parsed.restaurantId, title: 'QR Menu EC', body: 'Tienes una novedad en tu restaurante. Abre el panel para revisarla.' },
          android: { priority: 'high', ttl: '3600s', collapse_key: parsed.restaurantId },
          webpush: { headers: { TTL: '3600', Urgency: 'normal' } },
        } }),
      });
      if (response.ok) return 'sent';
      const result = await response.json().catch(() => ({})) as { error?: { details?: { '@type'?: string; errorCode?: string }[] } };
      const code = result.error?.details?.find(detail => detail['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError')?.errorCode;
      if (code === 'UNREGISTERED') return 'invalid-token';
      // INVALID_ARGUMENT can describe the payload, not necessarily the token.
      if (response.status === 429 || response.status >= 500 || response.status === 401 || response.status === 403) return 'retry';
      return 'rejected';
    } catch { return 'retry'; }
  }
}

export function pushRetryAt(attempt: number, now = Date.now()) {
  return new Date(now + Math.min(3_600_000, 60_000 * 2 ** Math.max(0, attempt - 1)));
}
