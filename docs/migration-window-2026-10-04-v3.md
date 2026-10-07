# Ventana de migración 2026-10-04 — intento 3

## Resultado: revertido, no activar la candidata

El importador completó y verificó 734 documentos a las 20:45:55 UTC. La credencial temporal fue revocada a las 20:46:00 UTC. No se completó la aceptación funcional de la candidata ni la prueba física del Honor durante la ventana. El watchdog restauró automáticamente la versión D1 `62bff004-11c0-4fa7-9047-b5a26a9cc0f1` al 100% a las 21:29:48 UTC.

Al retomar el trabajo, el 2026-10-05 a las 00:21:47 UTC, se volvió a confirmar D1 al 100%. Ambos dominios responden HTTP 200 en `/owner`, sin cabecera de mantenimiento. La candidata `22052178-361a-4546-9193-8cb47deb2f0c` no fue activada.

## Evidencia del importador

- Run UUID: `a18d88bc-02e8-4c7e-b4eb-b5b3de1a491b`.
- Documentos de datos verificados: 734; verificación completa de inventario y diarios antes de marcar el run como `verified`.
- Checksum del manifiesto: `8u8z9K3hWDZ4zpLN0mluLa42EwukenNyzM1NyPn+e4w=`.
- SHA-256 del SQL final: `b84a092a9691b256d5e70c0c03477e8b7b59ed236063d994c679ad792cf58d6c`.
- SHA-256 del respaldo cifrado: `2e4a8b4df179317729030badd86fe374810cd02c6c6bbe1cbf51fc72392e5fa7`.
- Respaldo privado: `work/private-backups/2026-10-04T20-40-13.035Z-9e17c44e`.
- Recibos privados: `work/migration-window-2026-10-04-v3/rollback.json` y `work/migration-preparation/temporary-credential.json`.

## Condición para cualquier intento posterior

Las reglas normales `src/lib/firebase.rules` fueron restauradas correctamente después del cierre. A las 00:23:28 UTC del 2026-10-05 pasaron las siete sondas anónimas de acceso (menú público permitido; restaurantes, usuarios, rate limits, auditoría, hostnames y configuración privada rechazados). La misma comprobación confirmó D1 al 100%, candidata al 0% y mantenimiento desactivado. Evidencia: `work/migration-preparation/publication-probes.json`. Se detuvo el emulador aislado de esta ventana y se dejó el marcador de cierre del watchdog.

Firestore conserva la copia importada y sus diarios; no se borraron documentos. D1 volvió a aceptar escrituras después de la reversión, por lo que **no se debe activar esta copia sin una nueva conciliación contra un respaldo final reciente**. No asumir destino vacío ni reutilizar este manifiesto como si siguiera representando producción.

Primero preparar una vía aislada y comprobable para la aceptación completa de la candidata, incluida la sesión real en Honor. Después preparar conciliación reanudable con precondiciones, preservando datos ajenos y verificando diferencias; no sobrescribir ni purgar el destino a ciegas. La importación verificada no equivale a una migración de producción completada.
