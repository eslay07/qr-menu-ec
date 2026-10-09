import type { ApiResult } from './api-types';
import { nativePush } from './native-push';
export function restaurantBase(){if(typeof location==='undefined')return '';const match=location.pathname.match(/^\/r\/([a-f0-9-]{36})(?:\/|$)/);if(match)return `/r/${match[1]}`;const alias=location.pathname.match(/^\/m\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/);return alias?`/m/${alias[1]}`:'';}
let csrfToken='';
const pendingReads = new Map<string, ReturnType<typeof request>>();
export async function api<P extends string>(path: P, method = 'GET', data?: unknown): Promise<ApiResult<P>> {
  const key = `${restaurantBase()}/api/v1/${path}`;
  if (method !== 'GET' || data !== undefined) {
    // In-flight reads from before a mutation cannot be reused after it.
    pendingReads.clear();
    return await request(path, method, data) as ApiResult<P>;
  }
  let pending = pendingReads.get(key);
  if (!pending) {
    pending = request(path, method, data).finally(() => { if (pendingReads.get(key) === pending) pendingReads.delete(key); });
    pendingReads.set(key, pending);
  }
  // Do not share mutable private state between callers; no persistent cache.
  return structuredClone(await pending) as ApiResult<P>;
}
async function request(path: string, method: string, data?: unknown) {
  const headers: Record<string, string> = data === undefined ? {} : { 'Content-Type': 'application/json' };
  if (!['GET', 'HEAD'].includes(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(`${restaurantBase()}/api/v1/${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json() as { csrfToken?: string; error?: string };
  if (result?.csrfToken) csrfToken = result.csrfToken;
  if (!response.ok) {
    const error = Error(result.error || 'No se pudo completar la operación.') as Error & { status?: number; details?: unknown };
    error.status = response.status; error.details = result; throw error;
  }
  if (path === 'logout' && method === 'POST') {
    csrfToken = '';
    try { localStorage.removeItem('qrmenu-push-enabled'); } catch { /* Optional preference storage. */ }
    try {
      if ('serviceWorker' in navigator) (await navigator.serviceWorker.getRegistration('/'))?.active?.postMessage({ type: 'push-preference', restaurantId: null });
      if (window.qrmenuPush) void nativePush('disable').catch(() => undefined);
    } catch { /* Server has revoked subscriptions; local cleanup never blocks logout. */ }
  }
  return result;
}
export function download(name:string,data:string,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
export async function uploadPhoto(file: File) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15_000_000)
    throw Error('Elige una foto JPG, PNG o WebP de hasta 15 MB.');
  const image = await createImageBitmap(file);
  try {
    if (!image.width || !image.height || image.width * image.height > 40_000_000)
      throw Error('La imagen es demasiado grande. Elige una de menos de 40 megapíxeles.');
    const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('No se pudo preparar la foto.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [.82, .7, .55, .4]) {
      blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 1_000_000) break;
    }
    if (!blob || blob.size > 1_000_000) throw Error('No se pudo reducir la foto. Prueba una imagen más pequeña.');
    const headers: Record<string, string> = { 'Content-Type': 'image/jpeg' };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const response = await fetch(`${restaurantBase()}/api/v1/media`, { method: 'POST', headers, body: blob });
    const result = await response.json() as {url:string;error?:string};
    if (!response.ok) throw Error(result.error || 'No se pudo subir la foto. Vuelve a intentar.');
    return result.url as string;
  } finally { image.close(); }
}
