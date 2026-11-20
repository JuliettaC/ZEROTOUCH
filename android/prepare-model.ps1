$ErrorActionPreference = 'Stop'
$assetDirectory = Join-Path $PSScriptRoot 'app\src\main\assets'
$destination = Join-Path $assetDirectory 'gesture_recognizer.task'
$expected = '97952348CF6A6A4915C2EA1496B4B37EBABC50CBBF80571435643C455F2B0482'
if (Test-Path -LiteralPath $destination) {
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $expected) { throw 'Modelo existente diferente; no se sobrescribe.' }
    Write-Output 'Modelo existente verificado.'
    exit 0
}
New-Item -ItemType Directory -Force -Path $assetDirectory | Out-Null
Write-Output 'Descarga explícita de modelo MediaPipe versión 1: 8.37 MB. Sin instalación en teléfono.'
Invoke-WebRequest -Uri 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task' -OutFile $destination -TimeoutSec 90
if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $expected) { throw 'Descarga no válida. No compilar ni utilizar este modelo.' }
Write-Output 'Modelo verificado. Procesamiento posterior sin red.'
