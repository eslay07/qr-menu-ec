# Desplegar en la cuenta del restaurante

La dirección principal configurada es `https://qr-menu-ec.consola.workers.dev`.

1. `npm ci` y `npm run build:worker`.
2. Inicia sesión con Wrangler en la cuenta de Cloudflare; crea una base D1 y copia su nombre e identificador en `wrangler.jsonc`.
3. Aplica las migraciones de `drizzle/` en orden, incluida `0003_security_promotions_domains.sql` para sesiones, límites, auditoría y hostnames ampliados.
4. Configura `CREATOR_SETUP_TOKEN`, `DATA_ENCRYPTION_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` y `CLOUDFLARE_API_TOKEN` como secretos. Define `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKERS_SUBDOMAIN`, `CORE_WORKER_SERVICE`, `PLATFORM_MENU_DOMAIN`, `CLOUDFLARE_ZONE_ID` y `CLOUDFLARE_CNAME_TARGET` como variables. El token debe limitarse a Workers y a la zona/Custom Hostnames necesarios.
5. `wrangler deploy --config deployment/cloudflare/wrangler.jsonc`. El archivo contiene un marcador D1 y no puede desplegarse sin configurar la cuenta real.
6. Abre el panel HTTPS, enrola TOTP, guarda los diez códigos de recuperación, crea el dueño, publica y prueba un pedido configurable. El subdominio gratuito queda fijo; un dominio propio requiere que el restaurante cree el CNAME mostrado por el panel.

`EMAIL_VERIFICATION_ENABLED` permanece en `false` hasta disponer de un dominio verificado en Resend. Al activarlo también se configuran `RESEND_API_KEY` y `EMAIL_FROM` como secretos/variables protegidos.

La API no confía en cabeceras de identidad enviadas por clientes. Este despliegue usa la contraseña propia del restaurante, D1, R2 y los mismos contratos de la edición Sites. El acceso al menú es público; editar requiere sesión. Los costos pertenecen a la cuenta del restaurante.
