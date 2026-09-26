# Demostración estática de Cloudflare Pages

La edición Pages permite revisar una carta HTTPS y descargar su único QR web.

```sh
npm run build:pages
npm run preview:pages
```

Abre `http://127.0.0.1:4173/restaurante-demo`. Esta edición no usa D1 y no registra pedidos; el flujo productivo y la demo interactiva con pedidos viven en el Worker, en `/demo`.
