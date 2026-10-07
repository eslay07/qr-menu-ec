# Corrección del acceso del creador — 2026-10-05

## Diagnóstico

El creador migrado conserva hash legacy y TOTP, pero no `emailCiphertext`, `emailHash` ni `firebaseUid`. Firebase Auth exige email y el flujo anterior fallaba con `EMAIL_REQUIRED`, presentado como «No se pudo verificar el acceso».

Una versión de diagnóstico aislada, protegida con secreto aleatorio y vencimiento de cinco minutos, comprobó la credencial de Auth: OAuth y consulta administrativa HTTP 200. No se extrajeron secretos, no se solicitaron contraseñas y no se escribieron datos. El usuario Firebase del dueño consultado aún no existía, coherente con una migración progresiva tras su primer login correcto. Recibo: `work/migration-preparation/auth-runtime-diagnosis.json`. Esta lectura no prueba la contraseña del dueño ni demuestra que un eventual fallo de su login tenga la misma causa.

## Corrección

Solo para creador legacy sin correo: validar primero la contraseña existente y utilizar el correo de recuperación configurado en servidor. Nunca aceptar email del formulario ni aplicar este mecanismo a dueños o cuentas ya migradas. Conservar TOTP y datos de seguridad; no mutar el estado local si falla Firebase. Una cuenta Firebase en conflicto no se adopta ni sobrescribe. El acceso completo sigue pasando por el desafío TOTP existente.

Código: `AuthSecurity.authenticatePassword`. Pruebas: `tests/firebase-auth-provider.test.ts`, incluidos contraseña incorrecta, exclusión de dueños, conservación de TOTP, proveedor caído y rechazo de configuración incompleta.

## Candidata sin tráfico

- ID `f98783e0-642d-4860-9731-973d13c04b64`.
- URL creador: `https://f98783e0-qr-menu-ec.consola.workers.dev/creator`.
- Worker SHA-256 `a5079faaa7aa9d4d94e87fca49af525bdc75158b2e6b75bc0f4b9a5c0b626278`.
- Solo cambia el método de transición en el bundle original; assets sin cambios. Bindings y secretos heredados de b5cc3b53, incluida la clave de cifrado original.
- Turnstile habilitado para el hostname nuevo conservando los dominios anteriores.
- `/api/creator/session` responde HTTP 200, `authProvider=firebase`, `mfaConfigured=true`.
- Producción D1 62bff004 permanece al 100%; candidata al 0%. No se abrió mantenimiento.
- Recibo: `work/migration-preparation/creator-email-fix-version.json`.

## Segundo fallo detectado en aceptación y corrección

El usuario reportó `Illegal invocation` al probar f98783e0. El adaptador guardaba `fetch` como propiedad y lo invocaba con `this` igual a la instancia de FirebaseAuthProvider. Cloudflare requiere el receptor global: se corrigieron tanto OAuth como las solicitudes de Identity Toolkit mediante `transport.call(globalThis, ...)`.

- Nueva candidata: `fcea08f9-90ed-498c-b79f-6538ff8d6444`, sin tráfico.
- Login: `https://fcea08f9-qr-menu-ec.consola.workers.dev/creator`.
- SHA-256 Worker: `44f0b30e17a44dcac14365c844c564eff7e06cd2d451782f2c8020bd451a6e5a`.
- 13 pruebas de Auth en verde, incluidas dos pruebas que exigen el receptor global en login, OAuth y consulta administrativa. TypeScript aprobado.
- Turnstile permite el hostname nuevo; configuración previa y secretos preservados.
- Smoke remoto aprobado: Firebase seleccionado, TOTP configurado, menú público disponible, endpoints privados rechazan acceso anónimo. Producción 62bff004 sigue al 100%.
- Recibo: `work/migration-preparation/creator-transport-fix-version.json`. Contiene el checksum correcto; su campo histórico `changedMethod` solo enumera authenticatePassword, pero este parche también corrige las dos llamadas de transporte de FirebaseAuthProvider.

El usuario confirmó acceso completo con contraseña y código TOTP en fcea08f9: «si ahora si avanzo completamente contraseña y codigo». La validación visual móvil del pedido también pasó contra esta candidata, con movimiento normal y reducido. La aceptación autenticada del dueño (preferencias, WiFi y persistencia del Honor) sigue pendiente; no está cubierta por el acceso del creador.

## APK aislada para aceptación

Compilación `assembleCandidate` correcta e instalación ADB en Honor LNA-LX3 confirmada (`Success`). Paquete independiente `ec.qrmenu.app.candidate`, nombre `QR Menu EC · PRUEBA`, versión `0.8.0-candidate-fcea08f9`. Arranque en frío `Status: ok`. No sustituye la app de producción.

APK: `native/android/app/build/outputs/apk/candidate/app-candidate.apk`.
SHA-256: `757bc3241d63e86923b0b49abbb48074d1a626b6a595867133dbc0f78992020c`.

Se pidió al usuario iniciar sesión de dueño y recordar el dispositivo antes de repetir force-stop/reapertura. El arranque por ADB no demuestra persistencia de sesión.

A continuación se completó aceptación física y privada, incluyendo una corrección de impresión nativa de la APK. Artefacto final y confirmaciones: `candidate-fcea08f9-acceptance.md`. El operador confirmó la reapertura final sin login y estable; cinco avisos, cifrado WiFi y vistas previas con/sin WiFi aprobados. La producción anterior sigue al 100%.
