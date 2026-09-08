# QR Menú — instalación y operación

Estado: edición piloto. La compilación y las pruebas de software no certifican la apertura del portal en teléfonos físicos.

## Windows 10 / Windows 7 SP1

1. Descomprime el paquete adecuado en una carpeta nueva. Windows 7 utiliza un ejecutable de 32 bits compatible también con Windows 7 de 64 bits; no usa Internet Explorer como editor.
2. Reserva una dirección fija para la PC en el router (por defecto el instalador espera 192.168.8.100). La red debe ser de perfil privado.
3. Ejecuta PowerShell como administrador y `./Install.ps1 -ServerIP 192.168.8.100`. El instalador copia el programa a ProgramData/QRMenu, conserva los datos, registra un servicio Windows SCM con inicio automático como SYSTEM y recuperación ante fallos y abre únicamente los puertos 8080 y 8443 en red privada. No instala un controlador ni modifica el acceso WAN.
4. Abre el certificado público `ProgramData/QRMenu/data/server.crt`, verifica que procede de esta instalación y confía en él solo en los equipos administradores. No distribuyas `server.key`.
5. Lee el código de `data/installation-code.txt`, abre `https://192.168.8.100:8443/`, crea el dueño y guarda el código de recuperación.
6. Importa la licencia firmada, edita, guarda y publica. Los clientes usan `http://192.168.8.100:8080/menu` desde la red dedicada.

Para parar: ejecuta Stop.ps1 como administrador. Para impedir el siguiente arranque: `Set-Service QRMenu-Servidor -StartupType Disabled`. Para actualizar: ejecuta Install.ps1 del nuevo paquete; detiene el servicio y guarda binario, interfaz, clave pública y datos anteriores en ProgramData/QRMenu/backups antes de sustituir archivos. Para desinstalar el servicio: Uninstall.ps1; conserva todos los archivos y datos. Una instalación fallida conserva el respaldo e informa su ubicación, pero no restaura automáticamente los datos.

Si cambia la IP, actualiza la reserva DHCP o renueva los certificados con el servidor detenido y reconfigura la confianza. El certificado generado tiene las IP suministradas al primer arranque; no se reescribe automáticamente.

## Android

Instala el APK piloto, autoriza las notificaciones e inicia el servidor desde la aplicación. El equipo necesita Android 10 o posterior, permanecer conectado al router y al cargador. Abre el panel mediante el botón de la aplicación. La aplicación muestra el código de instalación, las direcciones actuales y la huella del certificado.

Descarga el certificado público desde `http://IP:8080/certificate` y verifica su huella contra la aplicación antes de instalarlo como certificado de confianza de usuario en los dispositivos administradores. No indiques a comensales que instalen certificados. La ruta del menú de invitados es HTTP, de solo lectura.

Los pasos para confiar en certificados y permitir ejecución prolongada varían por fabricante. Antes de vender un modelo, valida ocho horas con pantalla apagada, reinicios, cambios de red, acceso desde otro celular y detención desde la notificación. El sistema puede detener procesos pese al servicio en primer plano. El hotspot común no incluye un portal cautivo administrable.

## Router GL.iNet GL-MT3000

Solo usar la edición arm64 en el modelo exacto, con firmware OpenWrt compatible y openNDS instalado. No se incluye ni se flashea firmware. Monta una unidad USB persistente en `/mnt/qrmenu`; debe estar disponible antes de arrancar el servicio. El menú y los datos no deben depender de `/tmp`.

1. Conserva la red de administración en 192.168.8.1 y realiza un respaldo completo del router.
2. Descomprime el paquete, da permiso de ejecución al binario y a los scripts (`chmod +x qrmenu *.sh`) y ejecuta `./install.sh` por SSH.
3. Configura el dueño en `https://192.168.8.1:8443/`. Confía en el certificado público solo en equipos administradores. El código de instalación está en `/mnt/qrmenu/data/installation-code.txt`.
4. En Acceso de clientes, define el SSID, clave y URL local (`http://192.168.50.1:8080/menu` para el router integrado). Guarda y exporta el perfil.
5. Transfiere perfil-router.json al router. Ejecuta `./configure-network.sh --check perfil-router.json`. Revisa el resultado; después ejecuta la misma orden con `--apply` conectado a la red de administración.
6. Se crea la red de invitados 192.168.50.0/24 en radio0, con aislamiento entre clientes y sin acceso a administración ni a internet. openNDS anuncia el portal; una excepción limitada permite llegar al menú por 8080. No se intercepta HTTPS.
7. El perfil conserva las configuraciones previas en `/root/qrmenu-network-FECHA`. Si un reinicio de servicio falla, el script intenta restaurarlas. Esa restauración automática no cubre cortes de energía ni todas las configuraciones posibles: el instalador debe conservar acceso físico y su respaldo.

Para un servidor PC/Android usa una reserva DHCP en 192.168.8.x y esa URL en el perfil. Solo se permite tráfico de invitados al puerto 8080 de esa dirección. El teléfono servidor permanece en la red administradora, no en el SSID aislado de clientes.

El perfil no aplica a cualquier router doméstico, a otras subredes o a políticas ya personalizadas. Debe adaptarse y validarse antes de utilizarlas. Repetir una aplicación requiere revisar las reglas anteriores del servidor remoto.

## Dueño: operación diaria

Edita platos, categorías, fotos o disponibilidad y pulsa Guardar borrador. Publicar crea una versión íntegra. La modalidad principal genera dos QR al frente: **MENÚ CON INTERNET** abre la experiencia visual permanente de Cloudflare y **MENÚ SIN INTERNET** abre una vCard 3.0 con la carta básica en Notas. El cliente elige manualmente. El QR web no se reimprime al cambiar platos; la vCard sí debe regenerarse e imprimirse y el panel muestra si quedó desactualizada. Las modalidades web, texto dividido y red local continúan disponibles para instalaciones existentes.

La selección del cliente calcula un total para enseñar al mesero; no envía pedidos. La vCard usa un máximo conservador de 900 bytes: primero omite descripciones largas solo del QR offline y después reduce adornos; nunca recorta nombres ni precios. Si el contenido esencial no cabe, la publicación se bloquea sin borrar el menú guardado. La presentación del contacto depende de la cámara y de la aplicación de Contactos.

## Respaldo y cambio de servidor

Guarda primero el borrador y descarga el respaldo completo. Incluye fotos y clave de invitados, pero no contraseña del dueño, código de recuperación ni clave privada del vendedor. Mantenlo privado. En el equipo destino crea el dueño, importa el respaldo y solicita al vendedor una licencia para la nueva identidad. Revisa la red antes de publicar. Restaurar no cambia el menú que los clientes ven hasta una publicación nueva.

No existe sincronización automática entre servidores desconectados. Todos los administradores deben abrir la dirección del origen principal. Los cambios concurrentes se rechazan para impedir sobrescrituras silenciosas.

## Web alojada

La entrega Sites inicial es una revisión privada del vendedor, no una URL pública lista para comensales. Para cada restaurante: desplegar en su cuenta de Cloudflare, crear D1/R2, aplicar las migraciones, configurar SETUP_TOKEN y LICENSE_PUBLIC_KEY y habilitar su dominio HTTPS. Ejecutar configuración inicial antes de anunciar la URL. El restaurante cubre esos servicios.

La copia offline web se descarga explícitamente con fotos y versión. Si falla, se conserva la anterior. Se abre en `/offline.html`. No puede garantizarse que el navegador la conserve indefinidamente; los precios corresponden a la fecha descargada.
