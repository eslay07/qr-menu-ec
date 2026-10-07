# Reducción de consumo y preparación de lanzamiento

05-10-2026. Corrección en código y candidata sin tráfico; no confundir con producción activada.

## Causa de amplificación encontrada

El panel sondeaba `session` cada cinco segundos, incluso oculto. El Worker cargaba el estado completo para determinar permisos y `handleApi` volvía a cargarlo. Cada lectura hidrataba borrador y publicación con varias consultas. Un celular abierto podía generar lecturas continuamente sin que el dueño editara nada. No se atribuye todo el consumo a este único factor: también hubo migraciones y ensayos.

## Cambios

- Sondeo cada cinco minutos y solo con `document.visibilityState === 'visible'`. Las acciones privadas siguen validándose en servidor en cada solicitud; esto no extiende la duración de las sesiones.
- `Store.readSession()` opcional: Firestore lee únicamente raíz y Auth privado. No lee categorías, platos, promociones ni configuración WiFi. D1 conserva el comportamiento compatible.
- El Worker lee solo metadatos de acceso para permisos en lugar de la carta completa. Los permisos provienen del servidor.
- `Store.readMenu()` opcional: el comensal lee solo la versión publicada y opciones públicas; nunca borrador ni Auth privado.
- Caché pública en memoria de 30 segundos, hasta 100 restaurantes por instancia, copia defensiva, deduplicación de solicitudes y rechazo explícito de estados privados. Se invalida tras mutaciones exitosas en esa instancia; otras instancias vencen por TTL. No se usa para precios de pedidos ni autorización privada.
- Archivos estáticos, APK y formularios de entrada no consultan la base para servirse.
- Los errores de cuota que escapan del router se presentan como HTTP 503 con `Retry-After: 60`, texto claro y sin detalles internos; ya no como excepción 500. Los casos capturados por el API del creador se convierten igualmente a 503.

## Verificación local

Cuatro pruebas nuevas cubren aislamiento/copia, caché que rechaza secretos, dos lecturas para sesión y menú publicado sin borrador/Auth. Dos pruebas nuevas cubren estáticos sin DB y respuesta segura 503. Pruebas de UUID y mantenimiento conservadas; TypeScript y compilaciones comprobados. Suite Firestore: 20/20 sin omisiones; suite unitaria previa a las dos pruebas de cuota: 70 pasan y 18 requieren emulador (cubiertas separadamente según sus comandos).

## Condición de salida

La optimización no restablece una cuota ya bloqueada. Hay que comprobar, desde la identidad del Worker, que vuelven a funcionar menú, acceso y escrituras antes de activar. No comprar dominio para solucionar este error y no retroceder a D1 sin conciliación. No activar un cron push cada minuto mientras el consumo siga sin control.

Correo de recuperación real del dueño: recibido y confirmado por el operador el 05-10-2026, sin cambio de contraseña ni TOTP. Fotos: D1; no requiere Storage ni Blaze para mostrarlas. Push: recepción física aún por comprobar; no venderlo como activado.
