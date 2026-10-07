# Planes, precios y costos de referencia

Estado técnico 07-10-2026: el corte a D1 terminó y FCM está habilitado en producción. La APK oficial y los enlaces están publicados; QR, impresión WiFi y preferencias pasaron aceptación, incluida prueba física en Honor. Los permisos por plan se aplican en servidor; los restaurantes anteriores mantienen acceso. La recepción push fue comprobada en aceptación y cada cliente debe autorizar su dispositivo. Los precios siguientes siguen siendo propuestas piloto, sin cobro automático. Las advertencias fechadas anteriores describen la preparación histórica, no el tráfico actual.

Actualización técnica 05-10-2026: se prepara D1 como proveedor operativo independiente, manteniendo Firebase Auth/FCM y las fotos originales. Los ensayos D1 con 150 platos y restauración pasaron, pero el corte de datos reales permanece condicionado a la lectura/conciliación de Firestore. Consultar `docs/d1-provider-cutover.md` y `checklist-primer-cliente.md`. No anunciar todavía «producción completa» ni cambiar el precio por una promesa de infraestructura gratuita ilimitada.

## Oferta revisada — 28 de septiembre de 2026

Esta oferta sustituye los nombres y paquetes de la tabla histórica inferior. Precios piloto sugeridos, no tarifas activadas: validar horas de soporte, consumo y aceptación con diez negocios. Recomiendo bajo costo en lugar de un plan gratis indefinido: prueba de 14 días sin tarjeta y hasta 30 días para los primeros diez pilotos acompañados, sin cobro automático.

| Plan | Mensual USD | Trimestre USD | Año USD | Alcance propuesto |
|---|---:|---:|---:|---|
| Básico | 6,90 | 19 | 69 | Hasta 40 platos, menú digital, QR, pedidos mostrados al mesero y avisos dentro del panel. |
| Medio | 10,90 | 30 | 109 | Hasta 80 platos, lo anterior, promociones, historial, reportes y preferencias de notificaciones. Push FCM implementado localmente; venta sujeta a aceptación y activación posterior. |
| Premium | 15,90 | 44 | 159 | Hasta 150 platos, lo anterior, WiFi en impresión autenticada del QR, respaldos automáticos programados y soporte prioritario. Código y ensayo local implementados; activación remota y aceptación comercial aún no realizadas. |

No vender FCM como activado antes de verificar la recepción real y aprobar producción, ni prometer restauración ilimitada. La bandeja interna no equivale a push con la app cerrada. Corrección 05-10-2026: las 16 fotos permanecen en D1; R2 nunca se activó y Firebase Storage no es necesario para la oferta inicial. La impresión WiFi premium muestra texto debajo del QR: la contraseña no está codificada en el QR ni incluida en enlaces públicos.

### Argumentos de venta

- Básico: «Actualiza precios y platos desde tu celular; el cliente ve la carta y muestra su pedido al mesero. No necesitas volver a imprimir la carta cada vez que cambias un precio».
- Medio: «Consulta el historial y los reportes para entender qué te piden. Decide qué avisos quieres recibir dentro del panel». Cuando el push esté realmente probado, añadir: «Recibe avisos compatibles con los permisos de tu celular». No garantizar entrega inmediata ni superar el modo silencio.
- Premium: «Entrega el acceso WiFi junto a tu QR sin dejar la clave dentro del código. Prioriza tus consultas de soporte». Tras validar respaldos: «Recupera tu información desde copias programadas con verificación». Nunca prometer riesgo cero o recuperación de datos posteriores al último respaldo.

### Restricciones por plan

En Básico se excluyen preferencias avanzadas, push, reportes históricos comerciales, promociones, impresión de WiFi y respaldos programados. En Medio se excluyen impresión WiFi, respaldos programados y soporte prioritario. Premium incluye esas ventajas; no incluye dominio comprado, fotografía, carga masiva ni desarrollos personalizados. Retener pedidos por seguridad no significa habilitar su consulta comercial en todos los planes.

Actualización técnica 06-10-2026: la candidata sin tráfico aplica permisos de servidor para preferencias/push/reportes desde Medio y WiFi/respaldos programados en Premium. Básico conserva pedidos públicos y bandeja interna. Los restaurantes anteriores mantienen el acceso adquirido; los nuevos empiezan con 40 platos. El creador asigna capacidad y plan manualmente. Promociones sigue siendo un permiso independiente habilitado por el creador: al incorporar clientes, asignarlo según el paquete contratado. Soporte y cobros se gestionan manualmente; no existe facturación automática por planes. No anunciar estos bloqueos en producción hasta completar el corte.

Soporte Básico/Medio: objetivo de primera respuesta de dos días laborables. Premium: objetivo de un día laborable, sujeto a capacidad del equipo y comunicado por contrato, sin soporte 24/7 ni SLA garantizado. Incorporación asistida opcional USD 20 según el alcance histórico indicado abajo.

### Costos contrastados y decisión

Fuentes oficiales consultadas el 28-09-2026: [Workers](https://developers.cloudflare.com/workers/platform/pricing/) tiene un mínimo de USD 5/mes en el plan de pago; [Firestore](https://firebase.google.com/docs/firestore/pricing) depende de operaciones, almacenamiento, ubicación y tráfico; [Firebase](https://firebase.google.com/pricing) lista FCM como producto sin costo. Que FCM no cobre por el servicio no elimina costos de implementación, procesamiento, soporte y mantenimiento.

Los escenarios históricos de abajo mantienen el mismo ingreso promedio de USD 9,89 con mezcla 50/30/20, pero sus USD 0,30 variables por restaurante son supuestos, no una estimación validada de Firestore. Medir antes de fijar precio definitivo; no asumir que la cuota gratuita cubre 100 negocios. Revisar después de 30 días las horas de soporte, operaciones por pedido y costo de restauración. Los precios finales al público deben aclarar tratamiento de impuestos antes del cobro.

## Estudio y supuestos históricos

Revisión: 27 de septiembre de 2026. USD. Recomendación inicial para validar con diez pilotos; no afirmar que es el precio «óptimo» hasta medir soporte y conversión. Comparables públicos consultados: [MenuDigital.ec](https://www.menudigital.ec/) anuncia plan gratuito y Pro de USD 9,99/mes; [César Reyes](https://www.cesarreyesjaramillo.com/menu-digital) publica un menú digital desde USD 150 de pago único. Las ofertas no son idénticas a QR Menu EC.

| Paquete | Funciones disponibles | Platos | Mes | Trimestre anticipado | Año anticipado |
|---|---|---:|---:|---:|---:|
| Carta | carta, QR, fotos, opciones | 40 | 6,90 | 19 | 69 |
| Carta + Promociones | anterior + banners/promociones | 80 | 10,90 | 30 | 109 |
| Carta + Pedidos QR | anterior + pedido mostrado al mesero y reporte | 150 | 15,90 | 44 | 159 |

Trimestre y año tienen vigencia concreta, sin soporte ni alojamiento perpetuo. No usar «pago único para siempre». La instalación en infraestructura del cliente sería un proyecto distinto, aún no listo para vender: faltan automatización de despliegue, transferencia segura de dominios/secretos, actualización y soporte pactados por contrato.

Incorporación autogestionada: USD 0. Incorporación asistida — carga inicial de hasta 20 platos, una sesión de 45 min y un QR listo para imprimir — precio piloto sugerido USD 20 una vez. Trabajos adicionales (fotografía, digitación masiva, diseño a medida) se cotizan aparte tras estimar horas. Soporte incluido: incidencias por correo en días laborables, objetivo de primera respuesta en 48 h; no prometer SLA de disponibilidad ni cocina automática.

## Costos y margen: escenario de decisión

[Cloudflare Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/) parte de USD 5/mes; el consumo adicional depende de solicitudes y CPU. [D1](https://developers.cloudflare.com/d1/platform/limits/) limita el tamaño por fila a 2 MB y factura/limita lecturas, escrituras y almacenamiento según plan. Resend, almacenamiento de fotos, dominios, Turnstile, soporte, pasarela/cobro y adquisición pueden variar: confirmar tarifas al contratar. Supuestos *no verificados* para simulación: infraestructura base USD 5/mes, variable USD 0,30/restaurante/mes, soporte 0,5 h/restaurante/mes a USD 5/h, cobros 4 % de ingresos; adquisición inicial USD 12 por cliente; correo y fotografía no incluidos. Mezcla ilustrativa: 50 % Carta, 30 % Promociones, 20 % Pedidos; ingreso mensual promedio USD 9,89.

| Restaurantes | Ingreso mensual estimado | Infraestructura estimada | Soporte estimado | Cobro estimado | Margen antes de adquisición, impuestos y trabajo inicial |
|---:|---:|---:|---:|---:|---:|
| 10 | 98,90 | 8,00 | 25,00 | 3,96 | 61,94 |
| 50 | 494,50 | 20,00 | 125,00 | 19,78 | 329,72 |
| 100 | 989,00 | 35,00 | 250,00 | 39,56 | 664,44 |

Estas cifras son sensibilidad, no presupuesto de producción: si soporte se eleva a 1 h por restaurante, el margen baja USD 25/125/250 respectivamente. El costo de adquisición se amortizaría solo si la retención lo permite; medir bajas y horas reales. Mantener un fondo para restauraciones y soporte. Revisar impuestos, comprobantes y modalidad de cobro con un profesional local antes de vender.

No se ofrece facturación SRI, pagos en la carta, inventario, modo sin internet ni recepción automática en cocina. El pedido QR es una confirmación que el comensal muestra al mesero.
