# Credenciales remotas — verificación de preparación

## Actualización vigente — 29-09-2026

Con autorización explícita se habilitó la API de Firestore y se consultó el inventario: `databases=[]`. Solo después se creó `projects/qr-menu-6981a/databases/(default)` como `STANDARD`, `FIRESTORE_NATIVE`, `us-east1`. Lectura posterior confirma edición y ubicación. No se vinculó facturación, no se migraron datos reales y no se desplegó producción. Script idempotente de inspección/creación: `scripts/create-firestore-standard.mjs --apply`.

Registrada la aplicación Android `ec.qrmenu.app`, identificador público `1:945507342553:android:4356ebe1da32ed285286c8`, sin instalarla ni publicarla. Su configuración pública está en recursos Android; ninguna clave de cuenta técnica está en la APK.

El certificado push web VAPID ya fue generado con autorización explícita. Firebase confirmó su creación el 29-09-2026; únicamente la clave pública se guardó en `.env.local`, excluido de Git. La clave privada permanece en Firebase. `FCM_ENABLED` y `VITE_FCM_ENABLED` siguen en `false`; no se desplegó producción. Código de entrega y resultados de prueba: `firestore-notifications.md`.

**Storage queda aplazado: fotos en R2**, por decisión expresa del usuario. Las secciones inferiores describen la inspección anterior, no bloquean esta decisión.

Fecha: 28-09-2026. Autorización del operador: cuentas técnicas separadas y pruebas aisladas, **sin cambiar facturación ni activar producción**.

## FCM: credencial creada y validada

- Cuenta: `qrmenu-fcm-worker@qr-menu-6981a.iam.gserviceaccount.com`.
- Rol personalizado: `projects/qr-menu-6981a/roles/qrMenuFcmSender`.
- Único permiso: `cloudmessaging.messages.create`. Sin privilegios Auth, Firestore, Storage, administración de temas ni IAM.
- Prueba HTTP v1 con `validate_only: true` y tema ficticio aleatorio: aprobada. No se envió ningún mensaje real ni se registró ningún cliente.
- Secreto `FIREBASE_FCM_SERVICE_ACCOUNT` guardado en Cloudflare, en versión **no desplegada** `29ce6c0b-c3cc-4002-be09-0c603e6e9752`.
- Verificación posterior: secreto presente, versión no desplegada, rol mínimo y exactamente una clave administrada activa. La lista de despliegues antes/después no cambió.
- Los intentos iniciales fallidos por propagación revocaron sus claves. La clave válida permanece solo en el secreto de Cloudflare; no se escribió su contenido a archivo, Git o salida de consola.

No equivale a terminar push: faltan registro y revocación de dispositivos, integración web/Android, entrega según preferencias y comprobación de recepción real. No activar el secreto ni publicar la versión por el solo hecho de que esta prueba haya pasado.

Para verificar sin modificar:

```powershell
node --import tsx scripts/provision-fcm-secret.mjs --verify 29ce6c0b-c3cc-4002-be09-0c603e6e9752
```

## Firestore: decisión previa a creación

Consulta autenticada: API devuelve `PERMISSION_DENIED` con motivo `SERVICE_DISABLED`. No significa una pérdida de acceso a la cuenta; la API no está habilitada. No se pudo inventariar la base por esa vía. No se crearon credenciales ni base.

Se solicitó autorización para una base Standard en `us-east1` si todavía no existe. Verificar inventario al habilitar la API antes de crearla. La ubicación es una decisión permanente, no debe elegirse silenciosamente. Mantener cuotas gratuitas y no vincular facturación sin aprobación.

## Storage: bloqueo por facturación

- `qr-menu-6981a.firebasestorage.app`: respuesta 404, no existe bucket accesible con ese nombre.
- Facturación del proyecto: `billingEnabled=false`; consola muestra plan Spark.
- Firebase exige Blaze para aprovisionar el bucket predeterminado actual. No se creó bucket ni cuenta/clave de Storage, y no se cambió de plan.
- Decisión solicitada: mantener imágenes en el proveedor actual o evaluar costos de Blaze antes de una autorización específica. El adaptador local permanece desactivado y D1/R2 no se retira.

Fuentes: [requisitos de facturación de Storage](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024), [permiso FCM](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging), [secretos en versiones no desplegadas de Workers](https://developers.cloudflare.com/workers/configuration/secrets/).
