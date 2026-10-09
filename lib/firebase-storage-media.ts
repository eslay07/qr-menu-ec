import { z } from 'zod';
import type { Store } from './store';
import { validateStoredImage } from './media-validation';

const uuid = z.string().check(z.uuid());
const mime = z.enum(['image/jpeg', 'image/png', 'image/webp']);
// The Firebase bucket is backed by Google Cloud Storage. Server IAM only;
// browser access remains denied, and all existing media URLs stay unchanged.
export class FirebaseStorageMedia implements Pick<Store, 'mediaGet' | 'mediaPut'> {
  constructor(private bucket: string, private restaurantId: string, private bearer: () => Promise<string>) {
    uuid.parse(restaurantId);
    if (!/^[a-z0-9][a-z0-9.-]{2,221}$/.test(bucket)) throw Error('Bucket inválido.');
  }
  private name(id: string) { return `restaurants/${this.restaurantId}/media/${uuid.parse(id)}`; }
  async mediaGet(id: string) {
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(this.name(id))}?alt=media`, { headers: { Authorization: `Bearer ${await this.bearer()}` }, signal: AbortSignal.timeout(15000) });
    if (response.status === 404) return null;
    if (!response.ok) throw Error('No se pudo leer la imagen.');
    const type = mime.parse(response.headers.get('Content-Type')?.split(';')[0]);
    const reader = response.body?.getReader();
    if (!reader) throw Error('Imagen vacía.');
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 1048576) { await reader.cancel(); throw Error('Imagen excesiva.'); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    validateStoredImage(bytes, type);
    return { bytes, type };
  }
  async mediaPut(id: string, bytes: Uint8Array, type: string) {
    mime.parse(type);
    validateStoredImage(bytes, type);
    const params = new URLSearchParams({ uploadType: 'media', name: this.name(id), ifGenerationMatch: '0' });
    const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?${params}`, { method: 'POST', headers: { Authorization: `Bearer ${await this.bearer()}`, 'Content-Type': type }, body: bytes as BodyInit, signal: AbortSignal.timeout(15000) });
    if (!response.ok && response.status !== 412) throw Error('No se pudo guardar la imagen.');
    const saved = await this.mediaGet(id);
    if (!saved || saved.type !== type || await byteHash(saved.bytes) !== await byteHash(bytes)) throw Error('Imagen existente diferente o verificación fallida; no se sobrescribió.');
  }
}
async function byteHash(bytes: Uint8Array) {
  // Binary-safe hash independent of filename or user content.
  const raw = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(raw), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function copyMediaVerified(ids: string[], source: Pick<Store, 'mediaGet'>, target: FirebaseStorageMedia) {
  for (const id of new Set(ids)) {
    const image = await source.mediaGet(id);
    if (!image) throw Error('Falta una imagen de origen.');
    await target.mediaPut(id, image.bytes, image.type);
  }
  return new Set(ids).size;
}
