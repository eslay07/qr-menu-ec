# Rendimiento reproducible

Medición serial 2026-10-08T06:44:39.201Z: bundles anteriores y posteriores preservados, servidor estático con gzip, Chromium 390×844, CPU 4×, descarga 1,6 Mbps, subida 750 kbps, RTT 150 ms. Cinco cargas frías y cinco calientes válidas por catálogo de 10/40 productos. Veinte repeticiones por interacción mostrada.

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
| public-|after|10|load|cold|usableMs | 5 | 2451.14 | 2294.69–3333.95 |
| public-|after|10|load|cold|lcp | 5 | 1768.00 | 1720.00–3048.00 |
| public-|after|10|load|cold|cls | 5 | 0.06 | 0.06–0.06 |
| public-|after|10|load|warm|usableMs | 5 | 2394.68 | 2361.99–2501.80 |
| public-|after|10|load|warm|lcp | 5 | 1776.00 | 1724.00–1776.00 |
| public-|after|10|load|warm|cls | 5 | 0.06 | 0.06–0.06 |
| public-|after|10|search|-|ms | 20 | 124.98 | 83.91–283.67 |
| public-|after|10|category|-|ms | 20 | 200.88 | 126.51–418.90 |
| public-|after|10|cart-add|-|ms | 20 | 300.15 | 161.15–589.32 |
| public-|after|40|load|cold|usableMs | 5 | 2559.25 | 2383.56–3350.61 |
| public-|after|40|load|cold|lcp | 5 | 2136.00 | 1744.00–3208.00 |
| public-|after|40|load|cold|cls | 5 | 0.06 | 0.06–0.06 |
| public-|after|40|load|warm|usableMs | 5 | 2454.58 | 2420.49–2622.72 |
| public-|after|40|load|warm|lcp | 5 | 2028.00 | 1852.00–2072.00 |
| public-|after|40|load|warm|cls | 5 | 0.06 | 0.06–0.06 |
| public-|after|40|search|-|ms | 20 | 184.94 | 94.60–301.29 |
| public-|after|40|category|-|ms | 20 | 272.53 | 117.83–518.38 |
| public-|after|40|cart-add|-|ms | 20 | 361.04 | 190.91–571.66 |
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
