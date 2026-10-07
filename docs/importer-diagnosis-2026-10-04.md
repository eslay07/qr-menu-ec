# Diagnóstico del importador — 4 de octubre de 2026

## Conclusión y certeza

Se reprodujo un fallo de la ruta de autenticación del importador: una clave de cuenta de servicio recién creada todavía no era reconocida por el endpoint OAuth. Etapa: `preflight.oauth-exchange`, antes de leer/escribir documentos. Respuesta **HTTP 400**, código **`invalid_grant`**, descripción clasificada **`Invalid JWT Signature.`**.

La evidencia decisiva fue la misma clave, sin cambiar permisos, código criptográfico, proyecto ni reloj: los intentos 1 y 2 fallaron; el intento 3 funcionó tras esperas de 1 y 2 segundos. Es consistente con propagación de la clave recién creada. La ventana anterior ocultó el error con un mensaje genérico; no existe una traza retrospectiva que permita certificar que aquel fallo tuvo exactamente la misma respuesta. Este es el fallo real reproducido y corregido, no una atribución inventada del registro perdido.

## Prueba remota exacta, solo lectura

Última ejecución: `2026-10-04T20:33:49.666Z` a `2026-10-04T20:34:02.287Z` (15:33:49–15:34:02 Ecuador).

| Comprobación | Resultado |
| --- | --- |
| Identidad temporal | `qrmenu-firestore-worker@qr-menu-6981a.iam.gserviceaccount.com` |
| Rol permanente | Solo `roles/datastore.user`, sin modificaciones |
| OAuth, primer intento | 400, `invalid_grant`, `INVALID_JWT_SIGNATURE` |
| OAuth, segundo intento | 400, mismo código y motivo |
| OAuth, tercer intento, misma clave | Correcto |
| Lectura de metadatos de `(default)` | HTTP 200; proyecto `qr-menu-6981a` confirmado |
| Inventario recursivo real con esa identidad | Correcto, **0 documentos** |
| Consulta de permisos con esa identidad | HTTP 200 |
| `datastore.entities.get` / `list` | Ambos concedidos |
| `datastore.entities.create` / `update` / `delete` | Los tres concedidos |
| Manifiesto real de la ventana anterior | 734 documentos; checksum/estructura correctos |
| Recorrido del importador | Llegó a la creación del primer checkpoint; escritura interceptada y bloqueada deliberadamente |
| Escrituras de documentos remotos | **0** |
| Clave temporal al terminar | Eliminada; ausencia verificada por IAM |

La prueba confirma permisos de escritura, **no una escritura efectiva** ni la aceptación de todos los lotes reales. No se creó un documento para probarla. Se añadieron dos barreras independientes: interceptar `commit`/`commitWire` y rechazar HTTP de mutación hacia Firestore. Se permiten únicamente GET y POST `listCollectionIds` para el inventario.

El token para leer Firestore usa exactamente el scope `datastore` del importador. Un segundo token de la misma clave usa solo `iam.test` para consultar permisos en Resource Manager; no cambia los roles de la cuenta. La primera versión de la herramienta diagnóstica consultó `databases:testIamPermissions` y recibió 501 `UNIMPLEMENTED`: se corrigió al endpoint de proyecto documentado. Ese 501 fue un fallo de la herramienta de diagnóstico nueva, no el fallo de la migración anterior.

## Correcciones locales

1. `lib/firestore-credentials.ts` conserva HTTP, código OAuth y una clasificación segura de la descripción. Nunca imprime tokens, JWT, clave privada ni cuerpo completo del proveedor.
2. `scripts/fresh-credential-readiness.mjs` espera que funcione OAuth antes de permitir el trabajo. Reintenta **solo** una clave recién creada con 400 + `invalid_grant` + `INVALID_JWT_SIGNATURE`. Esperas máximas: 1, 2, 4, 8 y 16 segundos; seis intentos en total. Otros errores se detienen inmediatamente. No baja seguridad, no modifica IAM y no reintenta escrituras.
3. `scripts/migration-credential.mjs` aplica esa espera y registra etapas de permisos, creación, identidad, preparación y revocación. `finally` sigue eliminando la clave incluso si fallan las pruebas.
4. `scripts/firestore-remote-migrate.ts` registra descifrado, validación, mantenimiento, OAuth, lectura previa e importación. La lectura previa es obligatoria antes del primer commit. Los lotes registran cantidades, no documentos ni datos personales.
5. `lib/firestore-remote-migration.ts` identifica checkpoint, inventario, autorización, lectura de lotes/diarios, commit, verificación final y marcado de éxito. No se cambiaron checksums, orden, precondiciones ni alcance de datos.
6. `scripts/migration-diagnostics.mjs` conserva tipo de excepción, HTTP, código, razón y frames de stack. Omite mensajes arbitrarios y cuerpos que pueden contener PII/secretos; no vuelca una excepción cruda por consola.

## Pruebas y evidencias

- Diez pruebas de preparación/diagnóstico: aprobadas. Cubren reintento transitorio, fallo permanente, límite de intentos, protección de datos en logs, bloqueo de escrituras, clasificación OAuth, mantenimiento y revocación.
- `npm run check`: correcto.
- Seis pruebas de importación en emulador: **6/6 aprobadas**, cero omitidas; interrupción/reanudación, respuesta perdida, conflicto, documentos huérfanos, reversión y autorización. Total focalizado: **16/16**.
- Verificación final del Worker `2026-10-04T20:35:34.825Z`: `62bff004` al 100%, candidata `22052178` al 0%, mantenimiento desactivado; siete sondas de reglas remotas correctas.
- Recibo de prueba remota: `work/migration-preparation/identity-dry-run.json`.
- Error reproducido antes de añadir reintento: `work/migration-preparation/identity-dry-run-before-retry.json`.
- Última eliminación de clave: `work/migration-preparation/temporary-credential.json`.
- Inventario IAM final: HTTP 200, una sola clave administrada por el usuario (la permanente anterior), cero creadas el 4 de octubre todavía presentes. No quedaron claves temporales del diagnóstico.
- Recibos fuera de Git, sin tokens ni documentos.

No se abrió ventana, no se cambió tráfico del Worker ni se publicaron reglas. Las únicas mutaciones remotas de este diagnóstico fueron crear y eliminar sus claves temporales autorizadas. La clave permanente de Cloudflare y la cuenta Auth permanecen intactas. El manifiesto viejo se utilizó solo para diagnóstico; no se debe reutilizar para un nuevo corte con D1 nuevamente en actividad.

Referencia del método de comprobación sin escritura: [Resource Manager — projects.testIamPermissions](https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/testIamPermissions).
