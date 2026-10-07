# Centro de notificaciones — versión 0.8.2

## Cambio funcional

El dueño dispone de un módulo **Notificaciones** separado de la carta. Incluye categorías, filtro de avisos sin leer, paginación, fecha en Ecuador y detalle individual. Abrir un aviso registra su lectura. Los errores de lectura o avisos eliminados son visibles: nunca se abre silenciosamente el editor como sustituto.

Los cinco avisos configurables conservan sus permisos por plan y preferencias. FCM envía el título y motivo registrados por el servidor, no el anterior texto genérico. La cancelación identifica pedido, total y causa. No se envían alias de clientes, artículos, credenciales WiFi ni tokens de acceso en el contenido push. Android conserva visibilidad privada en pantalla bloqueada.

La entrega se dispara en segundo plano al guardar el evento de pedido, cancelación o agotado; una actualización autenticada de la bandeja también procesa avisos pendientes. Ambos usan la misma cola con lease atómico, preferencias, permisos, revocación y presupuesto acotado. El cron conserva los reintentos y avisos programados; no se marca un envío como recibido en el teléfono solamente porque FCM lo aceptó.

Cada aviso tiene un PendingIntent distinto, identificado por restaurante y evento. Se elimina la agrupación destructiva mediante collapse_key por restaurante. El navegador y la APK abren `/r/UUID/?notification=EVENTO&restaurant=UUID`. El servidor requiere sesión y limita el detalle al restaurante autenticado, incluso para avisos fuera de la primera página. El enlace admite exclusivamente UUID e identificadores acotados, no URLs suministradas por el mensaje.

El destino se conserva durante login, renovación del dispositivo recordado y desbloqueo nativo. Una cuenta de otro restaurante recibe un aviso explícito, sin acceder a información ajena. Los enlaces de producción del dueño, creador, carta y APK no cambian.

## Instalación y compatibilidad

APK 0.8.2, código 13, identidad `ec.qrmenu.app` y firma original. Instalar encima de la aplicación existente; no borrar datos. Las notificaciones ya emitidas por la versión anterior no contienen el destino individual: la apertura corregida se aplica a los nuevos avisos recibidos con la APK actualizada. No reconstruir destinos a partir de mensajes antiguos ni exponer endpoints públicos.

## Verificación

- TypeScript; pruebas generales; emulador de repositorios, aislamiento y cola FCM.
- Pruebas nuevas: motivo exacto, eventos no colapsados, enlaces acotados, conservación tras acceso y rechazo de redirecciones externas.
- Interfaz local con datos de prueba en 390 y 1440 px: detalle exacto, lectura, recarga y aviso inexistente; evidencia en `outputs/notifications-qa` (no publicada).
- Android: compilación release, lint y firma verificados.
- Navegación móvil corregida: Carta, Ofertas, Pedidos, QR, Avisos y Ajustes; nombres completos accesibles. Validación visual con seis pestañas en 320, 360, 390 y 1440 px.
- La renovación concurrente del registro del celular conserva el trabajo pendiente en vez de descartarlo. Prueba de regresión del emulador: primer intento diferido y segundo enviado.
- Suite completa con emulador: 120 pruebas aprobadas, ninguna fallida ni omitida. TypeScript aprobado. Las cuatro pruebas del módulo de notificaciones incluyen la regresión de renovación concurrente.
- La prueba de toque físico en Honor no se considera aprobada si ADB no detecta el dispositivo. Comprobar con dos avisos distintos, aplicación abierta, en segundo plano y tras cierre completo; desbloquear manualmente cuando corresponda.

### Aceptación física del 7 de octubre de 2026

Honor LNA-LX3, APK oficial 0.8.2: se recibieron dos avisos independientes en la barra, cada uno con su título y explicación. El toque de «Prueba 2» abrió el detalle 2; después de enviar la app al fondo y cerrar su proceso con `am kill`, el toque de «Prueba 1» abrió el detalle 1, sin login ni editor. Ambos registros quedaron leídos y sin trabajos pendientes. No se crearon pedidos de prueba ni se modificaron ventas.

Producción: `b582cbc6-9d31-4d51-b42b-790fea80ce9a`, tráfico 100%; bindings de autenticación, cifrado y datos conservados. APK SHA-256: `9832f7880bbea5cc5f06979ca1dc922da697d5273e9f747faf393b6906768b26`.

## Publicación y reversión

`stage-production-push.mjs --stage-only --with-firebase-recovery --with-d1-documents --notifications-release` prepara una versión sin tráfico, heredando exclusivamente la producción D1 vigente. `deploy-notifications-release.mjs --activate-notifications` comprueba aceptación local, checksums, versión anterior y todos los bindings antes de activar. Si falla la comprobación posterior, vuelve a la versión anterior. No se migra, congela ni elimina ningún dato; no se cambian Auth, TOTP, cifrado ni fotos.

Los recibos y respaldos cifrados permanecen fuera de Git. El controlador registra por separado la aprobación automatizada y la prueba física, sin afirmar que sean equivalentes.
