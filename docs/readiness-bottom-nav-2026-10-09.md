# Cierre técnico y barra inferior — 09-10-2026

La barra móvil del dueño reservaba dos veces el margen de navegación del Honor: en la ventana nativa y en CSS. Android 0.8.6 consume los insets después de aplicarlos al contenedor; la web reconoce los shells 0.8.5 o posteriores y evita repetir ese margen. Los navegadores ordinarios conservan su área segura. No se elimina la protección de barras, recortes o teclado.

El control de tipos y lint global pasa sin desactivar reglas. Las fuentes mantenidas de la bifurcación de braces se comprueban; su distribución CommonJS generada se reproduce y compara byte a byte. CI incorpora lint. La migración de notificaciones web usa el FID y reemplaza atómicamente el registro del mismo navegador y familia de sesión; los tokens Android y registros anteriores permanecen compatibles.

La suite con Firestore local aprobó 196/196, sin omisiones, más la prueba específica del marcador Android. Build Worker, build Android, lint Android y ocho pruebas JVM aprobados; lint Android conserva 16 advertencias. La aceptación visual aprobó 30 combinaciones públicas de plantilla, viewport y ampliación del contenido, y el recorrido de fotos, conflicto y guardado. La ampliación del contenido del laboratorio no acredita zoom nativo del navegador o del teléfono.

El guardado de platos conserva un formulario real dentro del diálogo accesible. La prueba de conflicto sigue exigiendo el aviso 409 y conserva la fotografía y los campos antes del reintento.

Dos respaldos nuevos de las D1 se descifraron desde disco y restauraron únicamente en memoria: tres tablas operativas, doce históricas y 17 imágenes, integridad y referencias aprobadas. No se restauraron datos sobre producción. Rollback utiliza el procedimiento de deployment/cloudflare/README.md y el padre registrado al crear el candidato.

Integrado mediante [PR 26](https://github.com/eslay07/qr-menu-ec/pull/26), commit `24d82c8596f1ba6d55f2a868c6ba6d45db99fc1d`, con cuatro controles aprobados. Worker `ca6c0ddb-6727-438f-909e-0a0917232597` al 100 %. HTML, JavaScript y CSS realmente servidos comprobados por hash. Rollback registrado: `9d9d6bf3-85b5-4043-afec-bbdfdf90c6c7`.

APK distribuido: 0.8.6, código 17, firma original; SHA-256 `4cf8889329bf591573e0551085c8e4f71f4df1e56bb82d8a428694d2af233795`. Metadatos no-store y binario productivo coinciden con el build firmado. La lectura posterior del Honor confirmó 0.8.6/código 17; el APK extraído del dispositivo coincide por SHA-256 con el binario productivo. No se usó instalación por ADB.

La corrección web ya se comprobó en el Honor físico con su shell 0.8.5: pulsar Recargar app cargó el panel nuevo, conservó la sesión y eliminó el hueco adicional bajo la navegación. Véanse [antes](evidence/2026-10-09/readiness/bottom-nav-before.png) y [después](evidence/2026-10-09/readiness/bottom-nav-after.png). Posteriormente se comprobó también la instalación nativa 0.8.6 y su barra inferior en el Honor. Las capturas de Ajustes y del regreso a Carta acreditan el panel en primer plano; los diez cierres completos corresponden a la secuencia anterior 0.8.5 realizada por el propietario.

En el navegador productivo, publicar un nombre compuesto solo por espacios mostró el mensaje exacto y enfocó Nombre, sin publicar. Se restauró el nombre original y se publicó la misma demo: revisión 14, 40 platos. Los tres alias resolvieron esa revisión y las cinco rutas privadas anónimas devolvieron 401/no-store. La lectura inicial contó dos grants vigentes; el conteo por sí solo no identifica dispositivos. [Recibo productivo](evidence/2026-10-09/readiness/served.json) y [lectura de sesiones](evidence/2026-10-09/readiness/sessions.json).

La demo de aceptación sigue siendo QA FICTICIO · Octubre 2026. No se usan contactos reales ni se envían mensajes de WhatsApp. No se agregan proveedores, pagos, Blaze o R2.

La prueba real de provisión automática detectó workers.dev desactivado tras el PUT inicial. La corrección activa explícitamente la ruta, desactiva previews y comprueba HTTPS y la ruta CORE antes de marcar el alias activo. El token del propietario se verifica sin imprimirlo. Se creó un alias temporal -2 con reserva en SQLite aislada, TLS/ruta 200 y limpieza del Worker; no se modificaron fichas productivas de restaurantes. Véase [recibo](evidence/2026-10-09/readiness/automatic-subdomain.json).

La suite ampliada aprobó 199/199 con el emulador Firestore; tipos y lint global sin diagnósticos. Se fija LF para los artefactos generados de braces: el checkout CRLF de Windows impedía la comparación byte a byte; se conserva la aserción.

[Comparación reproducible completa](readiness-performance-2026-10-09.md): LCP frío mediano 1,920 s (10 platos) y 2,016 s (40); caliente 1,388 y 1,420 s. Hay cargas frías de hasta 3,272 s: no se acredita el objetivo de 2,5 s en cada carga. Respuesta visual mediana entre 29 y 66 ms, máximos menores de 200 ms. Reapertura caliente del panel mediana 1,515/1,597 s. Guardado y publicación controlados menores de 2 s en la fase final. La renovación recordada simulada conserva un máximo de 4,723 s, por encima del objetivo; no acredita Firebase ni Android físico. No se mezclan mediciones antiguas que desactivaban caché mediante interceptación con las nuevas cargas HTTP.

La recarga del Honor llegó al acceso. La consulta posterior encontró un grant anterior vencido; los dos vigentes anteriores no acreditaban una sesión vigente del Honor. El propietario volvió a ingresar, llegó a Carta y confirmó una reapertura posterior sin credenciales. La captura física acredita el panel y la lectura posterior cuenta tres grants vigentes. No se declara esa reapertura como cierre completo ni se atribuye al teléfono cada grant sin evidencia. Zoom nativo 200 % y reintento de descarga con interrupción de Internet no están acreditados por esta fase.

La recuperación de propagación TLS reusa la reserva del restaurante y verifica el binding CORE esperado; no vuelve a subir ni reemplazar el código. Una reserva cuyo PUT inicial nunca creó el Worker requiere revisión del operador: no se afirma recuperación automática de cualquier fallo. La regresión cubre fallo HTTPS, rechazo de CORE ajeno y reintento válido en el mismo hostname después de renombrar, con un único PUT. La revisión independiente de Producto confirmó la corrección y las limitaciones de las mediciones.

La demo quedó en revisión 15 tras retirar teléfono y WhatsApp. No ofrece acciones de llamada o mensajes a números de ensayo que pudieran pertenecer a personas reales; la advertencia al dueño para configurar su número permanece visible.
