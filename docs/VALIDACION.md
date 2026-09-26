# Validación

Antes de desplegar ejecuta:

```sh
npm run check
npm test
npm run build
```

La cobertura comprueba normalización de cartas anteriores, un solo QR HTTPS, validación y recálculo del pedido en servidor, rechazo de opciones inválidas, permisos de la función Pedidos, PDF, reportes, cancelación, concurrencia, autenticación y recuperación.

En Cloudflare valida además la creación y colisión de subdominios, aislamiento por restaurante, estados pendientes/activos de Custom Hostnames, certificado activo antes de habilitar el dominio y expiración pública a las 24 horas.
