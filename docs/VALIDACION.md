# Validación de la edición piloto

Estado: software piloto, no certificado para venta como instalación automática universal.

## Comprobado en este entorno

- TypeScript sin errores y compilación web y local completadas.
- Cinco pruebas automatizadas del API compartido y descarga offline: autenticación, licencias alteradas, conflictos de publicación, recuperación, catálogo, QR, treinta lecturas concurrentes y conservación de la copia anterior cuando falla una foto.
- Pruebas Go de persistencia, publicación, licencias y control de acceso.
- Chromium contra el servidor Go real: alta del dueño, activación de licencia, publicación, QR, menú guiado, selección y total, aislamiento del borrador respecto de la publicación y disposición móvil sin desbordamiento.
- Binarios compilados para Windows moderno, Windows 7 de 32 bits y Linux ARM64. Compilar no certifica ejecución en esos equipos.
- APK Android compilado y firma verificada. No ejecutado en un teléfono físico.
- Auditoría npm de dependencias de producción: cero vulnerabilidades reportadas en esta ejecución. Las herramientas de desarrollo requieren seguimiento independiente.

Las capturas y el resultado del navegador están en outputs/qa. La prueba de treinta lectores es de API; no sustituye treinta teléfonos en una red Wi-Fi.

## Pendiente antes de certificar y vender cada configuración

Ejecutar la matriz de VENTA-Y-CERTIFICACION.md con Android e iPhone reales: red olvidada y recordada, datos móviles activos e inactivos, cero internet, ambos modos, cierre y reapertura del portal, reinicios y fallos del servidor. Registrar las pulsaciones reales.

Probar físicamente el router GL-MT3000, cada versión de Windows y Android 10 o posterior; treinta clientes simultáneos y una jornada completa del servidor Android. Verificar aislamiento de red y recuperación tras corte eléctrico. Probar el despliegue web con una cuenta de restaurante y la descarga offline en sus navegadores objetivo.

Windows usa una tarea de inicio automático bajo SYSTEM, no un servicio registrado en el administrador SCM. Esta diferencia debe resolverse si un cliente exige un servicio SCM. El perfil OpenWrt se aplica mediante el instalador con el JSON exportado; el panel no administra remotamente el router por SSH.

No anunciar apertura silenciosa universal ni presentar estas verificaciones de software como certificación física.
