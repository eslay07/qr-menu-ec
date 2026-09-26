# Instalación y uso

## Plataforma

Despliega el Worker, aplica las tres migraciones D1 y configura los secretos de creador y Cloudflare indicados en `.env.example`. La plataforma es exclusivamente HTTPS y requiere conexión a Internet.

## Alta de un restaurante

1. El creador registra el restaurante y habilita, si corresponde, la función Pedidos por QR.
2. La plataforma asigna un subdominio gratuito permanente.
3. El dueño abre `/owner`, inicia sesión, configura la carta y publica.
4. En Acceso de clientes descarga e imprime el único QR HTTPS.
5. Opcionalmente agrega un dominio propio, crea el CNAME mostrado y pulsa Verificar.

## Platos configurables

Cada plato puede incluir grupos de selección única o múltiple, mínimo y máximo de elecciones, opciones disponibles y recargos. Por ejemplo, un desayuno continental puede exigir una bebida caliente y un jugo, además de extras opcionales.

## Pedidos y reportes

El cliente arma el pedido y pulsa Confirmar pedido. En ese momento se registra como confirmado y aparece en el reporte. La pantalla final muestra todos los platos, cantidades, opciones, notas y total, junto al mensaje “Muéstrale este pedido al mesero”. El QR para mesero es opcional; también se puede mostrar la pantalla, guardar el PDF, compartirlo o tomar una foto.

El dueño puede cancelar un pedido desde el historial. Los cancelados quedan auditables pero no suman a ventas. Los enlaces públicos y PDF dejan de estar disponibles después de 24 horas; las estadísticas privadas se conservan.
