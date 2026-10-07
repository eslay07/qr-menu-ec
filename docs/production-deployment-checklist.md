# Checklist de despliegue — 5 de octubre de 2026

> CONTINUACIÓN 6 DE OCTUBRE: candidata D1 `59cf7bb8-3b42-45fc-875c-417e65657fb4`, sin tráfico. La lectura de Firestore se recuperó; respaldo actual de 1.601 documentos cifrado y restauración verificada. La copia preparatoria está en curso, todavía sin conciliación final ni corte. Producción continúa `724862e7` al 100 %. Turnstile acepta el hostname de la candidata conservando el widget y los dominios existentes. Honor no detectado por ADB en esta comprobación. Las versiones y bloqueos de los párrafos inferiores son históricos.

> PREPARACIÓN VIGENTE D1: `6704b0f3-cae4-42c5-883c-1c6daff86714`, 0% de tráfico, `DATA_PROVIDER=d1-documents` y base operativa independiente. El acceso de lectura a Firestore sigue devolviendo 429 y bloquea la conciliación/corte. Consultar `d1-provider-cutover.md`; no ejecutar los scripts históricos que apuntan a `62bff004`. Los ensayos sintéticos no constituyen aceptación con datos actuales. FCM real y el corte D1 aún no están aprobados por pruebas completas de esta candidata.

> ESTADO VIGENTE: producción activada con `724862e7-0c75-4bdd-b01a-4067891f78fe` al 100%. Conciliación final, respaldo restaurable, reglas, TOTP, impresión Honor/desktop y convergencia verificadas. FCM continúa desactivado. Ver `final-cut-2026-10-05.md` y `print-qr-final-acceptance.md`. Las anotaciones siguientes son el historial del checklist, no bloqueos vigentes ni autorización para regresar a D1 sin conciliar nuevas escrituras.

> Actualización del 5 de octubre: la candidata vigente para aceptación es `fcea08f9-90ed-498c-b79f-6538ff8d6444`. El acceso Firebase con TOTP, preferencias reales, WiFi cifrado e impresión nativa del Honor se documentan en `candidate-fcea08f9-acceptance.md`. Los estados inferiores describen fases históricas; no significan que el destino siga vacío ni sustituyen los recibos actuales. Producción `62bff004` sigue al 100%. Para el corte final deben preservarse las transiciones Auth, sesiones y auditoría generadas en Firestore durante QA y conciliar los cambios D1; no reimportar ciegamente el snapshot inicial.

> Estado actualizado de preparación al 3 de octubre: ver `remote-migration-preparation.md` y `production-checklist-results.md`. El importador remoto y la guarda de mantenimiento están implementados localmente, no desplegados. Punto 4 de configuración Firestore VERDE: reglas publicadas, 6 índices compuestos READY y 6 configuraciones por campo verificadas; destino inventariado vacío. Migración/corte aún no autorizados. Las casillas históricas inferiores no sustituyen los recibos secuenciales.

## Alcance y decisión

Validación visual del pedido, WiFi opcional en impresión privada y cinco preferencias de avisos del dueño. Este documento **no autoriza desplegar**. Fotos permanecen en D1; R2 nunca se activó, según confirmación del operador. No activar Firebase Storage. Las preferencias del panel no equivalen a recepción push real verificada.

**Bloqueo histórico resuelto:** no se activó Firestore solo por crear la base. Se completaron ensayo, conciliación y corte autorizado antes de activar. Las pantallas WiFi/preferencias usan ahora el repositorio Firestore; no se publicó solo un frontend sobre D1.

## Verificación local

- [x] `npm run check`: TypeScript sin errores.
- [x] `npm test`: 40 aprobadas, cero fallos; 11 pruebas requieren emulador y se ejecutan por separado.
- [x] `npm run test:firestore`: 20 aprobadas, cero omitidas; incluye cifrado WiFi, revisiones, avisos y restauración.
- [x] `npm run build:worker`: compilación correcta.
- [x] `node scripts/order-feedback-qa.mjs`: pedido vacío, opciones obligatorias, alias, foco, scroll, resaltado y movimiento reducido.
- [x] `node scripts/preferences-qa.mjs`: cinco avisos, recarga de preferencias, WiFi, conservación ante conflicto y limpieza del campo secreto; API simulada, persistencia real cubierta por emulador.
- [ ] Prueba física completa Honor LNA-LX3: conectado; APK 0.8.0/código 11 abre tras cierre forzado (`LaunchState: COLD`, 1.441 ms) y se observó activa después. El usuario confirmó que **pide iniciar sesión**: aceptación de sesión persistente fallida. Corrección local de renovación aún no desplegada; probar candidata antes de liberar. No borrar datos del celular para ocultar el fallo.

## Antes de autorizar el corte

- [ ] Identificar versión exacta del Worker vigente, versión candidata, artefactos y sus SHA-256. Conservar la versión anterior para reversión.
- [ ] Respaldar D1 y el inventario/archivos de R2; cifrar y conservar fuera de Git. Verificar checksums y ensayo de restauración de catálogo, publicación, pedidos, líneas y enlaces.
- [ ] Ejecutar ensayo aislado con una exportación aprobada según `migration-rehearsal.md`. El script actual rechaza producción: no modificar ese control para improvisar un corte.
- [ ] Preparar y verificar el procedimiento de importación remota con identidad exclusiva Firestore y permisos mínimos, reglas e índices. Comparar UUID, membresías, borradores/publicaciones, promociones, pedidos/líneas, dominios y registros privados del creador; TOTP debe conservarse.
- [ ] Probar la candidata en entorno separado con datos de ensayo. Ninguna tarea programada ni correo de prueba debe operar sobre clientes reales.
- [ ] Inventariar los bindings/secrets vigentes sin imprimir valores. Conservar `DATA_ENCRYPTION_KEY`, configuración Auth/TOTP, dominios y acceso a imágenes existentes. Nunca regenerar la clave de cifrado durante este despliegue.
- [ ] Verificar `DATA_PROVIDER`, `FIRESTORE_PROJECT_ID`, `FIRESTORE_REMOTE_ENABLED` y secreto `FIRESTORE_SERVICE_ACCOUNT` en la candidata. Ausencia de cualquiera debe bloquear la activación, no derivar en una instalación vacía.
- [ ] Mantener `FCM_ENABLED=false` y `VITE_FCM_ENABLED=false` para esta entrega de avisos del panel. La recepción real push tiene aceptación propia pendiente; no anunciarla como probada.
- [ ] Verificar auditoría de dependencias actual: ejecutar `npm audit --audit-level=high`. La revisión anterior tenía 14 moderadas, no cero vulnerabilidades; no usar `--force` sin revisar cambios.
- [ ] Aprobar ventana de mantenimiento, congelación de escrituras, copia final, conciliación y responsable de reversión. Obtener autorización explícita para producción.

## Pruebas de aceptación de la candidata

- [ ] Dueño entra; creador conserva TOTP; sesión y permisos no cambian por esta entrega.
- [ ] Pedido vacío muestra explicación visible; opciones obligatorias se resaltan; alias recibe foco; con movimiento reducido no hay sacudida.
- [ ] Guardar cada uno de los cinco avisos y recargar: valores persisten; inactividad acepta 1–168 horas; fallo/conflicto conserva valores.
- [ ] Activar WiFi con una clave de prueba: ajustes no devuelven texto secreto, Firestore guarda ciphertext y solo el endpoint privado de impresión lo descifra.
- [ ] Sin sesión no se accede a impresión privada ni ajustes; otro restaurante no puede leerlos. Mutaciones requieren CSRF.
- [ ] Imprimir muestra nombre y `WiFi gratis · Clave: …` debajo del QR. Desactivar elimina el texto. Pantalla normal, SVG descargado, payload QR y URL no incluyen la clave.
- [ ] Escanear QR antiguo UUID y alias: mismo restaurante, HTTPS, destino correcto, sin bucles. No reimprimir QR que siga resolviendo correctamente.
- [ ] Pedido de ensayo genera aviso; cancelación y agotado generan el suyo; resumen/inactividad respetan preferencias sin duplicación.
- [ ] Comprobar menú e imágenes desde móvil. Reabrir APK tras matar proceso y probar desbloqueo; no sustituir esta prueba con una compilación exitosa.

## Después de una autorización futura

1. Congelar escrituras y obtener copia final. Migrar/reconciliar con procedimiento previamente ensayado; ante diferencias, detener.
2. Activar únicamente la candidata aprobada y comprobar aceptación, errores, latencia y disponibilidad de imágenes. No publicar descargas APK con hashes antiguos.
3. Habilitar escrituras cuando la verificación sea satisfactoria; monitorizar pedidos/avisos y errores sin registrar contraseñas o tokens.
4. Ante fallo: mantener congelación y volver a la versión/datos verificados. Si ya hubo escrituras en Firestore, reconciliarlas antes de volver a D1; cambiar solo el flag perdería pedidos recientes.

No se ha ejecutado ninguno de estos pasos de producción.
