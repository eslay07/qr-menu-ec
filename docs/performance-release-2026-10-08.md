# Rendimiento reproducible

Medición serial 2026-10-08T06:21:03.079Z: bundles anteriores y posteriores preservados, servidor estático con gzip, Chromium 390×844, CPU 4×, descarga 1,6 Mbps, subida 750 kbps, RTT 150 ms. Cinco cargas frías y cinco calientes válidas por catálogo de 10/40 productos. Veinte repeticiones por interacción mostrada.

API ficticia local: estas cifras no acreditan latencia del backend productivo, Firebase real ni Android físico. Las interacciones incluyen automatización; no equivalen a tiempo visual. usableMs incluye asentamiento networkidle. La copia posterior precede al último ajuste de diálogo y ruta explícita; repetir en versión final. Se descarta la comparación anterior sin gzip por no representar la transferencia comprimida productiva.

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
| public-|after|10|load|cold|usableMs | 5 | 2426.89 | 2404.58–3305.65 |
| public-|after|10|load|cold|lcp | 5 | 1836.00 | 1748.00–3000.00 |
| public-|after|10|load|cold|cls | 5 | 0.06 | 0.06–0.06 |
| public-|after|10|load|warm|usableMs | 5 | 2424.74 | 2359.95–2446.71 |
| public-|after|10|load|warm|lcp | 5 | 1808.00 | 1708.00–1884.00 |
| public-|after|10|load|warm|cls | 5 | 0.06 | 0.06–0.06 |
| public-|after|10|search|-|ms | 20 | 124.43 | 104.03–281.50 |
| public-|after|10|category|-|ms | 20 | 188.12 | 123.04–320.45 |
| public-|after|10|cart-add|-|ms | 20 | 284.44 | 165.64–443.45 |
| public-|after|40|load|cold|usableMs | 5 | 2459.43 | 2391.34–3926.75 |
| public-|after|40|load|cold|lcp | 5 | 1932.00 | 1856.00–3800.00 |
| public-|after|40|load|cold|cls | 5 | 0.06 | 0.06–0.06 |
| public-|after|40|load|warm|usableMs | 5 | 2419.09 | 2395.17–2444.58 |
| public-|after|40|load|warm|lcp | 5 | 1888.00 | 1872.00–1928.00 |
| public-|after|40|load|warm|cls | 5 | 0.06 | 0.06–0.06 |
| public-|after|40|search|-|ms | 20 | 145.47 | 107.59–307.80 |
| public-|after|40|category|-|ms | 20 | 231.58 | 162.40–444.66 |
| public-|after|40|cart-add|-|ms | 20 | 346.42 | 265.25–525.50 |
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
| owner-|after|10|panel-open|cold|ms | 5 | 2510.40 | 2447.26–3743.54 |
| owner-|after|10|panel-open|warm|ms | 5 | 2401.52 | 2304.61–2698.50 |
| owner-|after|10|save|-|ms | 20 | 936.72 | 721.66–1251.57 |
| owner-|after|10|publish|-|ms | 20 | 1507.78 | 942.19–1671.87 |
| owner-|after|10|orders-open|-|ms | 20 | 358.74 | 297.04–450.12 |
| owner-|after|40|panel-open|cold|ms | 5 | 2687.94 | 2552.64–4300.91 |
| owner-|after|40|panel-open|warm|ms | 5 | 2679.81 | 2510.49–3005.33 |
| owner-|after|40|save|-|ms | 20 | 1209.56 | 1015.50–1610.45 |
| owner-|after|40|publish|-|ms | 20 | 1386.26 | 1175.32–1980.46 |
| owner-|after|40|orders-open|-|ms | 20 | 361.95 | 334.46–539.49 |
| session-|before|-|login|-|ms | 20 | 2485.19 | 2372.32–3332.46 |
| session-|before|-|remembered-refresh|-|ms | 20 | 4094.11 | 3693.35–5010.72 |
| session-|after|-|login|-|ms | 20 | 2693.33 | 2487.16–3527.28 |
| session-|after|-|remembered-refresh|-|ms | 20 | 4171.95 | 3821.38–5609.38 |

Evidencia completa local: outputs/mobile-performance/*.json y logs. Scripts versionados mobile-performance-qa.ts, owner-performance-qa.ts, session-performance-qa.ts y performance-run.mjs. No se midió aún eliminación de carrito ni creación de pedidos en este perfil. No afirmar cumplimiento de esos objetivos.
