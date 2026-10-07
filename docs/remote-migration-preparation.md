# Preparación de migración remota — 3 de octubre de 2026

## Resultado actual: NO autorizar aún la ventana

Se implementaron herramientas locales y se verificó el destino en modo de lectura. **No se ejecutó el importador remoto, no se activó mantenimiento ni se cambió el tráfico.** Posteriormente, con autorización explícita, se publicaron únicamente reglas e índices; ver la sección 5. La candidata remota sigue siendo `22052178-361a-4546-9193-8cb47deb2f0c`; los cambios de código de esta preparación son locales y todavía no forman parte de esa versión.

| Paso solicitado | Evidencia |
| --- | --- |
| 1. Importador remoto | Implementado en `lib/firestore-remote-migration.ts`, con CLI en `scripts/firestore-remote-migrate.ts`; destino fijo, UUID, checksum y diario por documento. |
| 2. Mantenimiento | `lib/write-freeze.ts` y guardas iniciales de `fetch`/`scheduled` en el Worker. No configurado en ninguna versión remota. |
| 3. Ensayo | 28/28 pruebas de emulador, sin omisiones; 42 pruebas generales aprobadas y 17 separadas para emulador. TypeScript correcto. |
| 4. Reglas, índices, permisos | **VERDE**: reglas idénticas, 6/6 compuestos READY, 6/6 configuraciones de campo correctas, permiso exclusivo correcto. Ver sección 5. |
| 5. Inventario | 0 documentos, inventario recursivo con paginación y detección de subcolecciones sin padre. No se escribió ningún documento. |

Comprobación remota: `2026-10-03T22:07:41.955Z`. Recibo sin contenido personal: `work/migration-preparation/remote-readiness.json`. SHA-256 del inventario vacío: `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.

## 1. Flujo de importación preparado

1. Durante una futura ventana autorizada, obtener la copia FINAL cifrada con el origen congelado. No reutilizar el respaldo antiguo para un corte mientras D1 sigue recibiendo cambios.
2. Ejecutar el ensayo existente del respaldo en un emulador dedicado vacío. Debe terminar con `status=verified`, `serverTablesVerified=true` y checksum del origen. Se conserva la prohibición remota del importador anterior.
3. El modo `--prepare` lee ese emulador y genera un manifiesto cifrado Windows DPAPI CurrentUser, sin JSON privado en claro. Guardarlo bajo `work/`, excluido de Git. El archivo requiere el mismo perfil Windows para descifrarlo. No es una copia portable para recuperación ante pérdida del PC.
4. El manifiesto fija proyecto `qr-menu-6981a`, base `(default)`, UUID, checksum de origen y documentos tipados. Conserva timestamps, enteros, campos anidados y orden de listas. Orden: creador; restaurantes/configuración/membresías; catálogos/publicaciones; pedidos/índices; dominios; seguridad; auditoría/historial.
5. `--apply` exige autorización de ventana congelada, checksum completo y UUID exactos, identidad exclusiva Firestore en memoria, versión de mantenimiento al 100% y comprobación HTTP 503 de todos los hostnames inventariados. No hay un modo de ejecución remota implícito.
6. Antes de cada lote vuelve a comprobar mantenimiento. El destino debe estar vacío para iniciar; una reanudación solo admite documentos pertenecientes al manifiesto y sus registros de ejecución.
7. Cada lote crea hasta 40 documentos y sus 40 entradas de diario en el mismo commit con `exists=false`. La entrada contiene ruta y SHA-256 del contenido. Los hashes usados como identificadores se codifican en base64url sin separadores de ruta.
8. Una respuesta perdida se resuelve leyendo documento y diario, no repitiendo escrituras a ciegas. Datos diferentes, diario ausente, documento desconocido o checksum distinto detienen la ejecución.
9. Lectura final completa: contenido tipado de cada documento, diario y número exacto de documentos; solo entonces se marca `verified`. La comparación normaliza exclusivamente ceros fraccionarios insignificantes de timestamps (`.000Z` y `Z`), sin truncar precisión real.

El SHA-256 del manifiesto/diarios utiliza representación base64, como `digest` del proyecto; el checksum del origen preparado por el ensayo existente es hexadecimal. No confundir ambos argumentos.

No se extrae la clave guardada en Cloudflare ni se reutiliza Auth. La entrega en memoria ya está implementada mediante una clave temporal creada dentro del importador y eliminada en `finally`, sin argumentos, variables de entorno ni consola; permisos reales verificados, sin crear claves ahora. Procedimiento y límites: `maintenance-and-migration-credential.md`.

## 2. Alcance del mantenimiento

`MAINTENANCE_MODE` activa una respuesta 503 antes de resolver dominios, acceder a D1/Firestore, servir assets, autenticar, renovar sesiones o registrar auditoría. Bloquea todos los métodos y hosts que llegan al Worker, incluidos UUID, alias, dominios propios y Android WebView. `scheduled` retorna sin limpiar sesiones, generar respaldos, enviar correos ni despachar notificaciones.

No borra ni renueva cookies. Responde JSON a APIs y HTML sencillo a navegación web, con mensaje persistente, `Retry-After`, `Cache-Control: no-store` y `X-QRMenu-Maintenance: write-freeze-v1`. Se bloquea también lectura web durante esta ventana para evitar rutas GET con efectos secundarios. Una APK ya abierta puede mostrar contenido cacheado, pero sus operaciones de servidor reciben 503.

La guarda no controla accesos administrativos directos a Google/Cloudflare ni escrituras por SDK que eviten el Worker. Antes del corte: no permitir otras herramientas escritoras, comprobar reglas de cliente y pausar tareas externas. El preparativo no activa esta guarda; las reglas remotas se publicaron posteriormente con autorización separada. Las solicitudes ya en curso deben drenarse antes de tomar el respaldo final y verificar que el origen permanezca estable.

## 3. Reanudación y reversión verificadas

- Interrupción después de un lote: reanuda sin duplicar.
- Commit completado pero respuesta perdida: reconoce el diario atómico.
- Origen/checksum o destino modificado: rechaza sin sobrescribir.
- Destino ocupado, incluso documento con padre inexistente: rechaza antes de crear marcador.
- Pérdida de autorización/mantenimiento: cero escrituras nuevas o parada antes del siguiente lote.
- Reversión de la copia: verifica propiedad/checksum de TODOS los documentos antes de borrar; usa precondiciones de versión por documento. No borra documentos ajenos o alterados. Es reanudable después de una interrupción. Conserva un marcador `rolled-back`.

La reversión está implementada como función explícita `rollbackRemoteManifest`, no como limpieza automática ante error ni como botón expuesto al cliente. Su uso remoto necesitará autorización propia. No toca D1. Después de una reversión no se reinicia ignorando el marcador: se revisa el destino y se acuerda una nueva ejecución.

## 4. Verificación inicial y bloqueo histórico

`scripts/remote-migration-readiness.mjs` solo lee reglas, índices, IAM y documentos. En orden:

- Release `cloud.firestore`: no encontrado; no se puede acreditar que estén publicadas las reglas locales probadas.
- Índices compuestos esperados: faltan dos de `orders`, dos de `hostnames`, uno de `auditEvents` y uno de `notifications`.
- Configuraciones de campos: no coinciden las de `pushJobs.nextAttemptAt`, `pushDevices.tokenCiphertext`, `dishes.modifierGroups`, `dishes.description`, `lines.options` y `chunks.content`.
- Cuenta dedicada: habilitada y con único rol de proyecto `roles/datastore.user`, sin condición.
- Inventario completo: vacío. No es garantía de vacío en una fecha futura; el importador vuelve a comprobarlo antes de escribir.

La API de índices rechazó inicialmente `pageSize=100` y confirmó que admite únicamente el tamaño predeterminado; el lector ya utiliza ese valor y procesa cursores. No era un fallo de permisos ni motivo para crear índices automáticamente. Referencia del endpoint: https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.indexes/list

Este bloqueo inicial motivó la autorización separada para publicar únicamente reglas e índices revisados. La ventana de 60 minutos aún no está autorizada.

## 5. Publicación autorizada de configuración Firestore

Se ejecutó exclusivamente:

```powershell
node node_modules/firebase-tools/lib/bin/firebase.js deploy --only firestore:rules,firestore:indexes --project qr-menu-6981a --config firebase.preparation.json --non-interactive
```

Firebase confirmó compilación correcta y publicación de reglas e índices. La configuración usada no incluye Storage. No se ejecutó ningún importador, no se escribieron documentos remotos, no se modificó IAM ni se subió/activó el Worker.

- Reglas remotas idénticas a las locales (normalización CRLF/LF y espacios exteriores). SHA-256: `c03650abe7ad9774cc00ce747855bae7a12d11f9984868bd90032cf10fa72ab1`.
- Nueva ejecución de seguridad aislada: **8/8 pruebas aprobadas**, cero omitidas. Incluye aislamiento de dueños, membresías, escalamiento de privilegios, publicaciones, registros privados y notificaciones. Los datos de prueba se crearon exclusivamente en el emulador `demo-qr-menu-ec`.
- Comprobación remota sin sesión: **7/7 lecturas esperadas**. `publicMenus` devuelve 404 para un documento inexistente (consulta permitida); restaurantes, usuarios, rate limits, auditoría, hostnames y ajustes privados devuelven 403. No se intentaron escrituras de prueba remotas.
- Recibos locales sin secretos: `work/migration-preparation/remote-readiness.json` y `work/migration-preparation/publication-probes.json`. El primer recibo es una verificación de solo lectura; su contador `remoteWrites=0` no incluye la publicación de configuración realizada previamente por Firebase CLI.
- Cloudflare verificado: versión `62bff004-11c0-4fa7-9047-b5a26a9cc0f1` al 100%; candidata `22052178-361a-4546-9193-8cb47deb2f0c` al 0%; mantenimiento desactivado.

**Punto 4 VERDE**, comprobación final `2026-10-03T22:21:47.081Z` (17:21:47, Ecuador): seis índices compuestos en `READY`, ninguna construcción pendiente; seis configuraciones por campo correctas. `pushJobs.nextAttemptAt` tiene sus dos índices en `READY`; los otros cinco campos tienen indexación deshabilitada conforme al archivo autorizado. Inventario recursivo final: **0 documentos**, checksum vacío sin cambios. `remote-readiness.json` finaliza con `ready=true`.

| Colección | ID de índice compuesto | Estado |
| --- | --- | --- |
| orders | CICAgOjXh4EK | READY |
| orders | CICAgJiUpoMK | READY |
| hostnames | CICAgJiUpoMJ | READY |
| hostnames | CICAgJim14AK | READY |
| auditEvents | CICAgJjF9oIK | READY |
| notifications | CICAgOi3kJAK | READY |

Esto completa únicamente la publicación/verificación autorizada. No autoriza la ventana de migración, no acredita aceptación funcional contra datos migrados ni activa la candidata. Antes de migrar sigue siendo necesario preparar la versión de mantenimiento y la entrega segura de credenciales descritas arriba, con autorización correspondiente.

## 6. Preparación posterior de los dos requisitos operacionales

Con autorización posterior se creó la versión de mantenimiento exclusiva D1 `e6d9a9b6-66c3-476c-a586-2d5b72157a10` al 0%, sin congelar escrituras. Se implementó la entrega de credencial temporal en memoria y su eliminación verificada. **No usa el bundle local de migración ni recompila la aplicación activa:** es una barrera 503 mínima basada en la configuración y el binding D1 de producción. Procedimiento exacto, evidencias, reversión y límites en `maintenance-and-migration-credential.md`. Producción original al 100%, candidata Firestore al 0%. No hay autorización de ventana todavía.
