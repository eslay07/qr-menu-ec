# Ajustes desplegables, volver y recarga del editor

El dueño puede abrir y cerrar Categorías, Identidad, Presentación, Contacto, Horarios, Colores, Seguridad y Respaldos. Los campos permanecen montados: cerrar no guarda ni borra el borrador. Publicar sin nombre abre Identidad y enfoca el campo.

La navegación entre secciones registra historial. Atrás vuelve a la sección anterior; el contrato Android cierra primero el editor de plato o su diálogo. La raíz conserva la salida normal. La APK0.8.4/versionCode15 incorpora el callback de volver para Android13+ y conserva las protecciones de sesión/desbloqueo.

Un conflicto409 muestra **Recargar app**. Los cambios remotos de revisión o permisos se comprueban cada30segundos mientras el editor esté visible, y al volver al primer plano. El aviso pide recargar por cambios de otro dispositivo o del creador. No sustituye automáticamente el borrador; con cambios sin guardar pide confirmar antes de descartarlos. Recargar actualiza la aplicación y los permisos; no elude autenticación ni límites.

Pruebas y recibos: [evidencias](evidence/2026-10-08/owner-update/). API mínima editor-version exige sesión y conserva aislamiento/no-store. Navegador local con APIs ficticias verifica desplegables, navegación, conflictos, conservación/cancelación y temporizador virtual. APK compilada y firmada con el mismo certificado anterior, SHA256 `c7b532dd4e3df322b866c44761e23acd970b7c5641583dc456bb0b4146883a95`.

El teléfono no estuvo disponible: no se afirma instalación ni prueba física del APK nuevo. Las limitaciones globales anteriores de lint/rendimiento/zoom real siguen descritas en el informe08-10. No hay cambios de esquema ni proveedores nuevos.

Versión productiva activa al100%: `b01b47a7-558c-4a30-a74d-1ae3f201829a`, commit integrado `933cecfb1d0b4ee985b481074793c84a612df42b` ([PR20](https://github.com/eslay07/qr-menu-ec/pull/20)). HTML/JS/CSS verificados por SHA256; APK y metadatos servidos200 y hash correcto, JSONno-store. Recibos adjuntos. Las capturas anteriores de este directorio son pruebas locales con APIs simuladas, no capturas productivas. Rollback compatible: retornar al Worker padre7580118f y su APK0.8.2; no restaurar bases de datos sobre producción. Respaldos cifrados nuevos de ambas D1, comprobados desde disco con integridad/FK correctos.

Tipos y build Worker aprobados. Prueba de navegador:11 recorridos aprobados. Suite secuencial:163 tests,144 aprobados,19 dependientes de emulador omitidos,0 fallos; prueba API de aislamiento incluida. Android assembleRelease/lintRelease aprobados,0 errores (16 avisos). Lint global sigue con deuda histórica; no se desactivaron reglas.

## Actualizar por Internet

Desde la APK0.8.4, al abrir y desbloquear se comprueba si existe una versión más reciente en la infraestructura HTTPS existente. **Actualizar** descarga y verifica el APK, luego abre la confirmación de Android. **Ahora no** permite continuar. No hay instalación silenciosa, envío de credenciales al endpoint ni servicios de pago.

Android puede solicitar permitir instalaciones desde esta app; el usuario decide y vuelve para confirmar. La descarga se valida por tamaño, SHA256, nombre del paquete, versión y certificado igual al instalado. URL externa, redirección, archivo alterado o firma distinta se rechazan. Sin conexión no se bloquea el acceso habitual.

La APK0.8.2 no tenía este mecanismo y requiere una primera instalación manual del APK nuevo desde [la descarga HTTPS](https://qr-menu-ec.consola.workers.dev/downloads/qr-menu-ec.apk). No se puede agregar una función nativa a un APK instalado sin actualizarlo. Las siguientes versiones notifican desde la propia app.

El rollback del Worker revierte la distribución ofrecida; no fuerza a desinstalar ni degradar el APK que el usuario ya instaló. El APK conserva compatibilidad con el servidor anterior.

Suite completa con emulador:171/171 aprobadas sin omisiones. Pruebas adicionales de publicación de actualización/metadatos y frescura HTTP:9/9 aprobadas (incluyen2MIME y2rutas existentes). Política Android JVM:4/4. Instalación real y permisos en teléfono no comprobados.

Verificación final completa administrada por firebase emulators:exec: **176/176 aprobadas,0 fallos/omisiones**, antes de activar. Primera activación recibió HTML anterior y se revirtió automáticamente a7580118f; el mismo candidato se reactivó y sus archivos se comprobaron tras la propagación. El verificador de despliegue añade espera limitada antes de declarar fallo de HTML; MIME inválido o bytes incorrectos siguen provocando rechazo/rollback. Tres pruebas de empaquetado/propagación aprobadas.

Producción: login ficticio normal, siete ajustes plegados, apertura/cierre de Horarios, edición desde segunda pestaña, aviso remoto con Recargarapp y conservación del borrador local comprobados. La confirmación de recarga no pudo completarse en el navegador integrado por timeouts de control/captura; cancelar y aceptar están acreditados por Chromium local, sin atribuirlo a producción. No se adjuntan capturas locales como si fueran productivas. El texto temporal de ensayo se retiró mediante el repositorio operativo y CAS, sin restaurar respaldos; publicación13 permaneció intacta. Recibos owner-production.json ycleanup-production.json.
