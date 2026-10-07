# Ventana del 4 de octubre de 2026 — abortada antes de migrar

## Resultado

Se cumplió la orden de detenerse y revertir ante un fallo. No se inició el respaldo final ni el importador. No se creó una credencial temporal.

1. **Verificación inicial correcta:** `62bff004-11c0-4fa7-9047-b5a26a9cc0f1` al 100%, candidata al 0%, mantenimiento desactivado. Lectura `2026-10-04T19:10:34.198Z`.
2. **Activación confirmada por la API:** `e6d9a9b6-66c3-476c-a586-2d5b72157a10` al 100%.
3. **Comprobación HTTP fallida:** `GET https://qr-menu-ec.consola.workers.dev/`, sin seguir redirecciones, devolvió **302** en lugar del **503** y marcador de mantenimiento requeridos. Se detuvo en la primera comprobación; no se afirma que los demás dominios estuvieran congelados.
4. **Reversión inmediata:** el mismo script restauró `62bff004-11c0-4fa7-9047-b5a26a9cc0f1` al 100%. Recibo de reversión `2026-10-04T19:12:09.221Z` (14:12:09 Ecuador), `work/migration-window-2026-10-04/rollback.json`.
5. **Verificación posterior:** a `2026-10-04T19:12:28.954Z`, producción original al 100%, candidata al 0%, mantenimiento desactivado. Las comprobaciones remotas de reglas siguen correctas.
6. **Inventario posterior:** a `2026-10-04T19:12:55.653Z`, Firestore conserva **0 documentos**, los seis índices compuestos siguen READY y las seis configuraciones por campo son correctas. No hubo migración parcial.

## Alcance del fallo

El 302 demuestra que no se había confirmado el mantenimiento efectivo en ese instante. No prueba por sí solo la causa: podría tratarse de propagación del despliegue, enrutamiento u otra condición. No se ha vuelto a activar mantenimiento para investigar, ni se ha cambiado el criterio de aceptación a redirecciones o respuestas 200.

La versión de mantenimiento no debe considerarse validada en vivo hasta diagnosticar esta diferencia. Antes de reintentar hay que resolverla y volver a coordinar la ventana. La candidata Firestore no fue activada y no se ejecutaron los pasos 4–8.

Herramienta operacional: `scripts/migration-window-control.mjs`. Incluye validación del ID y checksum de mantenimiento, comprobación de binding D1, inventario de dominios y reversión inmediata si falla la activación/verificación HTTP. No imprime secretos.
