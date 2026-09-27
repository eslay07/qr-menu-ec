# Planes, precios y costos de referencia

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
