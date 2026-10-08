# Criterios de aceptación de la entrega

Este registro distingue evidencia local, simulación y producción. Las casillas pendientes no constituyen aprobación. Los documentos anteriores pueden describir versiones históricas: obtener siempre la versión activa por Cloudflare.

## Protección operativa comprobada

El inventario remoto de los respaldos nuevos confirmó `b582cbc6-9d31-4d51-b42b-790fea80ce9a`. Se respaldaron sin modificar datos la D1 operativa (2.036 documentos) y la D1 histórica (16 imágenes). Ambos archivos AES-256-GCM guardados fuera de Git se descifraron desde disco y restauraron en SQLite en memoria: integridad, claves foráneas y checksums correctos. R2 no tiene bindings y su API devuelve que debe habilitarse: no se activó ni se considera respaldado. Recibos privados bajo `work/private-backups/2026-10-08T04-38-49.472Z-20596e82` y `2026-10-08T04-39-19.842Z-86310244`.

## Matriz para cierre

| Recorrido | Evidencia exigida |
| --- | --- |
| Colores | HEX válido normalizado; CSS arbitrario rechazado; contraste real; restaurar/defaults sin guardado silencioso; importación antigua |
| Categorías | ID conservado al renombrar; orden persistido; eliminar con productos exige reasignación; revisión obsoleta rechazada |
| Publicar | Nombre ausente/invisible/default sin confirmar: 400 con texto exacto; ninguna revisión, slug ni provisión modificada |
| Dirección | Colisión concurrente atómica; URL completa; QR UUID anterior y nuevo abren mismo negocio; subdominio requiere TLS real |
| Sesión | Diez reaperturas mismo dispositivo; dos dispositivos independientes; refresh concurrente; logout/revocación/expiración |
| Carrito | 2+3 unidades = 5; total coherente; disminuir/eliminar/vaciar; accesibilidad 320px y zoom 200% |
| WhatsApp | Número propio válido; precios revalidados; apertura voluntaria; no autoenvío; estado solicitud/pedido explícito; carrito conservado |
| Promociones | Aviso no altera importe; regla explícita de descuento; fechas, vencimiento y duplicados; aislamiento |
| Pedidos | Clave igual/payload igual = uno; clave igual/payload distinto =409; claves distintas =dos; concurrencia atómica |
| Privacidad | Sin sesión: privados 401; dueño ajeno: denegado; CSRF; sin contacto predeterminado personal; caché pública sin privados |
| Permisos | Catálogo/configuración/pedidos/promociones/contactos/copias/sesiones; roles y límites comprobados en servidor |
| Presentación | Lista/tarjetas/compacta conservan carrito, precios y opciones; normal/ampliado; borrador no expone privados |
| Información | Guardar/publicar/recargar; horarios America/Guayaquil con cierre y medianoche; no afirmar abierto sin datos |
| Restauración | Ensayo aislado: carta, pedidos/líneas, imágenes, enlaces; nunca restauración de prueba productiva |
| Entrega | Tipos, lint, pruebas, emuladores, build; commit integrado; versión realmente servida; smoke dueño/comensal y limpieza |

## Verificación local y límites actuales

Tipos y build Worker aprobados. Suite general: 142 casos, 123 aprobados, 19 dependientes del emulador omitidos; suite específica Firestore 21 aprobados y reglas 8 aprobados. El primer launcher Firestore terminó con error al detener el emulador tras pasar sus pruebas; la repetición de reglas terminó correctamente. Lint no está aprobado: conserva deuda previa y hallazgos de archivos modificados; no se desactivaron reglas. Consultar logs locales outputs/product-tests-final.txt, product-emulator-tests.txt, product-rules-final.txt y lint-product-release-final.txt.

La comparación vigente de rendimiento está en [performance-release-2026-10-08.md](performance-release-2026-10-08.md). Sustituye mediciones anteriores sin gzip. Declara por separado API simulada, automatización y muestras aún faltantes; no acredita un dispositivo físico.

Capturas locales: 30 combinaciones de 3 plantillas, cinco anchos (320/360/390/768/1440) y zoom CSS 1/2. Comprobación de desbordamiento de página y diálogos aprobada; el zoom CSS no equivale a zoom real de navegador. A 320 px y zoom 2 el texto queda fragmentado y requiere desplazamiento vertical. Evidencia outputs/product-visual-qa, no prueba productiva.

Migración aditiva 0006 aplicada y comprobada en D1 histórica, sin modificar datos existentes. Las versiones preparadas sin tráfico no constituyen despliegue ni aceptación productiva. No habilitar URL de versiones históricas para probar candidatos.

Pendiente antes de activar: cerrar carreras concurrentes publicación/pedido y revocación/refresh detectadas por revisión independiente; ejecutar pruebas específicas y preparar versión nueva. Pendiente comprobación de dueño ficticio y Android real con cuenta ficticia. No afirmar producto listo para vender hasta completar recorridos productivos.