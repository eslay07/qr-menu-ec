# Centro de notificaciones — versión 0.8.2

## Cambio funcional

El dueño dispone de un módulo **Notificaciones** separado de la carta. Incluye categorías, filtro de avisos sin leer, paginación, fecha en Ecuador y detalle individual. Abrir un aviso registra su lectura. Los errores de lectura o avisos eliminados son visibles: nunca se abre silenciosamente el editor como sustituto.

Los cinco avisos configurables conservan sus permisos por plan y preferencias. FCM envía el título y motivo registrados por el servidor, no el anterior texto genérico. La cancelación identifica pedido, total y causa. No se envían alias de clientes, artículos, credenciales WiFi ni tokens de acceso en el contenido push. Android conserva visibilidad privada en pantalla bloqueada.

Cada aviso tiene un PendingIntent distinto, identificado por restaurante y evento. Se elimina la agrupación destructiva mediante collapse_key por restaurante. El navegador y la APK abren `/r/UUID/?notification=EVENTO&restaurant=UUID`. El servidor requiere sesión y limita el detalle al restaurante autenticado, incluso para avisos fuera de la primera página. El enlace admite exclusivamente UUID e identificadores acotados, no URLs suministradas por el mensaje.

El destino se conserva durante login, renovación del dispositivo recordado y desbloqueo nativo. Una cuenta de otro restaurante recibe un aviso explícito, sin acceder a información ajena. Los enlaces de producción del dueño, creador, carta y APK no cambian.

## Instalación y compatibilidad

APK 0.8.2, código 13, identidad `ec.qrmenu.app` y firma original. Instalar encima de la aplicación existente; no borrar datos. Las notificaciones ya emitidas por la versión anterior no contienen el destino individual: la apertura corregida se aplica a los nuevos avisos recibidos con la APK actualizada. No reconstruir destinos a partir de mensajes antiguos ni exponer endpoints públicos.

## Verificación

- TypeScript; pruebas generales; emulador de repositorios, aislamiento y cola FCM.
- Pruebas nuevas: motivo exacto, eventos no colapsados, enlaces acotados, conservación tras acceso y rechazo de redirecciones externas.
- Interfaz local con datos de prueba en 390 y 1440 px: detalle exacto, lectura, recarga y aviso inexistente; evidencia en `outputs/notifications-qa` (no publicada).
- Android: compilación release, lint y firma verificados.
- La prueba de toque físico en Honor no se considera aprobada si ADB no detecta el dispositivo. Comprobar con dos avisos distintos, aplicación abierta, en segundo plano y tras cierre completo; desbloquear manualmente cuando corresponda.

## Publicación y reversión

`stage-production-push.mjs --stage-only --with-firebase-recovery --with-d1-documents --notifications-release` prepara una versión sin tráfico, heredando exclusivamente la producción D1 vigente. `deploy-notifications-release.mjs --activate-notifications` comprueba aceptación local, checksums, versión anterior y todos los bindings antes de activar. Si falla la comprobación posterior, vuelve a la versión anterior. No se migra, congela ni elimina ningún dato; no se cambian Auth, TOTP, cifrado ni fotos.

Los recibos y respaldos cifrados permanecen fuera de Git. El controlador registra por separado la aprobación automatizada y la prueba física, sin afirmar que sean equivalentes.
