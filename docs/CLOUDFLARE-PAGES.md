# QR Menu Resuelven — migración independiente

## 1. ESTADO DEL PROYECTO

La edición estática de Pages reutiliza el menú React existente. La aplicación anterior con
panel administrativo, licencias, borradores, publicación, respaldos y servidores Windows,
Android y OpenWrt se conserva. Pages es la edición de consulta de cartas editadas mediante Git.

## 2. CAMBIOS REALIZADOS

- Entrada React/Vite independiente; ningún código de Sites ni API se incluye en esta edición.
- Catálogo demo separado, validado al compilar, sin sobrescribir la base existente.
- Rutas `/restaurante-demo`, `/restaurante-demo/qr`, inicio y aliases `/menu`, `/demo`.
- Dos QR PNG descargables e imprimibles: URL HTTPS permanente para el menú visual y vCard 3.0 para la carta básica sin conexión.
- Caché completa versionada por contenido; estado listo solo tras terminar la instalación.
- Manifest e iconos PNG, cabeceras de seguridad y caché, fallback SPA.
- Textos legibles, botones de al menos 44 px y tarjetas de una columna en móviles.
- Actualización compatible del conjunto Wrangler/Cloudflare para corregir vulnerabilidades altas.

## 3. ARCHIVOS MODIFICADOS

`app/ui/menu.tsx` admite un catálogo recibido por propiedad; los demás modos siguen usando su API.
`pages-ui/` contiene entrada, rutas, QR, estilos, manifest, redirects y headers.
`data/restaurants/restaurante-demo.json` contiene la carta ficticia.
`vite.pages.config.ts` compila la edición; `scripts/prepare-pages.mjs` empaqueta imágenes e iconos y genera el SW.
`scripts/pages-qa.mjs` prueba interacción, responsive, decodificación QR y offline.
`wrangler.pages.jsonc`, `.node-version`, `package.json`, `package-lock.json`, `.gitignore`,
`tsconfig.json`, `README.md` y este manual completan la configuración.

## 4. ARQUITECTURA RESULTANTE

| Edición | Entrada | Build | Salida | Persistencia |
|---|---|---|---|---|
| Pages | pages-ui/index.html → main.tsx | npm run build:pages | dist-pages | Catálogo versionado en Git; Cache Storage del navegador |
| Sites existente | app/layout.tsx y app/page.tsx | npm run build | dist/client + dist/server | D1/R2, sesiones del servidor |
| Local existente | local-ui/index.html → main.tsx | npm run build:local | dist-local | Servidor Go/Kotlin |

El original utiliza React 19, Vinext/Vite, Tailwind, Zod, qrcode y Drizzle. Sites tiene
su plugin Vite, `.openai/hosting.json`, identidad ChatGPT y bindings `DB`/`MEDIA`.
Las ediciones con servidor necesitan `SETUP_TOKEN` y `LICENSE_PUBLIC_KEY`. Pages no necesita
ninguna variable ni estos servicios. Conservamos sus fuentes sin importarlas en el bundle Pages.

En Pages no se usa localStorage para la carta ni se simula una base de datos local: se publican
archivos estáticos. La selección de platos vive en memoria y se vacía al recargar; no envía pedidos.
Las imágenes están empaquetadas; la única foto demo ya existente se identifica como ilustrativa.

Para otro restaurante, crea otro JSON con IDs únicos y agrégalo al registro `restaurants`
en `pages-ui/main.tsx`. No se acepta cualquier slug como restaurante válido. Añade la validación
del nuevo catálogo en `vite.pages.config.ts`. Para nuevas fotos amplía de forma controlada el
contrato `Asset` y el empaquetado de recursos. No uses rutas de medios privadas del servidor en Pages.

## 5. CONFIGURACIÓN CLOUDFLARE

| Campo | Valor |
|---|---|
| Tipo | Pages, integración GitHub |
| Repositorio | eslay07/qr-menu-resuelven (privado) |
| Rama de producción | main |
| Framework preset | None (configuración explícita de Vite) |
| Instalación local reproducible | npm ci |
| Build command | npm run build:pages |
| Build output directory | dist-pages |
| Root directory | raíz del repositorio; dejar vacío |
| Node | 22.16.0 mediante .node-version |
| Variables/secretos | Ninguno |
| Functions / D1 / R2 | Ninguno |

`_redirects` devuelve index.html para la navegación SPA; refrescar una ruta funciona.
HTML y manifest revalidan; assets con hash tienen caché anual; sw.js no tiene caché HTTP persistente.
La caché offline es diferente de la caché HTTP. El SW guarda los recursos de cada compilación de
forma completa y conserva la versión anterior si no termina la instalación de la nueva.
Una actualización del SW se activa cuando se cierran las pestañas anteriores: cerrar y reabrir
con Internet permite pasar a la versión nueva. No se garantiza recibir precios nuevos sin Internet.

Documentación oficial consultada: [integración Git](https://developers.cloudflare.com/pages/get-started/git-integration/),
[build](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[React](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/).

## 6. URL PÚBLICA

Publicado y verificado: https://qr-menu-resuelven.pages.dev

Cloudflare confirmó producción y la segunda publicación automática desde GitHub tras el commit
`1c6f0ce`. Pruebas públicas completadas el 7 de septiembre de 2026.

## 7. URL RESTAURANTE DEMO

https://qr-menu-resuelven.pages.dev/restaurante-demo

## 8. QR DE PRUEBA

Abre https://qr-menu-resuelven.pages.dev/restaurante-demo/qr. Pulsa **Descargar PNG** o **Imprimir ambos QR**.
El primer código contiene la URL pública permanente; el segundo contiene una vCard 3.0 dentro de 900 bytes. Los archivos decodificados se guardan como `restaurante-demo-web-qr.png` y `restaurante-demo-vcard-qr.png` en `outputs/pages-qa`.

## 9. PRUEBAS EJECUTADAS

Se registran en `outputs/pages-qa/results.json`. La batería incluye rutas, categorías, 10 productos,
precio de hamburguesa, búsqueda, detalle, selección, agotado, imagen, 5 anchos, controles táctiles,
manifest, iconos, SW, QR decodificado, recarga y pestaña nueva offline, y cliente nuevo sin red.
No confundir emulación de Pixel/Chromium con un Android físico.

Resultado público: batería completa aprobada, cero errores de consola. Red limitada simulada
(1.6 Mbps y 150 ms de latencia): carta visible en 1269 ms. HTTPS y cabeceras se verificaron por HTTP.
Build Pages, build Sites, build local, comprobación TypeScript y seis tests originales completados.
La actualización de tipos Cloudflare requirió convertir explícitamente las firmas a Buffer en tests.

## 10. ERRORES ENCONTRADOS

El proyecto original requiere API y bindings, por lo que copiar su salida a Pages no bastaba.
Su SW original solo descarga `/offline.html` y API bajo petición: no hacía offline la navegación SPA.
El QR y panel originales requieren configuración/licencia del servidor.
Se encontraron cinco vulnerabilidades altas y cuatro moderadas en herramientas de desarrollo.
La primera prueba pública detectó un 308 de index.html que impedía la recarga offline.

## 11. ERRORES CORREGIDOS

La edición Pages tiene entrada y datos propios, sin solicitudes a API; mantiene los componentes existentes.
Su propio SW cubre la carta SPA completa. La impresión ofrece un QR web permanente y una vCard que no exige servidor ni conexión al escanear.
Wrangler, su plugin y tipos compatibles se actualizaron y eliminaron los hallazgos altos.
El SW ahora guarda la respuesta canónica /, evitando reutilizar una respuesta redirigida durante
la navegación offline. La corrección se desplegó automáticamente y pasó las pruebas públicas.

## 12. LIMITACIONES ACTUALES

- El panel de edición no opera en Pages estático. Para conservar edición autenticada por navegador usa
  la edición Worker independiente documentada en `deployment/cloudflare/README.md`, que necesita D1/R2.
- Esta tarea no extrae ni migra datos privados de la publicación anterior; el demo es un fixture separado.
- Quedan cuatro avisos moderados del esbuild heredado de drizzle-kit, usado para migraciones del servidor;
  no forma parte del JavaScript entregado al comensal. No se forzó una regresión de Drizzle para ocultarlos.
- Offline funciona después de una descarga completa, en el mismo navegador y origen. Puede perderse
  si el usuario borra datos, usa incógnito o el navegador elimina caché por falta de espacio.
- La vCard funciona para un cliente nuevo sin Internet. El menú visual con fotos requiere conexión; una copia web offline solo existe después de una visita completa en ese navegador.
- La carta descargada puede mostrar precios/disponibilidad anteriores. La selección no persiste al recargar.
- No se ha certificado cámara, instalación PWA ni navegación en Android físico; requiere prueba humana.
- No hay pedidos, pagos ni sincronización de cambios entre dispositivos en la edición estática.

## 13. GUÍA PASO A PASO PARA PRINCIPIANTE

### ETAPA A — Abrir el proyecto

1. Abre Explorador de archivos. Pega `C:\Users\jimmy\Documents\ChatGPT\Qr Menu` en la barra superior y pulsa Enter.
2. Abre esa carpeta en Visual Studio Code: **File → Open Folder**, elige la carpeta y **Select Folder**.
3. En VS Code pulsa **Terminal → New Terminal**. Copia los comandos sin copiar las marcas de código.
4. Comprueba `node --version`. Usa Node 22.16.0 para reproducir Cloudflare; el equipo actual usa 22.13.1 y fue comprobado.

### ETAPA B — Verificarlo localmente

En la terminal ejecuta, uno por uno, esperando que cada comando termine:

```powershell
Set-Location -LiteralPath 'C:\Users\jimmy\Documents\ChatGPT\Qr Menu'
npm ci
npm run check
npm test
npm run build:pages
npm run preview:pages
```

Deja abierta esa terminal. En Chrome abre `http://127.0.0.1:4173/restaurante-demo`.
No abras index.html con doble clic. Para las pruebas automáticas abre otra terminal y ejecuta `npm run test:pages`.
Para detener el servidor vuelve a su terminal y pulsa Ctrl+C. Después de cambiar datos vuelve a compilar y recarga.

### ETAPA C — GitHub

1. Abre [el repositorio privado](https://github.com/eslay07/qr-menu-resuelven) e inicia sesión como eslay07.
2. En la pestaña **Code**, selecciona **main**. Debes ver `pages-ui`, `data`, `package.json` y este manual.
3. Pulsa el último mensaje de commit para comprobar los cambios. El repositorio privado exige sesión;
   eso no impide que la carta publicada en Pages sea pública.
4. En la terminal, `git status` muestra cambios pendientes y `git remote -v` debe apuntar a ese repositorio.

### ETAPA D — Cloudflare Pages

Los pasos describen tanto dónde quedó el proyecto como cómo repetir la configuración:

1. Abre [Cloudflare](https://dash.cloudflare.com) e inicia sesión en la cuenta elegida.
2. Abre **Workers & Pages**. Si ves la portada, pulsa **Create app**.
3. En **¿Busca implementar Pages?** pulsa **Comenzar**. No elijas el asistente de Workers.
4. En **Importar un repositorio Git existente** pulsa **Comenzar**.
5. Si aparece **Conecte GitHub**, pulsa allí, inicia sesión y autoriza acceso al repositorio `qr-menu-resuelven`.
6. Selecciona cuenta **eslay07**, marca **qr-menu-resuelven** y pulsa **Comenzar la instalación**.
7. Nombre: `qr-menu-resuelven`. Rama: `main`. Framework: **None**.
8. En **Build command / Comando de compilación** escribe `npm run build:pages`.
9. En **Build output directory / Directorio de salida** escribe `dist-pages`.
10. Deja la raíz vacía: package.json está en la raíz. No escribas la ruta C:\ de tu computadora.
11. Node se toma de `.node-version` (22.16.0); no añadas secretos ni bases de datos.
12. Pulsa **Save and Deploy / Guardar e implementar**. Si el proyecto ya existe, ábrelo en vez de crear otro.

### ETAPA E — Primer deployment

1. En el proyecto abre **Deployments / Implementaciones** y la implementación de **Production / Producción**.
2. Abre el registro. Deben finalizar instalación, `npm run build:pages` y carga de archivos sin errores.
3. Espera estado **Success / Correcto**. Una compilación iniciada no significa publicación terminada.
4. Pulsa la URL de producción terminada en `.pages.dev`; añade `/restaurante-demo`.
5. Pulsa Ctrl+R en esa dirección: debe volver a aparecer la carta, sin 404.
6. Para verificar HTTPS, comprueba que la dirección comienza con `https://` y Chrome no muestra una advertencia.

Alternativa de terminal, solo después de autenticar y si necesitas subir un build manualmente:

```powershell
npx wrangler login
npm run deploy:pages
```

Usa normalmente GitHub: cada push a main dispara la publicación automática. Una subida manual no configura por sí sola esa integración.

### ETAPA F — Abrir el menú desde celular

1. En Android conecta Wi-Fi, abre Chrome y escribe la URL pública con `/restaurante-demo`.
2. Comprueba que aparece RESTAURANTE DEMO RESUELVEN y no una pantalla de login.
3. Cierra la pestaña. Desactiva Wi-Fi, activa datos móviles y vuelve a abrir la URL.
4. Mantén el teléfono vertical. Comprueba texto legible y que no puedes desplazar toda la página hacia los lados.

### ETAPA G — Probar el QR

1. En la computadora abre la URL pública con `/restaurante-demo/qr`.
2. Verás exactamente dos tarjetas. Descarga los dos PNG o pulsa **Imprimir ambos QR**.
3. Con Internet, escanea **MENÚ CON INTERNET**: debe abrir la URL pública y mostrar fotografías, buscador y categorías.
4. Activa modo avión y escanea **MENÚ SIN INTERNET**: el teléfono debe ofrecer abrir o guardar un contacto vCard. En Notas deben aparecer categorías, platos disponibles y precios.
5. Comprueba que el plato agotado no aparezca en la vCard. Si el teléfono no reconoce el código, prueba Google Lens, más luz y mayor tamaño.

### ETAPA H — Simular restaurante real

1. Desde la página pública del QR pulsa **Imprimir QR** y elige tu impresora (o Guardar como PDF).
2. Imprime en blanco y negro, con margen blanco, sin recortar; el QR se propone a 8 cm.
3. Colócalo sobre una mesa, plano y con buena iluminación.
4. Aléjate y vuelve como cliente. Escanea a unos 20–40 cm, ajustando distancia si hace falta.
5. En el texto deben aparecer **Entradas**, Empanadas $2.50 y Patacones con queso $3.50.
6. Abre **Platos principales**: Hamburguesa clásica $5.00, doble $7.50, pollo $6.50, churrasco $8.50.
7. El encebollado de prueba debe verse agotado y con foto ilustrativa, sin botón para añadirlo.
8. Toca un plato para ver el detalle. Añádelo a la selección, comprueba el total y pulsa **Volver al menú**.
9. Abre **Bebidas**: Coca-Cola $1.50, Agua $1.00 y Limonada $2.00.
10. Comprueba que la imagen carga, los botones se pueden tocar y el cliente entiende que la selección se muestra al mesero.

### ETAPA I — Simular fallo de Internet

1. Con Internet abre el menú y visita varias categorías.
2. Espera el texto **Menú y fotos disponibles sin conexión en este navegador** al pie.
3. Desactiva Wi-Fi y datos móviles; también puedes usar modo avión. Mantén Chrome y el mismo perfil.
4. Recarga la carta. Cierra esa pestaña y abre otra con la misma dirección.
5. Comprueba categorías, nombres, descripciones, precios, foto y selección. Funcionan desde la copia guardada.
6. No esperes precios recién cambiados: no hay servidor accesible sin red. La selección se vacía al recargar.
7. Activa Internet, cierra todas las pestañas del sitio y vuelve a abrir para recibir actualizaciones.
8. Prueba otro teléfono que nunca abrió el menú, sin Internet: no podrá descargarlo. Eso es una limitación de la web, no del QR.

### ETAPA J — Cambiar un producto

Forma sencilla desde GitHub, sin instalar más programas:

1. Abre el repositorio, **Code → data → restaurants → restaurante-demo.json**.
2. Pulsa el lápiz **Edit this file**. Usa Ctrl+F y busca `hamburguesa-clasica`.
3. Dentro de ese objeto, debajo de su descripción y categoría, cambia exactamente `"priceCents": 500`
   por `"priceCents": 550`. Son centavos: no escribas `5.50`, ni `$`, ni cambies otro plato.
4. Pulsa **Commit changes**, escribe `Actualizar hamburguesa clásica a 5.50`, selecciona guardar en main y confirma.
5. Abre Cloudflare → proyecto → **Deployments**. Espera el nuevo commit con estado correcto.
6. Con Internet abre la carta. Si había una PWA abierta, cierra todas sus ventanas/pestañas y vuelve a abrir.
7. La hamburguesa debe mostrar $5.50. El QR no cambia: conserva la misma URL.

Alternativa local: edita ese mismo archivo en VS Code, pulsa Ctrl+S y ejecuta:

```powershell
npm run build:pages
git add data/restaurants/restaurante-demo.json
git commit -m "Actualizar hamburguesa clásica a 5.50"
git push origin main
```

La prueba automatizada verifica intencionalmente el precio demo $5.00: actualiza también su expectativa
en `scripts/pages-qa.mjs` si decides cambiar permanentemente el fixture a $5.50.

## 14. CHECKLIST FINAL

Resultados contra https://qr-menu-resuelven.pages.dev. FAIL indica no aprobado, incluyendo pruebas físicas pendientes; no implica que se haya observado un fallo de Android.

| Prueba | Resultado | Observaciones |
|---|---|---|
| Build | PASS | Pages, Sites y local terminados |
| Cloudflare Pages | PASS | Producción y segundo despliegue automático verificados |
| HTTPS | PASS | Certificado aceptado por Chromium y respuesta 200 |
| Página móvil | PASS | Emulación Pixel 7 / Chromium |
| QR web + vCard | PASS | Ambos PNG decodificados por software; cámara física pendiente |
| Categorías | PASS | Entradas, principales, bebidas y navegación |
| Productos | PASS | 10 productos; agotado no seleccionable |
| Precios | PASS | Hamburguesa $5.00 y total de selección |
| Imágenes | PASS | Foto e iconos cargados; foto también offline |
| Responsive | PASS | 320, 390, 412, 768 y 1440 px; sin overflow de página |
| PWA | PASS | Manifest, iconos, SW y caché funcional; instalación física pendiente |
| Offline previamente cargado | PASS | Recarga, nueva pestaña, carta y foto en producción |
| Android / iPhone | FAIL | No se dispone de teléfonos físicos; emulación web aprobada |
| Errores consola | PASS | Cero errores en la batería pública |


## 15. SIGUIENTES MEJORAS RECOMENDADAS

Realizar la prueba física Android/cámara/Wi-Fi/datos, sustituir datos ficticios por una carta autorizada,
incorporar fotos reales y un dominio propio solo cuando haga falta. Si se necesita editar desde el panel,
desplegar la edición Worker con su almacenamiento; no añadir un falso panel estático sin persistencia compartida.
