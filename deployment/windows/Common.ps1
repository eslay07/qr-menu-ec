function Assert-Administrator {
 $qrIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
 if(-not ([Security.Principal.WindowsPrincipal]$qrIdentity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Ejecuta PowerShell como administrador.'}
}
function Invoke-Native([string]$Executable,[string[]]$Arguments){
 & $Executable @Arguments | Out-Null
 if($LASTEXITCODE -ne 0){throw "Falló $Executable (código $LASTEXITCODE)."}
}
function Stop-QRService{
 $qrService=Get-Service -Name 'QRMenu-Servidor' -ErrorAction SilentlyContinue
 if($qrService -and $qrService.Status -ne 'Stopped'){
  Stop-Service -Name 'QRMenu-Servidor'
  $qrService.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(40))
 }
}
