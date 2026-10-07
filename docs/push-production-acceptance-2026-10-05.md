# Push y correo sin servicios de pago — aceptación bloqueada

Fecha: 05-10-2026, 08:55 UTC. **No se ha cambiado el despliegue activo.**

Producción conserva `724862e7-0c75-4bdd-b01a-4067891f78fe` al 100%, con FCM desactivado. Las versiones nuevas están al 0%.

## Completado

- Corregido el receptor de `fetch` en `FcmSender` para Cloudflare (`call(globalThis, ...)`) y añadida una prueba de regresión.
- Build web con `VITE_FCM_ENABLED=true`, service worker modular y VAPID existente. Se preservan React y TypeScript.
- Identidad FCM heredada de `29ce6c0b`, sin leer, imprimir ni regenerar secretos. Auth, Firestore, cifrado original y TOTP preservados.
- APK oficial 0.8.1/código 12, mismo paquete `ec.qrmenu.app`, firmada con la clave existente; build y lint Android correctos. El firmador ahora falla si falta la identidad original en lugar de regenerarla.
- SHA-256 APK: `cfb8d33580fd937d1d781465452e7140cda21cde86441bbb458611ed4ec1f3fb`.
- Candidata push `9cb08b46-2e43-41f0-9ad5-d13907c1324c`, sin tráfico. `/downloads/qr-menu-ec.apk` sirvió HTTP 200 con MIME Android y 7.513.592 bytes durante el smoke inicial.
- Candidata push + recuperación Firebase: `c0aebaa8-00d3-4138-9293-e041b0c5e65d`, sin tráfico. `/api/creator/session` confirmó Firebase, TOTP configurado y recuperación por correo disponible cuando Firestore respondió.
- Recuperación Firebase implementada para creador y dueño, sin Resend/dominio/Blaze. Se comprueba UID y email servidor; se mantienen TOTP y límites/Turnstile. Los dispositivos recordados anteriores al cambio de contraseña se rechazan.
- Prueba remota de correo con cuenta Auth temporal: HTTP 200, cuenta eliminada, contraseña real intacta. **El operador informa que el mensaje no llegó**, por tanto no se declara entrega verificada.
- 66 pruebas unitarias pasaron, 18 requieren emulador y se omitieron en esa ejecución; 20/20 pruebas de Firestore del comando dedicado pasaron sin omisiones. TypeScript, build Vite y test del service worker local correctos. El test de service worker usa un adaptador simulado de visualización, no demuestra recepción push real.

## Bloqueo real

El menú y la sesión del dueño comenzaron a devolver HTTP 500 en producción y ambas candidatas. Los errores del Worker confirmaron `Firestore operation failed (429, RESOURCE_EXHAUSTED)`. Un diagnóstico **solo lectura**, protegido con token en memoria y vencimiento de cinco minutos, confirmó desde Cloudflare:

```
Google Firestore: HTTP 429
status: RESOURCE_EXHAUSTED
message: Quota exceeded.
projectMatches: true
identityMatches: true
dataWrites: 0
```

Algunas lecturas del creador y las lecturas administrativas locales sí respondieron 200; no confundir una respuesta aislada correcta con recuperación estable. No se afirmó que la causa estuviera resuelta por bajar la concurrencia.

Métricas de Monitoring leídas sin escrituras: aproximadamente 43.446 lecturas reportadas desde alrededor de las 07:00 UTC hasta 08:49 UTC, con latencia y ventanas alineadas. **No son una medición exacta de consumo facturable ni prueba de 50.000 lecturas agotadas.** Se conserva el detalle local, fuera de Git, en `work/firestore-runtime-diagnostic/metrics.json`. La cuota gratuita diaria de Firestore y su reinicio cerca de medianoche del Pacífico están documentados por Firebase; debe revisarse el consumo y la cuota específica antes de decidir facturación.

No se activó Blaze, no se compró dominio y no se retrocedió a D1: un rollback de proveedor sin conciliar perdería modificaciones posteriores al corte. Las fotos siguen en D1 y los documentos migrados en Firestore se conservan.

## No declarar terminado hasta comprobar

1. Resolver y confirmar estabilidad de la cuota desde la identidad de producción; reducir lecturas redundantes y sondeos antes de aumentar frecuencia del cron.
2. Repetir la validación visual remota: el test no pasó porque la candidata no cargó el menú, no por un fallo comprobado de la animación.
3. Confirmar recepción del correo, no solo aceptación HTTP por Firebase.
4. Registrar el Honor con consentimiento y verificar push real en primer y segundo plano. La nueva APK de prueba se instaló, pero la recepción sigue sin evidencia.
5. Validar sesión, TOTP, impresión y rutas UUID en la candidata definitiva; después activar y comprobar descargas por SHA-256.
6. El cron activo es `0 * * * *`; el envío en cola no se debe anunciar inmediato. Ajustarlo para entrega oportuna solo después de resolver consumo y aceptar push.

Fuentes: [cuotas de Firestore](https://firebase.google.com/docs/firestore/quotas), [precios y reinicio de cuotas](https://firebase.google.com/docs/firestore/pricing).

## Actualización posterior: recuperación confirmada y candidata optimizada

- El operador confirmó recepción del correo enviado al dueño real, sin usar el enlace ni cambiar contraseña/TOTP. Este resultado sustituye el bloqueo de entrega anterior, no constituye una prueba completa de cambio de contraseña.
- Candidata vigente de esta aceptación: `a64e07c2-1c8b-476f-b902-79d540681585`, 0% de tráfico. Conserva la producción anterior y añade las optimizaciones documentadas en `firestore-cost-reduction.md`.
- Prueba Playwright contra `/demo` remoto: errores de pedido vacío, opciones faltantes y alias vacío visibles; foco, repetición, borde rojo y movimiento reducido comprobados. Se bloquean escrituras y navegación a producción durante el ensayo.
- Suite unitaria repetida: 90 pruebas, 72 pasan, 18 requieren emulador, cero fallos. Suite dedicada Firestore ejecutada anteriormente con estos cambios: 20/20 pasan sin omisiones.
- Última comprobación remota: `/owner` responde 200; sesión del restaurante responde 503. La cuota sigue bloqueando la aceptación funcional; el mensaje seguro no significa que el servicio esté recuperado.
- ADB no detecta dispositivos. Recepción push física pendiente; no anunciarla como disponible comercialmente ni activar la candidata sin completar aceptación.

No se modificó tráfico, facturación, dominio ni proveedor de fotos en esta actualización.
