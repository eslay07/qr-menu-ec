import { scalarText } from './scalar-text';
import { z } from 'zod';
import { FirestoreRest, firestoreId, type FirestoreData } from './firestore-rest';
import type { AuthSecurity } from './auth-security';

export const NotificationSettings = z.object({
  newOrder: z.boolean().default(true), customerCancelled: z.boolean().default(true),
  soldOut: z.boolean().default(true), dailySummary: z.boolean().default(false),
  inactivity: z.boolean().default(false), inactivityHours: z.number().int().min(1).max(168).default(8),
}).strict();
export const WifiSettings = z.object({ enabled: z.boolean(), name: z.string().trim().max(32), password: z.string().max(63) }).strict().refine(value => !value.enabled || (!!value.name && !!value.password), 'Completa nombre y clave del WiFi.');
export class RestaurantPreferences {
  private path: string;
  constructor(private db: FirestoreRest, restaurantId: string, private security: AuthSecurity) { this.path = `restaurants/${firestoreId(restaurantId)}/settings`; }
  async notifications() {
    const row = await this.db.get(`${this.path}/notifications`);
    return { revision: row?.updateTime ?? null, settings: NotificationSettings.parse(row?.data || {}) };
  }
  async saveNotifications(settings: unknown, revision: string | null) {
    const value = NotificationSettings.parse(settings);
    await this.db.commit([{ path: `${this.path}/notifications`, data: value, ...(revision ? { updateTime: revision } : { exists: false }) }]);
  }
  async wifi() {
    const row = await this.db.get(`${this.path}/general`);
    // Never return the password in settings, public state, QR data or URLs.
    return { revision: row?.updateTime ?? null, enabled: row?.data.wifiEnabled === true, name: typeof row?.data.wifiName === 'string' ? row.data.wifiName : '', hasPassword: typeof row?.data.wifiCiphertext === 'string' && !!row.data.wifiCiphertext };
  }
  async saveWifi(settings: unknown, revision: string | null) {
    const input = WifiSettings.parse(settings);
    const fields: FirestoreData = { wifiEnabled: input.enabled, wifiName: input.name, wifiCiphertext: input.enabled ? await this.security.encrypt(input.password) : null };
    await this.db.commit([{ path: `${this.path}/general`, data: fields, mask: Object.keys(fields), ...(revision ? { updateTime: revision } : { exists: false }) }]);
  }
  // Only called from the authenticated printing endpoint, never public QR.
  async printWifi() {
    const row = await this.db.get(`${this.path}/general`);
    if (row?.data.wifiEnabled !== true || typeof row.data.wifiCiphertext !== 'string') return null;
    return { name: scalarText(row.data.wifiName || ''), text: `WiFi gratis · Clave: ${await this.security.decrypt(row.data.wifiCiphertext)}` };
  }
}
