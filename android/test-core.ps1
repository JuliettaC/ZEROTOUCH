param([string]$JavaHome = $env:JAVA_HOME)
$ErrorActionPreference = 'Stop'
if (-not $JavaHome) { throw 'Indica -JavaHome con un JDK 17 o superior (no JRE).' }
$classes = Join-Path $PSScriptRoot 'build\core-tests'
New-Item -ItemType Directory -Force -Path $classes | Out-Null
& (Join-Path $JavaHome 'bin\javac.exe') --release 17 -encoding UTF-8 -d $classes (Join-Path $PSScriptRoot 'app\src\main\java\cl\zerotouch\mobile\GestureGate.java') (Join-Path $PSScriptRoot 'tests\GestureGateTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Falló compilación de pruebas del núcleo.' }
& (Join-Path $JavaHome 'bin\java.exe') -cp $classes cl.zerotouch.mobile.GestureGateTest
if ($LASTEXITCODE -ne 0) { throw 'Fallaron pruebas del núcleo.' }
