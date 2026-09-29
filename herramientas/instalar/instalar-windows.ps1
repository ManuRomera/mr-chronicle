# MR · Chronicle — instala lo necesario para procesar sesiones en Windows (x64).
# Se lanza con doble clic en "Instalar en Windows.bat". No necesita permisos de administrador:
# todo va a %USERPROFILE%\.cache\mr-chronicle.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # sin barra de progreso, Invoke-WebRequest va mucho más rápido

$WhisperVersion = "v1.9.2"
$DeepFilterVersion = "0.5.6"
$ModeloUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
$Casa = Join-Path $env:USERPROFILE ".cache\mr-chronicle"
$Bin = Join-Path $Casa "bin"
$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("mr-chronicle-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $Bin, $Tmp | Out-Null

function Bajar($Url, $Destino) {
  Write-Host "  descargando $(Split-Path $Url -Leaf)"
  Invoke-WebRequest -Uri $Url -OutFile $Destino -UseBasicParsing
}
function Descomprimir($Zip) {
  $Destino = Join-Path $Tmp ([guid]::NewGuid())
  Expand-Archive -Path $Zip -DestinationPath $Destino -Force
  return $Destino
}

try {
  Write-Host "== MR · Chronicle: herramientas de postproduccion para Windows =="

  Write-Host "> ffmpeg"
  if (Test-Path "$Bin\ffmpeg.exe") { Write-Host "  ya estaba" } else {
    Bajar "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" "$Tmp\ffmpeg.zip"
    $d = Descomprimir "$Tmp\ffmpeg.zip"
    Copy-Item (Get-ChildItem $d -Recurse -Filter ffmpeg.exe | Select-Object -First 1).FullName $Bin
  }

  Write-Host "> Node.js"
  if (Test-Path "$Bin\node\node.exe") { Write-Host "  ya estaba" } else {
    # Invoke-RestMethod devuelve la lista como un solo objeto en la tubería: se recorre con foreach.
    $Version = $null
    foreach ($v in (Invoke-RestMethod "https://nodejs.org/dist/index.json")) { if ($v.lts) { $Version = $v.version; break } }
    Bajar "https://nodejs.org/dist/$Version/node-$Version-win-x64.zip" "$Tmp\node.zip"
    $d = Descomprimir "$Tmp\node.zip"
    Move-Item (Get-ChildItem $d -Directory | Select-Object -First 1).FullName "$Bin\node"
  }

  Write-Host "> whisper.cpp $WhisperVersion"
  if (Test-Path "$Bin\whisper-cli.exe") { Write-Host "  ya estaba" } else {
    # Con tarjeta NVIDIA, la version con CUDA transcribe muchisimo mas rapido (pero ocupa 640 MB).
    $Paquete = if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { "whisper-cublas-12.4.0-bin-x64.zip" } else { "whisper-bin-x64.zip" }
    Bajar "https://github.com/ggml-org/whisper.cpp/releases/download/$WhisperVersion/$Paquete" "$Tmp\whisper.zip"
    $d = Descomprimir "$Tmp\whisper.zip"
    $Release = (Get-ChildItem $d -Recurse -Filter whisper-cli.exe | Select-Object -First 1).DirectoryName
    Copy-Item "$Release\*" $Bin -Recurse -Force
  }

  Write-Host "> DeepFilterNet $DeepFilterVersion"
  if (Test-Path "$Bin\deep-filter.exe") { Write-Host "  ya estaba" } else {
    Bajar "https://github.com/Rikorose/DeepFilterNet/releases/download/v$DeepFilterVersion/deep-filter-$DeepFilterVersion-x86_64-pc-windows-msvc.exe" "$Bin\deep-filter.exe"
  }

  Write-Host "> Modelo de Whisper large-v3-turbo (1,6 GB; si se corta, vuelve a abrir el instalador y sigue donde iba)"
  $Modelo = Join-Path $Casa "ggml-large-v3-turbo.bin"
  if ($env:MRC_SIN_MODELO) { Write-Host "  omitido (MRC_SIN_MODELO)" }
  elseif (Test-Path $Modelo) { Write-Host "  ya estaba" }
  else {
    # curl.exe viene con Windows 10 y 11, y sabe continuar una descarga cortada.
    & curl.exe -fL -C - -o "$Modelo.parte" $ModeloUrl
    if ($LASTEXITCODE -ne 0) { throw "No se pudo descargar el modelo." }
    Move-Item "$Modelo.parte" $Modelo
  }

  Write-Host ""
  if ($env:MRC_SIN_COMPROBAR) { Write-Host "(comprobacion omitida)" } else {
    & "$Bin\node\node.exe" (Join-Path $PSScriptRoot "..\post\mr-chronicle-post.mjs") --comprobar
    if ($LASTEXITCODE -eq 0) { Write-Host ""; Write-Host "Listo. Para procesar una sesion, abre 'Procesar sesion (Windows).bat'." }
  }
}
catch {
  Write-Host ""
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Vuelve a abrir el instalador: lo que ya se instalo no se repite."
}
finally {
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not $env:MRC_SIN_PAUSA) { Read-Host "Pulsa Intro para cerrar" | Out-Null }
