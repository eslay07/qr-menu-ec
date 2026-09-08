# Entrega comercial y certificación

No anunciar apertura silenciosa universal. Promesa permitida tras validar: «Escanea, acepta la conexión si tu teléfono lo solicita y abre el menú sin internet». El modo automático intenta abrir el portal; algunos teléfonos muestran un aviso para tocar. El modo guiado presenta una bienvenida y el botón Ver menú.

## Matriz de campo obligatoria

Registrar fecha, firmware, modelo servidor, modelo cliente, versión de Android/iOS, estado de datos móviles, red nueva/recordada, número de toques, apertura del portal, tiempo de carga y observaciones.

Pendientes físicos: GL-MT3000 con firmware elegido; Windows 7 SP1; Windows 10; Android servidor durante ocho horas; iPhone y Android cliente; treinta conexiones Wi-Fi reales. Las pruebas HTTP de 30 lectores no equivalen a 30 asociaciones inalámbricas.

Casos: foto y sin foto; búsqueda; carrito y total; cambio a agotado; publicación mientras hay lectores; pérdida de WAN; servidor apagado; router reiniciado; portal cerrado; visitante que regresa; VPN/DNS privado; certificados en dispositivos del dueño; reinicio del servidor y restauración.

No marcar una configuración como certificada sin registrar el resultado físico. El panel muestra pendiente a propósito: guardar un tipo de equipo no verifica su conectividad.

## Licencias

Una licencia por restaurante/local y modalidades compradas, sin expiración periódica. El vendedor emite un archivo firmado que el restaurante importa. La aplicación y sus servidores verifican Ed25519, identidad y modalidades. La clave privada permanece fuera de código, paquetes y alojamiento. Una ampliación debe incluir todas las modalidades que el cliente conserva, porque reemplaza la licencia anterior.

Un software ejecutado en equipos propiedad del comprador no es DRM inviolable. Las firmas impiden fabricar licencias aceptadas por una instalación íntegra; no impiden que alguien modifique deliberadamente su copia del programa.

Generar claves: `node tools/license.mjs keygen RUTA_PRIVADA_FUERA_DEL_PROYECTO`.

Emitir modalidad principal: `node tools/license.mjs issue CLAVE_PRIVADA ID_RESTAURANTE CLIENTE text ARCHIVO.json`. Para conservar ampliaciones existentes, incluye todas las modalidades adquiridas, por ejemplo `text,local,web`.

En esta entrega la clave del vendedor se conserva en la carpeta privada hermana del proyecto. Respaldarla fuera del equipo antes de emitir licencias comerciales. La identidad de firma Android de piloto es distinta y tampoco debe perderse para futuras actualizaciones.

## Precio y alcance

Separar licencia, instalación, equipo y soporte. No incluir alojamiento indefinido en un pago único. Windows 7 es una edición heredada local con toolchain sin mantenimiento; requiere evaluación adicional y no se expondrá directamente a internet. Los paquetes pilotos no incluyen garantía de hardware ni homologación.
