# Candidata b5cc3b53 — aceptación sin tráfico

Fecha: 2026-10-05 UTC.

## Preparación completada

- Versión: `b5cc3b53-5413-4431-9338-602888a88a48`.
- Origen: `https://b5cc3b53-qr-menu-ec.consola.workers.dev`.
- Creada por `scripts/stage-auth-candidate-beta.mjs`, con `deploy=false` explícito; no se llamó al endpoint de despliegues para modificar tráfico.
- Herencia por UUID desde `22052178` resuelta mediante la API beta de creación, sin extraer secretos ni buscar alternativas criptográficas. DATA_ENCRYPTION_KEY y las cuentas técnicas se conservaron dentro de Cloudflare.
- Únicas adiciones de bindings: AUTH_PROVIDER, FIREBASE_PROJECT_ID, FIREBASE_API_KEY y MAINTENANCE_MODE=false. Igualdad de todos los demás bindings verificada contra 22052178.
- Código SHA-256: `0735e1ce5be7c2aab10b5a944096966a1bda02151126c503eef132faff34e485`.
- Manifiesto de 30 assets SHA-256: `e3b2b2dbd000f65b1ffd5b89ed9e7e73d3e69e069ba789db81af5c8bc4d82f4e`.
- Código y assets idénticos a 22052178; FCM servidor y navegador siguen desactivados.
- Recibo privado: `work/migration-preparation/auth-candidate-beta.json`.
- Turnstile: se añadió también el nuevo hostname al widget existente; se conservaron los dominios anteriores, ajustes y secreto.
- Producción `62bff004` al 100%; candidata al 0%. Sin mantenimiento. Copia Firestore conservada.

## Pruebas completadas contra la candidata

- `/api/creator/session`: HTTP 200, configurado, proveedor Firebase, TOTP configurado, sesión anónima no autenticada.
- Menú publicado: HTTP 200 y restaurante correcto.
- Estado, cinco preferencias, WiFi y endpoint privado de impresión: HTTP 401 sin sesión.
- UUID público: redirección al hostname canónico HTTPS esperado; no se siguió hacia producción D1.
- Validación visual real en demo: pedido vacío, opciones requeridas, alias, foco, scroll, resaltado rojo, errores repetidos y movimiento reducido; prueba automatizada aprobada. Los envíos de pedidos reales están bloqueados por el script de QA.
- Recibo: `work/migration-preparation/candidate-readonly-smoke.json`, resultado aprobado solo para su alcance no autenticado.
- APK separada `ec.qrmenu.app.candidate` recompilada con el nuevo hostname e instalada correctamente por ADB. No reemplaza ni borra la app original.
- Honor: arranque frío correcto, 3915 ms. APK SHA-256 `3023c047d038a005f17a7328ebff1879447d74e63cb851938bc139c3a513b6da`.

## Aceptación completa: pendiente de intervención personal

Se solicitó al usuario ingresar manualmente en la app **QR Menu EC · PRUEBA**, marcar **Recordar este celular**, y completar huella/PIN; además ingresar al creador con su TOTP en el origen candidato. No se solicitaron valores de contraseña ni códigos, ni se fabricaron sesiones para sustituir estas pruebas.

Pendiente después del login: guardar/recargar los cinco avisos, WiFi cifrado y vista privada de impresión, comprobación autenticada de permisos y repetir cierre total/reapertura estable del Honor con desbloqueo personal. Estos casos **no están aprobados**. `mfaConfigured=true` comprueba conservación de la configuración, no una verificación TOTP exitosa.

No activar producción hasta finalizar estos casos y repetir conciliación final. Los eventos de auditoría y sesiones generados por QA en Firestore deben preservarse y distinguirse de los datos importados; no tratar el destino como vacío.
