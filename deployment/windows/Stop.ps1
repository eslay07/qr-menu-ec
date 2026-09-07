$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Administrator
Stop-QRService
Write-Output 'Servicio detenido. Los datos se conservan. Para impedir el siguiente arranque: Set-Service QRMenu-Servidor -StartupType Disabled'
