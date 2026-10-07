# Cierre al reabrir Android

## Continuación push — 29-09-2026

Se conserva el arreglo biométrico. La nueva integración FCM usa servicio nativo, permiso de notificaciones solicitado solo al activar, puente limitado al origen y protección frente a respuestas tardías tras destruir la Activity. `assembleDebug` y `assembleRelease` correctos. ADB vuelve a mostrar inventario vacío: no se afirma una prueba física nueva.

APK local firmada con la clave existente: `outputs/QR-Menu-EC-push-pruebas.apk`. SHA-256 `2AD3B22EBB4E1CA0F1FE5333B84D3A73B581FAAE940DE1FF08491687B46F5F7D`. No sustituye las descargas públicas ni activa el backend. Detalle de pruebas y configuración en `firestore-notifications.md`.

Equipo reportado: Honor X8d. Compatibilidad mantenida: Android 10/API 29 en adelante, no dependiente de Honor.

Defecto confirmado con logcat del teléfono conectado (Honor LNA-LX3, Android 16): `OwnerActivity.unlock()` llama a `BiometricPrompt.authenticate()` al detectar acceso recordado, pero el manifiesto no declaraba `android.permission.USE_BIOMETRIC`. El registro muestra `SecurityException: Must have USE_BIOMETRIC permission` al iniciar `OwnerActivity`, coincidiendo con el cierre reportado. No se copian registros ajenos a la aplicación ni identificadores del dispositivo al repositorio.

Correcciones: permiso declarado, inicio del desafío diferido hasta `onResume`, captura de fallos de disponibilidad con alternativa de credencial del sistema, pantalla opaca mantenida cuando no hay autenticación, limpieza de callbacks al destruir y eliminación de cookies completada antes de abrir el login cuando se retira el bloqueo del dispositivo.

Referencia: [API oficial BiometricPrompt](https://developer.android.com/reference/android/hardware/biometrics/BiometricPrompt), consultada 2026-09-27.

Prueba manual pendiente en teléfono: primer acceso, recordar celular, cierre forzado, nuevo arranque, cancelar desbloqueo, volver a intentar, PIN, huella, 60 segundos en segundo plano, selector de fotos breve, reinicio del dispositivo y ausencia de bloqueo. Nunca debe aparecer contenido privado al cancelar o fallar el desbloqueo. No hay teléfono conectado a ADB en este entorno.

No se ha publicado ni instalado una APK nueva en producción.

## Verificación local y alcance de compatibilidad

- `assembleDebug`: compilación correcta tras el cambio de ciclo de vida y permiso biométrico (2026-09-27, hora de Ecuador).
- Se mantiene `minSdk=29` (Android 10) y `targetSdk=35`; no se usan APIs exclusivas de Honor.
- Android 10 utiliza la credencial de bloqueo del sistema. Android 11 y posteriores permiten biometría fuerte o credencial; los errores de apertura conservan la pantalla bloqueada y ofrecen reintentar.
- Cancelar no vuelve a abrir automáticamente el desafío ni revela el contenido privado.
- La compilación no equivale a una prueba física. La matriz pendiente incluye Honor X8d, un Android 10 con PIN y otro fabricante con biometría. Sin dispositivo conectado no se afirma compatibilidad verificada en esos equipos.

## APK local de corrección

`assembleRelease` correcto y firma v3 verificada con la clave existente. Archivo local: `outputs/QR-Menu-EC-reapertura.apk`. Mantiene versión 0.8.0/código 11 e identidad `ec.qrmenu.app`; no es una publicación nueva. SHA-256: `B185A66C5D9446265C4631BFAC59BD450B641BC60E10D9BFBB850949F821D847`.

El dispositivo se desconectó antes de instalar la corrección. Por indicación del usuario se generó la APK sin exigir prueba física; queda pendiente confirmar la reapertura de esta compilación. No se borraron datos del teléfono ni se modificó producción.
