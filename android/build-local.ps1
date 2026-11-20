param(
    [Parameter(Mandatory = $true)][string]$GradleExecutable,
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$SdkHome = $env:ANDROID_HOME,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
if (-not $JavaHome -or -not $SdkHome) { throw 'Indica JavaHome (JDK 17+) y SdkHome (SDK 36 instalado).' }
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $SdkHome
$env:GRADLE_USER_HOME = Join-Path $env:TEMP 'zt-gradle'
$buildRoot = Join-Path $env:TEMP 'zt-build'
$projectCache = Join-Path $env:TEMP 'zt-project'
$arguments = @('-p', $PSScriptRoot, '--no-daemon', '--project-cache-dir', $projectCache, "-PztBuildRoot=$buildRoot")
if ($Offline) { $arguments += '--offline' }
if ($env:https_proxy) {
    $proxyUri = [uri]$env:https_proxy
    if ($proxyUri.UserInfo) { throw 'Configura el proxy autenticado fuera del script; no se guardan credenciales.' }
    $arguments += @("-Dhttps.proxyHost=$($proxyUri.Host)", "-Dhttps.proxyPort=$($proxyUri.Port)", "-Dhttp.proxyHost=$($proxyUri.Host)", "-Dhttp.proxyPort=$($proxyUri.Port)")
}
$arguments += ':app:assembleDebug'
& $GradleExecutable @arguments
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación Android; no se actualiza el APK entregable.' }
$apk = Join-Path $buildRoot 'app\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw 'Gradle terminó sin APK en la ruta esperada.' }
$output = Join-Path $PSScriptRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $output | Out-Null
Copy-Item -LiteralPath $apk -Destination (Join-Path $output 'zerotouch-android-debug.apk')
Get-FileHash -LiteralPath (Join-Path $output 'zerotouch-android-debug.apk') -Algorithm SHA256
