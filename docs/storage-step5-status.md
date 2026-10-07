# Paso 5 — almacenamiento de imágenes

## Decisión vigente — 29-09-2026

**Actualización 05-10-2026: las 16 fotografías existentes permanecen en D1; R2 nunca se activó.** La copia cifrada final incluye y verifica esas imágenes. No se contratará Blaze automáticamente ni se trasladarán imágenes. El adaptador experimental descrito abajo permanece desactivado (`MEDIA_PROVIDER=legacy`, `FIREBASE_STORAGE_ENABLED=false`); Firebase Storage no es requisito para el funcionamiento actual. Las notas inferiores se conservan como historial técnico.

Actualizado: 28-09-2026. Desarrollo local autorizado al continuar la migración. **Sin despliegue, bucket nuevo, IAM ni traslado de archivos reales.**

Inspección remota posterior autorizada: bucket esperado devuelve 404 y el proyecto mantiene Spark sin facturación vinculada. No se creó Storage porque requiere Blaze. Ver `firebase-remote-credentials-status.md`; el operador debe elegir continuidad con almacenamiento actual o evaluar el cambio de plan. No se aplicó el cambio automáticamente.

## Implementado

- Adaptador de servidor `FirebaseStorageMedia`, sin SDK compat ni credenciales en el navegador. Conserva las URLs `/api/v1/media/{uuid}` existentes y el aislamiento `restaurants/{uuid}/media/{uuid}`.
- Solo JPEG, PNG y WebP, máximo 1.000.000 bytes y límites de dimensiones/píxeles. Comprueba cabeceras, no es un decodificador completo de imagen.
- Copia reanudable por ID: `ifGenerationMatch=0` impide sobrescrituras. Si el objeto existe, compara MIME y SHA-256 tras volver a leer; una diferencia detiene la copia. No elimina el origen.
- Selección por `MEDIA_PROVIDER=firebase-storage`, más `FIREBASE_STORAGE_ENABLED=true`, bucket, proyecto y secreto de servidor explícitos. El valor predeterminado sigue siendo `legacy`.
- Lectura de objetos antiguos desde D1/R2 cuando no existen aún en Storage. Un fallo de permisos o red no se oculta como archivo inexistente.
- Reglas de Storage deniegan acceso directo del cliente. La autorización permanece en el Worker; IAM controla la cuenta técnica. Archivo enlazado en `firebase.json`, no publicado.

## Activación futura, con autorización

1. Verificar existencia del bucket y condiciones de facturación del proyecto; no crear ni cambiar de plan automáticamente.
2. Crear identidad separada de la utilizada para Auth, limitada al bucket. Necesita `storage.objects.get` y `storage.objects.create`; no conceder borrado ni sobrescritura. Guardar JSON exclusivamente como secreto `FIREBASE_STORAGE_SERVICE_ACCOUNT`.
3. Probar con datos ficticios y cuenta de prueba en entorno aislado. Mantener los flags desactivados en producción.
4. Enumerar imágenes de borrador, publicación y respaldos aprobados, copiar con `copyMediaVerified`, comparar inventarios y hashes. No dar por migrado un archivo ausente o distinto.
5. Con autorización de publicación, configurar proyecto/bucket/flags del Worker; comprobar alta de foto, publicación, URL antigua, respaldo y restauración. Conservar el origen durante la transición.

No se certifica todavía transferencia real ni eliminación de D1/R2. La prueba automatizada utiliza transporte simulado: aislamiento, idempotencia, bytes, conflicto y entradas inválidas. No equivale a prueba IAM remota.

Verificación local: TypeScript y compilación Worker correctos; prueba del adaptador aprobada dentro de la suite general. El ensayo Firestore de respaldo también recuperó una imagen eliminada de su proveedor ficticio, junto con líneas y enlace de pedido. Falta ensayo con bucket/credencial autorizados, no un cambio de interfaz ni de framework.

Referencias: [inserción y precondiciones GCS](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert), [lectura de objetos](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get).
