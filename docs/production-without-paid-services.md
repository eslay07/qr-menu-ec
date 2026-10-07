# Producción sin dominio comprado ni Blaze

Actualizado: 05-10-2026. No se ha comprado un dominio ni cambiado facturación.

Actualización productiva 07-10-2026: D1 operativo y FCM activados en `29930545`; APK oficial 0.8.1/código 12 publicada y checksum descargado verificado. Firebase Auth conserva recuperación y TOTP del creador. Las fotos siguen en D1 y no requieren Blaze. Evidencia vigente en `launch-readiness-2026-10-06.md`; las referencias de preparación posteriores son históricas. La entrega push requiere que cada dueño autorice notificaciones y registre su dispositivo; activar FCM no concede automáticamente permisos Android o del navegador.

## Decisión

- Mantener los enlaces HTTPS de `consola.workers.dev` y alias UUID existentes.
- Fotos: las 16 imágenes existentes están en **D1**, no R2. No se necesita Firebase Storage para servirlas ni para subir nuevas fotos mediante el API actual. Se mantienen los límites de carga y respaldos cifrados. Vigilar tamaño de D1 y cuotas; gratuito no significa capacidad ilimitada.
- Recuperación: usar el servicio integrado de **Firebase Authentication**, con remitente y página de recuperación predeterminados de Firebase. No requiere Resend ni un dominio comprado. No sustituye un servicio de correo comercial ni permite enviar cualquier campaña.
- `MAIL_DOMAIN` continúa reservado para Resend con dominio verificado. Cambiar esa variable por sí solo no verifica DNS ni habilita correo desde `workers.dev`.
- FCM: puede habilitarse sin Blaze. Requiere consentimiento del dispositivo, configuración pública web, identidad FCM independiente y prueba real de recepción.

## Recuperación implementada

El dueño dispone de «Olvidé mi contraseña» en `/owner`. El servidor comprueba origen, JSON, tamaño, esquema estricto, Turnstile y límites por cuenta/IP antes de solicitar el correo a Firebase. La respuesta no revela si el correo existe; fallos de envío se auditan sin guardar enlaces ni direcciones en texto claro. Las cuentas legacy todavía no migradas pueden usar recuperación manual del creador.

El creador solicita el enlace a su correo cifrado asociado al UID servidor, sin aceptar un destinatario enviado por el navegador. Firebase cambia únicamente la contraseña: **el secreto TOTP y sus códigos permanecen intactos**. No se habilita verificación obligatoria de email automáticamente.

Firebase rechaza las cookies previas cuando cambia `validSince`. La renovación de dispositivos recordados verifica asimismo que el permiso se creó después de la última revocación/cambio de contraseña. Un permiso anterior se rechaza y se revoca; no se crea una sesión nueva a partir de ese permiso.

Firebase aloja el formulario de nueva contraseña en `qr-menu-6981a.firebaseapp.com`. El correo puede acabar en spam y el servicio tiene cuotas: comprobar recepción con una cuenta de prueba antes de declarar aceptación de entrega. No se restablecerá la contraseña real del operador para probar.

Fuentes oficiales consultadas 05-10-2026:
- [Gestión de usuarios y recuperación](https://firebase.google.com/docs/auth/web/manage-users)
- [Remitente predeterminado y dominio personalizado](https://firebase.google.com/docs/auth/email-custom-domain)
- [Página de acciones de correo predeterminada](https://firebase.google.com/docs/auth/custom-email-handler)
- [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging/)

## Entrega y activación

La APK firmada 0.8.1/código 12 conserva `ec.qrmenu.app` y la clave original. El staging añade `/downloads/qr-menu-ec.apk` y `/downloads/SHA256SUMS.txt`, accesibles en la candidata antes de activar producción. El archivo no es la APK de prueba `.candidate`.

No confundir una candidata con producción: los resultados y hashes se registran en `work/push-production-candidate/version.json` y, para correo, `work/push-mail-production-candidate/version.json`, fuera de Git. Hasta pasar la recepción real y el flujo de recuperación, producción conserva `724862e7` con FCM desactivado.
