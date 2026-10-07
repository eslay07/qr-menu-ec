# Impresión QR y conciliación final — 2026-10-05

La candidata `724862e7-0c75-4bdd-b01a-4067891f78fe` conserva el Worker aceptado `fcea08f9` y todos sus bindings. Solo cambia HTML/CSS de impresión. SHA-256 del Worker: `44f0b30e17a44dcac14365c844c564eff7e06cd2d451782f2c8020bd451a6e5a`.

## Impresión aprobada

- Clave WiFi: 20 pt, negrita; nombre de red: 16 pt. QR de 88 mm, limitado al ancho disponible. Tarjeta sin división entre páginas y con ajuste de líneas largas.
- Chromium desktop: A4 y Carta, una página, sin desbordamiento. Se probó también una clave de 63 caracteres y un nombre largo. La prueba obtiene y compara el CSS real publicado y comprueba que el formulario del dueño se renderiza sin excepciones.
- Honor LNA-LX3 físico: vista previa del sistema Android, papel Carta, indicador `1/1`, QR y clave de ensayo legibles en la misma tarjeta. Trabajo cancelado, sin enviar a una impresora ni guardar un PDF en el teléfono.
- Configuración WiFi de ensayo restaurada: desactivada, nombre vacío y ciphertext ausente. Ningún pedido ni documento importado eliminado.
- APK de esta candidata: arranque frío tras force-stop en 758 ms. El operador confirmó «Sí, panel estable sin login» después de desbloquear y observar.

Se corrigió un fallo exclusivo de la primera candidata de impresión: HTML/CSS se habían subido con MIME `application/octet-stream`. La versión corregida usa `text/html` y `text/css`, verificados antes de instalar. Esa versión fallida no recibió tráfico de producción.

Evidencias privadas fuera de Git: `work/print-candidate-v2/version.json`, `desktop-print-qa.json`, vistas previas PDF desktop, `honor-print-large.png` y `wifi-restored.json`.

## Conciliación segura

El respaldo previo al corte confirmó dos restaurantes, siete pedidos y dieciséis fotos en D1. Respecto al respaldo original, solo se añadió un evento de auditoría; las demás tablas no cambiaron.

Los ensayos generan UUID aleatorios para catálogos inmutables. El conciliador alinea sus IDs y los de las publicaciones únicamente cuando todo el subárbol es idéntico, evitando interpretar UUID de ensayo como cambios del menú. Se conservan las actualizaciones remotas de Auth, sesiones, preferencias y los documentos exclusivos de la candidata cuando D1 no cambió ese documento. Los cambios concurrentes reales detienen el corte; las escrituras llevan precondición de revisión. No hay borrado de pedidos, copia original ni journals.

Pruebas: conservación de Auth/sesiones, conflictos, precondiciones, reanudación tras interrupción y ausencia de borrados. El ensayo de interrupción/reanudación se ejecutó en un proyecto demo aislado del emulador, sin credenciales de producción.

La ventana real y el corte quedaron completados después de esta aceptación. Producción `724862e7` está al 100%; respaldo congelado, conciliación sin borrados y comprobaciones posteriores constan en `final-cut-2026-10-05.md`.
