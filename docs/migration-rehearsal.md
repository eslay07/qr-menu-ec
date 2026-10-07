# Ensayo de migración reanudable

28-09-2026. Solo emulador y exportación local explícita; no exporta producción, no modifica D1 ni publica reglas.

1. Preparar una exportación aprobada en `work/migration/`, fuera de Git. JSON con `schemaVersion: 1`, `creator: {revision,state}` (o `null` si el origen no tiene creador), `restaurants: [{revision,state}]`, `orders: [{order,tokenHash}]` y `serverTables: [{table,rows}]`. Los estados y pedidos son las instantáneas completas del sistema, no DTO públicos. Cifrado original y hashes se conservan; tratar todo el archivo como confidencial.
2. Las tablas auxiliares admitidas son `restaurant_hosts`, `platform_domain_config`, `audit_events`, `rate_limits`, `security_migrations`, `auth_sessions`, `owner_devices` y `auth_challenges`. Filas en su formato de columnas D1. Los dominios reconstruyen la reserva por tipo y la validación JSON; dispositivos conservan ámbito dueño. No incluir tokens en claro.
3. Iniciar emulador aislado y definir `FIRESTORE_EMULATOR_HOST=127.0.0.1:PUERTO`. El script fija el proyecto ficticio `demo-qr-menu-migration`; nunca acepta ID de producción. Máximo 64 MB, 1.000 restaurantes y 10.000 pedidos por archivo de este ensayo.
4. Calcular SHA-256 con `Get-FileHash -Algorithm SHA256 -LiteralPath RUTA` y generar un UUID de ejecución. Ejecutar:

```powershell
node --import tsx scripts/firestore-migration-rehearsal.ts RUTA SHA256_EN_MINUSCULAS UUID
```

5. Reanudar con el mismo archivo, checksum y UUID. No crear otra ejecución para saltarse un conflicto. Comparar número de restaurantes/pedidos y estado del marcador `migrationRuns/{UUID}`. Un origen o destino modificado detiene el proceso sin borrar diferencias. Pedidos históricos no disparan avisos de pedidos nuevos.

El importador compara el restaurante completo normalizado, pedidos completos, enlaces privados y el inventario. Repetir tablas auxiliares idénticas es seguro; diferencias se rechazan. No reduce permisos ni revoca sesiones automáticamente: antes de una migración real debe decidirse si conservar permisos vigentes o forzar acceso nuevo.

## Límites que no se deben ocultar

El creador se traslada a `platformConfig/creator` conservando revisión, TOTP y cifrado; nunca se transforma en restaurante ni se permite sobrescribir diferencias. El comando no copia archivos. El operador confirmó que las 16 imágenes existentes están en D1 y R2 nunca se activó: conservar D1 para las imágenes, sin migrarlas a Storage ni crear buckets. No retirar D1 ni anunciar una migración integral remota a partir de este ensayo de datos.

Reversión del ensayo: mantener el origen sin modificaciones y descartar únicamente el proyecto ficticio dedicado, nunca una base compartida. No existe sincronización bidireccional de nuevas escrituras; un futuro corte real necesita ventana de mantenimiento, copia final y autorización expresa.

## Variante con respaldo cifrado aprobado (2 de octubre de 2026)

Para evitar exportaciones privadas en claro, `scripts/encrypted-migration-rehearsal.mjs` verifica el archivo AES-GCM, la clave DPAPI, SQL, inventarios y todas las imágenes mediante `verifiedBackup`. Restaura SQLite exclusivamente en memoria y genera el formato anterior con checksum. Rechaza tablas o registros de aplicación sin mapeo. Ejecuta el mismo importador dos veces con idénticos datos/UUID, verifica el marcador y ausencia de avisos históricos, y guarda solo un recibo sin datos personales junto al respaldo cifrado (fuera de Git).

Con un emulador nuevo, dedicado y ligado solo a loopback, ejecutar desde el perfil Windows que creó el respaldo:

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:18385'
node --import tsx scripts/encrypted-migration-rehearsal.mjs 'work/private-backups/2026-10-03T03-51-43.335Z-81a5ac0b' UUID_DEL_ENSAYO
```

El script bloquea tráfico HTTP fuera del emulador. No descarga ni altera producción y no acepta proyectos reales. Un recibo existente no se sobrescribe. Cerrar el proceso de ese emulador al terminar, sin exportar sus datos privados; no detener emuladores ajenos. Resultado del ensayo aprobado y checksum: `production-checklist-results.md`, paso 3.
