# QR Menu EC

Plataforma HTTPS para crear y publicar cartas de restaurantes. Cada restaurante recibe una dirección gratuita permanente y puede conectar un dominio propio. Un único QR abre el menú interactivo; no contiene credenciales ni información de red.

La carta admite categorías, fotografías, disponibilidad, grupos de opciones por plato y hasta ocho campañas promocionales. Cuando el creador habilita Pedidos, el restaurante puede activarlos y el cliente confirma desde su celular con nombre o alias obligatorio. La confirmación muestra el pedido completo, un QR opcional para el mesero, PDF y acciones para compartir. El evento queda registrado inmediatamente en los reportes.

El panel está organizado en `Carta`, `Promociones`, `Pedidos`, `Compartir` y `Ajustes`. Usa divulgación progresiva, skeletons sin saltos, foco visible, controles táctiles de 44 px y mensajes de guardado accesibles. Los estilos no dependen de design tokens globales; solo el color elegido por cada restaurante se mantiene como propiedad CSS dinámica.

## Desarrollo

Requiere Node 22.13 o superior.

```sh
npm ci
npm run db:local
npm run dev
```

Rutas principales: `/creator`, `/owner`, `/demo`, `/r/<uuid>/menu` y `/order/<token>`. Ejecuta `npm run check`, `npm test`, `npm audit --audit-level=high` y `npm run build:worker` antes de desplegar.

Plataforma principal: `https://qr-menu-ec.consola.workers.dev`.

## Cloudflare

El Worker usa D1 privada y Cloudflare for SaaS; el navegador nunca recibe una clave de base de datos. Aplica en orden las migraciones `0000` a `0003` de `drizzle/`. Configura como secretos `DATA_ENCRYPTION_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, `CLOUDFLARE_API_TOKEN` y, cuando se active correo, `RESEND_API_KEY`. El token de Cloudflare debe tener permisos mínimos para Workers y Custom Hostnames.

- El subdominio gratuito se crea junto con el restaurante y permanece como alias.
- El dominio propio es opcional y solo se activa cuando hostname y certificado estén activos.
- Todas las direcciones públicas usan HTTPS.
- Los reportes privados conservan el historial. El enlace público y el PDF del pedido expiran a las 24 horas.
- Las sesiones son opacas y revocables, viven en cookies `__Host-` seguras, expiran tras 30 minutos de inactividad y tienen un máximo absoluto de 12 horas.
- Creador y dueños deben enrolar TOTP; los códigos de recuperación solo se muestran una vez.
- El correo permanece detrás de `EMAIL_VERIFICATION_ENABLED=false` hasta verificar el dominio de envío.
- GitHub Actions ejecuta TypeScript, pruebas, `npm audit`, Gitleaks y CodeQL; Dependabot revisa npm, Gradle y Actions semanalmente.

Consulta [deployment/cloudflare/README.md](deployment/cloudflare/README.md) para el despliegue.

## Componentes

- `app/ui`: editor, menú, confirmación y reportes.
- `lib`: contratos, pedidos, PDF, dominios, API y persistencia.
- `deployment/cloudflare`: Worker y configuración.
- `native/android`: contenedor WebView online del panel del dueño.
- `pages-ui`: demostración estática HTTPS.

La foto de encebollado es únicamente ilustrativa y no representa un producto real.

La APK actual es la versión 0.7.0 (código 10), con icono adaptativo de QR Menu EC y WebView restringida a HTTPS y navegación interna segura.
