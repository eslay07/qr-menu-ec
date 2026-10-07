# Preparación de mantenimiento y credencial — 3 de octubre de 2026

> Actualización del 4 de octubre: el segundo intento corrigió y verificó la propagación del mantenimiento en ambos dominios. Posteriormente falló el importador, se restauró D1 al 100% y Firestore sigue vacío. Consultar `migration-window-2026-10-04-v2.md` como estado más reciente. No se completó la migración.

## Estado verificado

- Producción D1: `62bff004-11c0-4fa7-9047-b5a26a9cc0f1`, **100%**.
- Versión de mantenimiento: `e6d9a9b6-66c3-476c-a586-2d5b72157a10`, **0%**, subida sin desplegar.
- Candidata Firestore: `22052178-361a-4546-9193-8cb47deb2f0c`, **0%**, sin modificar.
- SHA-256 del módulo de mantenimiento subido y descargado para comparar: `ec8d0cfd4409a1b2fc3e6aec2f14a755743a92569dc8b61c56c5916bb22fd248`.
- Recibo: `work/migration-preparation/maintenance-version.json`, fuera de Git.
- TypeScript correcto. Cuatro pruebas nuevas aprobadas: 96 combinaciones de ruta/host/método bloqueadas; tarea programada sin operaciones; credencial eliminada al terminar normalmente y al interrumpirse; ningún alta si faltan permisos.
- Lectura final de tráfico `2026-10-03T22:30:56.056Z`: producción intacta, mantenimiento no activo.

## 1. Qué contiene la versión preparada

Es una versión **exclusiva de mantenimiento**, basada en el binding D1 y la configuración de compatibilidad de la versión activa. No recompila la aplicación local ni incorpora código de la candidata Firestore. El módulo es `deployment/cloudflare/maintenance-only.ts`, con la respuesta compartida de `lib/write-freeze.ts`.

Se verificó que conserva exactamente el binding `DB` de producción. Sus otros tres bindings son `DATA_PROVIDER=d1`, `MAINTENANCE_MODE=true` y `FCM_ENABLED=false`. No copia secretos, Auth ni assets: nada de ello es necesario para responder mantenimiento. No es una copia completa del bundle original con una bandera añadida; es una barrera mínima sin acceso a datos.

Todas las solicitudes que llegan a esta versión reciben 503, `Retry-After: 60`, `Cache-Control: no-store` y `X-QRMenu-Maintenance: write-freeze-v1`. No cambia cookies. Incluye navegación web/APK, estáticos, login, renovación, APIs, alias UUID y hostnames atendidos por el Worker. `scheduled` no ejecuta trabajo. No basta con cambiar la bandera a false para salir: el bloqueo es incondicional para impedir una reapertura accidental.

El endpoint de Cloudflare rechazó herencia por ID de versión (solo admite `latest` en esta cuenta/API). No se heredó la candidata: se envió el binding D1 explícito leído de producción y se verificó igualdad exacta después. Los intentos rechazados no crearon versiones ni cambiaron tráfico.

### Procedimiento futuro, solo con autorización de ventana

1. Releer `/deployments`: exigir la versión D1 anterior al 100%. Releer los metadatos/hash de la versión preparada y confirmar su ID, binding D1 y guardas. Si cambió la producción, detenerse y preparar una nueva base.
2. Activar **el ID exacto de mantenimiento**, nunca `latest`. La operación de despliegue tendrá una única versión, `e6d9a9b6-66c3-476c-a586-2d5b72157a10`, con 100%. No se ha ejecutado esta operación.
3. Comprobar 503 y marcador en cada dominio inventariado, UUID, login y renovación; confirmar el despliegue al 100%. Dejar drenar solicitudes anteriores y comprobar estabilidad D1 antes del respaldo final. La APK abierta puede conservar una pantalla cacheada, pero el servidor rechaza operaciones nuevas.
4. El congelamiento del Worker no bloquea herramientas con acceso directo a D1/Firestore ni SDK clientes. Coordinar otros escritores y la política temporal de escrituras cliente antes del primer lote. No se han modificado las reglas publicadas ni congelado estos accesos en esta preparación.
5. Obtener respaldo FINAL, repetir ensayo aislado y preparar manifiesto cifrado con UUID/checksum. No usar el respaldo antiguo como corte definitivo mientras D1 sigue recibiendo cambios.
6. Solo entonces ejecutar el importador autorizado y el procedimiento de credencial siguiente. El importador confirma mantenimiento antes de crear una clave y antes de cada lote.
7. Si se aborta antes de activar Firestore, volver al ID exacto D1 `62bff004-11c0-4fa7-9047-b5a26a9cc0f1` al 100%; eso recupera su código, assets, secretos y configuración originales. No activar la candidata automáticamente. Si ya hubo escrituras en Firestore, conservar el diario para reanudar/revertir según el plan, sin borrar datos automáticamente.

## 2. Credencial de servidor exclusivamente en memoria

Implementación: `scripts/migration-credential.mjs`, integrada en `scripts/firestore-remote-migrate.ts`. No requiere copiar la clave almacenada en Cloudflare ni poner una clave en `.env`, argumentos, consola o archivos. No modifica la cuenta de Auth.

La impersonación con token corto se probó y devolvió `IAM_PERMISSION_DENIED`. No se amplió IAM para habilitarla. Se verificaron, mediante consulta de permisos, los permisos existentes de la identidad operadora para crear/listar/eliminar claves **de la cuenta dedicada**:

`qrmenu-firestore-worker@qr-menu-6981a.iam.gserviceaccount.com`

Esta cuenta conserva únicamente `roles/datastore.user`. No se creó ninguna clave nueva durante esta preparación.

### Secuencia exacta durante la ventana

1. El operador usa la sesión Google ya autorizada de Firebase CLI. El módulo la utiliza internamente para llamar a IAM sin registrar cuerpos HTTP ni tokens.
2. Tras verificar manifiesto y mantenimiento, vuelve a comprobar cuenta activa, rol exclusivo y permisos create/delete/list. Si algo falla, no crea una clave ni inicia escrituras.
3. Crea una clave temporal RSA de esa cuenta por HTTPS. La respuesta se recibe directamente en el proceso Node; no se entrega por línea de comandos, variables de entorno ni stdin de otro proceso.
4. Valida proyecto/cuenta. Guarda únicamente el **nombre del recurso de clave**, estado y fecha en `work/migration-preparation/temporary-credential.json` (no contiene material criptográfico y está fuera de Git).
5. Construye el proveedor de bearer en una clausura y lo entrega directamente a `FirestoreRest` dentro del mismo proceso. La clave privada y el token permanecen en memoria; la cuenta autenticada usada para crear la clave no se utiliza para escribir documentos.
6. El bloque `finally` elimina la clave temporal en éxito o error, con hasta tres intentos. Después lista las claves para confirmar que el ID desapareció. Nunca elimina la clave permanente de Cloudflare ni otras claves.
7. Actualiza el recibo a `revoked`. Si no logra verificar la eliminación, registra `REVOCATION_REQUIRED`, termina con error y no permite declarar éxito. Mantener mantenimiento y revocar **solo el ID registrado** desde IAM antes de continuar.

Los argumentos del comando de importación siguen siendo exclusivamente modo, ruta del manifiesto cifrado, checksum, UUID e ID de mantenimiento. `REMOTE_MIGRATION_AUTHORIZATION=APPROVED_FROZEN_WINDOW` es una confirmación no secreta. Ya no se acepta `FIRESTORE_SERVICE_ACCOUNT` por variable de entorno para esta herramienta.

### Fallos y límites de seguridad

- La clave de cuenta de servicio no tiene vencimiento automático: su eliminación es obligatoria. Un apagado del PC o cierre forzado del proceso puede impedir `finally`. En ese caso, revisar el recibo y revocar el ID desde IAM; no reanudar sin comprobarlo.
- Si la respuesta de creación se pierde antes de recibir el ID, detenerse, revisar los eventos IAM y claves creadas en esa ventana; no adivinar ni borrar claves permanentes.
- Eliminar una clave no equivale a revocar de inmediato un bearer ya emitido. Los bearer del módulo vencen en un máximo aproximado de una hora; no se publican ni se persisten. Referencia: [credenciales de cuentas de servicio](https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys).
- Se sobrescribe el buffer binario local, pero JavaScript no garantiza borrado físico inmediato de cadenas/copias en RAM. No usar depuradores, volcados de memoria ni trazas de credenciales durante la ventana. El proceso debe finalizar al terminar.
- La prueba real de crear/eliminar esta clave y la migración no se ejecutaron ahora: lo comprobado es permiso real de IAM y pruebas locales de ciclo de vida. Se ejecutarán al autorizar la ventana.

## Detenido antes de activar

Las dos preparaciones están realizadas. Falta únicamente la autorización operacional de la ventana y sus verificaciones inmediatas; no se ha congelado ni migrado nada. La preparación de esta versión de mantenimiento no implica aprobar el despliegue funcional de Firestore.
