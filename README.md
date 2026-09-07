# QR Menú

## QR Menu Resuelven · Cloudflare Pages

Edición estática independiente: `npm ci`, `npm run build:pages`, `npm run preview:pages`.
Abre `http://127.0.0.1:4173/restaurante-demo`. El QR está en `/restaurante-demo/qr`.
Salida: `dist-pages`. Node recomendado: 22.16.0. Sin variables, D1, R2 ni cuenta ChatGPT.
Catálogo: `data/restaurants/restaurante-demo.json`; precios en centavos (`500` = $5.00).
Pruebas: `npm run check`, `npm test`, `npm run test:pages` (con preview activo).
La edición Pages publica cartas desde Git; el panel con contraseñas, licencias y respaldos
se conserva en las ediciones Sites/Worker/local y requiere su servidor. No se exportan datos privados.
Manual completo: [Migración a Pages](docs/CLOUDFLARE-PAGES.md).

Aplicación central para editar y publicar menús de restaurantes, con servidor web, Windows, Android y router OpenWrt. Español, Ecuador, USD. Edición piloto: la apertura de portales y compatibilidad física siguen pendientes de certificación.

## Desarrollo

Requiere Node 22.13 o superior. `npm ci`, `npm run db:local`, `npm run dev`. Para configuración local define SETUP_TOKEN y LICENSE_PUBLIC_KEY en `.dev.vars` (no se versiona). El menú demo está en `/demo`; el panel en `/`; la carta publicada en `/menu`.

`npm run check` comprueba tipos. `npm test` prueba contratos, licencias, publicación, recuperación y descarga offline. `npm run build` genera la edición Sites. `npm run build:local` genera la interfaz estática para equipos locales y el Worker independiente.

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
