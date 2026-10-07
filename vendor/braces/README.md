# Parche local de seguridad de braces

Origen: braces 3.0.3, https://github.com/micromatch/braces, licencia MIT conservada en LICENSE. La copia mantiene el código upstream salvo dos comprobaciones de profundidad en lib/parse.js y la metadata del paquete.

El parser rechaza más de 63 niveles abiertos de llaves o paréntesis antes de alcanzar recursión peligrosa. Los patrones normales, rangos, comillas y escapes se prueban en tests/braces-security.test.ts contra el paquete instalado, no contra una copia desconectada del árbol de dependencias.

El override de package.json obliga a las herramientas transitivas a usar esta copia. No es una afirmación de seguridad para AST arbitrarios suministrados directamente a compile; las herramientas deben usar patrones procesados por el parser.

Mantenimiento: revisar periódicamente la versión oficial. Cuando exista una corrección upstream equivalente, sustituir el override y ejecutar las pruebas de patrones y anidamiento, auditoría, compilación y emulador antes de eliminar esta copia. No publicar este fork como paquete oficial upstream.
