$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "El comando falló: $LASTEXITCODE" } }
npm run build:local
Check-Exit
npx vite build --config vite.pages.config.ts --mode hotspot --base /hotspot/ --outDir ../work/android-hotspot-ui
Check-Exit
$assets = Join-Path (Get-Location) 'native/android/app/src/main/assets'
New-Item -ItemType Directory -Force -Path "$assets/ui", "$assets/hotspot" | Out-Null
Copy-Item -Path 'dist-local/*' -Destination "$assets/ui" -Recurse -Force
Copy-Item -Path 'work/android-hotspot-ui/*' -Destination "$assets/hotspot" -Recurse -Force
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-23'
& './work/toolchains/gradle-8.13/bin/gradle.bat' -p native/android assembleRelease lintRelease --console=plain
Check-Exit
node scripts/sign-android.mjs
Check-Exit
New-Item -ItemType Directory -Force -Path 'deployment/android' | Out-Null
Copy-Item 'outputs/QR-Menu-Android-piloto.apk' 'deployment/android/qr-menu-android.apk' -Force
(Get-FileHash 'deployment/android/qr-menu-android.apk' -Algorithm SHA256).Hash.ToLower() + '  qr-menu-android.apk' | Set-Content -Encoding ascii 'deployment/android/SHA256SUMS.txt'
