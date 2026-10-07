# Riesgos operativos y respuesta

Actualización 07-10-2026: producción opera sobre D1, con Firebase Auth/FCM. Se verificaron copias cifradas, restauración aislada, reanudación y reversión conservando pedidos nuevos; UUID y recursos privados se comprobaron después del corte. Recuperación por Firebase entregada al dueño durante aceptación; Resend sigue reservado para futuro dominio verificado. El estado del 28 de septiembre inferior es histórico: no interpretar «FCM sin conectar» como condición vigente. Las 16 fotos siguen en D1; Storage/R2 no se activaron. Ver `docs/launch-readiness-2026-10-06.md` y `docs/d1-cut-runbook.md`.

## Estado de medidas — 28 de septiembre de 2026

No hay despliegue nuevo. El adaptador de Storage se desarrolla localmente, desactivado; FCM sigue sin conectar. No confundir implementaciones locales con protección ya activa en producción.

### QR antiguos

Conservar siempre el UUID del restaurante y sus alias. Antes de cambiar dominio: comprobar la ruta `/r/<uuid>/menu`, el subdominio gratuito y el dominio propuesto; confirmar que cada redirección termina en HTTPS, corresponde al mismo restaurante y no forma bucles. `tests/qr-redirects.test.ts` comprueba HTTPS, UUID, alias gratuito, prioridad, aislamiento y barra final. La ruta privada `/r/<uuid>/` se conserva para administración: un QR antiguo que apunte al panel en vez de `/menu` debe revisarse y reimprimirse, no cambiarse a ciegas perjudicando el acceso del dueño.

No reimprimir si el QR antiguo aún resuelve al menú correcto mediante un alias estable. Reimprimir únicamente códigos cuyo dominio ya no se controla, cuyo contenido sea incorrecto o que estén deteriorados; inventariar las mesas afectadas, escanear una muestra antes de imprimir el lote y conservar los alias recuperables. Un dominio caducado no se arregla cambiando el destino en la base si ya no recibimos sus solicitudes.

### Respaldos

Existe captura local consistente, fragmentación privada y checksum con lectura posterior. El timeout del emulador se corrigió usando `batchGet` y consultas dentro de la misma transacción. Están conectados creación, política diaria, restauración conservadora y ensayo mensual aislado; ver `docs/backup-drill.md`. Se recuperan catálogo, imágenes incluidas, líneas ausentes y enlaces vigentes disponibles en la copia. Operaciones fuera del límite atómico se rechazan sin sobreescribir pedidos. No prometer recuperación ilimitada ni vender activación real hasta el ensayo remoto autorizado.

### Sesiones

El repositorio de seguridad elimina permisos vencidos y limita renovaciones por dispositivo. El mantenimiento separa esta purga del historial comercial; una prueba con 205 pedidos verifica que anonimizar alias y retirar enlaces vencidos no borra pedidos reales. La recuperación manual del dueño revoca sesiones y dispositivos. No ejecutar limpiezas indiscriminadas de colecciones de restaurante.

### Correo y recuperación manual

`scripts/verify-mail-dns.ts` compara los registros exactos suministrados por Resend con DNS público, sin modificar registros ni enviar correo. Ejecutar con un manifiesto local de dominio y registros SPF/DKIM (y MX cuando corresponda). No adivinar el selector DKIM. Pendiente recibir el dominio/registros reales; pruebas simuladas no certifican el correo de producción.

El envío implementa hasta tres intentos para errores transitorios, backoff e idempotencia; errores permanentes no deben repetirse. El fallback es el restablecimiento del dueño desde el panel autenticado del creador, con auditoría de solicitud y finalización sin almacenar contraseña/código en el registro. Verificar identidad del responsable por un canal previamente acordado antes de usarlo. No es un bypass de TOTP del creador ni una garantía de entrega de email.

Sandbox Resend configurado en código para desarrollo: solo destinatario autorizado, no clientes reales. El creador dispone de listado de fallos y reenvío auditado con límites; el contenido se cifra y se purga al vencer. `MAIL_DOMAIN` prepara el cambio a dominio verificado. workers.dev no proporciona una zona DNS para Email Routing; procedimiento exacto en `docs/mail-domain-runbook.md`.

Revisión: 27 de septiembre de 2026. Prioridad = impacto × probabilidad estimada; reevaluar con datos reales.

| Riesgo | Impacto / prioridad | Señal | Prevención | Recuperación | Costo a reservar |
|---|---|---|---|---|---|
| Fotos en D1 y fila >2 MB | Alto / P1 | carga lenta, rechazo de guardado | límite 1,8 MB, fotos WebP optimizadas; evaluar R2 antes de 100 clientes | exportar respaldo, migrar fotos a R2 con URLs estables | almacenamiento y migración por estimar |
| Caída de Worker/D1/Internet | Alto / P1 | QR falla en varios teléfonos | monitor sintético, página de estado, respaldo diario | restaurar último respaldo, informar alcance y tiempo | horas de soporte y plan Cloudflare |
| QR físico apunta a URL antigua | Alto / P1 | mesas sin menú | mantener alias UUID y gratuitos; probar redirecciones antes de cambiar dominio | restaurar alias y reimprimir solo lo necesario | impresiones |
| Restauración incorrecta o respaldo incompleto | Alto / P1 | catálogo/pedidos no coinciden | ensayo mensual de exportar/importar en entorno aislado | congelar cambios y restaurar copia verificada | horas técnicas |
| Sesiones/dispositivos crecen sin control | Medio / P1 | escrituras D1, tablas grandes | limpieza de expirados, rate limits, revocación | purga segura de filas expiradas; nunca borrar pedidos | lectura/escritura D1 |
| PBKDF2 consume CPU | Medio / P1 | login lento, errores de CPU | medir p95 y presupuesto del plan; no reducir iteraciones por conveniencia | subir plan/capacidad, limitar picos | Worker Paid |
| Un Worker por restaurante alcanza límite | Medio / P2 | 90 Workers | alarma al 90; diseñar rutas wildcard de dominio propio/global | detener altas nuevas, migrar en lotes a enrutamiento compartido | plan superior/desarrollo |
| Correo no verificado o falla Resend | Medio / P1 | recuperaciones no entregadas | activar envío solo con dominio verificado; probar SPF/DKIM | recuperación manual auditada por creador | dominio/correo/soporte |
| Privacidad de nombres y pedidos | Alto / P1 | reportes compartidos indebidamente | aislamiento por restaurante, mínimo de datos, caducidad y borrado definidos | revocar sesiones, investigar, notificar según asesoría legal | respuesta a incidentes |
| Promociones/precios desactualizados | Medio / P2 | pedido rechazado por total esperado | validación del servidor, aviso de recargar | corregir campaña, contactar al cliente afectado en local | soporte |
| Soporte supera margen | Medio / P2 | >0,5 h/cliente/mes | guía breve, carga asistida cobrada, medir tickets | reajustar precio/alcance para nuevas ventas | 5 USD/h supuesto |
| Contactos comerciales no autorizados | Alto / P1 | queja/oposición | no inferir datos, base local, canal profesional, dos seguimientos máximo | cesar, suprimir registro y auditar origen | asesoría legal |

Fuentes técnicas: [D1 límites](https://developers.cloudflare.com/d1/platform/limits/), [Workers límites](https://developers.cloudflare.com/workers/platform/limits/), [Workers precios](https://developers.cloudflare.com/workers/platform/pricing/). Las obligaciones de datos personales deben contrastarse con la [SPDP](https://spdp.gob.ec/resolucion_041/) y asesoría local antes de una campaña.
