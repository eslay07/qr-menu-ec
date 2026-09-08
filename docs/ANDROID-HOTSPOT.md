# QR Menu Resuelven · Android dueño 0.3.0

Descarga: https://qr-menu-resuelven.pages.dev/android

## Qué está preparado

APK firmado para Android 10 o posterior. La pantalla principal abre el panel del dueño alojado en
Cloudflare para modificar carta, fotos, precios y generar los dos QR. El creador controla la cuenta
desde su panel privado. Las herramientas de hotspot, direcciones privadas y demo por IP se conservan.
La demo RESTAURANTE DEMO RESUELVEN está empaquetada dentro del APK:
un cliente nuevo puede descargarla desde el teléfono servidor sin Internet, siempre que se conecte a su Wi-Fi.
El acceso es `http://IP-DEL-SERVIDOR:8080/restaurante-demo`; el QR está en esa ruta seguida de `/qr`.
La IP real la muestra la aplicación; no hay una IP universal para Android.

## Instalación: dos celulares

1. En el Android del dueño abre el enlace de descarga y toca **Descargar APK del dueño**.
2. Abre el archivo desde Descargas. Si Android lo solicita, permite a Chrome instalar desde esta fuente
   y vuelve para instalar. No desactives Play Protect ni desinstales una versión anterior con datos.
3. Abre **QR Menu Resuelven** y pulsa **Administrar mi restaurante**.
4. Introduce el código entregado por el creador y luego la contraseña del dueño. Para probar también el respaldo local, abre Ajustes y busca **Hotspot**, **Zona Wi-Fi**, **Punto de acceso** o **Compartir Internet**.
5. Activa la zona Wi-Fi. Anota su nombre y contraseña. El nombre exacto del ajuste depende del fabricante.
6. Vuelve a la aplicación. Pulsa **Actualizar direcciones**, después **Iniciar servidor**.
7. Espera la notificación **QR Menú está disponible**. Pulsa **Probar demo en este teléfono**.
8. En el segundo celular conéctate a la zona Wi-Fi del primero. Acepta mantener esa conexión sin Internet.
9. En el servidor abre **Mostrar QR del menú demo** correspondiente a la IP de la zona Wi-Fi.
   Escanéalo desde el segundo celular ya conectado. También puedes escribir la dirección Demo.
10. Revisa categorías, precios y foto. Desactiva los datos móviles de ambos, sin apagar el hotspot.
    Recarga desde el cliente: debe obtener los datos del servidor local.
11. Apaga la pantalla del servidor y repite. Manténlo cargando. Revisa los ajustes de batería
    de la aplicación si el fabricante detiene el servidor. No se garantiza ejecución continua en todos los modelos.
12. Al terminar, pulsa **Detener servidor** en la aplicación o notificación y apaga el hotspot.

Si hay varias IP, usa la puerta de enlace que muestra la información Wi-Fi del cliente, siempre con
puerto 8080. No escribas 127.0.0.1 en el segundo celular. Si cambia la IP al reiniciar la zona Wi-Fi,
actualiza direcciones y genera otro QR. No se anuncia un portal cautivo automático.

## Carta propia y funciones conservadas

La demo no crea dueño, modifica datos, elimina licencias ni publica una carta real. El panel anterior
y sus funciones siguen presentes. Para la carta propia: iniciar servidor, mostrar código de instalación,
configurar al dueño en el panel HTTPS, conservar recuperación, importar licencia para la identidad
del restaurante, guardar borrador y publicar. La carta real se consulta en `/menu`.

La administración usa el certificado local existente. Verifica su huella y confíalo únicamente en
dispositivos administradores; no pidas certificados a los clientes. La emisión de la licencia requiere
el ID generado al configurar ese teléfono; no se incluye una licencia universal en el APK.

## Pruebas y alcance

- Compilación Kotlin/Android release: aprobada.
- Android lint release: sin errores; quedan advertencias del piloto (incluida operación prolongada con wake lock).
- Firma APK: verificada con apksigner; misma identidad de firma que el piloto anterior, versión de aplicación 3.
- Assets del panel y de la demo: empaquetados dentro del APK, sin dependencia de Cloudflare para servirlos.
- Teléfono conectado por ADB: ninguno. Instalación física, conectividad por hotspot, autonomía,
  pantalla apagada y compatibilidad del fabricante: pendientes, no se declaran probadas.
- La prueba Android offline confirmada anteriormente correspondía a la PWA web; no certifica este servidor APK.

## Reconstruir en este equipo

Ejecuta `./scripts/build-android-hotspot.ps1` desde PowerShell en el proyecto. Reutiliza los toolchains
de `work/toolchains`, JDK 23 y la identidad de firma guardada fuera del repositorio. La clave privada
no se publica. El script para al primer error, ejecuta lint, firma, verifica y prepara
`deployment/android/qr-menu-android.apk` y su SHA-256. Luego `npm run build:pages` incluye la descarga.
El APK se excluye de la caché offline del menú para no cargar aproximadamente 10 MB a cada comensal.
