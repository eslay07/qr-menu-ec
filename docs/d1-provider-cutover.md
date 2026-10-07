# D1 operativo y regreso a Firestore

Preparación autorizada el 05-10-2026. No confundir ensayos con activación.

## Arquitectura

`DATA_PROVIDER=d1-documents` utiliza el adaptador `D1DocumentStore` y un binding separado `DOCUMENT_DB`. `DB` conserva las fotos originales; no se toca la copia legacy ni se cambian React, TypeScript, Firebase Auth, el TOTP del creador o las cookies.

Las operaciones existentes de restaurantes, membresías, catálogo, pedidos, líneas, dominios, seguridad, avisos, push y respaldos comparten el contrato documental. El adaptador D1 implementa ese contrato sin pedir tokens de Firestore ni efectuar llamadas a Google. Los nombres históricos de algunos repositorios contienen “Firestore”, pero el proveedor lo decide el binding del adaptador, no la interfaz.

No hay fallback automático entre bases. Firestore y D1 nunca recibirán escrituras de negocio simultáneas desde producción. `DATA_PROVIDER=d1` sigue siendo el modo legacy: **no usarlo para este corte**, porque sus tablas contienen una copia antigua y no incluyen todas las funciones nuevas.

## Evidencia ya obtenida

- Base independiente `qr-menu-operational-documents`, identificador `0c8dab0c-5e79-4272-a28c-90b00a93e676`. Tablas e índices operativos nuevos; fotos intactas en la base anterior.
- Ocho pruebas SQLite: condiciones de revisión, rollback, cursores/aislamiento, instantánea coherente, 150 platos, WiFi cifrado, pedidos/restauración, sesiones/TOTP/rate limits y contrato FCM.
- Ensayo remoto con datos sintéticos: 150 platos creados/publicados, lectura pública, rollback atómico, pedido/cancelación y respaldo/restauración verificados. Datos sintéticos retirados; destino vacío.
- Ensayo adicional desde Worker real de Cloudflare: crear/publicar/leer 150 platos respondió 200. Worker temporal eliminado, datos de ensayo retirados y tráfico de producción intacto.
- Transferencia con UUID, checksum SHA-256 por documento y global, reanudación y rechazo de destinos modificados. Pruebas de interrupción y manipulación incluidas.

## Bloqueo de la fuente

### Lectura recuperada y copia completada — 6 de octubre de 2026

La cuota volvió a permitir lecturas. Se capturaron 1.601 documentos actuales, se cifraron fuera de Git y se verificó la restauración. Checksum del archivo cifrado: `dc68eefbb04ef8e01a7f5aee05f0712ab2ddb9c3aaaefc6e6657ec5a812c9f5f`. Recibo local: `work/d1-transition/source-receipt.json`.

Se archivaron fuera de Git dos eventos de auditoría del login público de la candidata y se retiraron exclusivamente esas filas con precondición de revisión. Ningún pedido ni catálogo fue eliminado. Luego se importaron los 1.601 documentos y se verificó cada documento y el manifiesto global: `22ae915d8335cb429f0385c33c4b661973bd630db9ab8f97cc3972d05076c2bc`. Ejecución: `fcf56bde-8905-481b-beda-44de3e06d88e`; recibo `work/d1-transition/import-verification.json`.

Esto es una copia preparatoria, no un corte: la fuente no se congeló, producción continúa intacta y los cambios posteriores deben conciliarse. La candidata vigente es `59cf7bb8-3b42-45fc-875c-417e65657fb4`, sin tráfico. Las 12 pruebas D1/transferencia pasan. Aceptación privada, Honor, push real y conciliación final siguen siendo requisitos antes de activarla.

### Continuación autorizada — 2026-10-06 04:55 UTC

La captura de lectura volvió a responder 429 `RESOURCE_EXHAUSTED`. No se ejecutó importación ni corte. La nueva candidata reconstruida es `59cf7bb8-3b42-45fc-875c-417e65657fb4`, con 0 % de tráfico; producción conserva `724862e7-0c75-4bdd-b01a-4067891f78fe` al 100 %. Evidencia: `work/d1-production-candidate/version.json`.

La conciliación ahora limita los lotes por bytes además de cantidad, valida tamaños antes de escribir y tiene un ensayo de interrupción/reanudación con altas, modificaciones y eliminaciones. Las cuatro pruebas de transferencia pasan. TypeScript, compilación web y empaquetado Worker en modo dry-run pasan. Suite general: 102 pruebas, 84 aprobadas, 18 omitidas por requerir emulador, ninguna fallida. La última ejecución dedicada del emulador aprobó sus 20 pruebas.

ADB no detectó dispositivos en esta comprobación. La aceptación física de esta candidata y la recepción push real siguen sin realizarse; las pruebas anteriores del Honor no sustituyen esta aceptación. El corte continúa condicionado a recuperar la lectura actual de Firestore y conciliarla, no a reutilizar respaldos antiguos.

La lectura administrativa actual también devuelve `429 RESOURCE_EXHAUSTED` en Firestore: GET de restaurante, listado y consulta. `scripts/prepare-d1-source.mjs` falló antes de escribir cualquier dato remoto. Sin una captura actual verificable no se ejecutará el corte: ni los 734 documentos de una copia anterior ni las tablas antiguas de D1 demuestran que contengan los últimos cambios.

No se compró un dominio ni se habilitó Blaze. La alternativa gratuita requiere recuperar una vez el acceso de lectura a Firestore para conciliar y dejar de depender de ella operativamente. El reinicio de cuota no se da por confirmado hasta que la lectura real funcione.

## Procedimiento cuando vuelva la lectura

### Conciliación preparatoria — 6 de octubre, 22:46 Ecuador

Nueva fuente cifrada: 1.615 documentos (archivo SHA-256 `b5df42cd6a8ff0112454b6b240446fb2755764d49318f4c3c6a3679423a28157`). La copia inicial de 1.601 queda identificada por `work/d1-transition/initial-source-receipt.json`; no reutilizar el recibo más reciente como base inicial.

Comparación de solo lectura de base, fuente y destino D1: 17 altas/modificaciones en la fuente, 1.672 documentos en D1 y propuesta combinada de 1.686 documentos. Los dos conflictos iniciales eran exclusivamente contadores `revision` de creador y restaurante histórico. El plan permite renovar esos dos contadores monótonos por encima de ambas ramas; cualquier conflicto de contenido sigue siendo rechazado. Cuatro pruebas del plan de combinación pasan y TypeScript pasa.

Plan resultante sin conflictos: checksum `60b29ea1adc31a55111f968010b8637fa9610a44af29398388aaa972e4a78b86`; evidencia `work/d1-transition/reconciliation-plan.json`. **No aplicado, sin congelación, sin activación.** Debe repetirse bajo congelación y validar permisos/relaciones de seguridad, no solo checksum. Conservar los cambios aprobados de la candidata, incluido dispositivo push y acceso; no conciliar usando solo la fuente contra el destino modificado.

1. `node --import tsx scripts/prepare-d1-source.mjs`: inventario completo en modo lectura; copia AES-256-GCM con clave protegida por DPAPI, fuera de Git, apertura y checksum verificados. No imprimir campos, correos, tokens ni secretos.
2. `node --import tsx scripts/import-d1-source.ts --import-isolated-copy`: copia preparatoria en el destino independiente, reanudable. Comprueba la versión de producción antes de cada lote; no activa el Worker. Registro por documento en `work/d1-transition/import-journal.json`.
3. Ensayar la candidata D1 con la copia: acceso dueño, TOTP creador, recuperación, cinco avisos, WiFi privado, pedido vacío, pedido/cancelación, QR UUID y fotos. Repetir acceso persistente y recepción push en Honor. Las configuraciones de prueba deben restaurarse; no crear pedidos ficticios entre pedidos reales.
4. Respaldar D1/fotos y la fuente documental; verificar restauración y checksums. Preparar mantenimiento basado en la versión activa y un rollback que use el proveedor correcto.
5. Congelar escrituras, comprobar 503 en todos los alias y detener tareas programadas. Capturar Firestore final y aplicar conciliación de tres vías (`reconcileDocuments`) contra la copia inicial. Si el destino fue modificado independientemente, detenerse: nunca sobrescribir silenciosamente.
6. Comprobar checksum de cada documento, cantidades por colección, referencias del catálogo, pedidos/líneas, credenciales cifradas intactas y alias. Solo entonces activar la candidata D1, retirar mantenimiento y repetir aceptación.
7. Conservar Firestore sin borrar y guardar el manifiesto de base. Tras cualquier escritura nueva en D1, volver a Firestore exige conciliación inversa; no basta activar la versión anterior.

`scripts/stage-production-push.mjs --stage-only --with-firebase-recovery --with-d1-documents` prepara únicamente una versión sin tráfico. Requiere bundle local actual; no hace migración ni despliegue.

## Volver a Firestore

### Verificación de continuidad — 6 de octubre de 2026 (UTC)

- Las 20 pruebas dedicadas de Firestore terminaron correctamente, sin omisiones. La suite general anterior terminó con 83 aprobadas y 18 omitidas por necesitar emulador; esas omisiones no se presentan como aprobaciones.
- Se actualizaron `oxfmt`, `basic-ftp` y `tinypool` a versiones corregidas compatibles. La auditoría completa pasó de dos vulnerabilidades críticas a ninguna, pero conserva 11 altas y 11 moderadas en herramientas de desarrollo: el control completo de seguridad todavía no está aprobado.
- Una nueva captura de la fuente real, exclusivamente de lectura, volvió a fallar con HTTP 429 `RESOURCE_EXHAUSTED`. Evidencia local: `work/d1-transition/source-blocker.json`. No se importaron datos, no se congelaron escrituras ni se activó una candidata.
- La versión de mantenimiento preparada es `4508207e-9a61-48d2-8e59-cffbd273977c`, sin tráfico. Sus cinco rutas de comprobación devolvieron 503 en el hostname de vista previa. Esto no equivale a una ventana de mantenimiento ejecutada.
- La candidata D1 debe reconstruirse después de estas actualizaciones de dependencias y completar aceptación contra una copia actual verificada. No usar una copia antigua para eludir el bloqueo de lectura de Firestore.

Exportar D1 operativo como documentos wire con manifiesto/checksums. Ensayar la conciliación contra una copia aislada de la base inicial Firestore; los conflictos se resuelven antes de la ventana. Durante el corte, congelar escrituras, hacer conciliación final con precondiciones y comprobar todos los datos. Cambiar después `DATA_PROVIDER=firestore`, manteniendo secretos, fotos y Auth. No crear IDs nuevos ni reinstalar la app por el cambio de base.

## Límites y mantenimiento

D1 Free también tiene cuotas. Conservar caché pública, sondeo limitado, índices y alertas de consumo. Los snapshots usan un contador monotónico incrementado en el mismo batch de escrituras; si cambia durante la captura, se reintenta o se rechaza el respaldo. Las condiciones de revisión fallidas abortan el batch completo. Las restauraciones extensas mantienen sus límites atómicos; no anunciar restauración ilimitada.

Las consultas nuevas deben utilizar parámetros, validar campos y probar diferencias de semántica respecto de Firestore. No pasar SQL del navegador ni permitir acceso directo a la base. Los documentos de negocio no son sustitutos de autorización: sesión, restaurante, roles y CSRF siguen comprobándose en el Worker.

Fuentes oficiales: [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [API parametrizada D1](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/), [cuotas y precios](https://developers.cloudflare.com/d1/platform/pricing/).
