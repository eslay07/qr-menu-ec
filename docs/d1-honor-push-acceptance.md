# Aceptación Honor y push con D1

Fecha local: 6 de octubre de 2026, Ecuador continental.

## Evidencia confirmada

- Honor LNA-LX3, ADB autorizado; APK de prueba 0.8.1 apuntando a `59cf7bb8-qr-menu-ec.consola.workers.dev` instalada con actualización, sin borrar datos.
- Se forzó el cierre completo de `ec.qrmenu.app.candidate` y se reabrió. Android confirmó inicio en frío. El operador confirmó regreso al panel y activación de notificaciones, incluido permiso Android y mensaje de éxito.
- El registro Android real pertenece al restaurante `550cd3d2-eead-4f4a-8505-df582abc001b`, no al restaurante histórico `998d4980-a169-469f-b009-634a373ca7ad`. No confundir ambas identidades ni dirigir pruebas al restaurante equivocado.
- Envío protegido desde una versión temporal sin tráfico, usando el registro cifrado en D1 y el secreto FCM heredado sin extraerlo. Firebase respondió `sent`; el operador confirmó recepción de la notificación en el Honor.
- Recibo local: `work/honor-push-qa/receipt.json`; hora de envío 2026-10-06 22:34 Ecuador (2026-10-07 03:34 UTC). Sin pedidos ficticios ni modificación del tráfico de producción.
- El endpoint temporal solo admite POST autenticado con una credencial aleatoria y vence a los diez minutos. No es un endpoint público del producto ni parte de la candidata final.

## Alcance y requisitos restantes

El operador confirmó además acceso correcto al creador en la candidata con contraseña y TOTP. Este caso queda aprobado por confirmación directa; no se solicitaron ni copiaron credenciales.

Posteriormente se verificó el despacho real desde la cola y la recepción en segundo plano: recibo `work/honor-push-qa/receipt.json`, 2026-10-06 22:49 Ecuador, evento `bbc604a8-a559-4f1e-929a-1eddf8a191a5`. El trabajo quedó drenado y Android registró la notificación de la APK mientras estaba en segundo plano. No se creó un pedido de cliente ficticio. Esto no sustituye la verificación de la programación periódica después del corte ni prueba todos los cinco eventos comerciales.

Las cinco preferencias se guardaron en la vista autenticada de la candidata y reaparecieron con los mismos valores tras recargar. La impresión privada y la conciliación final siguen siendo condiciones previas al corte.

La candidata permanece sin tráfico. Aún deben completarse aceptación del creador/TOTP, preferencias e impresión privada sobre D1, control de cambios generados en la copia por QA y conciliación final de tres vías con la fuente Firestore. Las escrituras de QA no deben descartarse indiscriminadamente: especialmente sesiones recordadas, dispositivo push y auditoría.

Producción continúa en Firestore mientras se resuelven estas verificaciones. No ejecutar los scripts históricos de corte dirigidos a versiones antiguas.

## Impresión privada y prueba final — 6 de octubre, 23:26 Ecuador

La vista nativa Android abrió con los datos WiFi ilustrativos del restaurante del Honor. La captura privada `work/d1-production-candidate/honor-print-wifi.png` muestra la clave ampliada y `1/1` páginas. Se decodificó el QR de esa captura: contiene únicamente URL HTTPS y no contiene la clave ilustrativa. El hostname es una vista previa porque la APK instalada es de prueba; no imprimir ese QR para clientes.

Los campos WiFi se restauraron desde el respaldo cifrado mediante CAS y comparación exacta; no se modificaron otros ajustes ni pedidos. Se repitió cierre completo/reapertura de la APK: Android reportó inicio en frío, 1.257 ms. La confirmación de regreso al panel después del desbloqueo local está solicitada al operador y no se da por recibida antes de su respuesta.

Confirmación recibida del operador el 7 de octubre, 04:59 UTC: el Honor vuelve al panel sin correo/contraseña y permanece estable durante 20 segundos después del desbloqueo. Recibo local `work/d1-production-candidate/honor-session-confirmation.json`. Esta prueba corresponde a la APK de aceptación; no equivale a trasladar cookies al hostname productivo.

## Inventario de cambios tras aceptación

Comparación de solo lectura contra el respaldo inicial verificado: D1 contiene 1.664 documentos frente a 1.601 de la copia inicial. Se detectaron 63 altas y 7 modificaciones, sin eliminaciones. Los grupos afectados incluyen auditoría, acceso, miembros/usuarios, límites de intentos, configuración y dispositivos push. No se detectaron cambios en categorías, platos, promociones, pedidos ni líneas. Recibo: `work/d1-transition/qa-delta.json`.

No ejecutar una reimportación del respaldo sobre estas filas. La conciliación estricta de tres vías debe rechazar cambios independientes hasta que se revise su política de conservación y se compare también la fuente actual. Esta revisión todavía no equivale a conciliación final ni autoriza activar datos divergentes.
