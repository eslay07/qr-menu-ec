# Android físico y producción · 9 de octubre de 2026

Seguimiento vigente del [informe del 8 de octubre](android-physical-2026-10-08.md). Cuenta y datos identificados como QA FICTICIO; no se utilizaron restaurantes reales para estos recorridos.

## Versión comprobada

Código: [PR 24](https://github.com/eslay07/qr-menu-ec/pull/24), commit [9b811fdc](https://github.com/eslay07/qr-menu-ec/commit/9b811fdc5e2c30ee2ecf498650fba4eb27f3137f). Worker activo `9d9d6bf3-85b5-4043-afec-bbdfdf90c6c7`, tráfico 100%. [Plataforma productiva](https://qr-menu-ec.consola.workers.dev) y [carta ficticia](https://qa-ficticio-octubre-2026.consola.workers.dev/menu). Publicación 13, 40 platos: UUID, ruta legible y subdominio resuelven el mismo restaurante. API privada anónima: 401 y no-store.

APK 0.8.5/código 16, paquete ec.qrmenu.app, 8.502.129 bytes, certificado original. SHA-256: `aa57f0efa246a68020586099b7c67b46d2be8a44c7fea2b2a6e496a462928080`.

## Aceptación en Honor físico

Honor LNA-LX3, Android 16, WebView 153.0.8010.36. Actualización real por Internet desde 0.8.4: aviso de la aplicación, permiso del instalador y confirmación del usuario. No se instaló mediante adb. Se comprobó 0.8.5 instalada, regreso Ajustes → Carta, margen de cabecera respecto a barras/recorte y campo visible con teclado abierto.

El usuario realizó diez reaperturas completas. La lectura de servidor conservó una sesión activa antes y después (1 → 1); se verificaron Carta y sesiones. Esto acredita este dispositivo y recorrido, sin sustituir las pruebas independientes de concurrencia/revocación.

Otro navegador dueño guardó un cambio temporal de borrador. En el Honor apareció el aviso Recargar: Cancelar conservó `QA_LOCAL_SIN_PUBLICAR`; confirmar cargó el cambio remoto y mostró Guardado ✓, conservando la sesión. No se publicó ese cambio de ensayo. El borrador original se restauró mediante Guardar y se verificó en D1; la publicación 13 permaneció sin cambios. El Honor recargado mostró el nombre original y Guardado ✓.

En el Honor se leyeron las opciones Lista/Tarjetas/Compacta y se observaron los cinco campos HEX, paletas, ratios de contraste y botones de restauración. No se cambió ni guardó una plantilla o paleta en este recorrido físico; su edición/publicación conserva el alcance de los informes web anteriores.

## Controles y respaldo

Ocho pruebas nativas y cinco de distribución aprobadas en el control previo; seis pruebas del operador aprobadas en el control actual. Tipos y build actuales aprobados. Suite actual: 176 pruebas, 157 aprobadas, 19 omitidas y cero fallos; la ejecución posterior con emulador Firestore aprobó 184/184, sin omisiones ni fallos. Las restauraciones de ensayo usaron el proyecto local demo, sin datos productivos. El lint global sigue fallando por 406 errores y cinco advertencias históricos; no se describe como aprobado. Dos respaldos D1 nuevos verificados: tres y doce tablas respectivamente, y 17 archivos multimedia. No se restauró un respaldo sobre producción.

Rollback del Worker: versión anterior `fb6cb9e4-53af-45f1-baa6-c2148988cce7`; conservar respaldos y recibos antes de revertir mediante el [procedimiento existente](../deployment/cloudflare/README.md). El rollback del Worker no desinstala el APK ni retira mensajes ya entregados a FCM.

## Límites pendientes

Las [mediciones web](owner-validation-2026-10-08.md) mantienen su alcance de laboratorio: viewport 390, API ficticia y CPU/red emuladas. LCP frío mediano 10/40 platos: 1968/2108 ms frente a 1724/2020 ms del baseline; no hubo mejora global acreditada. No son tiempos del Honor físico.

Zoom nativo 200 %, lectura física del QR y reintento de actualización sin conexión en el dispositivo no se han verificado. El subdominio ficticio existente tiene TLS operativo; falta el token Cloudflare necesario para aprovisionamiento automático. Estas limitaciones impiden afirmar cumplimiento íntegro del encargo o preparación comercial de todas las capacidades.

Se conservan los [informes anteriores](product-release-2026-10-08.md) y la [guía de incorporación](restaurant-onboarding.md). No se añadieron servicios pagos, Blaze ni R2.

## Evidencia versionada

- [Aceptación física y alcance](evidence/2026-10-09/honor/physical-acceptance.json), [APK instalada](evidence/2026-10-09/honor/installed-0.8.5.json) y [versión realmente servida](evidence/2026-10-09/honor/served-version.json).
- [Diálogo de recarga en Honor](evidence/2026-10-09/honor/reload-dialog-0.8.5.png), [Cancel conserva el borrador local](evidence/2026-10-09/honor/cancel-local-tail-0.8.5.png) y [original restaurado](evidence/2026-10-09/honor/restored-original-0.8.5.png).
- [Respaldos verificados](evidence/2026-10-09/honor/backups-verified.json), [rutas públicas y API privada](evidence/2026-10-09/honor/public-and-private.json) y [limpieza sin cambiar publicación](evidence/2026-10-09/honor/cleanup.json).
- [Dos sesiones actuales independientes](evidence/2026-10-09/honor/two-devices-sessions.json): navegador dueño y Honor autenticados.

[Recibo de controles actuales](evidence/2026-10-09/honor/verification.json). La mejora del operador conserva el candidato creado antes de verificarlo y permite recuperar el staging sin crear versiones adicionales ni modificar tráfico. Este seguimiento de operador y evidencia no cambia el Worker ni el APK ya desplegados.
