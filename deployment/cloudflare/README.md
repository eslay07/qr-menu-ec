# Desplegar en la cuenta del restaurante

La dirección principal configurada es `https://qr-menu-ec.consola.workers.dev`.

1. `npm ci` y `npm run build:worker`.
2. Inicia sesión con Wrangler en la cuenta de Cloudflare; crea una base D1 y copia su nombre e identificador en `wrangler.jsonc`.
3. Aplica las migraciones de `drizzle/` en orden, incluida `0002_orders_and_hosts.sql` para hostnames, pedidos y reportes.
4. Configura `SETUP_TOKEN`, `LICENSE_PUBLIC_KEY` y `CLOUDFLARE_API_TOKEN` como secretos. Define `PLATFORM_MENU_DOMAIN`, `CLOUDFLARE_ZONE_ID` y `CLOUDFLARE_CNAME_TARGET` como variables del Worker. El token de Cloudflare debe limitarse a la zona y permisos de Custom Hostnames/SSL necesarios.
5. `wrangler deploy --config deployment/cloudflare/wrangler.jsonc`. El archivo contiene un marcador D1 y no puede desplegarse sin configurar la cuenta real.
6. Abre el panel HTTPS, crea el dueño, guarda la recuperación, publica y prueba un pedido configurable. El subdominio gratuito queda fijo; un dominio propio requiere que el restaurante cree el CNAME mostrado por el panel.

La API no confía en cabeceras de identidad enviadas por clientes. Este despliegue usa la contraseña propia del restaurante, D1, R2 y los mismos contratos de la edición Sites. El acceso al menú es público; editar requiere sesión. Los costos pertenecen a la cuenta del restaurante.
