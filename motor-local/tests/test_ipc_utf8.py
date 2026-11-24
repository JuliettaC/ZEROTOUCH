"""El texto del teclado llega por stdin en UTF-8 desde el puente Rust y debe escribirse tal cual (23-11-2026: con
`sys.stdin` en texto, Windows lo decodificaba como cp1252 y «cómo» salía «cÃ³mo»)."""

from __future__ import annotations

import io
import json
import queue
import subprocess
import sys
import threading
from pathlib import Path

from motor_local.main import stdin_reader

TEXT = "cómo hacer receta de ñoquis con limón y pingüino"


def test_el_lector_decodifica_utf8_aunque_la_consola_sea_cp1252() -> None:
    line = json.dumps({"cmd": "TYPE_TEXT", "text": TEXT}, ensure_ascii=False) + "\n"
    q: "queue.Queue[dict]" = queue.Queue()
    stdin_reader(q, threading.Event(), source=io.BytesIO(line.encode("utf-8")))
    assert q.get_nowait()["text"] == TEXT
    assert q.get_nowait()["cmd"] == "STOP"


def test_proceso_real_con_tuberia_lee_utf8() -> None:
    """Igual que el puente: un proceso hijo con stdin por tubería y bytes UTF-8 sin escapar."""
    root = Path(__file__).resolve().parents[1]
    code = (
        "import queue, threading, json, sys\n"
        "from motor_local.main import stdin_reader\n"
        "q = queue.Queue(); stdin_reader(q, threading.Event())\n"
        "sys.stdout.write(json.dumps(q.get_nowait(), ensure_ascii=True))\n"
    )
    line = json.dumps({"cmd": "TYPE_TEXT", "text": TEXT}, ensure_ascii=False) + "\n"
    out = subprocess.run(
        [sys.executable, "-c", code], input=line.encode("utf-8"), capture_output=True, cwd=root, timeout=60,
        env={"PYTHONIOENCODING": "cp1252", "SYSTEMROOT": __import__("os").environ.get("SYSTEMROOT", "")},
    )
    assert out.returncode == 0, out.stderr.decode("utf-8", "replace")
    assert json.loads(out.stdout)["text"] == TEXT
