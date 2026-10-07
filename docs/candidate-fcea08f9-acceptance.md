# Candidata fcea08f9 — aceptación del 5 de octubre de 2026

Versión `fcea08f9-90ed-498c-b79f-6538ff8d6444`, tráfico 0%. Producción D1 `62bff004-11c0-4fa7-9047-b5a26a9cc0f1` permanece al 100%. Sin mantenimiento.

**Resultado: los seis puntos del checklist de aceptación solicitado están aprobados.** Creador con TOTP, dueño, validación del pedido, cinco avisos persistentes, WiFi/QR privado, alias UUID y persistencia física se detallan abajo. Esta aceptación no ejecuta ni sustituye la conciliación final y el corte de producción.

## Identidad y corrección

Worker SHA-256 `44f0b30e17a44dcac14365c844c564eff7e06cd2d451782f2c8020bd451a6e5a`. Assets conservados del build aceptado, FCM servidor/navegador desactivados. Se preservaron la clave de cifrado y los demás bindings. El acceso Firebase corrige el correo legacy del creador y las llamadas fetch con receptor incorrecto; ver `creator-firebase-email-transition-fix.md`.

APK independiente `ec.qrmenu.app.candidate`, versión `0.8.0-candidate-fcea08f9`, SHA-256 `757bc3241d63e86923b0b49abbb48074d1a626b6a595867133dbc0f78992020c`. Instalación y arranque ADB correctos en Honor LNA-LX3.

Actualización posterior con impresión nativa: APK SHA-256 `4aaffef38139d02deb02c7f2b0bd3f9897cd4a1bf6761a999b272d336c8eae4b`, compilación/lint Android correctos, instalación `Success`, arranque frío 1226 ms. Conserva paquete, firma de prueba, hostname y datos. El hash anterior corresponde a las pruebas previas a añadir OwnerPrintBridge.

## Aprobado

- Creador: el operador confirmó acceso completo con contraseña y código TOTP.
- Dueño: el operador confirmó acceso al panel en la APK candidata.
- Persistencia física: force-stop del paquete candidato seguido de arranque frío (`LaunchState: COLD`, 986 ms). El operador desbloqueó y confirmó: «Sí, entra y permanece estable». El árbol Android posterior muestra `Panel conectado`, navegación privada y carta del restaurante.
- Pedido incompleto: prueba Playwright contra el origen candidato aprobada, con errores visibles, foco, scroll, repetición y movimiento reducido.
- API anónima: menú correcto; preferencias, estado e impresión privada rechazan acceso sin sesión. UUID redirige al hostname canónico esperado.
- Avisos: desde el panel del Honor se invirtieron las cinco preferencias, se guardaron y se reabrió su sección. Firestore confirmó las cinco opciones y la pantalla cargó el mismo estado. El intervalo de inactividad se cambió de 8 a 6 horas y Firestore confirmó 6.
- Limpieza de QA: se restauró la ausencia original del documento de preferencias, comprobando primero los valores exactos de ensayo y usando precondición de revisión. Solo se eliminó el documento nuevo creado por la prueba; cero documentos importados y cero pedidos tocados. Recibo privado `preferences-qa-cleanup.json`. Al cargar de nuevo rigen las preferencias originales por defecto.
- Dominio remoto: consulta de repositorio de solo lectura confirmó `la-sazon-marinera.consola.workers.dev` como principal activo del UUID esperado.
- WiFi: guardado real desde el Honor; Firestore contiene `wifiCiphertext` con versión `v1`, sin campo de contraseña en claro y sin la clave de ensayo en el documento. La clave desaparece del formulario después de guardar.
- QR generado en la APK: se decodificó desde captura del dispositivo físico. Payload exacto `https://la-sazon-marinera.consola.workers.dev/menu`, sin clave WiFi. Recibo `honor-qr-decoded.json`.
- Impresión nativa corregida y verificada: el sistema abrió `com.android.printspooler/.ui.PrintActivity` y la vista previa PDF mostró la red de ensayo y `WiFi gratis · Clave: …` bajo el QR. Captura privada `honor-print-preview.png`.
- WiFi desactivado/restaurado desde el panel: Firestore confirmó nombre vacío, contraseña cifrada ausente y opción desactivada. La segunda impresión eliminó por completo la red y clave; captura privada `honor-print-without-wifi.png`. Los trabajos de impresión se cancelaron tras revisar sus vistas previas, sin enviar a impresoras externas.
- Con WiFi habilitado durante QA, el menú público no expuso credenciales y la impresión privada siguió devolviendo 401 sin sesión.
- Autenticación: 13 pruebas y TypeScript aprobados tras detener el daemon Gradle que competía por memoria.

Evidencias privadas fuera de Git: `work/migration-preparation/preferences-evidence-*.json`, `honor-notifications-reloaded.png`, `candidate-readonly-smoke.json` y `creator-transport-fix-version.json`. El script de evidencia permite solo lecturas, no imprime contraseñas, ciphertext ni tokens.

## Incidencia corregida durante aceptación

La impresión desde APK falló: el botón realizó su consulta privada pero `window.print()` no abrió Android. La documentación oficial de Android confirma que WebView no inicia impresión mediante JavaScript. Se implementó `OwnerPrintBridge`, limitado al origen HTTPS y frame principal; usa `PrintManager`/`createPrintDocumentAdapter` y conserva el DOM ya autorizado. No recibe HTML, contraseñas ni credenciales. El Worker y sus assets permanecen iguales.

APK con puente instalada y ambas vistas previas aprobadas. Preferencias de avisos y WiFi restauradas. Se repite el cierre completo y reapertura de esta última APK como comprobación final de persistencia.

Comprobación final completada: force-stop explícito de `ec.qrmenu.app.candidate`, arranque `COLD` de la APK con impresión nativa (853 ms). El operador confirmó después de desbloquear y observar: «Sí, entra y queda estable». La persistencia está aprobada también en el artefacto final. Se restauró `stay_on_while_plugged_in=0`, su valor inicial, tras la prueba USB.

Captura final `work/migration-preparation/honor-final-reopen.png`: panel conectado, carta del restaurante y navegación privada visibles. El árbol de accesibilidad transitorio estaba vacío; se verificó visualmente la captura real en lugar de interpretarlo como fallo de sesión.

Verificación final de Cloudflare a las 06:41:07 UTC del 5 de octubre (01:41:07 Ecuador): candidata 0%, producción anterior 100%, configuración Firebase/Firestore correcta, FCM desactivado y secretos presentes sin mostrar valores. Recibo `work/migration-preparation/acceptance-final-traffic.json`.

Referencia: https://developer.android.com/training/printing/html-docs (consulta 2026-10-05).

No confundir los casos aprobados con una aprobación del corte. Antes de activar corresponde conciliar los cambios finales de D1 y preservar los cambios de Auth, dispositivos, preferencias y auditoría creados durante aceptación en Firestore. No volver a importar ciegamente el snapshot anterior encima de estos documentos.
