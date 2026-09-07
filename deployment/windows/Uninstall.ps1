$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Administrator
Stop-QRService
if(Get-Service -Name 'QRMenu-Servidor' -ErrorAction SilentlyContinue){Invoke-Native sc.exe @('delete','QRMenu-Servidor')}
foreach($qrRule in @('QRMenu-Menu','QRMenu-Administracion')){& netsh.exe advfirewall firewall delete rule "name=$qrRule" | Out-Null}
Write-Output 'Servicio y reglas de red retirados. Se conservan programa, certificados, respaldos y datos en ProgramData\QRMenu. Para reinstalar, ejecuta Install.ps1.'
