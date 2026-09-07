$ErrorActionPreference='Stop'
& schtasks.exe /End /TN 'QRMenu-Servidor'
Write-Output 'Servidor detenido. Los datos se conservan. Para deshabilitar el arranque: schtasks /Change /TN QRMenu-Servidor /Disable'
