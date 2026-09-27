# Riesgos operativos y respuesta

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
