# MR · Chronicle — comparte tu Foundry con una dirección HTTPS gratuita (túnel de Cloudflare).
# Se lanza con doble clic en "Compartir Foundry (Windows).bat".
#
# Los jugadores necesitan HTTPS para poder grabar. Esto da una dirección
# https://algo.trycloudflare.com que lleva a tu Foundry, sin dominio, sin abrir puertos del
# router y sin que los jugadores instalen nada. Mientras esta ventana esté abierta, funciona.
$ErrorActionPreference = "Continue"   # cloudflared escribe su registro por stderr: no es un error
$ProgressPreference = "SilentlyContinue"

$CloudflaredVersion = "2026.9.3"
$Bin = Join-Path $env:USERPROFILE ".cache\mr-chronicle\bin"
New-Item -ItemType Directory -Force $Bin | Out-Null
$Cf = if ($env:MRC_CLOUDFLARED) { $env:MRC_CLOUDFLARED } else { Join-Path $Bin "cloudflared.exe" }

if (-not (Test-Path $Cf)) {
  Write-Host "> Descargando cloudflared $CloudflaredVersion (solo la primera vez)..."
  Invoke-WebRequest -UseBasicParsing -OutFile $Cf `
    "https://github.com/cloudflare/cloudflared/releases/download/$CloudflaredVersion/cloudflared-windows-amd64.exe"
}

$Puerto = if ($args[0]) { $args[0] } else { Read-Host "En que puerto esta Foundry? [30000]" }
if (-not $Puerto) { $Puerto = "30000" }

try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://localhost:$Puerto" | Out-Null }
catch {
  if (-not $_.Exception.Response) {
    Write-Host "No responde nada en http://localhost:$Puerto. Arranca Foundry primero (y lanza el mundo)." -ForegroundColor Red
    Read-Host "Pulsa Intro para cerrar" | Out-Null
    exit 1
  }
}

Write-Host ""
Write-Host "> Abriendo el tunel hacia http://localhost:$Puerto ... (tarda unos segundos)"
Write-Host "  Deja esta ventana abierta durante toda la partida. Para cerrarlo: Ctrl+C o cierra la ventana."
Write-Host ""
& $Cf tunnel --no-autoupdate --url "http://localhost:$Puerto" 2>&1 | ForEach-Object {
  $linea = "$_"
  if ($linea -match "(https://[a-z0-9-]+\.trycloudflare\.com)") {
    Write-Host ""
    Write-Host "=================================================================="
    Write-Host "  Pasa esta direccion a tus jugadores (y usala tu tambien):"
    Write-Host ""
    Write-Host "      $($Matches[1])" -ForegroundColor Green
    Write-Host ""
    Write-Host "  IMPORTANTE: cualquiera con la direccion puede llegar a tu Foundry."
    Write-Host "  Pon contrasena a los usuarios, sobre todo al master."
    Write-Host "  La direccion cambia cada vez que abres el tunel."
    Write-Host "=================================================================="
    Write-Host ""
  }
  elseif ($linea -match "ERR|error") { Write-Host $linea }
}
