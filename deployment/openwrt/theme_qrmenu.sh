#!/bin/sh
# QR Menu EC custom ThemeSpec. API reference: openNDS ThemeSpec GPL project.
# No authentication is granted: only the menu's HTTP endpoint is allowlisted.
title="QR Menu EC"
header() {
 printf '%s\n' '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QR Menu EC</title></head><body>'
}
generate_splash_sequence() {
 menu_url=$(cat /etc/qrmenu/menu-url)
 case "$menu_url" in http://192.168.*:8080/menu|http://10.*:8080/menu|http://172.*:8080/menu) ;; *) printf '%s\n' '<p>El instalador debe revisar la dirección del menú.</p>'; footer ;; esac
 safe_url=$(printf '%s' "$menu_url" | sed 's/\&/\&amp;/g;s/"/\&quot;/g;s/</\&lt;/g;s/>/\&gt;/g')
 printf '<meta http-equiv="refresh" content="0;url=%s"><p>Abriendo tu menú…</p><a href="%s">Ver menú</a>\n' "$safe_url" "$safe_url"
 footer
}
footer() { printf '%s\n' '</body></html>'; exit 0; }
