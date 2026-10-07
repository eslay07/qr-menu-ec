# Segundo intento de migración — 4 de octubre de 2026

> Diagnóstico posterior sin nueva ventana: `importer-diagnosis-2026-10-04.md`. Se reprodujo rechazo OAuth transitorio de una clave recién creada y se corrigió con espera acotada; prueba remota solo lectura satisfactoria. No se ha reintentado la migración.

## Resultado: revertido, sin datos migrados

El mantenimiento se corrigió y verificó en vivo. El importador falló antes de crear documentos remotos. Se restauró producción D1 al 100%, se repusieron las reglas Firestore normales y se confirmó la eliminación de la clave temporal. La candidata no se activó.

## Diagnóstico del 302

La primera ronda tras recibir la confirmación de despliegue aún obtuvo respuestas de la aplicación anterior: 302 en raíz, 200/404 en otras rutas. Las siguientes tres rondas completas devolvieron 503 y ambos marcadores de mantenimiento. Esto confirma un intervalo de propagación entre el plano de control y los puntos que atendían las solicitudes; no era una redirección producida por el módulo de mantenimiento.

Corrección: comprobación acotada a 90 segundos, tres rondas consecutivas correctas en ambos dominios y todas las rutas antes de permitir respaldo/importación. Nunca se acepta un 302 como mantenimiento. Prueba automática de 302 transitorio y 302 persistente incluida. Nueva versión preparada y usada: `136e79e3-aee7-422c-a7ec-ae5d137f5147`; SHA-256 `83cdfda88bc13d1c97a4b9dfa37f1208772649ba436b932301c5f63c79546d4f`. Cinco pruebas de preparación aprobadas.

Mantenimiento verificado `2026-10-04T19:22:25.789Z`, recibo `work/migration-window-2026-10-04-v2/maintenance-verified.json`. Durante la ventana se publicaron reglas temporales que niegan accesos cliente a Firestore; se restauraron las reglas originales tras abortar.

## Respaldo final y ensayo

- Carpeta cifrada: `work/private-backups/2026-10-04T19-22-54.270Z-466e60a3`.
- SQL SHA-256: `b84a092a9691b256d5e70c0c03477e8b7b59ed236063d994c679ad792cf58d6c`.
- Archivo cifrado SHA-256: `e48948320d3f076e56bc54b8614f2038d2c50334d3a81a935b1e0033cfc65408`.
- Restauración verificada: 11 tablas, 16 imágenes. Fuente: 2 restaurantes, 7 pedidos, creador, 472 eventos de auditoría, 12 dispositivos y demás tablas auxiliares.
- Ensayo aislado y reanudación correctos; no emitió notificaciones históricas. Se utilizó un nuevo emulador loopback en 18985 porque 18385 estaba ocupado; no se borró ni reutilizó el entorno ajeno.
- UUID del ensayo/manifiesto: `4d27459b-d409-4b16-8d50-c0a6c09f7a92`.
- Manifiesto cifrado DPAPI: `work/migration-window-2026-10-04-v2/manifest.dpapi`, 734 documentos; checksum `INwSIstrxuO1fePDR/rt1IQIZygeDz1rQBq5Lbm9LO8=`.

## Fallo y reversión

El importador devolvió un error genérico y se detuvo. La salida disponible no permite atribuir con certeza la causa interna. No volver a intentar escrituras a ciegas: hace falta diagnóstico con etapas/códigos sanitizados y comprobación de lectura usando la identidad temporal antes de otro corte.

- Clave temporal eliminada y comprobada: recibo `work/migration-preparation/temporary-credential.json`, estado `revoked`, `2026-10-04T19:25:39.462Z`. No se eliminó la clave permanente de Cloudflare.
- D1 original restaurado al 100%: `2026-10-04T19:26:01.055Z`; ID `62bff004-11c0-4fa7-9047-b5a26a9cc0f1`.
- Reglas normales restauradas; seis índices READY y seis configuraciones por campo correctas.
- Inventario recursivo `2026-10-04T19:26:26.637Z`: **0 documentos**, checksum vacío `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`. No quedaron documentos parciales.
- Verificación de tráfico `2026-10-04T19:26:32.375Z`: original al 100%, candidata al 0%, mantenimiento desactivado.
- El Honor LNA-LX3 estaba conectado por ADB. No se ejecutó aceptación funcional de la candidata en el dispositivo: la importación no alcanzó ese paso.

Se canceló el temporizador de reversión de seguridad mediante su marcador de parada. El respaldo y manifiesto se conservan fuera de Git. Al haber reabierto D1, este manifiesto es evidencia de la ventana abortada, **no es válido como copia final de un próximo corte**: deberá generarse uno nuevo después de congelar nuevamente.
