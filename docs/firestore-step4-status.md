# Migración Firestore — estado consolidado

## Entrega acotada — 02-10-2026

Tres funciones locales verificadas: validación visual del pedido (incluido alias), WiFi cifrado exclusivamente para impresión privada y cinco preferencias del dueño. Los formularios bloquean edición durante guardado; los conflictos conservan entradas y muestran foco en el error. La impresión bloquea clics duplicados durante la petición.

Verificación: TypeScript y compilación Worker correctos; 40 pruebas generales aprobadas y 11 separadas para emulador; emulador 20/20 sin omisiones; recorrido móvil de pedido aprobado con/sin movimiento reducido; nuevo recorrido `scripts/preferences-qa.mjs` aprobado con API simulada (persistencia/cifrado reales cubiertos por emulador). El servidor de este recorrido desactiva vigilancia de archivos para no escanear toolchains Android.

Honor LNA-LX3 detectado: APK instalada 0.8.0/11 abre tras cierre forzado. Usuario confirma que pide login tras desbloquear: no declarar persistencia aprobada. Corrección local de renovación no desplegada. Ver `owner-session-resume.md`.

Checklist preparado en `production-deployment-checklist.md`. Sin activación de producción, Storage ni push. Ensayo remoto y reconciliación de datos siguen siendo condiciones de corte, no se consideran hechos por pasar pruebas locales.

## Actualización vigente — 29-09-2026

Esta sección prevalece sobre las notas históricas siguientes. Firestore Standard `(default)` en `us-east1` creado tras confirmar inventario vacío; no se migraron datos ni se activó producción. Las fotos continúan en R2 y el Paso 5 queda aplazado expresamente.

Push: implementación local de cola atómica para las cinco clases de aviso, preferencias, tokens cifrados, registro autenticado con CSRF/rate limit, revocación al cerrar sesión, exclusión de restaurantes suspendidos, expiración, limpieza y reintentos. Web dispone de cliente modular y service worker empaquetado; Android, servicio FCM y puente restringido al origen HTTPS y marco principal. No se usa la WebView como sustituto de push nativo. Sigue desactivado por defecto; detalle de aceptación externa en `firestore-notifications.md`.

Verificación de esta continuación: 20/20 pruebas del emulador, incluidas las nuevas de cola y reglas privadas; validación móvil aprobada con y sin movimiento reducido; compilación Android debug correcta. VAPID generado y clave pública real guardada en `.env.local`, excluido de Git. ADB sigue sin teléfono. El registro real desde Google Chrome automatizado falla con `Registration failed - permission denied`, aunque el permiso de notificaciones figura concedido. No se declara recepción real verificada; detalle en `firestore-notifications.md`.

El ensayo remoto completo y el corte de producción no se consideran realizados por haber creado una base vacía. No se ha desplegado la versión de Cloudflare con la credencial FCM.

Auditoría del 29-09-2026: `npm audit --audit-level=high` termina con código 0, cero altas/críticas y **14 moderadas** (incluidas herramientas transitivas). Esta cifra sustituye la anterior de diez. No se aplicó `--force`, que propone cambios incompatibles. No se afirma ausencia total de vulnerabilidades.

## Continuación vigente — 28-09-2026

Esta sección sustituye el estado de las notas históricas inferiores. El usuario autorizó continuar al siguiente paso de migración; **no autorizó activar producción ni cambiar facturación**. Se inició Storage únicamente en código local, desactivado. FCM no está conectado.

Implementaciones añadidas y verificadas durante esta continuación:

- Importación reanudable con revisión, comparación completa de estado normalizado y pedidos, conciliación de inventarios y rechazo de origen/destino modificado. Tablas auxiliares incluyen permisos de sesiones/dispositivos, desafíos, auditoría, límites, dominios y marcas. Dominios conservan validación y reserva única. El registro privado del creador conserva TOTP y revisión. Comando de ensayo explícito: `scripts/firestore-migration-rehearsal.ts`; ver `migration-rehearsal.md`.
- Recolección de versiones de catálogo antiguas: retención de 30 días, protección de punteros y referencias de respaldos, precondiciones atómicas. Respaldos en preparación impiden purgar versiones.
- Cancelación del comensal con confirmación, origen comprobado, token opaco, caducidad, límite de intentos y actualización atómica. La interfaz deja de ofrecer QR/WhatsApp como pedido confirmado tras cancelar.
- Pruebas del Worker para redirecciones HTTPS, UUID, alias, prioridad y ausencia de bucles. Conservación del origen privado de administración.
- Sandbox Resend y reenvío manual auditado: payload cifrado, metadatos en panel del creador, idempotencia, rate limit y purga de registros vencidos. Falta el destinatario y secreto de una cuenta Resend de prueba para comprobar entrega real; no se inventan.
- Reportes: páginas de 50 pedidos, cursores ligados al restaurante y filtros, resumen del rango completo, CSV completo hasta 5.000 registros. Por encima exige acotar fechas: no devuelve un total parcial como completo. La lectura del resumen sigue acotada al rango, no es una agregación incremental.
- WiFi privado para impresión y cinco preferencias de notificaciones están conectados a API/Firestore/panel. No se confunden avisos internos con push real.
- Respaldos automáticos con checksum y ensayo aislado; ampliados para recuperar líneas ausentes e índices de enlaces aún vigentes. Consultar límites atómicos en `backup-drill.md`; no se promete restauración ilimitada.

Verificación final de esta continuación: **18/18 emulador**, **38 pruebas generales aprobadas / 10 separadas para emulador**, recorrido móvil de foco/scroll/repetición/movimiento reducido aprobado, TypeScript y compilación Worker correctos. El ensayo recuperó imagen, líneas faltantes y enlace vigente; el importador conserva también TOTP del creador. El recorrido visual ahora inicia y cierra su propio servidor temporal, sin depender de una terminal previa. No se cuentan pruebas omitidas como aprobadas. Auditoría npm: cero altas/críticas, diez moderadas transitivas en herramientas; no se aplicó `audit fix --force`.

Pendientes reales para declarar la migración total concluida: ensayo remoto autorizado con IAM específico, transferencia verificada de imágenes reales y corte final, configuración/prueba real de correo y push FCM. No se han creado esos permisos ni retirado D1/R2. Ver `storage-step5-status.md`. Las notas siguientes son historia del avance, no una lista actual de acciones ya repetidas.

El operador autorizó identidades separadas de Firestore/Storage/FCM. FCM obtuvo una identidad de un único permiso y una prueba `validate_only` satisfactoria; su secreto está en una versión no desplegada. Firestore tiene la API deshabilitada; Storage requiere Blaze y no se cambió facturación. Detalle y decisiones en `firebase-remote-credentials-status.md`. No se reutilizó ni amplió la cuenta técnica de Auth. FCM aún requiere implementación de entrega y registro de dispositivos: no es únicamente encender un flag.

---

## Historial de implementación

Actualizado: 2026-09-27. Este documento distingue código verificado de trabajo pendiente. **No se ha activado Firestore en producción, ni desplegado reglas/índices, ni cambiado IAM.** React + TypeScript, Storage y FCM permanecen intactos.

## Implementado localmente

### Respaldos conectados y límite externo de correo — 28-09-2026

Verificación tras esta integración: **17/17 pruebas del emulador aprobadas**; `npm test` **31 aprobadas y 9 omitidas** (ejecutadas en la suite separada de emulador); TypeScript y compilación Worker correctos. No equivale a certificar todavía todos los pendientes históricos ni entrega de correo real.

Se añadieron endpoints autenticados de listado/creación/restauración y política de programación exclusiva del creador. El cron usa la política privada de cada restaurante activo, no habilitada en producción. `scripts/backup-monthly-drill.mjs` pasó en emulador: catálogo y líneas recuperados coinciden y un fragmento alterado se rechaza. Procedimiento y límites en `backup-drill.md`.

`MAIL_DOMAIN` existe en `.env.local` (vacío deliberadamente) y `.env.example`; el servidor conserva EMAIL_FROM anterior si está vacío. El dominio workers.dev se rechaza como dominio de correo. Cloudflare requiere una zona propia administrable para Email Routing; no se puede configurar SPF/DKIM de consola.workers.dev. Ver `mail-domain-runbook.md` con registros, origen de claves/valores únicos y pasos exactos. No se activó servicio de correo ni DNS.

Este avance no elimina los restantes pendientes de migración reanudable, recolección segura de versiones, cancelación del comensal y cobertura integral del Worker. No se presenta el Paso 4 como terminado ni se borra su historial de pendientes.

### Verificación posterior — 28 de septiembre de 2026

- Corregido rechazo de renovación de dispositivo por longitud CSRF incorrecta. Ver `owner-session-resume.md`. No desplegado; ADB sin dispositivo.
- Resuelto timeout transaccional del emulador: `get` usa `batchGet` y `list` usa `runQuery` con el mismo identificador de transacción. No se sustituye por lecturas sin consistencia ni se incrementa el timeout. Referencia del fallo de GET transaccional: https://github.com/firebase/firebase-tools/issues/3293.
- Suite completa Firestore: **16/16 pasan**, incluyendo catálogo/restauración y las nuevas notificaciones. Extensión posterior del caso verifica también `restoreComplete`, catálogo de 150 platos y conservación del estado/total de pedidos; pasa aisladamente.
- `npm test`: **30 aprobadas, 8 omitidas por requerir emulador**, sin fallos. Esas pruebas de emulador se ejecutaron por separado. TypeScript y build del Worker correctos. El comando `test:firestore` incluye ahora notificaciones y ejecución serial para evitar que las reglas reinicien datos mientras otro archivo usa el emulador.
- Planes comerciales actualizados, con FCM y recuperación programada completa expresamente pendientes, sin vender funciones no disponibles. Recuperación manual del dueño registra solicitud y finalización sin secretos.

**No se declara completado el Paso 4.** Pendientes de integración y cobertura: automatización/ensayo mensual de respaldo integral, aislamiento y validación adicional de restauración, cancelación del comensal, migración reanudable, recolección de versiones y prueba integral de alias/redirecciones. DNS real requiere dominio y registros Resend del operador. No se ha activado producción, Storage o FCM.

### Entrega parcial de APK y revisión (2026-09-28)

El logcat del Honor conectado confirmó `SecurityException` por falta de `USE_BIOMETRIC`. Se generó y verificó la firma de `outputs/QR-Menu-EC-reapertura.apk`, sin publicar ni instalar: el teléfono dejó de estar conectado. Evidencia y SHA-256 en `android-reopen-fix.md`.

La continuación paralela se interrumpió por límite de uso. Quedaron guardadas bandeja de notificaciones, resumen paginado, pruebas dedicadas y script de comprobación DNS. TypeScript y las cuatro pruebas DNS pasan; las dos pruebas nuevas de notificaciones pasan. La ejecución conjunta de repositorios tuvo un timeout en la prueba de catálogo/restauración: no se considera toda la suite en verde hasta repetirla. La verificación DNS real requiere los registros exactos del dominio de envío: las pruebas no certifican SPF/DKIM de producción.

Siguen pendientes respaldo/restauración integral y automática, ensayo mensual aislado, importación reanudable, recolección de versiones, cancelación identificada como comensal, documentación comercial final y recorrido integral. No avanzar al Paso 5 ni activar producción.

### Avance de la continuación (2026-09-27)

- Seguridad auxiliar conectada a Firestore: sesiones, dispositivos, desafíos de un solo uso, límites de intentos y auditoría. Las pruebas usan un D1 que lanza error ante cualquier acceso para detectar dependencia accidental.
- Dominios y resolución del Worker con adaptador Firestore; reserva de alias por restaurante, prioridad y conservación de dirección gratuita. Transporte remoto preparado detrás de configuración explícita, desactivado por defecto. No se creó credencial Firestore ni se cambió IAM.
- Preferencias de notificación conectadas a interfaz y API autenticada, con revisión para evitar sobrescritura concurrente. Eventos de pedidos, agotados y tareas de resumen/inactividad incorporados; la integración completa y su cobertura siguen pendientes.
- WiFi opcional cifrado en `settings/general`. La API de configuración solo devuelve presencia de contraseña; su descifrado está restringido al endpoint autenticado de impresión. El QR y los enlaces no llevan la contraseña.
- Limpieza paginada de alias vencidos e índices de enlaces públicos, sin borrar pedidos reales. Prueba con 205 pedidos verifica que los primeros 200 ya anonimizados no impidan procesar los restantes.
- Listado de pedidos usa consultas filtradas y cursor interno, con límite explícito de búsqueda. Aún debe completarse la paginación externa de reportes y su cobertura.
- Corrección Android detallada en `android-reopen-fix.md`; APK debug compilada. Recorrido Playwright móvil verifica errores de pedido, foco, repetición y movimiento reducido. Falta prueba física en Honor X8d.

Verificación de esta continuación: reglas y repositorios **14/14 aprobados**, TypeScript correcto y repositorios **7/7 aprobados** después del ajuste de consultas, compilación Android correcta. Los pendientes de respaldo completo, importación reanudable, recolección de versiones y recorridos integrales aún impiden declarar el Paso 4 terminado.

### Base de partida (histórico anterior a esta continuación)

- Transporte REST exclusivamente para emulador loopback y proyectos `demo-*`. Rechaza el proyecto real y otros hosts. No solicita credenciales.
- `FirestoreRestaurantStore`: restaurantes, membresías vinculadas al UID real de Firebase, configuraciones y catálogos normalizados. Contraseñas heredadas/TOTP/correo cifrado quedan en un documento privado, nunca en el restaurante legible por el dueño.
- Categorías, platos y promociones en documentos independientes, orden estable; versiones privadas inmutables y publicación pública completa mediante commit atómico. Guardados con revisión y precondición `updateTime`.
- Reserva atómica de correo anonimizado; normalización Base64URL de hashes antiguos que contienen `/`.
- `ApplicationRepository`: controladores de creador y búsqueda de dueño seleccionan el repositorio; D1 sigue siendo el valor predeterminado. `cloudStore` selecciona el adaptador de carta. Worker selecciona el repositorio de pedidos.
- Pedidos separados de líneas; índice privado para conservar enlaces de reporte. Cancelación con precondición, límite de lectura y expiración pública comprobada en servidor.
- Repositorio de notificaciones internas y manifiestos de respaldos. Solo se añadieron reglas para leer notificaciones propias, cambiar su marca de lectura y consultar manifiestos propios.
- Respaldo local de datos de negocio en fragmentos privados, SHA-256, lectura posterior de verificación y detección de alteración. Restaurar borrador conserva acceso, dominio, identidad, publicación e historial. El contenido exportado incluye publicación y pedidos, pero aún no hay restauración completa de estos últimos.
- Importador local inyectable de restaurantes/pedidos que conserva UUID, revisiones y hashes de enlaces, registra progreso y verifica datos. Utilidad para importar filas de dominios, configuración global, auditoría, límites y marcas de migración; no consulta producción por sí misma.
- Índices preparados en archivo, no desplegados.

## Pendientes obligatorios para terminar el Paso 4

1. Persistencia de sesiones auxiliares, dispositivos, desafíos TOTP, rate limits y auditoría migrada localmente; ampliar recorridos API de extremo a extremo. El proveedor de identidad sigue siendo Firebase cuando está configurado.
2. Adaptadores añadidos para dominios/hostnames, Worker, tareas programadas, migración de correo y desafíos del creador. Pendiente auditoría integral de todas las rutas; los archivos conservan el proveedor D1/R2 hasta el Paso 5.
3. Transporte remoto de servidor añadido con configuración separada y desactivada por defecto. Pendiente ensayo autorizado futuro; no reutilizar la cuenta técnica Auth para Firestore sin autorización.
4. Conectar notificaciones y respaldos a los endpoints autenticados existentes; actualmente son repositorios probados, no funciones completas de interfaz. Integrar exportación/restauración completa con verificación de imágenes, publicación e historial.
5. Reemplazar el escaneo acotado de pedidos y listado administrativo por consultas/cursors indexados; probar paginación, reportes y búsquedas completas. Probar consistencia del respaldo frente a pedidos concurrentes.
6. Recolectar versiones privadas huérfanas de intentos fallidos, preservando versiones publicadas y referenciadas por respaldos. La preparación de versiones no altera el puntero vigente, pero todavía no tiene recolección automática.
7. Implementar importador reanudable desde una exportación D1 aprobada, reconciliación completa y ensayo de reversión. La utilidad actual exige destino vacío y no migra credenciales, sesiones ni archivos.
8. Añadir recorridos completos API/Worker y pruebas de seguridad de la persistencia restante. Revisar coherencia de las escrituras directas que permiten las reglas existentes frente a las revisiones del servidor, sin sustituir las reglas aprobadas.

## Imágenes / alcance del respaldo

Los bytes siguen en el proveedor D1/R2 existente. No se modificó Firebase Storage. Los manifiestos tienen `mediaBridgeRequired: true`: **no son respaldos autosuficientes de imágenes**. No retirar D1/R2 ni ofrecer restauración total desde estos manifiestos hasta terminar la verificación de archivos y el Paso 5 correspondiente.

## Pruebas

`npm run test:firestore` inicia un emulador independiente configurado en `firebase.step4.json`. No usar el proyecto real. Si un puerto está ocupado, identificar su proceso antes de cerrar nada; un emulador ya confirmado se puede reutilizar estableciendo `FIRESTORE_EMULATOR_HOST` solo para el proceso de prueba.

Las pruebas comprueban 150 platos, separación de privados, membresías, UUID, revisiones, conflictos, reserva de correo, publicación, precios históricos, cancelación concurrente, aislamiento, expiración, notificaciones, respaldo alterado e importación con revisión existente. `npm test` omite la prueba de repositorios sin emulador; no contar ese omitido como prueba Firestore aprobada.

Última ejecución: `npm run test:firestore` 9/9 aprobadas; `npm test` 25 aprobadas y 1 omitida (emulador); `npm run check` y `npm run build:worker` correctos. Ninguna de estas comprobaciones prueba todavía la eliminación completa de D1.

## Referencias técnicas

Consultadas el 2026-09-27: [REST de Firestore](https://firebase.google.com/docs/firestore/use-rest-api), [transacciones y escrituras atómicas](https://firebase.google.com/docs/firestore/manage-data/transactions), [límites de Firestore](https://firebase.google.com/docs/firestore/quotas).

No iniciar el Paso 5 hasta terminar los pendientes y recibir confirmación del usuario.
