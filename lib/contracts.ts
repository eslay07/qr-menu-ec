import { z } from 'zod';

export const Mode = z.enum(['dual_web_vcard', 'web', 'text', 'local']);
export type Mode = z.infer<typeof Mode>;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const singleLine = (max: number) => z.string().max(max).refine(value => !value.includes('\r') && !value.includes('\n') && !value.includes(String.fromCharCode(0)), 'Usa una sola línea sin caracteres de control.');

export const Asset = z.string().regex(/^(|\/demo\/encebollado\.jpg|\/api\/v1\/media\/[a-f0-9-]{36})$/);
export const Catalog = z.object({
  name: z.string().trim().min(1).max(80),
  tagline: z.string().max(180),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  logo: Asset,
  categories: z.array(z.object({ id, name: z.string().trim().min(1).max(50) })).min(1).max(30),
  dishes: z.array(z.object({
    id,
    name: z.string().trim().min(1).max(90),
    description: z.string().max(500),
    categoryId: id,
    priceCents: z.number().int().min(0).max(9999999),
    available: z.boolean(),
    image: Asset,
  })).max(150),
}).superRefine((value, context) => {
  const categories = new Set(value.categories.map(item => item.id));
  if (categories.size !== value.categories.length || new Set(value.dishes.map(item => item.id)).size !== value.dishes.length) context.addIssue({ code: 'custom', message: 'Hay identificadores duplicados.' });
  if (value.dishes.some(item => !categories.has(item.categoryId))) context.addIssue({ code: 'custom', message: 'Un plato tiene una categoría inexistente.' });
});
export type Catalog = z.infer<typeof Catalog>;

export const OfflineCardSettings = z.object({
  title: singleLine(80),
  intro: singleLine(160),
  farewell: singleLine(160),
  phone: singleLine(40),
  address: singleLine(180),
  hours: singleLine(120),
  includeDescriptions: z.boolean(),
  separator: singleLine(24),
  categoryBullet: singleLine(8),
  dishBullet: singleLine(8),
});
export type OfflineCardSettings = z.infer<typeof OfflineCardSettings>;
export const defaultOfflineCard: OfflineCardSettings = {
  title: '',
  intro: '',
  farewell: 'Gracias por visitarnos',
  phone: '',
  address: '',
  hours: '',
  includeDescriptions: true,
  separator: '━━━━━━━━━━━━━━━━',
  categoryBullet: '◆',
  dishBullet: '•',
};

export const Settings = z.object({
  mode: Mode,
  server: z.enum(['router', 'windows10', 'windows7', 'android']),
  accessExperience: z.enum(['automatic_preferred', 'guided']),
  ssid: z.string().min(1).max(32).refine(value => new TextEncoder().encode(value).length <= 32, 'El nombre de red supera 32 bytes.'),
  wifiPassword: z.string().regex(/^[\x20-\x7e]{8,63}$/),
  localUrl: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'http:' && !url.username && !url.password && !url.search && !url.hash && (/^192\.168\.\d{1,3}\.\d{1,3}$|^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$|^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(url.hostname) || url.hostname === 'menu.lan');
  }, 'Usa una dirección HTTP de la red privada.'),
  webUrl: z.union([z.literal(''), z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }, 'La dirección web debe usar HTTPS.')]),
  offlineCard: OfflineCardSettings.default(defaultOfflineCard),
});
export type Settings = z.infer<typeof Settings>;

export const defaultSettings: Settings = {
  mode: 'dual_web_vcard',
  server: 'router',
  accessExperience: 'automatic_preferred',
  ssid: 'QR-Menu',
  wifiPassword: 'menu-invitados',
  localUrl: 'http://192.168.8.1:8080/menu',
  webUrl: '',
  offlineCard: defaultOfflineCard,
};
export function normalizeSettings(value: Partial<Settings> | undefined): Settings {
  return Settings.parse({ ...defaultSettings, ...value, offlineCard: { ...defaultOfflineCard, ...value?.offlineCard } });
}

export const LicensePayload = z.object({ schemaVersion: z.literal(1), restaurantId: id, licenseId: id, modes: z.array(Mode).min(1).max(4), issuedAt: z.string().datetime(), customer: z.string().min(1).max(120) });
export type LicensePayload = z.infer<typeof LicensePayload>;
export const License = z.object({ payload: z.string().max(4096), signature: z.string().max(256) });
export type License = z.infer<typeof License>;
export const Backup = z.object({ schemaVersion: z.literal(1), sourceId: id, exportedAt: z.string().datetime(), draft: Catalog, settings: Settings, media: z.array(z.object({ id: z.string().uuid(), type: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().max(1500000) })).max(151) });

export const blankCatalog: Catalog = { name: 'Mi restaurante', tagline: 'Sabores que nos reúnen.', color: '#244130', logo: '', categories: [{ id: 'principales', name: 'Platos principales' }, { id: 'bebidas', name: 'Bebidas' }], dishes: [] };
export const demoCatalog: Catalog = { ...blankCatalog, name: 'La Mesa', tagline: 'Cocina ecuatoriana, hecha con cariño.', categories: [{ id: 'principales', name: 'Nuestra cocina' }, { id: 'bebidas', name: 'Para acompañar' }], dishes: [{ id: 'encebollado', name: 'Encebollado de la casa', description: 'Albacora, yuca suave, cebolla encurtida y el toque fresco del limón.', categoryId: 'principales', priceCents: 650, available: true, image: '/demo/encebollado.jpg' }, { id: 'seco', name: 'Seco de pollo', description: 'Cocción lenta con especias, arroz amarillo y maduro.', categoryId: 'principales', priceCents: 750, available: true, image: '' }, { id: 'bolon', name: 'Bolón de verde', description: 'Verde dorado, queso fresco y café pasado para acompañar.', categoryId: 'principales', priceCents: 400, available: true, image: '' }, { id: 'jugo', name: 'Jugo de maracuyá', description: 'Fruta natural, preparado al momento.', categoryId: 'bebidas', priceCents: 250, available: true, image: '' }] };
export const money = (cents: number) => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(cents / 100);
const qrMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export function wifiPayload(settings: Settings) { const escape = (value: string) => value.replace(/([\\;,:" ])/g, '\\$1'); return `WIFI:T:WPA;S:${escape(settings.ssid)};P:${escape(settings.wifiPassword)};;`; }

export const TEXT_QR_MAX_BYTES = 900;
const textBytes = (value: string) => new TextEncoder().encode(value).length;
const textFooter = (part: number, total: number) => `\n\nPARTE ${part} DE ${total}`;
export function textPages(catalog: Catalog, maxBytes = TEXT_QR_MAX_BYTES) {
  const pages: string[] = [], firstHeader = `${catalog.name}\nMENÚ · PRECIOS EN USD`, nextHeader = `${catalog.name}\nMENÚ · CONTINUACIÓN`, contentLimit = maxBytes - textBytes(textFooter(150, 150));
  let text = firstHeader, hasDish = false, currentCategory = '';
  for (const category of catalog.categories) for (const dish of catalog.dishes.filter(item => item.categoryId === category.id && item.available)) {
    const item = `- ${dish.name}: ${qrMoney(dish.priceCents)}`;
    let addition = currentCategory === category.id ? `\n${item}` : `\n\n${category.name}\n${item}`;
    if (textBytes(text + addition) > contentLimit) {
      if (!hasDish) throw Error(`El texto de “${dish.name}” es demasiado largo para un QR legible.`);
      pages.push(text); text = nextHeader; hasDish = false; currentCategory = ''; addition = `\n\n${category.name}\n${item}`;
      if (textBytes(text + addition) > contentLimit) throw Error(`El texto de “${dish.name}” es demasiado largo para un QR legible.`);
    }
    text += addition; hasDish = true; currentCategory = category.id;
  }
  if (hasDish) pages.push(text);
  return pages.map((page, index) => `${page}${textFooter(index + 1, pages.length)}`);
}

export const VCARD_QR_MAX_BYTES = 900;
export type VCardResult = { payload: string; note: string; bytes: number; remaining: number; fits: boolean; compacted: boolean; omittedDescriptions: string[]; offendingDish: string | null };
function escapeVCardText(value: string) { return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
function foldVCardLine(line: string) {
  const chunks: string[] = [];
  let chunk = '';
  for (const character of line) {
    const limit = chunks.length ? 74 : 75;
    if (chunk && textBytes(chunk + character) > limit) { chunks.push(chunk); chunk = character; }
    else chunk += character;
  }
  if (chunk || !chunks.length) chunks.push(chunk);
  return chunks.map((value, index) => index ? ` ${value}` : value).join('\r\n');
}
function makeNote(catalog: Catalog, settings: OfflineCardSettings, omitted: Set<string>, compact: boolean) {
  const available = catalog.dishes.filter(dish => dish.available);
  const lines: string[] = [];
  const separator = compact ? '' : settings.separator.trim();
  const title = (settings.title.trim() || catalog.name).toUpperCase();
  if (separator) lines.push(separator);
  lines.push(title, 'MENÚ · PRECIOS EN USD');
  if (separator) lines.push(separator);
  if (!compact && settings.intro.trim()) lines.push('', settings.intro.trim());
  if (settings.hours.trim()) lines.push('', `HORARIO: ${settings.hours.trim()}`);
  for (const category of catalog.categories) {
    const dishes = available.filter(dish => dish.categoryId === category.id);
    if (!dishes.length) continue;
    lines.push('', `${compact ? '' : `${settings.categoryBullet.trim()} `}${category.name.toUpperCase()}`);
    for (const dish of dishes) {
      lines.push('', `${compact ? '- ' : `${settings.dishBullet.trim()} `}${dish.name} — ${qrMoney(dish.priceCents)}`);
      if (settings.includeDescriptions && dish.description.trim() && !omitted.has(dish.id)) lines.push(`  ${dish.description.trim()}`);
    }
  }
  if (!compact && separator) lines.push('', separator);
  if (!compact && settings.farewell.trim()) lines.push(settings.farewell.trim());
  return lines.join('\n');
}
function makeVCard(catalog: Catalog, settings: Settings, note: string) {
  const card = settings.offlineCard;
  const name = escapeVCardText(catalog.name);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${name}`, `N:;${name};;;`, `ORG:${name}`];
  if (card.phone.trim()) lines.push(`TEL;TYPE=WORK,VOICE:${escapeVCardText(card.phone.trim())}`);
  if (card.address.trim()) lines.push(`ADR;TYPE=WORK:;;${escapeVCardText(card.address.trim())};;;;`);
  if (settings.webUrl) lines.push(`URL:${settings.webUrl}`);
  lines.push(`NOTE:${escapeVCardText(note)}`, 'END:VCARD');
  return lines.map(foldVCardLine).join('\r\n') + '\r\n';
}
export function buildVCard(catalog: Catalog, rawSettings: Settings | Partial<Settings>, maxBytes = VCARD_QR_MAX_BYTES): VCardResult {
  const settings = normalizeSettings(rawSettings);
  const available = catalog.dishes.filter(dish => dish.available);
  const omitted = new Set<string>();
  const omittedInOrder: string[] = [];
  let compacted = false;
  let note = makeNote(catalog, settings.offlineCard, omitted, compacted);
  let payload = makeVCard(catalog, settings, note);
  const candidates = settings.offlineCard.includeDescriptions ? [...available].filter(dish => dish.description.trim()).sort((a, b) => textBytes(b.description) - textBytes(a.description)) : [];
  for (const dish of candidates) {
    if (textBytes(payload) <= maxBytes) break;
    omitted.add(dish.id);
    omittedInOrder.push(dish.id);
    note = makeNote(catalog, settings.offlineCard, omitted, compacted);
    payload = makeVCard(catalog, settings, note);
  }
  if (textBytes(payload) > maxBytes) {
    compacted = true;
    note = makeNote(catalog, settings.offlineCard, omitted, compacted);
    payload = makeVCard(catalog, settings, note);
  }
  const bytes = textBytes(payload);
  const longest = [...available].sort((a, b) => textBytes(`${b.name}${qrMoney(b.priceCents)}`) - textBytes(`${a.name}${qrMoney(a.priceCents)}`))[0];
  return { payload, note, bytes, remaining: Math.max(0, maxBytes - bytes), fits: available.length > 0 && bytes <= maxBytes, compacted, omittedDescriptions: omittedInOrder.map(dishId => available.find(dish => dish.id === dishId)!.name), offendingDish: bytes > maxBytes ? longest?.name || null : null };
}
