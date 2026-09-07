$ErrorActionPreference='Stop'
$qrInstall=Join-Path $env:ProgramData 'QRMenu'
$qrState=Get-Service -Name 'QRMenu-Servidor' -ErrorAction SilentlyContinue
$qrPorts=@{}
foreach($qrPort in @(8080,8443)){
 $qrClient=New-Object Net.Sockets.TcpClient
 try{$qrAttempt=$qrClient.BeginConnect('127.0.0.1',$qrPort,$null,$null);if($qrAttempt.AsyncWaitHandle.WaitOne(1500)){$qrClient.EndConnect($qrAttempt);$qrPorts["$qrPort"]='accesible'}else{$qrPorts["$qrPort"]='sin respuesta'}}catch{$qrPorts["$qrPort"]='sin respuesta'}finally{$qrClient.Close()}
}
$qrHash='no disponible'
$qrBinary=Join-Path $qrInstall 'qrmenu.exe'
if(Test-Path -LiteralPath $qrBinary){
 $qrStream=[IO.File]::OpenRead($qrBinary);$qrHasher=[Security.Cryptography.SHA256]::Create()
 try{$qrHash=[BitConverter]::ToString($qrHasher.ComputeHash($qrStream)).Replace('-','').ToLower()}finally{$qrStream.Dispose();$qrHasher.Dispose()}
}
Write-Output ('Sistema: '+[Environment]::OSVersion.VersionString)
Write-Output ('Servicio: '+$(if($qrState){$qrState.Status}else{'no registrado'}))
Write-Output ('HTTP local 8080: '+$qrPorts['8080'])
Write-Output ('HTTPS local 8443: '+$qrPorts['8443'])
Write-Output ('SHA256: '+$qrHash)
Write-Output 'Esta comprobación local no prueba Wi-Fi, confianza TLS ni apertura del portal en teléfonos.'
