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

Estado productivo 07-10-2026: proveedor operativo `d1-documents`, Firebase Authentication y TOTP del creador conservados, FCM habilitado. El corte verificado trasladó 1.729 documentos de dos restaurantes, conservando siete pedidos y 17 líneas. Las 16 imágenes permanecen en la D1 histórica; no se activaron R2, Storage ni Blaze. Consultar `docs/launch-readiness-2026-10-06.md` para evidencia vigente; los informes fechados anteriores son históricos.

El Worker usa D1 privada y Cloudflare for SaaS; el navegador nunca recibe una clave de base de datos. Aplica en orden las migraciones `0000` a `0003` de `drizzle/`. Configura como secretos `DATA_ENCRYPTION_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, `CLOUDFLARE_API_TOKEN` y, cuando se active correo, `RESEND_API_KEY`. El token de Cloudflare debe tener permisos mínimos para Workers y Custom Hostnames.

- El subdominio gratuito se crea junto con el restaurante y permanece como alias.
- El dominio propio es opcional y solo se activa cuando hostname y certificado estén activos.
- Todas las direcciones públicas usan HTTPS.
- Los reportes privados conservan el historial. El enlace público y el PDF del pedido expiran a las 24 horas.
- El acceso usa Firebase Authentication mediante cookies seguras HttpOnly y autorización del servidor. Los dispositivos recordados son permisos opacos revocables; nunca se guarda la contraseña.
- Solo el creador mantiene TOTP obligatorio. El dueño entra con correo y contraseña y puede recordar su celular con desbloqueo nativo.
- El correo permanece detrás de `EMAIL_VERIFICATION_ENABLED=false` hasta verificar el dominio de envío.
- La recuperación de contraseña vigente usa Firebase Authentication y su remitente predeterminado, sin dominio comprado; no confundirla con el envío de correo comercial mediante Resend.
- GitHub Actions ejecuta TypeScript, pruebas, `npm audit`, Gitleaks y CodeQL; Dependabot revisa npm, Gradle y Actions semanalmente.

Consulta [deployment/cloudflare/README.md](deployment/cloudflare/README.md) para el despliegue.

## Componentes

- `app/ui`: editor, menú, confirmación y reportes.
- `lib`: contratos, pedidos, PDF, dominios, API y persistencia.
- `deployment/cloudflare`: Worker y configuración.
- `native/android`: contenedor WebView online del panel del dueño.
- `pages-ui`: demostración estática HTTPS.

La foto de encebollado es únicamente ilustrativa y no representa un producto real.

La APK actual es la versión 0.8.0 (código 11), con icono adaptativo de QR Menu EC, WebView restringida a HTTPS y desbloqueo local opcional para celulares recordados.
