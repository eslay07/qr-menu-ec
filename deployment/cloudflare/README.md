# Desplegar en la cuenta del restaurante

## Procedimiento vigente del servicio existente (octubre 2026)

El servicio `qr-menu-ec` utiliza D1 Documents para datos operativos, D1 histórica para imágenes, Firebase Authentication y FCM. No requiere R2, Blaze ni nuevos proveedores. Las instrucciones de instalación inferiores son históricas y no deben reemplazar los bindings actuales.

1. Ejecutar tipos, pruebas, emuladores, lint y `npm run build:worker`; revisar cualquier fallo crítico antes de continuar.
2. Respaldar las dos D1 con `scripts/production-backup.mjs` y comprobar los archivos con `scripts/verify-encrypted-backup.mjs`. Mantener claves y recibos privados fuera de Git.
3. Aplicar solamente migraciones compatibles necesarias. `0006_order_operations.sql` agrega identidad de operación a la D1 histórica; no reemplaza datos ni tablas.
4. Integrar mediante PR y comprobar los controles del repositorio.
5. Con el build terminado, ejecutar `node scripts/product-release.mjs --stage`. Este flujo conserva todos los bindings de la versión activa, incluidos secretos, y conserva el APK firmado existente. No ejecutar build y staging simultáneamente.
6. Registrar aceptación crítica y respaldo verificado en `work/product-release/acceptance.json`, con el `versionId` exacto del recibo. Ejecutar `--activate` y comprobar la versión realmente servida y los recorridos productivos con datos ficticios.
7. Ante fallo crítico, ejecutar `node scripts/product-release.mjs --rollback`. Comprueba que la versión candidata siga activa y restaura al 100 % su versión anterior. No restaurar bases de datos de ensayo sobre producción.

La URL legible `/m/nombre` funciona sin aprovisionamiento externo. Los subdominios nuevos requieren permisos de Cloudflare y verificación real de TLS/rutas; no interpretar esa ruta como un subdominio. El GET del panel de dirección no aprovisiona recursos. Las URL de versiones previas permanecen deshabilitadas.

La dirección principal configurada es `https://qr-menu-ec.consola.workers.dev`.

1. `npm ci` y `npm run build:worker`.
2. Inicia sesión con Wrangler en la cuenta de Cloudflare; crea una base D1 y copia su nombre e identificador en `wrangler.jsonc`.
3. Aplica las migraciones de `drizzle/` en orden, incluida `0003_security_promotions_domains.sql` para sesiones, límites, auditoría y hostnames ampliados y `0004_owner_email_index.sql` para el acceso único por correo.
4. Configura `CREATOR_SETUP_TOKEN`, `DATA_ENCRYPTION_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` y `CLOUDFLARE_API_TOKEN` como secretos. Define `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKERS_SUBDOMAIN`, `CORE_WORKER_SERVICE`, `PLATFORM_MENU_DOMAIN`, `CLOUDFLARE_ZONE_ID` y `CLOUDFLARE_CNAME_TARGET` como variables. El token debe limitarse a Workers y a la zona/Custom Hostnames necesarios.
5. `wrangler deploy --config deployment/cloudflare/wrangler.jsonc`. El archivo contiene un marcador D1 y no puede desplegarse sin configurar la cuenta real.
6. Abre el panel HTTPS, enrola TOTP, guarda los diez códigos de recuperación, crea el dueño, publica y prueba un pedido configurable. El subdominio gratuito queda fijo; un dominio propio requiere que el restaurante cree el CNAME mostrado por el panel.

`EMAIL_VERIFICATION_ENABLED` permanece en `false` hasta disponer de un dominio verificado en Resend. Al activarlo también se configuran `RESEND_API_KEY` y `EMAIL_FROM` como secretos/variables protegidos.

La API no confía en cabeceras de identidad enviadas por clientes. Este despliegue usa la contraseña propia del restaurante, D1, R2 y los mismos contratos de la edición Sites. El acceso al menú es público; editar requiere sesión. Los costos pertenecen a la cuenta del restaurante.

## Acceso y recuperación

- El dueño entra en `/owner` con correo y contraseña, sin código de restaurante ni TOTP. El creador puede actualizar el correo desde la ficha del restaurante; esto revoca las sesiones del dueño sin cambiar su contraseña o carta.
- El creador conserva contraseña y TOTP. La recuperación por correo requiere los secretos `CREATOR_RECOVERY_EMAIL`, `RESEND_API_KEY` y `EMAIL_FROM` (remitente verificado). `PUBLIC_APP_ORIGIN` fija el origen HTTPS del enlace; por defecto usa la dirección central indicada arriba.
- La recuperación funciona independientemente de `EMAIL_VERIFICATION_ENABLED`. Sin proveedor/remitente configurados, la interfaz indica que el envío no está disponible y no simula éxito. El enlace caduca en 30 minutos, es de un solo uso y obliga a enrolar nuevamente TOTP después de revocar las sesiones anteriores.
- Para una migración operada excepcional, `OWNER_EMAIL_MIGRATION` admite JSON `{ "id": "identificador-unico", "restaurantId": "uuid", "email": "correo" }`. Un GET a `/api/owner/login` ejecuta la transacción una sola vez. No acepta esos datos del navegador. Verifica el hash y el marcador en `security_migrations` y elimina el secreto de migración al terminar. El correo queda cifrado, no en texto plano dentro de D1.

## Pruebas de experiencia

Ejecuta `npm run check`, `npm test` y `npm run build:worker`. Con `vite preview --config vite.worker.config.ts --host 127.0.0.1 --port 4175` activo, `npm run test:experience` verifica banners en cuatro tamaños, movimiento reducido, cierre de diálogos, subida de foto, conservación de datos ante errores, guardado y acceso por correo. Sus datos simulados solo se permiten en localhost. Las capturas quedan en `outputs/experience-qa/` (no versionadas).
