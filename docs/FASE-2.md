# Fase 2: instalación y preparación de pruebas

Alcance asumido para continuar el piloto: cerrar el servicio Windows previsto en el plan y preparar la validación física. No modifica la interfaz web ni habilita licencias automáticamente.

## Cambios entregados

- Servicio Windows SCM, inicio automático y tres demoras de recuperación configuradas tras fallos. El proceso informa que está listo solo después de abrir ambos puertos.
- Parada ordenada de HTTP y HTTPS, con hasta quince segundos para solicitudes en curso. Si falla el segundo puerto, se libera el primero.
- Instalador de actualización: detiene la versión anterior y conserva copia privada del programa, interfaz, clave pública y datos antes de copiar la nueva versión. La tarea del piloto se migra al servicio.
- Stop.ps1 y Uninstall.ps1 para parar o retirar el servicio. Desinstalar conserva archivos, certificados, datos y respaldos.
- Herramienta de ficha de campo: genera 16 combinaciones de acceso y 11 pruebas adicionales; todas empiezan pendientes.

## Uso de la ficha

`node tools/certification.mjs crear pruebas-local.json`

Completar el JSON con modelos, versiones, técnico, huella SHA256 del binario y resultados reales. Para cada acceso: indicar toques, segundos y una referencia a evidencia conservada por el técnico. Mantener apagada la conexión a internet del router en las pruebas de acceso. Las combinaciones alternan datos móviles encendidos/apagados en el cliente.

`node tools/certification.mjs revisar pruebas-local.json`

El código de salida 2 indica que faltan datos o hay pruebas pendientes/fallidas. Cero significa que el registro está completo según las reglas; no certifica la veracidad de las observaciones ni cambia el panel. Se exige una ficha separada por configuración de servidor. La prueba de ocho horas se exige al servidor Android. Se exigen treinta clientes Wi-Fi físicos para todas las configuraciones.

## Verificación y límites

Pruebas Go: persistencia, licencia, catálogo, autenticación, liberación de puertos si falla el arranque, parada de ambos servidores y estados SCM (inicio, ejecución, parada y fallo). El controlador SCM se prueba mediante sus canales de control sin instalar un servicio en el equipo de desarrollo.

No se realizó una instalación elevada, reinicio real de Windows, prueba con iPhone/Android ni configuración física del router. El acceso directo al router desde el panel sigue pendiente: se aplica el JSON mediante el instalador OpenWrt. No hay nueva certificación comercial por ejecutar estas pruebas de software.

Referencia del adaptador de servicio: https://pkg.go.dev/golang.org/x/sys/windows/svc . La dependencia está fijada a v0.20.0 para mantener compilación Go 1.20; la edición heredada necesita revisión y pruebas separadas.
