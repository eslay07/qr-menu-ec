# Corte operativo Firestore → D1

Autorización existente del operador: completar migración y despliegue preservando datos y accesos. Sin compras, cambios de facturación, Storage o R2.

## Identidades fijas

Origen activo: `724862e7-0c75-4bdd-b01a-4067891f78fe`. Mantenimiento preparado: `4508207e-9a61-48d2-8e59-cffbd273977c`. La candidata se toma del recibo verificado `work/d1-production-candidate/version.json`, no de un UUID histórico escrito a mano. D1 operativo: `0c8dab0c-5e79-4272-a28c-90b00a93e676`; D1 de fotos permanece intacta.

## Preparación y ensayo

`node --import tsx scripts/execute-d1-cut.ts` únicamente lee, valida evidencias y concilia en memoria. No abre mantenimiento.

`node --import tsx scripts/d1-cut-rehearsal.ts` usa respaldos cifrados y SQLite exclusivamente en memoria. Comprueba interrupción/reanudación, reversión previa exacta y conservación de una escritura posterior. No realiza llamadas de red ni deja datos privados en claro. El ensayo pasó con dos restaurantes, siete pedidos y 17 líneas; recibo `work/d1-transition/cut-rehearsal.json`. Las 20 pruebas dedicadas del emulador también pasan con `firebase.launch-qa.json` (puertos separados, sin detener emuladores ajenos).

## Ventana autorizada

`node --import tsx scripts/execute-d1-cut.ts --execute-authorized-window`

1. Verifica versión activa y aceptación. Activa mantenimiento, bloquea todas las vistas previas y deshabilita cron. Espera tres rondas completas de 503 con marcadores correctos en ambos dominios, incluyendo menú, login y renovación.
2. Publica exclusivamente las reglas Firestore de congelación. Comprueba rechazo anónimo; IAM del importador permanece privado y en memoria. No imprime ni guarda credenciales.
3. Exporta y verifica restauración de las dos bases D1. Captura Firestore final cifrado fuera de Git. La captura por sí sola tiene `freezeConfirmed=false`; solo la comprobación externa de mantenimiento antes/después permite marcar el recibo de corte como congelado. No confundir una captura de lectura con una ventana autorizada.
4. Concilia tres vías: respaldo inicial, Firestore final, D1 actual. Rechaza conflictos de contenido; renueva únicamente los dos contadores de revisión ya revisados. Valida catálogo, identidad, membresías y líneas. Aplica con CAS y verifica checksum global.
5. Sin escrituras de clientes, refleja el estado combinado en Firestore para construir una base de reversión idéntica. Esto conserva los cambios de identidad aprobados durante QA; no es doble escritura de negocio en funcionamiento normal.
6. Activa D1, habilita cron por minuto para la cola push y comprueba tres rondas funcionales de menú y creador/TOTP; descarga APK y verifica SHA-256.

Las vistas previas antiguas permanecen deshabilitadas después del lanzamiento: no deben seguir escribiendo en el proveedor anterior. Firestore conserva todos sus documentos, pero queda cerrado al SDK del navegador mientras D1 es operativo; Firebase Authentication y FCM no dependen de esas reglas. Para volver a Firestore, conciliar primero y restaurar las reglas normales solo durante el retorno verificado.

## Recuperación

Antes de activar, si se inició el reflejo Firestore, restaurar la fuente capturada con precondiciones y después reglas/configuración/tráfico original. Después de activar, congelar otra vez y reflejar el D1 actual hacia Firestore antes de recuperar el tráfico original. Nunca activar una copia antigua por encima de pedidos nuevos.

La ventana tiene límite de 45 minutos, reservando margen de la autorización original de 60. La recuperación no queda bloqueada por ese vencimiento. Si una recuperación no puede verificarse, el controlador deja un recibo explícito y no anuncia reversión exitosa. Un cierre abrupto del proceso o del equipo requiere revisar el tráfico y ese recibo antes de continuar; no se promete recuperación automática ante pérdida del equipo de operación.

Los recibos no incluyen documentos, correos, tokens ni secretos. No publicar `work`, respaldos, adjuntos privados o base de prospectos.
