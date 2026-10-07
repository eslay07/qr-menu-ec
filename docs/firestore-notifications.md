# Notificaciones del dueño — Paso 4

Actualización 05-10-2026: bandeja y preferencias ya en producción Firestore. Push preparado en candidata sin tráfico, pendiente de recepción real. Las 16 fotos permanecen en D1; R2 nunca se activó y Storage no es necesario para esta entrega.

Las preferencias se guardan en `restaurants/{id}/settings/notifications`, con control de revisión. El panel Ajustes permite activar nuevo pedido, cancelación por comensal, agotado, resumen diario e inactividad de 1 a 168 horas. Los tres primeros están activos por defecto; los avisos programados requieren activación expresa.

La bandeja muestra páginas de 30 avisos, ordenadas por fecha e identificador para evitar saltos cuando coinciden fechas. Permite actualizar, cargar anteriores y marcar como leído. Solo usa endpoints autenticados; las mutaciones mantienen CSRF y autorización del servidor. Los avisos push requieren habilitación del entorno y consentimiento del dispositivo; no se promete entrega inmediata ni eludir restricciones del sistema operativo.

## Entrega push implementada

- `pushJobs` se escribe en la misma operación atómica que el aviso/pedido. El programador preparado consulta una cola acotada cada minuto; no recorre todos los restaurantes por minuto. Mantenimiento pesado solo cada hora. Índice de grupo preparado en `firestore.indexes.json`, sin publicar.
- Cinco preferencias se vuelven a comprobar al enviar. Los restaurantes suspendidos no reciben push. Los pedidos de demostración/importaciones históricas no generan push.
- `POST/DELETE /api/v1/push/device`: autorización de dueño/creador, CSRF, entrada estricta de hasta 5 KB, límite de 20 cambios/hora y hasta 20 dispositivos/restaurante. Claves de registro cifradas; índice hash global evita enviar dos restaurantes al mismo token. El cierre de sesión revoca registros asociados; cambios de epoch y suspensión invalidan dispositivos.
- Caducidad de dispositivos a 30 días con renovación al abrir el panel. Limpieza horaria de registros expirados. Se comprueba que el dispositivo siga existiendo antes de enviar. No se guardan contraseñas ni sesiones en el servicio Android.
- Arrendamiento CAS evita procesadores concurrentes. Backoff desde 60 segundos, seis intentos y ventana de una hora. FCM `UNREGISTERED` elimina el token; errores de payload no se confunden con tokens expirados. La bandeja conserva el aviso aunque el push falle. Entrega al menos una vez: etiquetas estables evitan múltiples tarjetas del mismo evento; no se promete exactamente una vez.
- Cada ejecución tiene un presupuesto compartido de 20 envíos, cinco restaurantes y 25 segundos antes de iniciar otra operación. Lo no procesado conserva la cola sin gastar intentos de fallo. Dimensionar este límite con las pruebas de volumen antes de vender entrega de alto tráfico; cuotas Firestore/Workers y restricciones del sistema operativo siguen aplicando.
- Payload genérico sin alias, platos, importes, contraseña WiFi ni enlaces opacos. Al tocar se abre el panel y se exige autorización normal.
- Web: SDK modular y service worker propio, sin CDN/compat. Consentimiento explícito, recepción en primer y segundo plano, activación/desactivación por dispositivo, preferencia local no secreta. CSP limitada a los endpoints de Firebase requeridos.
- Android: SDK FCM, permiso `POST_NOTIFICATIONS` en Android 13+, canal nativo, privacidad de pantalla bloqueada y puente AndroidX restringido a `https://qr-menu-ec.consola.workers.dev` y marco principal. Solo pide permiso al activar; la inicialización automática de FCM/Analytics está deshabilitada. Sin Google Play Services compatibles se explica el fallo y la bandeja sigue funcionando.

## Configuración y aceptación antes de producción

`FCM_ENABLED=false` y `VITE_FCM_ENABLED=false` son los valores predeterminados. Para un entorno de prueba aislado se necesitan Firestore configurado, clave de cifrado, la credencial FCM independiente, índices y `VITE_FIREBASE_VAPID_KEY` pública. No copiar cuentas técnicas a VITE ni APK. La credencial FCM permanece en la versión no desplegada documentada en `firebase-remote-credentials-status.md`.

El certificado VAPID se generó en Firebase con autorización expresa y confirmación visible. Solo su clave pública se guardó en `.env.local` (excluido de Git); privada no descargada. La compilación del camino web se repitió con esa clave real. Los flags predeterminados permanecen desactivados. Esto no cuenta como recepción real.

Prueba viva `node scripts/push-live-local-check.mjs`: perfil desechable, localhost, sin datos del restaurante y sin escribir Firestore. Se corrigió el middleware del servidor de prueba para servir JavaScript real del service worker antes de la ruta HTML. El navegador headless reducido devuelve permiso bloqueado; Chromium completo y Chrome instalado reconocen permiso `granted`, pero la suscripción devuelve `Registration failed - permission denied`. No hubo token FCM ni mensaje enviado. La limpieza con `deleteToken` terminó correctamente y se cerraron perfil/servidor. Resultado **inconcluso por entorno**, no aprobado: el script devuelve código 2 cuando no puede demostrar recepción. La prueba real debe completarse en navegador interactivo o teléfono conectado; ADB volvió a mostrar inventario vacío.

Aceptación manual de sistema: consentir/rechazar notificaciones; recibir cada tipo en primer/segundo plano; cerrar sesión y comprobar cese; suspender restaurante; cambiar cuenta en el mismo dispositivo; Android con permiso denegado y sin Play Services; cortar red y recuperar. ADB sin dispositivo conectado el 29-09-2026. Nunca llamar a la recepción física «probada» por una compilación correcta.

También se intentó `push-live-local-check.mjs --interactive` con ventana real de Chrome y perfil desechable: mismo rechazo de suscripción (`permission denied`) con permiso de notificaciones concedido. No es solo una limitación del modo headless. No se modificaron políticas de Chrome, del sistema o de red para forzar el registro. Se requiere comprobar recepción en otro entorno/dispositivo; la causa del rechazo del servicio push de este equipo no está demostrada.

## Evidencias locales — 29-09-2026

- `npm test`: 40 aprobadas, cero fallos; 11 casos reservados al emulador no se cuentan como aprobados en este comando.
- Suite completa contra emulador: 20/20 aprobadas, incluidas restauración, WiFi cifrado, reglas de push y cola/reintentos/revocación.
- TypeScript y compilación web con ruta push incluida: correctos. Entrada push separada evita descargar/inicializar Firestore o Storage para recibir notificaciones.
- Auditoría npm: cero altas/críticas; 14 moderadas documentadas. No se aplicaron degradaciones forzadas de herramientas.
- `scripts/order-feedback-qa.mjs`: foco, scroll, repetición y movimiento reducido correctos.
- `scripts/push-worker-qa.mjs`: lógica real del service worker con adaptador de visualización simulado. Comprueba payload genérico, etiqueta y supresión tras baja. El primer intento con visualización nativa quedó pendiente en Chrome headless/Windows; se detuvo únicamente ese proceso de prueba. No se sustituyó por una afirmación de recepción física.
- Android `assembleDebug` y `assembleRelease` correctos; firma v3 verificada. APK de pruebas `outputs/QR-Menu-EC-push-pruebas.apk`, SHA-256 `2AD3B22EBB4E1CA0F1FE5333B84D3A73B581FAAE940DE1FF08491687B46F5F7D`. Conserva identidad y versión 0.8.0/código 11. No instalada ni publicada; el backend de producción sigue sin los cambios locales.

El mantenimiento emite como máximo un resumen y una alerta de inactividad por día/restaurante mediante identificadores deterministas. Resumen del día anterior en UTC−5: solo pedidos reales confirmados, suma íntegra paginada de cabeceras, sin descargar líneas ni confundir pedidos con pagos. Los restaurantes suspendidos no reciben estos avisos. La inactividad cuenta horas naturales; no existe todavía un calendario de horarios de atención.

Pruebas dedicadas: `tests/firestore-notifications.test.ts` cubre paginación con fechas iguales, aislamiento, lectura, conflictos de revisión, filtros del resumen con más de una página, preferencias desactivadas y deduplicación. Ejecutar exclusivamente contra proyecto demo en emulador local.
