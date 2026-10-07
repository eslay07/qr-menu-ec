# Resultados del checklist secuencial

Orden autorizado: 1) versión/SHA-256; 2) respaldo D1/R2; 3) ensayo aislado; 4) variables Firestore; 5) FCM desactivado. Detenerse después de cada paso y no activar despliegues nuevos hasta confirmar los cinco.

## Paso 1 — confirmado

Consulta de solo lectura realizada el 2 de octubre de 2026, 22:31:30 Ecuador (2026-10-03T03:31:30.253Z).

- Worker: `qr-menu-ec`.
- Versión vigente: `62bff004-11c0-4fa7-9047-b5a26a9cc0f1`, 100% del tráfico.
- Deployment: `1def384e-ef56-482e-983a-3108e0b33d12`.
- Etiqueta: `session-loading-fix`.
- Módulo descargado y verificado: `worker.js`, 2.090.109 bytes.
- SHA-256: `92632b8d50bcf40b5502d816a1aa7714e0d2a60f9b275c27aed32695d1fade06`.

Se comprobó que la versión más reciente coincide con la activa y que ambas permanecieron iguales antes y después de calcular el hash. Script reproducible: `node scripts/production-worker-baseline.mjs`. No imprime credenciales ni guarda el código descargado.

El checksum identifica el módulo del Worker, no sus assets estáticos, la APK ni los datos D1/R2. No sustituye el respaldo del paso 2. No se modificó producción.

## Paso 2 — confirmado; R2 no aplica

Ejecutado el 2 de octubre de 2026, 22:51 Ecuador. Exportación SQL nativa D1 completa, sin filtros de tablas o datos. La tabla interna administrada `_cf_KV` no forma parte del dump nativo; se verificó presencia de las 11 tablas de aplicación. Incluye 7 pedidos y 16 imágenes BLOB en `media`.

Carpeta local excluida de Git mediante `/work/` (comprobado con `git check-ignore`):

`work/private-backups/2026-10-03T03-51-43.335Z-81a5ac0b/`

Archivos: `d1-backup.aes256gcm`, `key.dpapi` y `verification.json`. El SQL y la clave AES nunca se escribieron en claro. Archivo cifrado con AES-256-GCM, IV aleatorio y etiqueta autenticada; clave aleatoria de 256 bits protegida por Windows DPAPI CurrentUser.

Checksums SHA-256 confirmados:

| Contenido | SHA-256 |
| --- | --- |
| SQL D1 dentro del archivo cifrado | `e0f62e0a366ec0657f952a4233f0b2c87d691340e081fd70ed2884ecc8142897` |
| Archivo cifrado | `f11386540b375b4c08cb69b4c8c024d68db04a7b75ff7cb43c6115577989d992` |
| Inventario de tablas, imágenes D1 y estado R2 | `8d3471248e7eaaa013cd1ee0b5d2fbaf18b338b7e7c7739697038a41f68892f0` |
| Clave protegida DPAPI | `06598caea41a8949ac7504bcc0de33eb9a521eb68152353f96338d0230c1ac1a` |

Restauración repetida en un proceso independiente, partiendo exclusivamente de los archivos cifrados guardados: descifrado autenticado, SHA-256 SQL, importación a SQLite en memoria, comparación de esquema/contenido completo de las 11 tablas, integridad `ok`, claves foráneas sin errores y hashes de las 16 imágenes correctos. Ninguna restauración remota ni dato de producción modificado. No es el ensayo Firestore del paso 3.

Repetir desde la raíz del proyecto con el usuario Windows que creó el respaldo:

```powershell
node scripts/verify-encrypted-backup.mjs 'work/private-backups/2026-10-03T03-51-43.335Z-81a5ac0b'
```

DPAPI impide descifrar desde otra identidad (incluido el sandbox); se verificó correctamente con el usuario real. **Conservar el perfil/credenciales Windows y los tres archivos. Esta copia todavía no es portable a otro PC ni protege contra pérdida de ese perfil**: antes de una política de recuperación ante desastre hay que envolver/exportar la clave mediante un mecanismo de recuperación independiente acordado, sin guardarla en claro. Los secretos de aplicación alojados en Cloudflare, como `DATA_ENCRYPTION_KEY`, no son parte de un dump D1 y deben conservarse para descifrar los campos de aplicación tras una restauración.

### Aclaración R2 confirmada por el operador

El Worker activo no tiene bindings `r2_bucket`. La API de listado de buckets devuelve `403 / 10042: Please enable R2 through the Cloudflare Dashboard.` No se habilitó R2 ni se cambió facturación. No afirmar inventario vacío verificado ni fabricar checksums R2: no fue posible listar objetos. Las 16 imágenes reales incluidas en esta copia provienen de D1.

El operador confirmó que R2 nunca se activó, no existe bucket que respaldar y las 16 imágenes D1 son todas las existentes. Paso 2 aceptado. Se conserva el recibo original sin modificarlo: su `r2Verified: false` significa que no se verificó R2, no un respaldo D1 incompleto.

## Paso 3 — ensayo aislado verificado

Finalizado el 2 de octubre de 2026, 23:01:38 Ecuador (`2026-10-03T04:01:38.084Z`). Proyecto ficticio `demo-qr-menu-migration`, emulador Standard en `127.0.0.1:18385`; no se usaron credenciales ni endpoints remotos. El ejecutor bloquea solicitudes fuera de ese origen loopback.

- Origen: el mismo respaldo cifrado aprobado del paso 2, descifrado y restaurado solo en memoria. Las 11 tablas y las 16 imágenes se volvieron a verificar antes de importar.
- RUN_UUID: `dc89654c-ac5b-48d6-870c-9f18094cc9d0`.
- SHA-256 de la exportación lógica generada en memoria: `89310e98402fef2834d26e1d03bdb82e9e1105ea738d0c5b71714c212df8f7f1`.
- Verificados: 2 restaurantes completos (incluidos borrador, publicación, configuración y acceso), 7 pedidos con líneas e índices privados, y el registro privado del creador.
- Ocho tablas auxiliares: 1 hostname, 462 eventos de auditoría, 58 sesiones, 12 dispositivos y 1 marcador histórico de seguridad; configuración global de dominio, límites y desafíos estaban vacíos.
- Segunda ejecución con el mismo checksum y UUID: correcta, sin duplicar registros ni sobrescribir diferencias. Marcador final `verified`.
- No se emitieron notificaciones por pedidos históricos. Las imágenes no se copiaron a Firestore: permanecen en D1, con sus 16 checksums verificados.
- `npm run check`: correcto.
- Emulador dedicado cerrado después de verificar su PID y argumentos; sus datos temporales en memoria se descartaron, sin exportarlos a disco.

Recibo sin contenido personal: `work/private-backups/2026-10-03T03-51-43.335Z-81a5ac0b/migration-dc89654c-ac5b-48d6-870c-9f18094cc9d0.json`. No se generó un JSON/SQL descifrado en disco. El ensayo comprueba fidelidad de datos y reanudación; no equivale a un despliegue, prueba de reglas o corte remoto. No se activó producción. Pasos 4 y 5 esperan confirmación.

## Pasos 4 y 5 — inspeccionados, no aprobados

Consulta de solo lectura: `2026-10-03T04:09:35.043Z` (2 de octubre, 23:09 Ecuador), mediante `scripts/production-config-check.mjs`. Se inspeccionaron los bindings de la versión con el 100% del tráfico, comprobando que el deployment no cambió durante la consulta. No se imprimieron valores ni secretos.

| Configuración | Resultado en producción activa |
| --- | --- |
| `DATA_PROVIDER` | Ausente |
| `FIRESTORE_PROJECT_ID` | Ausente |
| `FIRESTORE_REMOTE_ENABLED` | Ausente |
| `FIRESTORE_SERVICE_ACCOUNT` | Secreto ausente |
| `FCM_ENABLED` | Ausente; no cumple declaración explícita solicitada |
| `VITE_FCM_ENABLED` | Valor de compilación no confirmado |

`VITE_FCM_ENABLED` se sustituye al compilar Vite: comprobar un binding del Worker no prueba cómo se compiló el navegador. El entrypoint JS publicado no contiene el indicador ni las referencias de registro push buscadas; eso no acredita un valor explícito de compilación. Tampoco se encontraron esas referencias en el snapshot usado para el hotfix de sesión. La configuración local/candidata no demuestra la configuración publicada.

Los secretos de Cloudflare no se pueden leer mediante sus metadatos. Si existiera el binding, aún haría falta evidencia adicional para validar su contenido y permisos; en esta consulta está ausente. No se creó ni modificó ningún binding, secret, artefacto, versión o despliegue. Detener el checklist: estos pasos no habilitan producción.

## Preparación de candidata — bloqueo de identidad Firestore

Tras autorización para configurar exclusivamente una candidata, se compiló `npm run build:worker` con la variable de proceso `VITE_FCM_ENABLED` desactivada explícitamente (prioridad sobre archivos de entorno). Compilación correcta; artefacto local `dist-worker/assets/index-bxRa-bJU.js`. Esto no cambia el frontend publicado.

Se consultó IAM sin modificar permisos: la cuenta técnica del Paso 3 de Auth tiene exclusivamente el rol de proyecto Firebase Authentication Admin. No es una credencial válida para operar Firestore bajo ese alcance. El secreto Auth tampoco puede extraerse de Cloudflare para copiar su valor. No reutilizarlo ni ampliar su rol silenciosamente.

La consulta de existencia de una cuenta separada Firestore falló en el cliente/API con estado 500; no se concluye que la cuenta exista o no exista. Se requiere resolver esa consulta y confirmar el uso de una identidad separada con permisos mínimos Firestore antes de aprovisionar el secreto. No se subió una candidata incompleta, no se modificaron variables/secrets de Cloudflare ni se cambió el tráfico activo.

## Cuenta Firestore creada y verificada — 3 de octubre de 2026

Autorización específica: crear identidad separada con Cloud Datastore User, sin tocar Auth y sin subir candidata. El intento anterior fue rechazado por indisponibilidad del revisor de permisos y no ejecutó acciones remotas. En esta continuación, Google aceptó creación y asignación; la primera lectura de verificación devolvió 404. Una segunda ejecución exclusivamente de lectura confirmó cuenta habilitada, rol exacto y cero claves administradas por el usuario.

- Cuenta: `qrmenu-firestore-worker@qr-menu-6981a.iam.gserviceaccount.com`.
- Único rol de proyecto asignado a esta identidad: `roles/datastore.user` (Cloud Datastore User), sin condición.
- No se asignaron roles Auth, Storage, FCM ni IAM. Los roles de la cuenta Auth no se modificaron.
- Sin claves generadas; `FIRESTORE_SERVICE_ACCOUNT` todavía no guardado. Cloudflare, tráfico activo y datos de producción no se modificaron.
- Verificación reproducible, solo lectura: `node scripts/provision-firestore-identity.mjs --verify`.

Permisos exactos devueltos por la definición del rol en esta verificación:

```text
appengine.applications.get
databasesconsole.locations.get
databasesconsole.locations.list
databasesconsole.studioQueries.create
databasesconsole.studioQueries.delete
databasesconsole.studioQueries.search
databasesconsole.studioQueries.update
datastore.databases.get
datastore.databases.getMetadata
datastore.databases.list
datastore.entities.allocateIds
datastore.entities.create
datastore.entities.delete
datastore.entities.get
datastore.entities.list
datastore.entities.update
datastore.namespaces.get
datastore.namespaces.list
datastore.schemas.list
datastore.statistics.get
datastore.statistics.list
resourcemanager.projects.get
resourcemanager.projects.list
```

El rol predefinido solicitado incluye metadatos de proyecto/App Engine y funciones de consultas de consola; no es literalmente un rol formado solo por operaciones `datastore.entities`. No se añadieron permisos fuera de ese rol. Su definición es administrada por Google y puede cambiar.

**Pausa antes del secreto:** en Cloudflare, guardar un secreto versionado crea una nueva versión de Worker aunque no le asigne tráfico. La restricción vigente de no subir candidata impide hacerlo todavía. Se requiere confirmar permiso para crear esa versión no desplegada antes de generar la clave y guardarla exclusivamente como secreto; no guardar una clave en claro ni reutilizar Auth.

## Secreto Firestore en versión no desplegada — confirmado, 3 de octubre de 2026

El operador autorizó expresamente crear una versión sin desplegar, únicamente para guardar el secreto. Esta autorización resuelve la pausa anterior, pero no autoriza publicar código ni activar Firestore.

- `FIRESTORE_SERVICE_ACCOUNT`: guardado como `secret_text` y presencia verificada.
- Versión creada: `7c506d5f-14a3-4a35-9be8-4d7fb778c7a2`, sin despliegue y con 0% del tráfico.
- Versión activa anterior: `62bff004-11c0-4fa7-9047-b5a26a9cc0f1`, conservada al 100%.
- Inventario de deployments idéntico antes/después; todos los demás bindings idénticos.
- Clave nueva de la cuenta exclusiva Firestore validada mediante una lectura de metadatos de la base, sin lecturas de registros de clientes ni escrituras de datos.
- Secreto transmitido en memoria por stdin a `wrangler versions secret bulk`; no se imprimió ni escribió en archivos locales/Git.
- No se modificó la cuenta Auth, no se cambiaron variables, no se publicó el build local ni se ejecutó `versions deploy`.

Ejecutor de esta operación: `scripts/stage-firestore-secret.mjs`. Sus controles impiden generar otra clave si ya existe una y exigen que la última versión coincida con la activa antes de crear una nueva; no volver a ejecutarlo sobre esta candidata. Este resultado confirma únicamente el secreto en la versión sin tráfico; la configuración completa y activación quedan fuera de este paso. Detenido a la espera de confirmación.

## Candidata con configuración y build actualizados — 3 de octubre de 2026

Autorizado completar la configuración y subir el build local, sin darle tráfico. Las versiones Cloudflare son inmutables: `7c506d5f` se conservó y se creó su sucesora `22052178-361a-4546-9193-8cb47deb2f0c`.

Verificación remota final: `2026-10-03T12:56:22.996Z`.

- `DATA_PROVIDER`, `FIRESTORE_PROJECT_ID`, `FIRESTORE_REMOTE_ENABLED`, `FCM_ENABLED`: presentes y coinciden con la configuración solicitada; valores no incluidos en el recibo.
- `FIRESTORE_SERVICE_ACCOUNT`: presente como secreto heredado de la candidata anterior; no se extrajo ni se regeneró.
- Los demás bindings permanecen idénticos a los de la candidata anterior.
- Frontend recompilado con FCM desactivado explícitamente. Se comprobó que el bundle contiene el mensaje de desactivación y no contiene registro `push/device` ni una referencia sin resolver a `VITE_FCM_ENABLED`.
- `npm run check`, build web y compilación Worker `--dry-run`: correctos. La compilación Worker requirió permisos de lectura fuera del sandbox; no hizo despliegue.
- Subidos Worker actual y 30 assets mediante una nueva versión, sin desplegar. Worker descargado posteriormente coincide por SHA-256 con el compilado local.
- Producción conserva `62bff004-11c0-4fa7-9047-b5a26a9cc0f1` al 100%; candidata nueva al 0%. Inventario de deployments idéntico antes/después.

Checksums:

| Artefacto | SHA-256 |
| --- | --- |
| Worker | `0735e1ce5be7c2aab10b5a944096966a1bda02151126c503eef132faff34e485` |
| Entry JS navegador | `7ca9984b970e29cb0c7b388dcc44ee45fd74792142eb9db54a219782c72e22c1` |
| Manifiesto de assets aceptado | `e3b2b2dbd000f65b1ffd5b89ed9e7e73d3e69e069ba789db81af5c8bc4d82f4e` |

Cloudflare rechazó los primeros intentos de creación por enviar simultáneamente `serve_directly` (metadato interno de lectura) y `run_worker_first` (opción de subida). Se corrigió el traductor de metadatos; esos intentos no crearon versiones ni cambiaron tráfico. Script: `scripts/complete-firestore-candidate.mjs`; recibo local sin secretos: `work/candidate-complete/verification.json`.

**Detenido:** esto confirma configuración y artefactos subidos, no aceptación funcional ni migración remota de datos. No se invocó la candidata contra datos reales ni se activó. Se espera confirmación para continuar.

## Preparación autorizada sin migrar — 3 de octubre de 2026

Implementados localmente importador remoto con diario atómico por documento y modo mantenimiento temprano, sin subir ni activar estos cambios. Ensayos finales: 28/28 emulador, sin omisiones; 42 pruebas generales aprobadas, 17 que se ejecutan por separado con emulador; TypeScript correcto. Los ensayos detectaron y permitieron corregir codificación de IDs del diario y normalización no destructiva de timestamps. Detalle operativo: `remote-migration-preparation.md`.

Lectura remota `2026-10-03T22:07:41.955Z`: sin release de reglas publicado, faltan 6 índices compuestos y 6 configuraciones de campos; IAM de la cuenta exclusiva correcto. Inventario recursivo vacío (0 documentos), checksum `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`. No se escribieron documentos, reglas o índices remotos. No procede marcar los cinco puntos en verde.

Lectura posterior de Cloudflare: `62bff004-11c0-4fa7-9047-b5a26a9cc0f1` sigue al 100%, mantenimiento desactivado y candidata `22052178-361a-4546-9193-8cb47deb2f0c` al 0%. Detenido antes de la ventana de migración: se requiere autorización para publicar la configuración Firestore ausente y repetir la verificación.

## Publicación autorizada de reglas e índices — punto 4 VERDE

Autorización posterior limitada a configuración, ejecutada con `--only firestore:rules,firestore:indexes` y `firebase.preparation.json`. No se tocó Storage, Worker, tráfico, mantenimiento ni datos.

Verificación final: `2026-10-03T22:21:47.081Z`. Reglas activas idénticas al archivo local, SHA-256 `c03650abe7ad9774cc00ce747855bae7a12d11f9984868bd90032cf10fa72ab1`. Seis índices compuestos **READY** (no en construcción), seis configuraciones por campo correctas. Cuenta exclusiva conserva únicamente `roles/datastore.user`. Inventario recursivo **0 documentos**, SHA-256 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.

Pruebas repetidas: **8/8** reglas en emulador aislado, cero omitidas; **7/7** lecturas anónimas remotas con resultado esperado (404 menú público inexistente, 403 rutas privadas). No se crearon documentos de prueba remotos. Recibos: `work/migration-preparation/remote-readiness.json`, `work/migration-preparation/publication-probes.json`; detalle e IDs de índices en `remote-migration-preparation.md`.

Producción comprobada intacta: versión `62bff004-11c0-4fa7-9047-b5a26a9cc0f1` al 100%, candidata `22052178-361a-4546-9193-8cb47deb2f0c` al 0%, mantenimiento desactivado. Se detiene aquí, sin iniciar migración ni ventana de congelación.
