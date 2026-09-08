param([string]$ServerIP='192.168.8.100',[string]$AdminSubnet='192.168.8.0/24')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Administrator
$qrParsed=$null
if (-not [Net.IPAddress]::TryParse($ServerIP,[ref]$qrParsed) -or $ServerIP -notmatch '^192\.168\.8\.' -or (@(0,255) -contains $qrParsed.GetAddressBytes()[3])) { throw 'Se requiere una dirección de servidor válida en 192.168.8.1–254.' }
if ($AdminSubnet -ne '192.168.8.0/24') { throw 'Este perfil reserva la administración a 192.168.8.0/24.' }
$qrInstall=Join-Path $env:ProgramData 'QRMenu'
foreach($qrRequired in @('qrmenu.exe','seller-public.txt','ui/index.html')) { if(-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $qrRequired))){throw "Falta $qrRequired"} }
$qrService=Get-Service -Name 'QRMenu-Servidor' -ErrorAction SilentlyContinue
if($qrService){Stop-QRService}
# Migrate the pilot task only when it exists, without running two servers.
$qrPreference=$ErrorActionPreference
$ErrorActionPreference='Continue'
& schtasks.exe /Query /TN 'QRMenu-Servidor' 2>$null | Out-Null
$qrLegacy=($LASTEXITCODE -eq 0)
$ErrorActionPreference=$qrPreference
if($qrLegacy){
 $ErrorActionPreference='Continue'
 & schtasks.exe /End /TN 'QRMenu-Servidor' 2>$null | Out-Null
 $ErrorActionPreference=$qrPreference
 # Wait for the previous executable to release its files and ports.
 foreach($qrProcess in @(Get-Process -Name qrmenu -ErrorAction SilentlyContinue)){if($qrProcess.Path -eq (Join-Path $qrInstall 'qrmenu.exe')){if(-not $qrProcess.WaitForExit(15000)){throw 'La versión anterior sigue ejecutándose. Deténla antes de actualizar.'}}}
}
New-Item -ItemType Directory -Force -Path $qrInstall,(Join-Path $qrInstall 'data') | Out-Null
# Protect the whole executable tree; standard users must not replace SYSTEM binaries.
Invoke-Native icacls.exe @($qrInstall,'/inheritance:r','/grant:r','*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F')
$qrBackup=$null
if(Test-Path -LiteralPath (Join-Path $qrInstall 'qrmenu.exe')){
 $qrBackup=Join-Path $qrInstall ('backups/'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff'))
 New-Item -ItemType Directory -Path $qrBackup | Out-Null
 foreach($qrItem in @('qrmenu.exe','seller-public.txt','ui','data')){if(Test-Path -LiteralPath (Join-Path $qrInstall $qrItem)){Copy-Item -LiteralPath (Join-Path $qrInstall $qrItem) -Destination $qrBackup -Recurse}}
}
try{
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'qrmenu.exe'),(Join-Path $PSScriptRoot 'seller-public.txt') -Destination $qrInstall -Force
 New-Item -ItemType Directory -Force -Path (Join-Path $qrInstall 'ui') | Out-Null
 Copy-Item -Path (Join-Path $PSScriptRoot 'ui/*') -Destination (Join-Path $qrInstall 'ui') -Recurse -Force
 $qrCommand='"'+(Join-Path $qrInstall 'qrmenu.exe')+'" --ui "'+(Join-Path $qrInstall 'ui')+'" --data "'+(Join-Path $qrInstall 'data')+'" --public-key "'+(Join-Path $qrInstall 'seller-public.txt')+'" --cert-ips '+$ServerIP
 if($qrService){Invoke-Native sc.exe @('config','QRMenu-Servidor','binPath=',$qrCommand,'start=','auto','obj=','LocalSystem')}
 else{Invoke-Native sc.exe @('create','QRMenu-Servidor','binPath=',$qrCommand,'start=','auto','obj=','LocalSystem','DisplayName=','QR Menu EC - Servidor local')}
 Invoke-Native sc.exe @('description','QRMenu-Servidor','Menú local y administración HTTPS del restaurante.')
 Invoke-Native sc.exe @('failure','QRMenu-Servidor','reset=','86400','actions=','restart/5000/restart/15000/restart/60000')
 Invoke-Native sc.exe @('failureflag','QRMenu-Servidor','1')
 foreach($qrRule in @('QRMenu-Menu','QRMenu-Administracion')){& netsh.exe advfirewall firewall delete rule "name=$qrRule" | Out-Null}
 Invoke-Native netsh.exe @('advfirewall','firewall','add','rule','name=QRMenu-Menu','dir=in','action=allow','protocol=TCP','localport=8080','remoteip=localsubnet','profile=private')
 Invoke-Native netsh.exe @('advfirewall','firewall','add','rule','name=QRMenu-Administracion','dir=in','action=allow','protocol=TCP','localport=8443',"remoteip=$AdminSubnet",'profile=private')
 Start-Service -Name 'QRMenu-Servidor'
 (Get-Service 'QRMenu-Servidor').WaitForStatus('Running',[TimeSpan]::FromSeconds(40))
 if($qrLegacy){Invoke-Native schtasks.exe @('/Delete','/TN','QRMenu-Servidor','/F')}
 Write-Output "Servicio instalado. Panel: https://${ServerIP}:8443/ . Menú: http://${ServerIP}:8080/menu"
 Write-Output "Código inicial: $qrInstall\data\installation-code.txt. Confía server.crt solo en equipos administradores."
 if($qrBackup){Write-Output "Respaldo privado anterior: $qrBackup"}
}catch{
 if($qrBackup){Write-Warning "La instalación falló. Se conservó el respaldo en $qrBackup y los datos actuales en $qrInstall\data. No sobrescribas los datos sin revisar la causa."}
 throw
}
