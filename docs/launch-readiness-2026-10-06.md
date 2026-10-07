# Cierre de preparación — 6 de octubre de 2026, Ecuador

## Producción activada — 7 de octubre, 00:17 Ecuador

Versión `29930545-7db3-4c1b-85f7-525ace3ecb15` activa al 100%, proveedor `d1-documents`, Firebase Auth y TOTP del creador conservados, FCM activo en servidor y frontend. Mantenimiento retirado y previews históricos cerrados. Firestore conserva la copia de reversión verificada, cerrada al SDK cliente; no se eliminaron sus documentos ni se activaron Storage/R2/Blaze.

Conciliación final: 1.729 documentos, dos restaurantes, siete pedidos y 17 líneas; 37 documentos D1 actualizados. Checksum común verificado: `d77f6f40a649b427913079fc30598a5ff1606371302ed3add937a62637ccaa6d`. El primer intento revirtió sin activar por dos conflictos de contadores rate limit; se añadió política conservadora probada (acumular intentos y conservar mayor vencimiento). El segundo intento terminó correctamente.

Enlaces de dueño, creador, UUID, APK y SHA256SUMS comprobados después del corte. Recursos WiFi/notificaciones privados responden 401 sin sesión. APK oficial 0.8.1/código 12: `cfb8d33580fd937d1d781465452e7140cda21cde86441bbb458611ed4ec1f3fb`; instalada como actualización sin borrar datos en el Honor. La confirmación física anterior corresponde a la APK de aceptación; la comprobación manual del panel oficial después de instalar se solicitó por separado.

Pruebas: TypeScript en verde, 97 generales aprobadas y 18 reservadas para emulador; las 20 dedicadas y las siete adicionales de migración/reanudación pasaron. Gitleaks: 33 commits históricos y cambios preparados sin secretos detectados; excepciones limitadas a identificador de algoritmo, checksum de manifiesto y vectores de prueba revisados. Auditoría de ejecución: cero vulnerabilidades; herramientas de desarrollo: 13 moderadas, ninguna alta/crítica. No se presenta como ausencia total de avisos.

Recibos privados: `work/d1-transition/cut-bdaaaeee-2e65-412b-9d75-065b0ef4bbbc/{verified,completed}.json` y `work/d1-production-candidate/launch-verification.json`. Los apartados siguientes son antecedentes de preparación y no describen el tráfico vigente.

Confirmación posterior: el operador ve el panel en la APK oficial actualizada del Honor. El smoke web de producción abrió acceso por correo, menú y configurador; Turnstile rechazó el envío automatizado, correctamente. No se presenta esa ejecución como creación de pedido, PDF o recepción push real en producción. La recepción física de push y el flujo completo del pedido fueron verificados durante aceptación; cada nuevo dispositivo necesita sus propios permisos. No se transfirieron credenciales ni cookies entre la app de prueba y la oficial.

No constituye aprobación de producción. La versión activa sigue siendo `724862e7-0c75-4bdd-b01a-4067891f78fe`, al 100%. Candidata actual: `29930545-7db3-4c1b-85f7-525ace3ecb15`, sin tráfico.

Actualización 6 de octubre, 23:39 Ecuador: TypeScript y suite general en verde (96 aprobadas, 18 reservadas para emulador, cero fallos). Las 20 pruebas dedicadas del emulador pasaron; se repiten después de ampliar la cobertura de restricciones push. La candidata actual pasó validación visual móvil, acceso público/privado y composición de impresión A4/Carta. Worker SHA-256: `1eda582f147ee899eaff1ea5c4abdc65a111c4a9de782e6032debd4d9b8c72b1`.

El ensayo aislado del corte verificó interrupción/reanudación, reversión exacta previa a activar y conservación de una escritura posterior a activar: 1.696 documentos, dos restaurantes, siete pedidos y 17 líneas; cero escrituras remotas. El preflight más reciente propone 1.705 documentos y no detecta conflictos ni referencias rotas. Esta cifra no sustituye la captura final congelada.

La impresión privada pasó en el Honor con clave ilustrativa grande y una página; se restauraron ambos ajustes WiFi originales. La última reapertura física sigue pendiente de confirmación explícita del panel tras desbloquear. No activar mientras esa comprobación esté pendiente.

Repetición final: las 20 pruebas dedicadas volvieron a pasar, incluida la supresión del push al bajar a Básico. Auditoría de dependencias de ejecución: cero vulnerabilidades; completa: 13 moderadas de desarrollo y ninguna alta/crítica. El controlador exige recibo de confirmación humana de sesión física antes de cualquier activación; dicho recibo aún no se ha creado. La reversión posterior a activar vuelve a comprobar convergencia 503 antes de copiar las escrituras nuevas.

Los permisos por plan se validan en servidor: preferencias/push/reportes desde Medio, WiFi y copias programadas en Premium. Los restaurantes anteriores conservan sus permisos; los nuevos empiezan en Básico con 40 platos. El creador puede ajustar plan y capacidad. Promociones conservan su permiso independiente del creador; no afirmar que el plan por sí solo las activa o bloquea. Los apartados siguientes registran evidencias anteriores y no sustituyen esta actualización.

## Verificado

- TypeScript sin errores. Suite general: 109 pruebas, 91 aprobadas, 18 omitidas porque requieren emulador, cero fallos. Emulador dedicado: 20 aprobadas. Después se añadió una prueba de resolución del paquete braces instalado; sus tres pruebas específicas pasan.
- Dependencias de ejecución: auditoría sin vulnerabilidades. Auditoría completa supera el umbral alto/crítico; quedan 13 avisos moderados en herramientas de desarrollo, no se presentan como cero avisos.
- Compilación web con FCM habilitado y Worker actual recompilado. Se corrigió la ruta duplicada de salida de Wrangler; staging recompila con ruta absoluta para no reutilizar un bundle anterior.
- Worker SHA-256: `ed8a1abb92fd07a205ec47936443be2a5725f6409dca221e497a76fbfc59ef41`.
- Menú de candidata responde; Firebase Auth y TOTP del creador configurados. Ajustes, WiFi e impresión privada rechazan solicitudes anónimas con 401. Alias UUID devuelve el dominio principal esperado, sin seguir el salto a producción durante QA.
- Validación de pedido en viewport móvil: errores visibles, foco, scroll, repetición y movimiento reducido pasan, sin crear pedidos.
- Impresión de escritorio con estilos servidos por la candidata: A4 y Carta, una página, sin desbordamiento; clave de prueba a 26,67 px y QR de 332,59 px. Esto es una prueba de composición con datos ilustrativos, no una sesión autenticada de impresión.
- Turnstile conserva identidad, secretos y dominios productivos. Se sustituyó exclusivamente la vista previa antigua `22052178` para liberar uno de los diez hostnames; nueva candidata permitida.
- Respaldos AES-256-GCM fuera de Git, claves DPAPI y restauración comprobada. D1 operativo: 1.682 documentos. D1 histórico conserva sus 16 imágenes. R2 no está activo, no se creó ni se anuncia respaldo de R2.
- Conciliación de lectura: fuente 1.615 documentos, destino 1.682, propuesta 1.696, cero conflictos. No aplicada; requiere nueva captura bajo congelación.

## Evidencia local privada

`work/d1-production-candidate/version.json`, `smoke.json`, `desktop-print-qa.json`; `work/d1-transition/reconciliation-plan.json`; recibos de respaldo en `work/private-backups/2026-10-07T04-05-55.374Z-edd619d6` y `2026-10-07T04-06-01.811Z-df9b6b09`. No publicar datos, claves, SQL ni archivos privados.

## Condiciones que impiden anunciar lanzamiento completo

Completar impresión privada autenticada y continuidad física de la última candidata. El navegador conectado dejó de permitir interacción con la pestaña existente; se pidió reconexión, sin solicitar contraseña ni PIN.

Terminar y ensayar el controlador del corte D1 con congelación de todas las rutas, incluidas vistas previas y tareas programadas; nueva captura, validación de relaciones y privilegios, conciliación CAS y reversión coherente. No usar los scripts históricos dirigidos a `62bff004` ni activar la versión anterior después de nuevas escrituras D1 sin conciliación inversa.

Comprobar los bloqueos comerciales por plan antes de prometerlos como automatizados. Publicar solo código y documentos no sensibles, actualizar descargas y verificar enlaces después de la activación real. No se compró dominio, no se cambió facturación ni se activó Blaze/Storage.
