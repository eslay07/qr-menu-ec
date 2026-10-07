# Respaldos: programación y ensayo aislado

Fecha: 2026-09-28. No hay activación de producción.

El Worker programado invoca `firestoreMaintenance`. Para restaurantes activos con `private/backupPolicy.automatic=true`, crea una copia diaria UTC mediante `automatic()`. Solo el creador puede habilitar la política por `PUT /api/v1/backups/policy`; el dueño no escribe el documento privado. No se ha habilitado ninguna política real.

Las rutas autenticadas `GET/POST /api/v1/backups` listan o generan copias; `POST /api/v1/backups/{uuid}/restore` exige `{revision, confirm:true}`, sesión y CSRF. No puede restaurar otro restaurante. La copia captura carta y pedidos en una transacción de lectura, incluye imágenes referenciadas y preferencias; fragmenta y comprueba SHA-256 mediante lectura posterior antes de marcar `verified`.

Restauración conservadora: conserva credenciales, permisos y dominio; rechaza revisión obsoleta y pedidos existentes diferentes; no elimina pedidos posteriores. Reconstruye pedidos ausentes y líneas. Las imágenes existentes diferentes se rechazan. Las operaciones excesivas se rechazan antes de modificar estado vivo: no se promete recuperación ilimitada ni se trocea un commit de restauración de forma insegura.

Extensión del ensayo: si un pedido conserva su cabecera pero perdió líneas, repone únicamente las líneas ausentes cuando el resto coincide; una línea cambiada se rechaza. Las copias nuevas incluyen el índice privado de enlaces con hashes. Al restaurar se recuperan enlaces aún vigentes, nunca vencidos ni asignados a otro pedido. Los respaldos anteriores sin índice siguen siendo legibles, pero no pueden recuperar un índice que nunca contuvieron.

## Ensayo mensual

En un emulador local dedicado al proyecto `demo-qr-menu-ec`, definir `FIRESTORE_EMULATOR_HOST=127.0.0.1:PUERTO` y ejecutar:

```powershell
node scripts/backup-monthly-drill.mjs
```

El script rechaza hosts remotos y usa UUID nuevos con datos ficticios. No lee exportaciones reales ni solicita credenciales. Comprueba copia automática y deduplicación diaria, simula pérdida en sus propios documentos, restaura catálogo y líneas, compara valores completos y rechaza checksum alterado. Guardar la salida de cada ejecución con fecha en el registro interno de operaciones. Es un ensayo ejecutable, no una automatización del escritorio creada sin autorización.

Resultado local: ensayo aprobado el 28-09-2026. Una prueba adicional de repositorios conserva estado cancelado y total de pedidos durante restauración de carta de 150 platos. Esto no sustituye un ensayo de despliegue remoto autorizado, ni valida volúmenes superiores al límite atómico.
