# Rendimiento comparable — 09-10-2026

Laboratorio Chromium, viewport 390 px, CPU 4×, descarga 1,6 Mbps, subida 750 kbps y RTT 150 ms. Catálogos ficticios de 10 y 40 platos. Bundles fijos: antes de PR 26 y después de PR 26. API ficticia servida por HTTP local; no mide Firebase ni latencia del backend productivo. Cinco cargas frías y cinco calientes por catálogo y fase; veinte repeticiones por interacción. La corrección posterior de activación de subdominios no modifica el frontend medido.

Se retiró la interceptación de Playwright en las pruebas de cargas: desactivaba la caché y hacía inválida la etiqueta «caliente». Los resultados anteriores de ese método no son una comparación de caché válida. Estas cifras sustituyen esa medición; ambas fases usan el mismo método corregido. «Utilizable» espera búsqueda y botón de agregar habilitados y dos fotogramas; no incluye la espera artificial del controlador.

Valores en milisegundos salvo CLS, formato mediana [mínimo–máximo]. Duraciones de navegación/guardado incluyen automatización; respuesta visual se mide aparte desde el evento DOM y dos fotogramas, sin acreditar INP ni latencia física.

| Recorrido / platos / temperatura / métrica | n | Antes | Después |
|---|---:|---:|---:|
| public- / 10 / load / cold / usableMs | 5 | 1967 [1947–2882] | 1906 [1842–2899] |
| public- / 10 / load / cold / lcp | 5 | 1980 [1960–2840] | 1920 [1868–2788] |
| public- / 10 / load / cold / cls | 5 | 0.065 [0.065–0.065] | 0.065 [0.065–0.065] |
| public- / 10 / load / warm / usableMs | 5 | 1431 [970–1482] | 1368 [1190–1426] |
| public- / 10 / load / warm / lcp | 5 | 1404 [980–1460] | 1388 [1204–1448] |
| public- / 10 / load / warm / cls | 5 | 0.065 [0.065–0.065] | 0.065 [0.065–0.065] |
| public- / 10 / search / - / ms | 20 | 162 [74–420] | 125 [95–307] |
| public- / 10 / category / - / ms | 20 | 229 [105–495] | 186 [143–402] |
| public- / 10 / cart-add / - / ms | 20 | 305 [183–460] | 284 [236–476] |
| public- / 40 / load / cold / usableMs | 5 | 2084 [1989–3581] | 2003 [1917–3362] |
| public- / 40 / load / cold / lcp | 5 | 2108 [2016–3468] | 2016 [1932–3272] |
| public- / 40 / load / cold / cls | 5 | 0.065 [0.065–0.065] | 0.065 [0.065–0.065] |
| public- / 40 / load / warm / usableMs | 5 | 1483 [1200–1629] | 1416 [1306–1578] |
| public- / 40 / load / warm / lcp | 5 | 1488 [1228–1640] | 1420 [1324–1564] |
| public- / 40 / load / warm / cls | 5 | 0.065 [0.065–0.065] | 0.065 [0.065–0.065] |
| public- / 40 / search / - / ms | 20 | 131 [82–355] | 139 [113–289] |
| public- / 40 / category / - / ms | 20 | 211 [151–340] | 233 [132–497] |
| public- / 40 / cart-add / - / ms | 20 | 288 [220–521] | 334 [217–559] |
| owner- / 10 / panel-open / cold / ms | 5 | 2453 [2229–4459] | 2536 [2320–3706] |
| owner- / 10 / panel-open / warm / ms | 5 | 1573 [1492–1838] | 1515 [1498–1576] |
| owner- / 10 / save / - / ms | 20 | 954 [746–1132] | 821 [757–1377] |
| owner- / 10 / publish / - / ms | 20 | 1481 [961–1761] | 1375 [1289–1590] |
| owner- / 10 / orders-open / - / ms | 20 | 339 [302–453] | 326 [304–387] |
| owner- / 40 / panel-open / cold / ms | 5 | 2663 [2563–3980] | 2589 [2575–3773] |
| owner- / 40 / panel-open / warm / ms | 5 | 1694 [1530–1856] | 1597 [1508–1701] |
| owner- / 40 / save / - / ms | 20 | 1315 [1044–2874] | 1223 [993–1388] |
| owner- / 40 / publish / - / ms | 20 | 1718 [1174–5228] | 1358 [1139–1862] |
| owner- / 40 / orders-open / - / ms | 20 | 407 [331–457] | 364 [287–482] |
| session- / - / login / - / ms | 20 | 2158 [1562–4366] | 2041 [1771–2886] |
| session- / - / remembered-refresh / - / ms | 20 | 2757 [2325–5416] | 2739 [2226–4723] |
| cart-order- / 10 / cart-decrease / - / ms | 20 | 269 [248–356] | 271 [200–568] |
| cart-order- / 10 / cart-remove / - / ms | 20 | 158 [138–222] | 133 [103–181] |
| cart-order- / 10 / cart-empty / - / ms | 20 | 253 [210–337] | 219 [150–456] |
| cart-order- / 10 / order-create / - / ms | 20 | 474 [401–756] | 452 [350–751] |
| cart-order- / 40 / cart-decrease / - / ms | 20 | 332 [260–474] | 344 [233–462] |
| cart-order- / 40 / cart-remove / - / ms | 20 | 198 [136–303] | 199 [131–299] |
| cart-order- / 40 / cart-empty / - / ms | 20 | 285 [196–900] | 292 [197–405] |
| cart-order- / 40 / order-create / - / ms | 20 | 460 [393–667] | 449 [412–705] |

Respuesta visual (evento → oportunidad de presentación):

| Platos / interacción | n | Antes | Después |
|---|---:|---:|---:|
| 10 / search | 20 | 38 [29–75] | 29 [21–48] |
| 10 / category | 20 | 49 [36–95] | 38 [29–82] |
| 10 / cart-add | 20 | 47 [37–77] | 40 [23–75] |
| 40 / search | 20 | 43 [36–74] | 35 [22–157] |
| 40 / category | 20 | 89 [64–126] | 66 [47–151] |
| 40 / cart-add | 20 | 83 [24–123] | 66 [37–154] |

Limitaciones adicionales: consulta de pedidos incluye una espera fija de 200 ms del controlador y no constituye latencia de la consulta. Las interacciones visuales usan datos sin fotografías y, con 40 platos, la primera ventana de 30 tarjetas. Los JSON de cargas llevan una corrección explícita de la descripción obsoleta de usableMs; no se cambiaron muestras, fechas de medición ni cifras.
