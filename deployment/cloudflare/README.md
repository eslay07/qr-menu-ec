# Desplegar en la cuenta del restaurante

1. `npm ci` y `npm run build:local`.
2. Inicia sesión con Wrangler en la cuenta del restaurante; crea una base D1 y un bucket R2. Copia sus nombres e identificador en wrangler.jsonc. No es necesario instalar Sites ni tener ChatGPT para los clientes de esta edición.
3. Aplica `drizzle/0000_even_inhumans.sql` a la base remota. Futuras versiones deben aplicar solo las migraciones nuevas.
4. Configura secretos mediante `wrangler secret put SETUP_TOKEN --config deployment/cloudflare/wrangler.jsonc` y `wrangler secret put LICENSE_PUBLIC_KEY --config deployment/cloudflare/wrangler.jsonc`. SETUP_TOKEN debe ser largo, aleatorio y privado. LICENSE_PUBLIC_KEY es el contenido de seller-public.txt; nunca uses seller-private.pem.
5. `wrangler deploy --config deployment/cloudflare/wrangler.jsonc`. El archivo contiene un marcador D1 y no puede desplegarse sin configurar la cuenta real.
6. Abre el panel HTTPS, crea el dueño con el código de instalación, guarda la recuperación, importa una licencia web y publica. Configura el dominio del menú antes de imprimir el QR.

La API no confía en cabeceras de identidad enviadas por clientes. Este despliegue usa la contraseña propia del restaurante, D1, R2 y los mismos contratos de la edición Sites. El acceso al menú es público; editar requiere sesión. Los costos pertenecen a la cuenta del restaurante.
