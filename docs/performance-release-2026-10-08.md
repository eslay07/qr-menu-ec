# Rendimiento reproducible

Medición serial 2026-10-08T14:04:48.413Z: bundles anteriores y posteriores preservados, servidor estático con gzip, Chromium 390×844, CPU 4×, descarga 1,6 Mbps, subida 750 kbps, RTT 150 ms. Cinco cargas frías y cinco calientes válidas por catálogo de 10/40 productos. Veinte repeticiones por interacción mostrada.

API ficticia local: estas cifras no acreditan latencia del backend productivo, Firebase real ni Android físico. Las interacciones incluyen automatización; no equivalen a tiempo visual. usableMs incluye asentamiento networkidle. La medición posterior se repitió con el bundle final, incluido el ajuste de diálogo y ruta explícita. Se descarta la comparación anterior sin gzip por no representar la transferencia comprimida productiva.

| Métrica/fase/catálogo | n | Mediana (ms excepto CLS) | Rango |
| --- | --- | --- | --- |
| public-|before|10|load|cold|usableMs | 5 | 2411.44 | 2147.81–3191.67 |
| public-|before|10|load|cold|lcp | 5 | 1724.00 | 1640.00–3124.00 |
| public-|before|10|load|cold|cls | 5 | 0.03 | 0.03–0.03 |
| public-|before|10|load|warm|usableMs | 5 | 2322.97 | 2161.31–2400.69 |
| public-|before|10|load|warm|lcp | 5 | 1624.00 | 1568.00–1832.00 |
| public-|before|10|load|warm|cls | 5 | 0.03 | 0.03–0.03 |
| public-|before|10|search|-|ms | 20 | 131.93 | 84.69–309.93 |
| public-|before|10|category|-|ms | 20 | 176.67 | 74.52–332.90 |
| public-|before|10|cart-add|-|ms | 20 | 300.51 | 143.39–536.12 |
| public-|before|40|load|cold|usableMs | 5 | 2350.55 | 2240.67–4024.15 |
| public-|before|40|load|cold|lcp | 5 | 2020.00 | 1732.00–3812.00 |
| public-|before|40|load|cold|cls | 5 | 0.03 | 0.00–0.03 |
| public-|before|40|load|warm|usableMs | 5 | 2289.92 | 2183.09–2304.76 |
| public-|before|40|load|warm|lcp | 5 | 1776.00 | 1656.00–1868.00 |
| public-|before|40|load|warm|cls | 5 | 0.03 | 0.03–0.03 |
| public-|before|40|search|-|ms | 20 | 195.88 | 86.81–353.75 |
| public-|before|40|category|-|ms | 20 | 267.37 | 166.34–789.03 |
| public-|before|40|cart-add|-|ms | 20 | 448.10 | 171.49–664.19 |
| public-|after|10|load|cold|usableMs | 5 | 2485.19 | 2303.90–4039.99 |
| public-|after|10|load|cold|lcp | 5 | 1740.00 | 1708.00–3792.00 |
| public-|after|10|load|cold|cls | 5 | 0.06 | 0.06–0.06 |
| public-|after|10|load|warm|usableMs | 5 | 2404.03 | 2233.52–2460.33 |
| public-|after|10|load|warm|lcp | 5 | 1732.00 | 1616.00–1800.00 |
| public-|after|10|load|warm|cls | 5 | 0.06 | 0.06–0.06 |
| public-|after|10|search|-|ms | 20 | 111.33 | 45.61–458.63 |
| public-|after|10|category|-|ms | 20 | 181.76 | 94.78–492.54 |
| public-|after|10|cart-add|-|ms | 20 | 363.24 | 151.71–521.75 |
| public-|after|40|load|cold|usableMs | 5 | 2565.47 | 2447.76–3200.51 |
| public-|after|40|load|cold|lcp | 5 | 2064.00 | 1912.00–3000.00 |
| public-|after|40|load|cold|cls | 5 | 0.06 | 0.06–0.06 |
| public-|after|40|load|warm|usableMs | 5 | 2533.51 | 2378.69–2552.29 |
| public-|after|40|load|warm|lcp | 5 | 1972.00 | 1728.00–2068.00 |
| public-|after|40|load|warm|cls | 5 | 0.06 | 0.06–0.06 |
| public-|after|40|search|-|ms | 20 | 204.42 | 99.86–331.52 |
| public-|after|40|category|-|ms | 20 | 312.95 | 156.92–569.15 |
| public-|after|40|cart-add|-|ms | 20 | 443.03 | 148.85–627.17 |
| owner-|before|10|panel-open|cold|ms | 5 | 2091.49 | 2003.59–4306.93 |
| owner-|before|10|panel-open|warm|ms | 5 | 2094.79 | 1958.90–2504.74 |
| owner-|before|10|save|-|ms | 20 | 764.43 | 692.56–1046.86 |
| owner-|before|10|publish|-|ms | 20 | 1318.79 | 906.40–1579.40 |
| owner-|before|10|orders-open|-|ms | 20 | 343.72 | 295.37–425.60 |
| owner-|before|40|panel-open|cold|ms | 5 | 2662.04 | 2506.34–4009.13 |
| owner-|before|40|panel-open|warm|ms | 5 | 2443.56 | 2399.42–2917.60 |
| owner-|before|40|save|-|ms | 20 | 1151.18 | 901.91–1693.29 |
| owner-|before|40|publish|-|ms | 20 | 1424.29 | 1080.64–1902.11 |
| owner-|before|40|orders-open|-|ms | 20 | 410.38 | 316.48–449.86 |
| owner-|after|10|panel-open|cold|ms | 5 | 2688.82 | 2629.78–3641.10 |
| owner-|after|10|panel-open|warm|ms | 5 | 2521.41 | 2242.65–2613.23 |
| owner-|after|10|save|-|ms | 20 | 842.94 | 663.14–1032.58 |
| owner-|after|10|publish|-|ms | 20 | 1432.98 | 979.39–1695.62 |
| owner-|after|10|orders-open|-|ms | 20 | 346.38 | 319.33–438.23 |
| owner-|after|40|panel-open|cold|ms | 5 | 2588.46 | 2347.17–4445.37 |
| owner-|after|40|panel-open|warm|ms | 5 | 2567.04 | 2415.55–2656.61 |
| owner-|after|40|save|-|ms | 20 | 1195.42 | 806.46–1633.71 |
| owner-|after|40|publish|-|ms | 20 | 1250.43 | 966.86–1523.55 |
| owner-|after|40|orders-open|-|ms | 20 | 360.03 | 314.66–513.59 |
| session-|before|-|login|-|ms | 20 | 2485.19 | 2372.32–3332.46 |
| session-|before|-|remembered-refresh|-|ms | 20 | 4094.11 | 3693.35–5010.72 |
| session-|after|-|login|-|ms | 20 | 2777.65 | 2512.53–3439.91 |
| session-|after|-|remembered-refresh|-|ms | 20 | 4120.99 | 3845.33–4683.53 |
| cart-order-|before|10|cart-decrease|-|ms | 20 | 308.15 | 212.05–513.18 |
| cart-order-|before|10|cart-remove|-|ms | 20 | 144.91 | 110.17–249.16 |
| cart-order-|before|10|cart-empty|-|ms | 20 | 239.29 | 173.76–476.56 |
| cart-order-|before|10|order-create|-|ms | 20 | 508.11 | 429.54–658.73 |
| cart-order-|before|40|cart-decrease|-|ms | 20 | 399.22 | 161.83–534.15 |
| cart-order-|before|40|cart-remove|-|ms | 20 | 218.05 | 155.70–316.18 |
| cart-order-|before|40|cart-empty|-|ms | 20 | 378.07 | 262.23–735.00 |
| cart-order-|before|40|order-create|-|ms | 20 | 558.57 | 431.40–1011.26 |
| cart-order-|after|10|cart-decrease|-|ms | 20 | 291.74 | 223.64–431.10 |
| cart-order-|after|10|cart-remove|-|ms | 20 | 144.90 | 88.75–264.62 |
| cart-order-|after|10|cart-empty|-|ms | 20 | 253.44 | 171.76–418.03 |
| cart-order-|after|10|order-create|-|ms | 20 | 474.57 | 408.61–720.36 |
| cart-order-|after|40|cart-decrease|-|ms | 20 | 343.34 | 227.49–545.33 |
| cart-order-|after|40|cart-remove|-|ms | 20 | 181.13 | 117.22–722.32 |
| cart-order-|after|40|cart-empty|-|ms | 20 | 289.86 | 185.77–444.51 |
| cart-order-|after|40|order-create|-|ms | 20 | 511.73 | 411.56–739.13 |

Evidencia completa local: outputs/mobile-performance/*.json y logs. Scripts versionados mobile-performance-qa.ts, owner-performance-qa.ts, session-performance-qa.ts y performance-run.mjs. Se agregaron veinte repeticiones por catálogo de disminuir, eliminar, vaciar y crear pedido con API ficticia y recalculador real, sin persistencia ni Turnstile. No acredita creación productiva.

## Respuesta visual instrumentada adicional

Veinte repeticiones por interacción y catálogo, en los mismos bundles y perfil. El reloj empieza en captura de input/click del navegador, espera el DOM esperado mediante MutationObserver y dos requestAnimationFrame. Es una aproximación a oportunidad de presentación, no observación de píxeles ni INP; excluye la cola anterior al evento y hardware. El catálogo de 40 usa la ventana inicial existente de 30 tarjetas. API ficticia local sin fotos; no es producción ni Honor.

| Catálogo | Interacción | Antes: mediana [mín–máx], ms | Después: mediana [mín–máx], ms |
| --- | --- | --- | --- |
| 10 | search | 36.90 [22.60–73.40] | 37.45 [18.90–143.50] |
| 10 | category | 34.05 [12.00–63.10] | 63.55 [34.10–109.20] |
| 10 | cart-add | 42.40 [24.00–117.60] | 47.75 [26.70–152.80] |
| 40 | search | 46.80 [29.10–124.00] | 40.75 [28.30–139.10] |
| 40 | category | 86.85 [49.20–154.30] | 84.75 [47.20–326.20] |
| 40 | cart-add | 67.85 [46.40–186.30] | 69.45 [11.20–166.30] |

Las medianas posteriores están bajo 200 ms. En categoría de 40 aparece un máximo de 326,20 ms: el objetivo no se cumple en todas las repeticiones. Tampoco se afirma una mejora general de LCP: antes 10/40 fríos 1.724/2.020 ms, después 1.740/2.064 ms. La separación de módulos reduce el arranque inicial y mantiene medianas dentro del objetivo, pero las colas de carga fría exceden 2,5 s.

Carta y respuesta instrumentada se repitieron tras la corrección final de contraste, con el CSS final servido en4186. Las muestras de panel, sesión y API de carrito/pedido anteriores se conservaron: los cambios finales son selectores limitados a la carta pública y no cambian esas rutas ni el servidor.
