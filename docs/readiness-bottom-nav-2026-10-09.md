# Cierre técnico y barra inferior — 09-10-2026

La barra móvil del dueño reservaba dos veces el margen de navegación del Honor: en la ventana nativa y en CSS. Android 0.8.6 consume los insets después de aplicarlos al contenedor; la web reconoce los shells 0.8.5 o posteriores y evita repetir ese margen. Los navegadores ordinarios conservan su área segura. No se elimina la protección de barras, recortes o teclado.

El control de tipos y lint global pasa sin desactivar reglas. Las fuentes mantenidas de la bifurcación de braces se comprueban; su distribución CommonJS generada se reproduce y compara byte a byte. CI incorpora lint. La migración de notificaciones web usa el FID y reemplaza atómicamente el registro del mismo navegador y familia de sesión; los tokens Android y registros anteriores permanecen compatibles.

La suite con Firestore local aprobó 196/196, sin omisiones, más la prueba específica del marcador Android. Build Worker, build Android, lint Android y ocho pruebas JVM aprobados; lint Android conserva 16 advertencias. La aceptación visual aprobó 30 combinaciones públicas de plantilla, viewport y ampliación del contenido, y el recorrido de fotos, conflicto y guardado. La ampliación del contenido del laboratorio no acredita zoom nativo del navegador o del teléfono.

El guardado de platos conserva un formulario real dentro del diálogo accesible. La prueba de conflicto sigue exigiendo el aviso 409 y conserva la fotografía y los campos antes del reintento.

Dos respaldos nuevos de las D1 se descifraron desde disco y restauraron únicamente en memoria: tres tablas operativas, doce históricas y 17 imágenes, integridad y referencias aprobadas. No se restauraron datos sobre producción. Rollback utiliza el procedimiento de deployment/cloudflare/README.md y el padre registrado al crear el candidato.

APK preparado: 0.8.6, código 17, firma original; SHA-256 `4cf8889329bf591573e0551085c8e4f71f4df1e56bb82d8a428694d2af233795`. La integración, activación, versión realmente servida y aceptación física deben registrarse después de ejecutarlas; la preparación del APK no acredita instalación.

La demo de aceptación sigue siendo QA FICTICIO · Octubre 2026. No se usan contactos reales ni se envían mensajes de WhatsApp. No se agregan proveedores, pagos, Blaze o R2.
