# Bloqueo al preparar la candidata de Firebase Auth

> **RESUELTO el 2026-10-05 a las 01:21 UTC.** La API beta de creación de versiones (`POST /workers/workers/qr-menu-ec/versions?deploy=false`) sí acepta la herencia explícita desde 22052178, a diferencia de la API de scripts y el merge-patch probados antes. Nueva candidata `b5cc3b53-5413-4431-9338-602888a88a48`, sin tráfico. Se conservaron código, assets y todos los bindings existentes, incluida DATA_ENCRYPTION_KEY, sin leer ni regenerar secretos. HTTP 200 de `/api/creator/session` confirmó `authProvider=firebase` y `mfaConfigured=true`. Lo que sigue documenta los intentos anteriores, no un bloqueo vigente. Ver `candidate-b5cc3b53-acceptance.md`.

Solicitud: añadir únicamente AUTH_PROVIDER, FIREBASE_PROJECT_ID y FIREBASE_API_KEY a una nueva versión, manteniendo secretos/bindings de 22052178 y producción intactos.

Se preparó `scripts/stage-auth-candidate.mjs`. Lee la configuración Firebase existente de `.env.local` sin imprimirla; verifica el SHA-256 del Worker y del manifiesto de assets contra el recibo original; no contiene operación de despliegue. Intenta heredar los bindings especificando explícitamente la versión 22052178, conforme al campo `version_id` de la documentación de Cloudflare.

La API real rechazó la subida con HTTP 400 / código 10057: para `inherit.version_id` **solo admite el literal `latest`**, no el UUID de una versión anterior. No devolvió ID de nueva versión. La última versión es la de mantenimiento 136e79e3, que no conserva los secretos de la candidata. Quitar el UUID o usar `latest` no garantiza conservar los bindings y no es una solución aceptable.

No se activó mantenimiento, no se cambió el despliegue, no se recrearon credenciales y no se extrajeron secretos. El widget Turnstile conserva el hostname añadido en la operación anterior.

La comprobación HTTP de `authProvider=firebase` continúa pendiente: no se debe afirmar éxito sin una candidata nueva válida. Para seguir hace falta una vía soportada por Cloudflare para clonar los bindings de una versión histórica sin tráfico, o autorización y un procedimiento para reaprovisionar los secretos que no se pueden recuperar. No rotar DATA_ENCRYPTION_KEY: protege datos existentes y TOTP.

Referencia consultada: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/create/ . Aunque documenta `version_id` como UUID o `latest`, la respuesta de esta cuenta restringe el comportamiento a `latest`.

## Investigación adicional con autonomía — 2026-10-05 01:14 UTC

Se inspeccionó la implementación instalada de Wrangler: `versions secret bulk` usa un endpoint de merge-patch de versiones y fija `latest`. Se intentó la misma operación apuntando exclusivamente a 22052178, con las tres variables autorizadas y MAINTENANCE_MODE=false; nunca a producción ni a latest. Cloudflare la rechazó con HTTP 400, código 10004. No se confirmó ninguna versión nueva. Se verificó nuevamente que el despliegue no cambió. Recibo: `work/migration-preparation/auth-patch-result.json`.

La inspección de bindings confirmó que los secretos existentes son `secret_text`, no referencias de Secrets Store. La última versión, mantenimiento 136e79e3, no tiene secretos heredables. Referenciarlos por su nombre no transforma estos bindings en secretos de cuenta reutilizables.

Se comprobaron solamente los nombres de variables de `.env.local` y el inventario del directorio privado conocido; no contienen una copia identificable de DATA_ENCRYPTION_KEY ni de las cuentas técnicas. No se extrajeron valores secretos de Cloudflare, no se regeneró la clave de cifrado, no se rotaron cuentas técnicas ni se cambiaron permisos. No se borró la copia Firestore.

Con las restricciones actuales no se ha encontrado una vía operativa para crear la nueva candidata conservando la clave. Hace falta recuperar el material original desde su custodia segura o que Cloudflare habilite/confirme un mecanismo de clonación de la versión histórica. Sustituir la clave de cifrado o activar una versión temporalmente para forzar herencia no son alternativas aceptables. La aceptación completa y el Honor siguen pendientes, no aprobados.
