param([string]$JavaHome = $env:JAVA_HOME)
$ErrorActionPreference = 'Stop'
if (-not $JavaHome) { throw 'Indica -JavaHome con un JDK 17 o superior (no JRE).' }
$classes = Join-Path $PSScriptRoot 'build\core-tests'
$main = Join-Path $PSScriptRoot 'app\src\main\java\cl\zerotouch\mobile'
$tests = Join-Path $PSScriptRoot 'tests'
New-Item -ItemType Directory -Force -Path $classes | Out-Null
# Solo las clases sin dependencias de Android (lógica pura y cliente HTTP de Java estándar).
$sources = @('GestureGate.java', 'GestureActions.java', 'MiniJson.java', 'ApiClient.java', 'ModeLoader.java') | ForEach-Object { Join-Path $main $_ }
$sources += @('GestureGateTest.java', 'GestureActionsTest.java', 'ModeLoaderTest.java') | ForEach-Object { Join-Path $tests $_ }
& (Join-Path $JavaHome 'bin\javac.exe') --release 17 -encoding UTF-8 -d $classes @sources
if ($LASTEXITCODE -ne 0) { throw 'Falló compilación de pruebas del núcleo.' }
& (Join-Path $JavaHome 'bin\java.exe') -cp $classes cl.zerotouch.mobile.GestureGateTest
if ($LASTEXITCODE -ne 0) { throw 'Fallaron pruebas del núcleo.' }
& (Join-Path $JavaHome 'bin\java.exe') -cp $classes cl.zerotouch.mobile.GestureActionsTest
if ($LASTEXITCODE -ne 0) { throw 'Fallaron pruebas de la lista de acciones.' }
& (Join-Path $JavaHome 'bin\java.exe') '-Dfile.encoding=UTF-8' -cp $classes cl.zerotouch.mobile.ModeLoaderTest (Join-Path $tests 'fixtures')
if ($LASTEXITCODE -ne 0) { throw 'Fallaron pruebas de lectura del modo desde la API.' }
