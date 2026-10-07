# Conciliación y aceptación sin mantenimiento

Fecha de comprobación: 2026-10-05 UTC (noche del 4 de octubre en Ecuador).

## 1. Conciliación — sin cambios de negocio en el corte comparado

Se descargó y verificó un respaldo nuevo de D1 a las 00:51:40 UTC. Su SQL y su inventario tienen los mismos SHA-256 que el respaldo final de la ventana anterior. Las once tablas coinciden, incluidos dos restaurantes y creador, siete pedidos, dieciséis imágenes, 472 eventos de auditoría y doce dispositivos recordados.

- SQL SHA-256: `b84a092a9691b256d5e70c0c03477e8b7b59ed236063d994c679ad792cf58d6c`.
- Inventario SHA-256: `8544c7971a8d974762f875ee1fce54706dc7c91ee207a32805848e9992688c9c`.
- Respaldo nuevo cifrado fuera de Git: `work/private-backups/2026-10-05T00-51-43.192Z-a25a1c30`.
- Verificación remota completada a las 00:55:21 UTC: 734 documentos de datos, todos idénticos al manifiesto validado; 0 ausentes y 0 modificados. Inventario total: 1469, incluidos diario por documento y marcador del run.
- Cambios necesarios por diferencias D1 en ese corte: **0 altas, 0 actualizaciones**.
- Recibo: `work/migration-preparation/reconciliation-2026-10-05.json`.

El script `scripts/reconcile-readonly.ts` solo permite lecturas de Firestore; no crea claves técnicas ni modifica documentos. Se niega a dar una cifra si el respaldo D1 cambia: en ese caso será necesario generar un manifiesto nuevo en aislamiento. Esta es una comparación puntual, no una garantía de inmovilidad futura.

Las pruebas HTTP posteriores pueden generar auditoría en Firestore (y la consulta de sesión de producción puede generar auditoría en D1). Esos eventos no son pérdida ni diferencias de negocio: deben preservarse y clasificarse separadamente. No borrar el destino ni reutilizar el importador de destino vacío para conciliación. No se modificaron ni eliminaron los 734 documentos base para ejecutar esta comparación.

## 2. Aceptación de 22052178 — BLOQUEADA, no autorizar corte

La candidata ya tiene configurados Firestore remoto y su credencial, con FCM desactivado. Se comprobó que producción `62bff004` conserva el 100% y la candidata el 0%. No se abrió mantenimiento.

Verificado contra la URL real de versión:

- Menú publicado correcto: HTTP 200, UUID esperado.
- Validación visual en viewport móvil: pedido vacío, opciones obligatorias, repetición del error, alias, foco, scroll, borde rojo y movimiento reducido. Pasó `scripts/order-feedback-qa.mjs` con `QR_QA_CANDIDATE_ORIGIN` apuntando a la candidata. El script bloquea envíos y saltos a producción.
- Preferencias, WiFi, impresión privada y estado: HTTP 401 sin sesión.
- UUID `/menu`: redirección HTTPS al hostname canónico correcto. No se siguió esa redirección, porque su destino usa producción D1.
- Creador configurado y TOTP configurado: ambos verdaderos. Esto no prueba un acceso TOTP completo.

### Fallos reproducidos

1. Turnstile muestra **Unable to connect to website**. La API de Cloudflare confirmó que el widget permite únicamente `qr-menu-ec.consola.workers.dev` y `la-sazon-marinera.consola.workers.dev`; no incluye `22052178-qr-menu-ec.consola.workers.dev`. El usuario confirmó el mismo fallo. No se deshabilitó Turnstile ni se cambió el widget compartido.
2. `/api/creator/session` devuelve `authProvider: legacy`. La inspección de bindings confirmó que no está habilitado `AUTH_PROVIDER=firebase` en esta candidata. `FIREBASE_SERVICE_ACCOUNT` está presente, pero su presencia no activa el proveedor. El TOTP no se perdió. Se requiere corregir/verificar la configuración de Auth en una nueva versión sin tráfico antes de declarar el Paso 3 operativo en esta candidata.

Recibo de sondas: `work/migration-preparation/candidate-readonly-smoke.json` (resultado global fallido deliberadamente). Captura del fallo: `work/migration-preparation/candidate-login.png`.

### Honor

Honor LNA-LX3 conectado por ADB. Se añadió un build Android separado `candidate`:

- Paquete `ec.qrmenu.app.candidate`, etiqueta **QR Menu EC · PRUEBA**.
- Host fijo de candidata; enlaces externos bloqueados; cookies y datos separados del paquete original.
- Firma de desarrollo, no distribuible como APK de producción. La identidad/firma de la APK de producción no se modificó.
- Compilación `assembleCandidate` correcta; instalación correcta; arranque frío correcto en 1680 ms y proceso posteriormente activo.
- APK: `native/android/app/build/outputs/apk/candidate/app-candidate.apk`.
- SHA-256: `71e3257b7970659dee42840e26b5dea080ef2130f24cfed9fb11537b18b0a683`.

No se copiaron cookies ni credenciales de la app original. **Persistencia después de login y cierre forzado en candidata: no verificada**, porque Turnstile bloquea el acceso. Abrir la app de producción no sustituye esta prueba.

### Pendientes de aceptación, no marcarlos como aprobados

Acceso del dueño, desafío TOTP completo del creador, guardar y recargar los cinco avisos, WiFi cifrado y descifrado exclusivamente en impresión autenticada, aislamiento entre usuarios autenticados, generación de avisos y persistencia de la sesión en el Honor. Requieren primero resolver ambos bloqueos. La APK y la web de prueba no deben seguir enlaces al dominio de producción para aparentar éxito.

## Siguiente acción necesaria

### Actualización 01:04:39 UTC — hostname corregido; bloqueo adicional de Auth

Con autorización explícita, se añadió `22052178-qr-menu-ec.consola.workers.dev` al widget Turnstile existente. La verificación de API confirmó que ambos dominios anteriores, los demás ajustes, sitekey y secreto siguen intactos. Producción conserva su despliegue anterior al 100%. No se creó otro widget ni se abrió mantenimiento. Recibo: `work/migration-preparation/turnstile-candidate-fix.json`.

Antes de crear una versión con `AUTH_PROVIDER=firebase`, la inspección confirmó que también faltan **FIREBASE_PROJECT_ID** y **FIREBASE_API_KEY** en la candidata. **FIREBASE_SERVICE_ACCOUNT** sí existe. El constructor `FirebaseAuthProvider` rechaza la configuración incompleta con `AUTH_NOT_CONFIGURED`; activar únicamente el flag introduciría un fallo conocido. Por eso no se creó ni activó una versión inválida y se detuvo la aceptación para informar del nuevo bloqueo, conforme a lo solicitado. Se requiere incluir las dos variables adicionales del mismo proyecto en la nueva candidata, sin cambiar secretos ni bindings existentes.

La autorización del hostname por API no equivale a login manual aprobado. Los casos autenticados y Honor continúan sin aprobarse; no se cambió el host de la APK porque todavía no existe nueva versión.

Autorizar/configurar el hostname de prueba en Turnstile conservando la protección y los dominios actuales, y preparar una versión sin tráfico con la configuración completa de Firebase Auth, manteniendo todos los demás bindings y TOTP. Actualizar el hostname de la APK de prueba si cambia la URL de versión. Repetir aceptación con acceso manual del usuario, sin registrar credenciales. Solo después preparar el corte final y volver a conciliar bajo congelación.
