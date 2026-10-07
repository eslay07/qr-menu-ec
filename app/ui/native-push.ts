type PushBridge = { postMessage(value: string): void; onmessage: ((event: { data: string }) => void) | null };
declare global { interface Window { qrmenuPush?: PushBridge } }
let pending = false;
export function nativePush(action: string, restaurantId?: string): Promise<{ token?: string; enabled?: boolean }> {
  return new Promise((resolve, reject) => {
    const bridge = window.qrmenuPush;
    if (!bridge || pending) { reject(Error('El servicio de notificaciones no está disponible.')); return; }
    pending = true;
    const finish = () => { pending = false; bridge.onmessage = null; clearTimeout(timer); };
    const timer = setTimeout(() => { finish(); reject(Error('La solicitud de notificaciones venció. Inténtalo de nuevo.')); }, 60_000);
    bridge.onmessage = event => {
      finish();
      try { const result = JSON.parse(event.data); if (result.error) reject(Error(result.error)); else resolve(result); }
      catch { reject(Error('Respuesta de notificaciones inválida.')); }
    };
    bridge.postMessage(JSON.stringify({ action, restaurantId }));
  });
}
