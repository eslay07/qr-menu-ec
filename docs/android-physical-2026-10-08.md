# Honor y actualización Android · 8 de octubre de 2026

El Honor LNA-LX3 físico está conectado: Android 16, WebView 153.0.8010.36 y APK 0.8.4/código 15. Cuenta utilizada: QA FICTICIO · Octubre 2026, catálogo de 40 platos. No se usan cuentas reales.

El usuario confirmó Carta → Ajustes → Volver conservando la app abierta. Se repitió mediante entrada de prueba Android y se capturó Carta como resultado. Ajustes presenta secciones desplegables. Dos cierres completos y arranques fríos se iniciaron mediante el gestor de actividades Android; el desbloqueo nativo lo realiza el usuario, sin compartir credenciales. Se observó la Carta de nuevo; no se atribuyen todavía diez reaperturas a esta evidencia. El servidor conserva dos sesiones activas en las lecturas realizadas.

## Corrección 0.8.5/código 16

La cabecera de 0.8.4 se dibuja bajo la barra de estado y la cámara en Android 16. El contenedor ahora reserva el máximo de barras, recorte y teclado, sin sumar márgenes repetidos. Conserva el bloqueo nativo y las cookies seguras.

El actualizador anterior consulta una sola vez por Activity. Ahora vuelve a comprobar en cada regreso al primer plano, coalesciendo solicitudes y evitando avisos superpuestos, descargas repetidas o aviso mientras espera el instalador. Una consulta fallida sin conexión no bloquea el editor y puede repetirse en la siguiente apertura.

APK firmado con el certificado original; paquete ec.qrmenu.app, versión 0.8.5/16. SHA-256: aa57f0efa246a68020586099b7c67b46d2be8a44c7fea2b2a6e496a462928080; 8.502.129 bytes. No añade permisos ni dependencias. APK y metadatos se reemplazan juntos en la infraestructura existente.

## Controles antes de activar

Build Android, lint (0 errores/16 avisos) y ocho pruebas JVM aprobados, incluidas comprobaciones de SHA, tamaño, paquete, versión, certificado y origen HTTPS. Cinco pruebas de distribución/verificador, tipos y build Worker aprobados. Revisión independiente de Calidad aprobada. Respaldos nuevos de ambas D1 verificados desde disco, con integridad/FK correctos y 17 imágenes comprobadas; ninguna restauración productiva.

La instalación desde el aviso, cabecera con margen, teclado y diez reaperturas de 0.8.5 quedan sujetos a aceptación física después de desplegar. No se presenta la firma/build como instalación realizada. El instalador y el desbloqueo permanecen bajo control de Android.

Los informes anteriores conservan su alcance: [aceptación del editor y rendimiento](owner-validation-2026-10-08.md), [guía para restaurantes](restaurant-onboarding.md). Sin cambios de esquema, sin R2/Blaze ni gastos nuevos.
