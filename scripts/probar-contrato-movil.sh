#!/usr/bin/env bash
# Prueba con curl del contrato que usa la app Android (docs/movil-contrato.md) contra un backend real
# con una base TEMPORAL fuera del repositorio. Nunca toca la base real (no lee DATABASE_PATH de .env).
# Uso (Git Bash):  bash scripts/probar-contrato-movil.sh [JAVA_HOME]
# Con JAVA_HOME, además ejecuta el cliente Java del teléfono (ApiClient + ModeLoader) contra ese backend.
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT_PRUEBA:-3901}"
TMP="$(mktemp -d "${TEMP:-/tmp}/zt-movil-XXXX")"
OUT="$TMP/respuestas"; mkdir -p "$OUT"
win() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
url() { if command -v cygpath >/dev/null; then echo "file:///$(cygpath -m "$1")"; else echo "file://$1"; fi; }
DB="$(win "$TMP/movil.sqlite")"
node -e 'import(process.argv[1]).then(m=>m.openDatabase(process.argv[2],{initialize:true}).close())' "$(url "$R/backend/src/config/database.js")" "$DB"
PORT=$PORT HOST=127.0.0.1 LAN_HOST= DATABASE_PATH="$DB" NODE_ENV=test APP_ORIGIN=http://127.0.0.1:$PORT \
  SESSION_TTL_SECONDS=28800 MAIL_TRANSPORT=archivo node "$R/backend/src/server.js" > "$OUT/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
B=http://127.0.0.1:$PORT/api/v1
for _ in $(seq 1 50); do curl -s "$B/health" >/dev/null && break; sleep 0.2; done
J=(-s -H "Content-Type: application/json")   # sin Origin, como el teléfono
id() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).data[process.argv[2]])' "$1" "$2"; }

# Cuenta ficticia verificada con el correo de desarrollo (archivo .eml junto a la base temporal).
curl "${J[@]}" -X POST "$B/auth/registro" -d '{"nombre_usuario":"demo_movil","correo":"demo.movil@example.test","contrasena":"Receta-Demo-2026"}' > "$OUT/registro.json"
TOKEN=$(node -e 'import(process.argv[1]).then(async m=>console.log(await m.tokenFromOutbox(process.argv[2],"demo.movil@example.test")))' "$(url "$R/backend/test/helpers/correo.js")" "$(win "$TMP/correo-saliente")")
curl "${J[@]}" -X POST "$B/auth/verificacion" -d "{\"token\":\"$TOKEN\"}" > "$OUT/verificacion.json"

# 1. Login (teléfono)
curl "${J[@]}" -D "$OUT/login.headers" -c "$OUT/cookies.txt" -X POST "$B/auth/login" -d '{"nombre_usuario":"demo_movil","contrasena":"Receta-Demo-2026"}' > "$OUT/login.json"
CSRF=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).data.csrf_token)' "$OUT/login.json")
# Preparación que hace el ESCRITORIO (el teléfono no escribe): perfil, modo móvil con dos asignaciones y un modo de PC.
curl "${J[@]}" -b "$OUT/cookies.txt" -H "X-CSRF-Token: $CSRF" -X POST "$B/perfiles" -d '{"nombre":"Cocina"}' > "$OUT/perfil.json"
PID=$(id "$OUT/perfil.json" id)
# Cuerpo escrito en UTF-8 por Node y enviado desde archivo: en Windows, los argumentos de curl.exe pasan por
# la página de códigos ANSI y una «é» llegaría corrupta.
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({nombre:"Receta en el teléfono",categoria:"accesibilidad",plataforma:"movil",gestos:[{gesto_codigo:"pulgar_arriba",accion_codigo:"multimedia_play_pause",habilitado:true},{gesto_codigo:"pulgar_abajo",accion_codigo:"atras",habilitado:true}]}))' "$(win "$OUT/modo-movil.body.json")"
curl "${J[@]}" -b "$OUT/cookies.txt" -H "X-CSRF-Token: $CSRF" -X POST "$B/perfiles/$PID/modos" --data-binary @"$OUT/modo-movil.body.json" > "$OUT/modo-movil.json"
curl "${J[@]}" -b "$OUT/cookies.txt" -H "X-CSRF-Token: $CSRF" -X POST "$B/perfiles/$PID/modos" -d '{"nombre":"Oficina","categoria":"oficina"}' > "$OUT/modo-pc.json"
MID=$(id "$OUT/modo-movil.json" id)
# 2-4. Lecturas del teléfono
curl "${J[@]}" -b "$OUT/cookies.txt" "$B/perfiles?limite=100&offset=0" > "$OUT/perfiles.json"
curl "${J[@]}" -b "$OUT/cookies.txt" "$B/perfiles/$PID/modos?limite=100&offset=0" > "$OUT/modos.json"
curl "${J[@]}" -b "$OUT/cookies.txt" "$B/modos/$MID/gestos" > "$OUT/gestos.json"
# Errores que el teléfono debe tratar
echo "sin sesión: $(curl "${J[@]}" -o "$OUT/sin-sesion.json" -w '%{http_code}' "$B/perfiles") $(cat "$OUT/sin-sesion.json")"
echo "clave mala: $(curl "${J[@]}" -o "$OUT/login-malo.json" -w '%{http_code}' -X POST "$B/auth/login" -d '{"nombre_usuario":"demo_movil","contrasena":"incorrecta-123"}') $(cat "$OUT/login-malo.json")"
grep -i "^set-cookie" "$OUT/login.headers" | sed -E 's/zt_session=[^;]+/zt_session=<token>/'
node -e 'const g=JSON.parse(require("fs").readFileSync(process.argv[1])).data;console.log("modo:",g.modo.nombre,g.modo.plataforma,"· gestos:",g.gestos.length);for(const x of g.gestos)if(["dos_dedos","pulgar_arriba","pulgar_abajo","modo_precision"].includes(x.gesto_codigo))console.log(" ",x.gesto_codigo,"→",x.accion_codigo,x.habilitado,"v"+x.asignacion_version)' "$OUT/gestos.json"

if [ -n "${1:-}" ]; then
  CORE="$R/android/build/core-tests"
  "$1/bin/javac" --release 17 -encoding UTF-8 -d "$(win "$CORE")" "$(win "$R/android/app/src/main/java/cl/zerotouch/mobile/MiniJson.java")" \
    "$(win "$R/android/app/src/main/java/cl/zerotouch/mobile/ApiClient.java")" "$(win "$R/android/app/src/main/java/cl/zerotouch/mobile/ModeLoader.java")" \
    "$(win "$R/android/app/src/main/java/cl/zerotouch/mobile/GestureActions.java")" "$(win "$R/android/tests/RealApiCheck.java")"
  "$1/bin/java" -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp "$(win "$CORE")" cl.zerotouch.mobile.RealApiCheck "http://127.0.0.1:$PORT" demo_movil Receta-Demo-2026
fi
echo "Respuestas en $OUT (base temporal; bórrala cuando quieras)."
