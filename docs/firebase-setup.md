# Firebase — Paso 2: configuración inicial

La interfaz sigue usando React y TypeScript. Este módulo no está conectado a las
pantallas, ni sustituye Auth, D1, R2 o las sesiones existentes. No se desplegaron reglas.

## Valores que debes copiar

En Firebase: **Configuración del proyecto → General → Tus apps → app web →
Configuración del SDK → Configuración**. Si todavía no hay app web, regístrala
antes de copiar los valores. No inventes valores a partir del nombre del proyecto.

Crea `.env.local` en la raíz del repositorio (ignorado por Git) y pega:

```dotenv
VITE_FIREBASE_API_KEY=valor_de_apiKey
VITE_FIREBASE_AUTH_DOMAIN=valor_de_authDomain
VITE_FIREBASE_PROJECT_ID=valor_de_projectId
VITE_FIREBASE_STORAGE_BUCKET=valor_de_storageBucket
VITE_FIREBASE_MESSAGING_SENDER_ID=valor_de_messagingSenderId
VITE_FIREBASE_APP_ID=valor_de_appId
```

Usa exactamente el bucket de la consola: no cambies su sufijo ni añadas `gs://`.
No se necesitan `measurementId`, Analytics, `databaseURL` ni VAPID en este paso.
Estos seis identificadores forman parte del cliente; no son credenciales Admin.
Nunca pongas claves privadas, cuentas de servicio o secretos en variables `VITE_*`.
Reinicia Vite después de modificar el archivo. Son variables de compilación:
los builds de Pages y Worker también leen la raíz mediante `envDir`.

## Exportaciones

`src/lib/firebase.ts` exporta `firebaseApp`, `db`, `auth`, `storage` y `messaging`.
Las primeras cuatro son instancias independientes; `messaging` es una
`Promise<Messaging | null>` porque `isSupported()` es asíncrona. En SSR, HTTP no
seguro o navegadores incompatibles devuelve `null`. No solicita permisos, registra
Service Workers ni genera tokens FCM. Este SDK web no sustituye FCM nativo Android.

El módulo falla con un mensaje de configuración si faltan valores, en vez de usar
un proyecto de ejemplo. No importarlo todavía en los flujos actuales. Al integrarlo
en una etapa posterior, usarlo desde código cliente; no es un SDK administrativo.

## Contrato de las reglas iniciales

- El servidor crea `restaurants/{id}` con `access.active` y `access.features`, y
  `restaurants/{id}/members/{uid}` con `role: 'owner'` y `active: true`.
- Un dueño activo lee solo los recursos explícitamente permitidos de su restaurante.
  Puede editar `name`/`tagline` y `settings/general.ordersEnabled` (solo habilitarlo
  si tiene la función contratada). No puede autoasignarse membresía ni permisos.
- El servidor crea `users/{uid}` con `displayName` y `locale`. El usuario solo lee
  su propio documento y actualiza esos dos campos; no roles, correo verificado ni IDs.
- Escrituras de catálogo, pedidos, precios, publicaciones y credenciales de dispositivo
  permanecen cerradas al SDK cliente hasta implementar sus operaciones del Paso 4.
  El servidor deberá comprobar identidad, ámbito, revisión, límites y esquemas.
- `publicMenus` es público de solo lectura, incluidas sus subcolecciones. Nunca
  escribir allí borradores, secretos, datos personales ni versiones incompletas.
- `rateLimits`, `auditEvents`, `hostnames` y cualquier ruta no declarada están
  cerradas al cliente. Admin SDK no se autoriza con estas reglas sino con IAM:
  sus handlers deben aplicar las comprobaciones del servidor.

No desplegar estas reglas sobre datos reales antes de provisionar las membresías
y probar la migración. `firebase.json` solamente declara su ubicación local.

## Verificación local

`npm run test:firebase` inicia exclusivamente Firestore Emulator en el proyecto
ficticio `demo-qr-menu-ec`, ejecuta pruebas de aislamiento y apaga el emulador.
Requiere Java compatible con Firebase CLI; la primera ejecución descarga el
emulador. No necesita las variables reales ni inicia sesión en Firebase.
Las pruebas cubren usuarios ajenos/anónimos, subcolecciones, membresías falsas,
roles, límites, suspensión, menús públicos y rutas solo de servidor.

Comprobar además `npm run check`, `npm test`, `npm run build:worker` y
`npm run build:pages`. El Paso 3 requiere confirmación separada.

## Referencias

- https://firebase.google.com/docs/web/setup
- https://firebase.google.com/docs/reference/js/messaging
- https://firebase.google.com/docs/firestore/security/rules-fields
