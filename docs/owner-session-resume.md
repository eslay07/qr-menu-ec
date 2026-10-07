# Recuperación de sesión del dueño — 2026-09-28

## Prueba física — 2026-10-02

### Segundo defecto: ciclo de carga del panel — 2026-10-02 (Ecuador)

El usuario informó recargas continuas y nuevo login después de matar la app. La consulta de solo lectura encontró sesiones creadas aproximadamente cada 1,4 segundos, con uso posterior: la cookie sí llegaba al servidor. Causa reproducida: `loadState()` establece primero `session.authenticated=true` y espera después `state`; durante esa espera, `if (!state)` montaba `OwnerLauncher`, que renovaba y navegaba otra vez. No era correcto interpretar esa carga como sesión ausente.

Corrección: mantener skeleton cuando hay sesión válida y catálogo pendiente; si la carga falla, mostrar error y botón Reintentar sin montar login. Añadida tanto al árbol actual como a una copia aislada de HEAD `992aae3`. La compilación anterior aislada reprodujo exactamente los nombres/hash públicos de JS y CSS. No se publicó la migración local.

Regresión `node --import tsx scripts/session-loading-qa.ts`: falla con el frontend anterior (dos solicitudes de acceso/renovación durante carga autenticada) y pasa con la corrección, incluyendo carga lenta y error/reintento. TypeScript y siete pruebas de autenticación pasan. Las pruebas de navegador usan API simulada y no cuentan como aceptación física.

Versión activa del hotfix UI: `62bff004-11c0-4fa7-9047-b5a26a9cc0f1`, publicada tras verificar backend idéntico al hotfix anterior, bindings idénticos y runtime equivalente. Se conservaron bytes públicos de archivos no relacionados y el JS anterior para compatibilidad de caché; cambian el entrypoint `index-CG5hAKz4.js` y su referencia HTML. No se activó Firestore, Storage o FCM. `/owner`, `/creator` y el nuevo JS responden 200.

Honor LNA-LX3, APK 0.8.0/código 11: **aceptación física aprobada**. Primer cierre forzado, ausencia del proceso comprobada y arranque frío en 1.237 ms: usuario confirmó «Panel estable, entró sin login». Segundo cierre forzado y arranque frío en 1.091 ms: tras desbloquear y observar unos 20 segundos, confirmó «Sí, entra y permanece estable». No se borraron datos ni se pidió reingreso entre ambas pruebas. Se conserva el desbloqueo del sistema; no se eliminó seguridad para superar el ensayo.

Esta aceptación cubre dos reaperturas tras matar el proceso, sin login ni recargas. No equivale a probar reinicio del teléfono, 30 días de inactividad o todos los modelos Android. Reversión disponible a `f8544df4-c2a5-495f-8665-f41faecbb1b0`, que conserva el arreglo CSRF pero tiene el defecto UI. No se avanzó con otros despliegues.

### Hotfix mínimo autorizado y desplegado — 2026-10-02

Tras autorización explícita del usuario, se publicó únicamente la validación compatible del CSRF de renovación. Se tomó el bundle público, se verificó SHA-256 `dcb13a9d18831bbfd67bf34b937b68cc722cd430e84f516e3e5ac254a5dad446` y se sustituyó una sola expresión (`length !== 64` por comprobación alfanumérica de 20–64 caracteres). Bundle resultante: `92632b8d50bcf40b5502d816a1aa7714e0d2a60f9b275c27aed32695d1fade06`. No se compiló/publicó el árbol local de migración.

Versión anterior: `230a9997-9ee9-4c32-ac3a-0d1efe9f2a28`. Hotfix activo al 100%: `f8544df4-c2a5-495f-8665-f41faecbb1b0`. Se verificó igualdad de bindings y runtime (normalizando valores predeterminados de assets); el secreto FCM de la versión preparada se excluyó. Sin cambios a datos, cron, Firestore, Storage, interfaz o autenticación del creador. La versión anterior sigue disponible para reversión.

Verificación pública sin credenciales: CSRF sintético de 42 y 64 caracteres devuelve 401 (ya supera la validación de formato pero no autoriza sin cookie); longitud 3 devuelve 403. `/owner`, `/creator` y menú UUID devuelven 200. Honor: proceso detenido, ausencia comprobada y reapertura fría en 919 ms. **Esperando confirmación del usuario tras desbloqueo: todavía no declarar aprobada la persistencia física.**

Script de preparación auditado: `scripts/session-hotfix.mjs`; restringido al hash/versión de origen anterior para impedir su reutilización accidental sobre otra versión. No debe ejecutarse como despliegue general.

Comprobación posterior de solo lectura: el permiso creado a las 22:39:02 UTC registró uso a las 22:47:07 UTC y la longitud del CSRF pasó de 43 a 41, consistente con la rotación. No se expusieron tokens. Confirma que la renovación alcanzó la rotación del servidor; falta la confirmación visual del panel por el usuario para cerrar la aceptación completa.

### Repetición con candidata instalada y diagnóstico remoto

Se reinstaló con `adb install -r` la candidata firmada `QR-Menu-EC-push-pruebas.apk` (SHA-256 `2AD3B22EBB4E1CA0F1FE5333B84D3A73B581FAAE940DE1FF08491687B46F5F7D`). El usuario confirmó acceso al panel. Se ejecutó `am force-stop`, se comprobó ausencia del proceso y se abrió OwnerActivity en frío (749 ms). El usuario confirmó que volvió a pedir correo y contraseña: **prueba fallida**.

Diagnóstico no mutante del backend público: consulta D1 exclusivamente de fechas/longitudes (cero escrituras) encontró un permiso reciente, no revocado, con CSRF de 43 caracteres; los dos anteriores tenían 40 y 43. Dos solicitudes sintéticas sin cookies a renovación dieron 403 para longitud 42 y 401 para longitud 64. Esto evidencia que la validación pública todavía rechaza el formato generado antes de comprobar el dispositivo. No se imprimieron tokens ni contraseñas.

La corrección local de `lib/owner-auth.ts` ya acepta el formato generado y después exige igualdad exacta con el CSRF del permiso. Siete pruebas de `tests/owner-auth.test.ts` aprobadas. No se alteró Firebase para almacenar tokens en localStorage ni se omitió autenticación. Instalar esta APK no actualiza el Worker al que apunta. Para repetir la aceptación del arreglo hace falta una candidata de backend aislada con configuración de prueba o autorización explícita de un hotfix mínimo al backend público. No publicar el árbol completo de migración para solucionar esta línea. No continuar al checklist ni declarar sesión persistente resuelta hasta repetir la prueba física satisfactoriamente.

Honor LNA-LX3 conectado por ADB. APK instalada 0.8.0/código 11: cierre forzado y arranque frío de OwnerActivity correctos (1.441 ms); actividad observada en primer plano después. No se borraron datos ni se instaló otra APK. El usuario confirmó que después del desbloqueo pide iniciar sesión. **Persistencia no aceptada en la versión pública.** La APK carga el backend público: esta prueba no ejecutó la corrección local descrita abajo. No concluir que la causa actual es exclusivamente el CSRF sin observar el flujo de renovación en una candidata controlada. Sigue siendo condición de aceptación previa a producción; no se desplegó nada.

Defecto comprobado: `handleOwnerDevice` exigía un CSRF de exactamente 64 caracteres, mientras `createDevice` usa `randomToken()` (32 bytes codificados y filtrados, normalmente unos 40–43 caracteres). La petición se rechazaba antes de consultar el permiso recordado. La huella solo desbloqueaba la WebView; no podía corregir ese rechazo del servidor.

Se valida ahora el alfabeto y un intervalo acotado compatible con el generador. La autorización sigue exigiendo origen exacto, JSON, cookie HttpOnly/Secure/SameSite=Strict, coincidencia exacta del CSRF guardado, restaurante activo, vencimiento y rotación de un solo uso. No se guardan contraseñas ni se desactiva TOTP del creador.

Este flujo usa sesiones del servidor y permiso de dispositivo. No se arregla cambiando Firebase a persistencia LOCAL: no hay un inicio de sesión Firebase cliente que conservar en este recorrido. `OwnerLauncher` ya espera la renovación antes de mostrar el formulario. No se añade almacenamiento de tokens en localStorage.

Prueba de regresión en `tests/owner-auth.test.ts`: token real aceptado, token falso rechazado, token previo rechazado después de rotar y cookie de dispositivo nueva emitida. Las seis pruebas del archivo pasan.

No desplegado. Una APK que carga el servidor actual no incorpora por sí sola este cambio de backend. ADB no detectó teléfono en esta continuación; falta ensayo físico de la renovación una vez autorizado el entorno de prueba o despliegue. No se declara resuelto en producción.
