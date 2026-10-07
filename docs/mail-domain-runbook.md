# Correo: configuración real y cambio de dominio

Fecha: 2026-09-28. No se activó ni modificó producción.

Actualización 05-10-2026: se añadió una alternativa sin dominio comprado: recuperación mediante el remitente y formulario predeterminados de Firebase Authentication. Ver `production-without-paid-services.md`. El primer ensayo con cuenta temporal no acreditó recepción. El segundo ensayo verificó la cuenta real del dueño y solicitó un único correo, sin cambiar contraseña ni TOTP; Firebase respondió HTTP 200 y **el operador confirmó que llegó**. Evidencia local: `work/recovery-live-qa/owner-delivery.json`. Resend queda como opción futura para correo personalizado, no como requisito del acceso actual.

## Lo que no permite workers.dev

`consola.workers.dev` es una ruta de ejecución, no una zona DNS propiedad del operador. Email Routing exige seleccionar una zona del propio Cloudflare y configurar registros MX/TXT. No se puede activar recepción o crear SPF/DKIM sobre ese subdominio. Email Routing recibe/reenvía; el envío transaccional requiere además un proveedor/remitente autorizado. No es posible resolver esa ausencia cambiando una variable.

Referencias: [Routing](https://developers.cloudflare.com/email-service/get-started/route-emails/), [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [envío de Cloudflare](https://developers.cloudflare.com/email-service/get-started/send-emails/).

## Configuración del módulo

### Sandbox implementado (28-09-2026)

Para desarrollo: `MAIL_DOMAIN=` vacío, `MAIL_SANDBOX=true`, `MAIL_SANDBOX_TO=` con el correo de la cuenta Resend confirmado por el operador y `RESEND_API_KEY` como secreto de servidor. Se usa `QR Menu EC <onboarding@resend.dev>`; no necesita dominio propio. El sandbox **no permite enviar recuperación a todos los clientes**: solo al destinatario de prueba autorizado por Resend. El código rechaza otros destinatarios antes del envío. `.env.local` deja el destinatario vacío hasta verificarlo; no se supone que un correo mencionado en el chat sea el titular de Resend.

Con dominio verificado, asignar `MAIL_DOMAIN=dominio.tld`; el módulo deja de usar el remitente y la restricción sandbox sin cambiar código. Mantener el secreto del proveedor. No se hizo un envío real ni se configuró DNS en esta implementación. Referencia: [restricciones de resend.dev](https://github.com/resend/resend-node/issues/538).

Los fallos de entrega tienen tres intentos limitados con backoff e idempotencia. El creador ve metadatos en **Correos fallidos**, puede reenviar antes del vencimiento y queda auditoría. El contenido se cifra; nunca aparece en el listado. Tras éxito se borra el contenido cifrado; a los 30 minutos la limpieza elimina el registro vencido, conservando el evento de auditoría. El reenvío manual tiene límite de tres solicitudes por hora y registro. No extiende la validez del enlace de recuperación ni elude TOTP.

Para dominio futuro basta una zona DNS administrable con TXT/MX, por ejemplo un `.com` en [Namecheap](https://www.namecheap.com/domains/registration/gtld/com/). Reservar aproximadamente USD 10–20/año como **estimación**, comprobar renovación, impuestos y promoción al comprar; no prometer USD 10 fijo. El alojamiento del menú sigue siendo independiente del dominio de envío.

`MAIL_DOMAIN=` está añadido a `.env.local` y `.env.example`, vacío a propósito. Sin valor conserva `EMAIL_FROM` y Resend existentes si están configurados; no inventa un remitente. Al asignar un dominio propio ya verificado, usa `QR Menu EC <notificaciones@DOMINIO>`. Rechaza workers.dev, URLs y saltos de línea. Esta variable es del servidor, sin prefijo VITE.

Cloudflare desplegado no lee automáticamente `.env.local`: al autorizar una futura publicación hay que trasladar `MAIL_DOMAIN` a la configuración del Worker. `RESEND_API_KEY` permanece como secreto. Verificar DNS y proveedor primero; cambiar el dominio de aplicación después. No habilitar verificación obligatoria de email hasta completar la prueba de recepción.

## Registros y secuencia para dominio propio

1. Registrar/delegar a Cloudflare una zona bajo control del operador. No modificar MX existentes sin comprobar si hay correo corporativo. Elegir el dominio exacto que se usará en `MAIL_DOMAIN`.
2. Para recibir soporte: Cloudflare → Email Routing → Onboard Domain. Añadir **todos** los MX con destino y prioridad mostrados por Cloudflare, su TXT SPF y su TXT DKIM. Esos valores son suministrados para la zona; no usar hosts o claves inventados. Confirmar por email el destino personal antes de crear `soporte@DOMINIO` → destino verificado. Si existe servicio MX corporativo, usar un subdominio independiente para Routing.
3. Para enviar recuperación con el proveedor actual: Resend → Domains → Add domain → introducir exactamente `MAIL_DOMAIN`, elegir región y obtener registros. Crear TXT `resend._domainkey.DOMINIO` con la clave pública completa generada por Resend; TXT `send.DOMINIO` con `v=spf1 include:amazonses.com ~all` y MX `send.DOMINIO` con la prioridad y host `feedback-smtp.REGION.amazonses.com` **exactos del panel**. Si el panel configura otro selector/return-path, usar sus nombres exactos en vez de estos valores habituales. No crear un segundo SPF en el mismo nombre.
4. No mezclar el MX de retorno `send.DOMINIO` con los MX de recepción del dominio raíz. No pegar claves privadas DKIM en DNS: solo la clave pública generada. Un registro `_dmarc.DOMINIO` con `v=DMARC1; p=none` permite iniciar observación; revisar alineación antes de endurecerlo. No añadir direcciones de reportes que no se controlen.
5. Copiar los registros emitidos a un manifiesto JSON local y ejecutar `node --import tsx scripts/verify-mail-dns.ts RUTA.json`. Campos raíz: `domain`, `records`; cada registro: `purpose` (`spf`, `dkim`, `mx`), `name`, `type`, `value` y `priority` solo para MX. El script compara valores completos y falla ante SPF duplicado o consultas fallidas.
6. Confirmar estado Verified en Resend. Enviar una recuperación de prueba a una cuenta controlada, revisar encabezados SPF/DKIM/DMARC y uso único/caducidad del enlace. Solo entonces trasladar `MAIL_DOMAIN` al Worker y publicar con autorización.

Los valores únicos DKIM y la región no existen hasta dar de alta el dominio: no se pueden predecir. Este procedimiento especifica dónde obtenerlos y cómo verificarlos. Fuentes: [registros Resend](https://resend.com/changelog/new-domain-webhooks), [return-path](https://resend.com/changelog/custom-return-path).

## Fallos y recuperación actual

El emisor reintenta como máximo tres veces ante red/429/5xx, con backoff y clave idempotente estable. Errores permanentes no se reintentan. La entrega no se declara exitosa al agotar intentos; queda auditoría sin contenido del correo.

Sin dominio enviador disponible, el fallback del dueño es el restablecimiento por el creador autenticado, previa comprobación de identidad fuera de la app. Registra solicitud y finalización, revoca permisos y no guarda contraseñas en auditoría. No permite saltarse TOTP del creador. No se promete correo automático gratuito sobre workers.dev.
