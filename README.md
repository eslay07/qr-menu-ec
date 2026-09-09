# QR Menu EC

## QR Menu EC · Cloudflare Pages

Edición estática independiente: `npm ci`, `npm run build:pages`, `npm run preview:pages`.
Abre `http://127.0.0.1:4173/restaurante-demo`. La tarjeta con los dos QR está en `/restaurante-demo/qr`.
Salida: `dist-pages`. Node recomendado: 22.16.0. Sin variables, D1 ni credenciales para la demostración estática.
Catálogo: `data/restaurants/restaurante-demo.json`; precios en centavos (`500` = $5.00).
Pruebas: `npm run check`, `npm test`, `npm run test:pages` (con preview activo).
La edición Pages publica cartas desde Git; el panel con contraseñas, licencias y respaldos
se conserva en las ediciones Sites/Worker/local y requiere su servidor. No se exportan datos privados.
Manual completo: [Migración a Pages](docs/CLOUDFLARE-PAGES.md).

Aplicación central para editar y publicar menús interactivos de restaurantes. El producto funciona desde Cloudflare o desde un servidor dentro de la red del local en Windows, Android y routers OpenWrt. La carta admite fotografías, categorías, búsqueda, disponibilidad y selección de platos. Español, Ecuador y precios en USD.

## Desarrollo

Requiere Node 22.13 o superior. `npm ci`, `npm run db:local`, `npm run dev`. Para configuración local define SETUP_TOKEN y LICENSE_PUBLIC_KEY en `.dev.vars` (no se versiona). El menú demo está en `/demo`; el panel en `/`; la carta publicada en `/menu`.

`npm run check` comprueba tipos. `npm test` prueba contratos, acceso, publicación, QR y recuperación. `npm run build:local` genera la interfaz del Worker de Cloudflare y de los equipos locales.

## Plataforma central en Cloudflare

- Panel privado del creador: `https://qr-menu-ec.omar777j.workers.dev/creator`.
- Entrada web y APK para dueños: `https://qr-menu-ec.omar777j.workers.dev/owner`.
- Cada restaurante vive bajo `/r/ID/`; el dueño solo entra con su código y contraseña.
- El creador crea restaurantes, habilita modalidades, suspende accesos y restablece contraseñas.
- La información y las fotos se guardan por restaurante en D1. El despliegue no requiere R2.
- El secreto `CREATOR_SETUP_TOKEN` se configura en Cloudflare y nunca se guarda en Git.

El Worker se despliega con `deployment/cloudflare/wrangler.jsonc`. Primero se aplican las migraciones
`drizzle/0000_even_inhumans.sql` y `drizzle/0001_central_creator.sql`; después se compila con
`npm run build:local` y se ejecuta `wrangler deploy`.

## Componentes

- `app/ui`: interfaz compartida del dueño y comensal.
- `lib`: contratos versionados, servicio web, D1/R2 y seguridad.
- `native/go`: servidor Windows/OpenWrt; el adaptador SCM usa golang.org/x/sys v0.20.0, fijado para el compilador heredado. Compilar con Go actual para Windows 10 y Linux arm64, y Go 1.20.14 para Windows 7.
- `native/android`: aplicación Kotlin y servidor persistente en primer plano. Gradle 8.13, JDK 17 o posterior y Android SDK 35. Copiar dist-local a app/src/main/assets/ui antes de compilar. El archivo seller-public.txt es público; la clave privada nunca forma parte del APK.
- `deployment`: instaladores y configuración de red, más despliegue independiente en Cloudflare.
- `tools/license.mjs`: herramienta privada del vendedor para emitir licencias firmadas.

## Entregables

Los artefactos se generan en outputs y no se versionan. `scripts/package-local.ps1` prepara Windows 10, Windows 7 y OpenWrt. `scripts/sign-android.mjs` firma el APK con una identidad conservada fuera del proyecto. No ejecutar los instaladores de sistema en una máquina de desarrollo para una simple prueba.

`scripts/browser-qa.mjs` inicia un servidor Go temporal con una identidad de prueba, recorre el panel y menú en Chromium y guarda resultados en outputs/qa. No modifica la carta del restaurante ni utiliza la clave real del vendedor.

## Manuales

- [Segunda fase y pruebas de campo](docs/FASE-2.md)
- [Instalación y uso](docs/INSTALACION.md)
- [Venta y certificación](docs/VENTA-Y-CERTIFICACION.md)
- [Despliegue en la cuenta del restaurante](deployment/cloudflare/README.md)

La foto de encebollado de demostración fue generada con ImageGen. No representa un plato de un restaurante real. Todos los recursos del menú local están empaquetados; no se descargan fuentes ni fotos externas al abrirlo.
