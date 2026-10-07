export type MaintenanceEnv = { MAINTENANCE_MODE?: string };
export function writesFrozen(env: MaintenanceEnv) { return env.MAINTENANCE_MODE === 'true'; }
export function maintenanceResponse(request: Request): Response {
  const json = new URL(request.url).pathname.includes('/api/') || !(request.headers.get('Accept') || '').includes('text/html');
  const message = 'Estamos realizando mantenimiento. Tu información está guardada. Intenta nuevamente en unos minutos.';
  const body = json ? JSON.stringify({ error: message, code: 'MAINTENANCE', retryAfter: 60 })
    : `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mantenimiento · QR Menu EC</title><body><main><h1>Mantenimiento temporal</h1><p role="status">${message}</p><p>No necesitas cerrar sesión ni volver a introducir tu contraseña.</p><a href="">Volver a intentar</a></main></body></html>`;
  return new Response(request.method === 'HEAD' ? null : body, { status: 503, headers: {
    'Content-Type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store', 'Retry-After': '60', 'X-QRMenu-Maintenance': 'write-freeze-v1',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  } });
}
