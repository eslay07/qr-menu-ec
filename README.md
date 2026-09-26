# QR Menu EC

Plataforma HTTPS para crear y publicar cartas de restaurantes. Cada restaurante recibe una dirección gratuita permanente y puede conectar un dominio propio. Un único QR abre el menú interactivo; no contiene credenciales ni información de red.

La carta admite categorías, fotografías, disponibilidad y grupos de opciones por plato. Cuando el creador habilita Pedidos, el restaurante puede activarlos y el cliente confirma desde su celular. La confirmación muestra el pedido completo, un QR opcional para el mesero, PDF y acciones para compartir. El evento queda registrado inmediatamente en los reportes.

## Desarrollo

Requiere Node 22.13 o superior.

```sh
npm ci
npm run db:local
npm run dev
```

Rutas principales: `/creator`, `/owner`, `/demo`, `/r/<uuid>/menu` y `/order/<token>`. Ejecuta `npm run check`, `npm test` y `npm run build` antes de desplegar.

Plataforma principal: `https://qr-menu-ec.consola.workers.dev`.

## Cloudflare

El Worker usa D1 y Cloudflare for SaaS. Aplica las migraciones `drizzle/0000_even_inhumans.sql`, `drizzle/0001_central_creator.sql` y `drizzle/0002_orders_and_hosts.sql`. Configura `PLATFORM_MENU_DOMAIN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_CNAME_TARGET` y un token con permisos mínimos para Custom Hostnames.

- El subdominio gratuito se crea junto con el restaurante y permanece como alias.
- El dominio propio es opcional y solo se activa cuando hostname y certificado estén activos.
- Todas las direcciones públicas usan HTTPS.
- Los reportes privados conservan el historial. El enlace público y el PDF del pedido expiran a las 24 horas.

Consulta [deployment/cloudflare/README.md](deployment/cloudflare/README.md) para el despliegue.

## Componentes

- `app/ui`: editor, menú, confirmación y reportes.
- `lib`: contratos, pedidos, PDF, dominios, API y persistencia.
- `deployment/cloudflare`: Worker y configuración.
- `native/android`: contenedor WebView online del panel del dueño.
- `pages-ui`: demostración estática HTTPS.

La foto de encebollado es únicamente ilustrativa y no representa un producto real.
