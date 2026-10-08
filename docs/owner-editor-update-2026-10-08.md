# Ajustes desplegables, volver y recarga del editor

El dueño puede abrir y cerrar Categorías, Identidad, Presentación, Contacto, Horarios, Colores, Seguridad y Respaldos. Los campos permanecen montados: cerrar no guarda ni borra el borrador. Publicar sin nombre abre Identidad y enfoca el campo.

La navegación entre secciones registra historial. Atrás vuelve a la sección anterior; el contrato Android cierra primero el editor de plato o su diálogo. La raíz conserva la salida normal. La APK0.8.3/versionCode14 incorpora el callback de volver para Android13+ y conserva las protecciones de sesión/desbloqueo.

Un conflicto409 muestra **Recargar app**. Los cambios remotos de revisión o permisos se comprueban cada30segundos mientras el editor esté visible, y al volver al primer plano. El aviso pide recargar por cambios de otro dispositivo o del creador. No sustituye automáticamente el borrador; con cambios sin guardar pide confirmar antes de descartarlos. Recargar actualiza la aplicación y los permisos; no elude autenticación ni límites.

Pruebas y recibos: [evidencias](evidence/2026-10-08/owner-update/). API mínima editor-version exige sesión y conserva aislamiento/no-store. Navegador local con APIs ficticias verifica desplegables, navegación, conflictos, conservación/cancelación y temporizador virtual. APK compilada y firmada con el mismo certificado anterior, SHA256 `05471ac045ea39010658521e69f45fec09571ec896bfce069b8fdcb3c6d8596e`.

El teléfono no estuvo disponible: no se afirma instalación ni prueba física del APK nuevo. Las limitaciones globales anteriores de lint/rendimiento/zoom real siguen descritas en el informe08-10. No hay cambios de esquema ni proveedores nuevos.

El recibo del despliegue y las capturas productivas se incorporan después de verificar la versión servida. Rollback compatible: retornar al Worker padre7580118f y su APK0.8.2; no restaurar bases de datos sobre producción. Respaldos cifrados nuevos de ambas D1, comprobados desde disco con integridad/FK correctos.

Tipos y build Worker aprobados. Prueba de navegador:11 recorridos aprobados. Suite secuencial:163 tests,144 aprobados,19 dependientes de emulador omitidos,0 fallos; prueba API de aislamiento incluida. Android assembleRelease/lintRelease aprobados,0 errores (15 avisos). Lint global sigue con deuda histórica; no se desactivaron reglas.
