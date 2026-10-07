# Paso 3 — Firebase y TOTP existente: transición no activada

## Estado de esta entrega

La integración de servidor está detrás de `AUTH_PROVIDER=firebase`. Producción
continúa con el proveedor anterior: no se desplegó, no se crearon cuentas reales,
no se cambiaron IAM, facturación, TOTP, Firestore, Storage ni FCM.

Esta no es todavía la finalización del Paso 3. Se conservaron los formularios
React/TypeScript. El adaptador usa REST oficial de Firebase desde el Worker para
mantener cookies HttpOnly. El cliente sincroniza el SDK modular con
`onAuthStateChanged` y persistencia exclusivamente en memoria. El token de
sincronización solo se emite tras verificar cookie, permiso local y CSRF. La
cookie sigue siendo necesaria para autorizar las operaciones del Worker.

## Implementado

- Contraseñas de cuentas migradas se verifican solo en Firebase. Ante error del
  proveedor no se permite fallback al hash antiguo.
- Cuentas legacy se migran tras validar su contraseña. El algoritmo histórico
  encadena PBKDF2 y no se puede importar como un hash PBKDF2 estándar. Se mantiene
  normalización NFKC de contraseña para compatibilidad.
- UID determinista por rol/restaurante, sin adoptar cuentas por coincidencia de
  correo. Un conflicto de cuenta requiere revisión administrativa, no sobrescritura.
- El hash local se retira cuando la credencial Firebase ha sido validada y la
  actualización de estado se confirma. Los reintentos comprueban UID, email y
  contraseña antes de continuar una migración interrumpida.
- Cookies Firebase de 12 horas, verificadas por firma, issuer, audience, sujeto,
  vencimiento y revocación del usuario. Se mantienen HttpOnly, Secure y SameSite.
- El creador sigue usando su secreto TOTP/códigos existentes. El ID token de la
  primera fase permanece cifrado en un desafío de cinco minutos. Solo tras TOTP
  se intercambia por la cookie y se registra el permiso de acceso de la aplicación.
- Consumir un desafío es atómico; un segundo uso no emite otra sesión.
- Recuperar la contraseña Firebase del creador NO elimina su TOTP existente.
- Alta/restablecimiento de dueño, email y renovación por dispositivo cuentan con
  ramas Firebase. Ninguna migración de datos de negocio se ejecuta aquí.

## Lo que permanece en D1 y por qué

`auth_sessions` sigue siendo un registro auxiliar de permisos por sesión: CSRF,
inactividad, listado, revocación individual y evidencia del paso TOTP. En modo
Firebase el hash apunta a la cookie emitida por Google, no a una credencial opaca
emitida localmente. Una cookie válida de Google sin permiso local tampoco da acceso.

También continúan los desafíos TOTP, rate limits y permisos de celular recordado.
Eliminar estas tablas ahora perdería funcionalidades que Firebase Auth no sustituye
automáticamente. Su retirada definitiva **no está completada** y requiere resolver
su almacenamiento en el paso correspondiente; no renombrarlas para ocultar esto.

## Requisitos de activación (solo servidor)

- `AUTH_PROVIDER=firebase`.
- `FIREBASE_PROJECT_ID=qr-menu-6981a`.
- `FIREBASE_API_KEY`: la clave pública de la app de ese mismo proyecto.
- `FIREBASE_SERVICE_ACCOUNT`: secreto del Worker con JSON de una cuenta técnica
  del mismo proyecto y permisos limitados de administración de Firebase Auth.
  Nunca en Git, VITE, descargas, respuestas ni logs. No usar la sesión personal
  de Firebase CLI como credencial permanente de producción.
- `DATA_ENCRYPTION_KEY`: conservar la clave actual para no perder TOTP ni emails.

No se ha aprovisionado esta cuenta técnica ni cargado su secreto en Cloudflare.
La configuración incompleta falla cerrada. No activar la variable antes de
probar el proveedor real en un entorno separado con usuarios de prueba.

## Verificación pendiente antes de activar

1. Prueba integral real de cuenta técnica, emisión/verificación de cookies,
   login, TOTP válido/erróneo, recuperación, logout, revocación e inactividad.
2. Cubrir operaciones concurrentes entre Firebase y D1, particularmente alta y
   cambio de contraseña/email. No existe una transacción distribuida entre ambos.
3. Verificar en navegador la sincronización del observador cliente y CSP. El
   texto de recuperación y las rutas de revocación de IDs base64 ya se adaptaron.
4. Copia protegida y comprobada del estado previo; prueba de migración de una cuenta
   de ensayo. Después de migrar cuentas, cambiar el flag a legacy NO es un rollback
   válido porque el hash local ya no existe.
5. Recorrido web y APK con dispositivos recordados, sin modificar los catálogos.

Las pruebas unitarias con dobles del proveedor no demuestran que IAM o la emisión
real de cookies estén configurados. No informar el Paso 3 como terminado hasta
cerrar estos puntos. El Paso 4 permanece fuera del alcance de esta entrega.

## Referencias

- https://firebase.google.com/docs/auth/admin/manage-cookies
- https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects/createSessionCookie
- https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects/accounts
