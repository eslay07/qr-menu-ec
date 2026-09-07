#!/bin/sh
set -eu
[ "$(id -u)" = 0 ] || { echo 'Ejecuta como root en el router.'; exit 1; }
[ -f /etc/openwrt_release ] || { echo 'Se requiere OpenWrt.'; exit 1; }
case "$(cat /tmp/sysinfo/board_name)" in glinet,gl-mt3000) ;; *) echo 'Este paquete solo admite GL-MT3000. No se modificó el equipo.'; exit 1 ;; esac
[ -d /mnt/qrmenu ] && mount | grep -q ' on /mnt/qrmenu ' || { echo 'Monta primero almacenamiento USB en /mnt/qrmenu.'; exit 1; }
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ -x "$base/qrmenu" ] && [ -f "$base/ui/index.html" ] && [ -f "$base/seller-public.txt" ] || { echo 'Paquete incompleto.'; exit 1; }
command -v opennds >/dev/null || { echo 'Instala opennds con el gestor de paquetes del firmware antes de continuar.'; exit 1; }
mkdir -p /opt/qrmenu /etc/qrmenu /mnt/qrmenu/data
chmod 700 /mnt/qrmenu/data
cp "$base/qrmenu" /opt/qrmenu/qrmenu
cp -R "$base/ui" /opt/qrmenu/
cp "$base/seller-public.txt" /etc/qrmenu/seller-public.txt
cp "$base/qrmenu.init" /etc/init.d/qrmenu
cp "$base/theme_qrmenu.sh" /usr/lib/opennds/theme_qrmenu.sh
chmod 755 /opt/qrmenu/qrmenu /etc/init.d/qrmenu /usr/lib/opennds/theme_qrmenu.sh
/etc/init.d/qrmenu enable
/etc/init.d/qrmenu restart
echo 'Servidor instalado. Configura el panel en https://192.168.8.1:8443/ y aplica después el perfil de red.'
echo 'Código privado de instalación: /mnt/qrmenu/data/installation-code.txt'
