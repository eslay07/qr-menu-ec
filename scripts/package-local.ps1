param([string]$GoCurrent='work/toolchains/go-current/go/bin/go.exe',[string]$GoLegacy='work/toolchains/go120/go/bin/go.exe',[string]$SellerPublic='C:/Users/jimmy/Documents/ChatGPT/QR Menu Vendedor Privado/seller-public.txt')
$ErrorActionPreference='Stop'
$qrRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$qrGo=(Resolve-Path (Join-Path $qrRoot $GoCurrent)).Path
$qrGoOld=(Resolve-Path (Join-Path $qrRoot $GoLegacy)).Path
New-Item -ItemType Directory -Force -Path (Join-Path $qrRoot 'outputs/packages') | Out-Null
$qrTargets=@(@{Name='windows10';OS='windows';Arch='amd64';Compiler=$qrGo},@{Name='windows7';OS='windows';Arch='386';Compiler=$qrGoOld},@{Name='openwrt-mt3000';OS='linux';Arch='arm64';Compiler=$qrGo})
Push-Location (Join-Path $qrRoot 'native/go')
try {
 foreach($qrTarget in $qrTargets){
  $qrDest=Join-Path $qrRoot ('outputs/packages/'+$qrTarget.Name)
  New-Item -ItemType Directory -Force -Path $qrDest | Out-Null
  $env:GOOS=$qrTarget.OS; $env:GOARCH=$qrTarget.Arch; $env:CGO_ENABLED='0'
  $qrExe=if($qrTarget.OS -eq 'windows'){'qrmenu.exe'}else{'qrmenu'}
  & $qrTarget.Compiler build -trimpath -ldflags '-s -w' -o (Join-Path $qrDest $qrExe) .
  if($LASTEXITCODE -ne 0){throw ('Falló compilación '+$qrTarget.Name)}
  New-Item -ItemType Directory -Force -Path (Join-Path $qrDest 'ui') | Out-Null
  Copy-Item -Path (Join-Path $qrRoot 'dist-local/*') -Destination (Join-Path $qrDest 'ui') -Recurse -Force
  Copy-Item -LiteralPath $SellerPublic -Destination (Join-Path $qrDest 'seller-public.txt') -Force
  $qrFiles=if($qrTarget.OS -eq 'windows'){'deployment/windows/*'}else{'deployment/openwrt/*'}
  Copy-Item -Path (Join-Path $qrRoot $qrFiles) -Destination $qrDest -Force
  Copy-Item -LiteralPath (Join-Path $qrRoot 'docs/INSTALACION.md') -Destination $qrDest -Force
  if($qrTarget.OS -eq 'windows'){Compress-Archive -Path (Join-Path $qrDest '*') -DestinationPath (Join-Path $qrRoot ('outputs/QR-Menu-'+$qrTarget.Name+'.zip')) -Force}
  else {& tar.exe -czf (Join-Path $qrRoot 'outputs/QR-Menu-openwrt-mt3000.tar.gz') -C $qrDest .}
 }
} finally {Pop-Location;Remove-Item Env:GOOS -ErrorAction SilentlyContinue;Remove-Item Env:GOARCH -ErrorAction SilentlyContinue;Remove-Item Env:CGO_ENABLED -ErrorAction SilentlyContinue}
