#!/bin/sh
set -eu
# Usage: configure-network.sh --check|--apply profile.json
action=${1:---check}
profile=${2:?Indica el perfil JSON exportado por el panel}
[ "$action" = '--check' ] || [ "$action" = '--apply' ] || exit 2
command -v jsonfilter >/dev/null || { echo 'Falta jsonfilter.'; exit 1; }
ssid=$(jsonfilter -i "$profile" -e '@.ssid')
password=$(jsonfilter -i "$profile" -e '@.wifiPassword')
menu_url=$(jsonfilter -i "$profile" -e '@.localUrl')
[ "${#ssid}" -ge 1 ] && [ "${#ssid}" -le 32 ] || { echo 'SSID inválido'; exit 1; }
[ "${#password}" -ge 8 ] && [ "${#password}" -le 63 ] || { echo 'Contraseña inválida'; exit 1; }
# Restrict local server hosts before putting the value into router firewall rules.
menu_host=$(printf '%s' "$menu_url" | sed -n 's|^http://\([0-9][0-9.]*\):8080/menu$|\1|p')
case "$menu_host" in 192.168.8.*|192.168.50.*) ;; *) echo 'Usa el servidor en 192.168.8.x o 192.168.50.x, puerto 8080.'; exit 1 ;; esac
[ "$(cat /tmp/sysinfo/board_name)" = 'glinet,gl-mt3000' ] || { echo 'Modelo no validado por este perfil'; exit 1; }
uci -q get wireless.radio0 >/dev/null || { echo 'No existe radio0.'; exit 1; }
uci -q get network.lan.ipaddr | grep -q '^192\.168\.8\.1$' || { echo 'Este perfil espera administración en 192.168.8.1. Requiere adaptación por instalador.'; exit 1; }
echo "Perfil: red dedicada 192.168.50.0/24; servidor $menu_host:8080; administración separada."
[ "$action" = '--apply' ] || { echo 'Validación completada. No se modificó la red.'; exit 0; }
[ "$(id -u)" = 0 ] || exit 1
backup="/root/qrmenu-network-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
for f in network wireless firewall dhcp opennds; do cp "/etc/config/$f" "$backup/$f"; done
rollback() { for f in network wireless firewall dhcp opennds; do cp "$backup/$f" "/etc/config/$f"; done; /etc/init.d/network reload; /etc/init.d/firewall restart; /etc/init.d/dnsmasq restart; /etc/init.d/opennds restart; }
trap 'rollback' HUP INT TERM
uci set network.qrmenu='interface'
uci set network.qrmenu.proto='static'
uci set network.qrmenu.device='br-qrmenu'
uci set network.qrmenu.ipaddr='192.168.50.1'
uci set network.qrmenu.netmask='255.255.255.0'
uci set network.qrmenu_bridge='device'
uci set network.qrmenu_bridge.type='bridge'
uci set network.qrmenu_bridge.name='br-qrmenu'
uci set wireless.qrmenu='wifi-iface'
uci set wireless.qrmenu.device='radio0'
uci set wireless.qrmenu.mode='ap'
uci set wireless.qrmenu.network='qrmenu'
uci set "wireless.qrmenu.ssid=$ssid"
uci set wireless.qrmenu.encryption='psk2'
uci set "wireless.qrmenu.key=$password"
uci set wireless.qrmenu.isolate='1'
uci set dhcp.qrmenu='dhcp'
uci set dhcp.qrmenu.interface='qrmenu'
uci set dhcp.qrmenu.start='10'
uci set dhcp.qrmenu.limit='100'
uci set dhcp.qrmenu.leasetime='12h'
uci set firewall.qrmenu='zone'
uci set firewall.qrmenu.name='qrmenu'
uci set firewall.qrmenu.network='qrmenu'
uci set firewall.qrmenu.input='REJECT'
uci set firewall.qrmenu.output='ACCEPT'
uci set firewall.qrmenu.forward='REJECT'
for rule in dhcp dns menu portal; do uci set "firewall.qrmenu_$rule=rule"; uci set "firewall.qrmenu_$rule.src=qrmenu"; uci set "firewall.qrmenu_$rule.target=ACCEPT"; done
uci set firewall.qrmenu_dhcp.proto='udp'
uci set firewall.qrmenu_dhcp.dest_port='67'
uci set firewall.qrmenu_dns.proto='tcp udp'
uci set firewall.qrmenu_dns.dest_port='53'
uci set firewall.qrmenu_menu.proto='tcp'
uci set firewall.qrmenu_menu.dest_port='8080'
uci set firewall.qrmenu_portal.proto='tcp'
uci set firewall.qrmenu_portal.dest_port='2050'
# A server on the owner's LAN gets one narrow forwarding rule, no guest LAN access.
uci -q delete firewall.qrmenu_remote || true
if [ "$menu_host" != '192.168.8.1' ] && [ "$menu_host" != '192.168.50.1' ]; then
 uci set firewall.qrmenu_remote='rule'
 uci set firewall.qrmenu_remote.src='qrmenu'
 uci set firewall.qrmenu_remote.dest='lan'
 uci set "firewall.qrmenu_remote.dest_ip=$menu_host"
 uci set firewall.qrmenu_remote.dest_port='8080'
 uci set firewall.qrmenu_remote.proto='tcp'
 uci set firewall.qrmenu_remote.target='ACCEPT'
fi
uci set opennds.@opennds[0].gatewayinterface='br-qrmenu'
uci set opennds.@opennds[0].login_option_enabled='3'
uci set opennds.@opennds[0].themespec_path='/usr/lib/opennds/theme_qrmenu.sh'
uci -q delete opennds.@opennds[0].preauthenticated_users || true
uci add_list "opennds.@opennds[0].preauthenticated_users=allow tcp port 8080 to $menu_host"
mkdir -p /etc/qrmenu
printf '%s\n' "$menu_url" > /etc/qrmenu/menu-url
for f in network wireless firewall dhcp opennds; do uci commit "$f"; done
if ! /etc/init.d/network reload || ! /etc/init.d/firewall restart || ! /etc/init.d/dnsmasq restart || ! /etc/init.d/opennds restart; then rollback; exit 1; fi
trap - HUP INT TERM
echo "Perfil aplicado. Respaldo anterior: $backup. Prueba desde un teléfono nuevo antes de entregar."
