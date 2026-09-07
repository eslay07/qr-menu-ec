param([string]$InstallDir="$env:ProgramData\QRMenu",[string]$ServerIP='192.168.8.100',[string]$AdminSubnet='192.168.8.0/24')
$ErrorActionPreference='Stop'
$qrIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$qrIdentity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Ejecuta el instalador como administrador.' }
if ($ServerIP -notmatch '^192\.168\.8\.\d{1,3}$') { throw 'Este instalador espera una IP fija en 192.168.8.x.' }
if ($AdminSubnet -notmatch '^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$') { throw 'Subred de administración inválida.' }
$qrInstall=[IO.Path]::GetFullPath($InstallDir)
if ($qrInstall -eq [IO.Path]::GetPathRoot($qrInstall)) { throw 'No se admite instalar en la raíz de una unidad.' }
New-Item -ItemType Directory -Force -Path $qrInstall,(Join-Path $qrInstall 'data') | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'qrmenu.exe'))) { throw 'Falta qrmenu.exe.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'qrmenu.exe') -Destination (Join-Path $qrInstall 'qrmenu.exe') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'seller-public.txt') -Destination (Join-Path $qrInstall 'seller-public.txt') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ui') -Destination $qrInstall -Recurse -Force
$qrCommand='"'+(Join-Path $qrInstall 'qrmenu.exe')+'" --ui "'+(Join-Path $qrInstall 'ui')+'" --data "'+(Join-Path $qrInstall 'data')+'" --public-key "'+(Join-Path $qrInstall 'seller-public.txt')+'" --cert-ips '+$ServerIP
& schtasks.exe /Create /TN 'QRMenu-Servidor' /SC ONSTART /RU SYSTEM /RL HIGHEST /TR $qrCommand /F
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el inicio automático.' }
& netsh.exe advfirewall firewall add rule name='QRMenu-Menu' dir=in action=allow protocol=TCP localport=8080 remoteip=localsubnet profile=private
& netsh.exe advfirewall firewall add rule name='QRMenu-Administracion' dir=in action=allow protocol=TCP localport=8443 remoteip=$AdminSubnet profile=private
& icacls.exe (Join-Path $qrInstall 'data') /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
& schtasks.exe /Run /TN 'QRMenu-Servidor'
Write-Output "Servidor instalado. Panel: https://${ServerIP}:8443/ . Menú: http://${ServerIP}:8080/menu"
Write-Output "Código de instalación en $qrInstall\data\installation-code.txt. Configura una reserva DHCP para esta IP y confía el certificado server.crt solo en los dispositivos del dueño."
