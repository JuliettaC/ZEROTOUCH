"""Banco con videos REALES de gestos: detector MediaPipe + intérprete del motor, fotograma a fotograma.

Cada video se nombra con lo que debería hacer (p. ej. «pasar pestaña.mp4»). Para cada uno se cuentan los
eventos que produce el intérprete y se comparan con los esperados; los eventos de otro gesto son falsos
positivos. Se procesa como el motor: imagen en espejo, 640 px de ancho, una mano, puntero ya armado (CONTROL).

No guarda imágenes ni puntos de la mano: solo imprime conteos. Los videos de la persona usuaria están fuera de
Git (carpeta «VIDEOS GESTOS», en .gitignore). Es una medida con pocos videos de UNA persona y UNA cámara:
sirve para comparar versiones del motor, no prueba precisión general.

Uso (desde motor-local):  .venv/Scripts/python.exe -m tools.banco_videos "../VIDEOS GESTOS" [--json '{"dragEnabled":false}']
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from collections import Counter
from pathlib import Path

import cv2

from motor_local.config import EngineConfig
from motor_local.detector import HandDetector
from motor_local.interpreter import GestureInterpreter

# Palabra clave del nombre del archivo -> eventos que ese video DEBE producir.
EXPECTED = [
    ("traerla de vuelta", {"RESTORE_WINDOW"}),  # antes que «minimizar»: su nombre también lo contiene
    ("regresar ventana", {"RESTORE_WINDOW"}),   # 23-11: antes que «win + tecla abajo» (su nombre lo contiene)
    ("win + tecla abajo", {"MINIMIZE_WINDOW"}),
    ("activar teclado", {"KEYBOARD"}),
    ("transcriptor", {"DICTATION"}),
    ("alt tab", {"ALT_TAB"}),
    ("arrastrar", {"START_DRAG"}),
    ("confirmar", {"CONFIRM"}),
    ("devolver pestana", {"PREV_TAB"}),
    ("click izquierdo", {"LEFT_CLICK"}),
    ("click derecho", {"RIGHT_CLICK"}),
    ("pausar", {"PAUSE", "RESUME"}),
    ("pasar pestana", {"NEXT_TAB"}),
    ("minimizar", {"MINIMIZE_WINDOW"}),
    ("scroll", {"SCROLL"}),
    ("mostrar escritorio", {"SHOW_DESKTOP"}),
    ("mover cursor", set()),
]
IGNORED = {"MOVE_CURSOR", "TRACKING_LOST", "END_DRAG"}
# Configuración pedida por la persona usuaria el 21-11-2026: sin arrastre, con gestos de ventana. Para los videos
# del 23-11 (mano izquierda, con arrastre y confirmar): --json '{"preferredHand": "LEFT", "drag": true, "thumbsUp": true}'
DEFAULTS = {"drag": False, "windowSwipe": True, "tabGestures": True}


def plain(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


def expected_for(name: str) -> set[str] | None:
    key = plain(name)
    for word, events in EXPECTED:
        if word in key:
            return events
    return None


def run_video(path: Path, config: EngineConfig, already_mirrored: bool = False) -> tuple[Counter, int, int]:
    detector = HandDetector(min_detection_confidence=0.5, min_tracking_confidence=0.5)
    interp = GestureInterpreter(config)
    interp.pointer_armed = True  # el banco mide gestos en CONTROL, no el armado
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
    counts: Counter = Counter()
    frames = with_hand = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        # La app voltea la webcam (vista de espejo). Un video de la cámara frontal del móvil YA viene en espejo:
        # voltearlo otra vez convierte la mano derecha en izquierda (23-11-2026). Con --ya-en-espejo se usa tal cual.
        frame = cv2.flip(frame, 1) if (config.mirror_camera and not already_mirrored) else frame
        frame = cv2.resize(frame, (640, int(640 * frame.shape[0] / frame.shape[1])))
        hand = detector.detect(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), preferred_hand=config.preferred_hand,
                               mirror_camera=config.mirror_camera, min_confidence=config.min_detection_confidence)
        with_hand += hand is not None
        for event in interp.process_frame(hand, now_ms=frames * 1000.0 / fps):
            if event.type not in IGNORED:
                counts[event.type] += 1
        frames += 1
    cap.release()
    detector.close()
    return counts, frames, with_hand


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("folder", type=Path)
    parser.add_argument("--json", default="{}", help="ajustes extra de EngineConfig (formato de la interfaz)")
    parser.add_argument("--ya-en-espejo", action="store_true", help="el video ya está en espejo (cámara frontal del móvil): no voltearlo")
    args = parser.parse_args(argv)
    config = EngineConfig.from_dict({**DEFAULTS, **json.loads(args.json)})
    videos = sorted(args.folder.glob("*.mp4"))
    if not videos:
        print(f"No hay videos .mp4 en {args.folder}")
        return 2
    hits = total = false_pos = 0
    print(f"{'video':48} {'esperado':28} {'obtenido'}")
    for path in videos:
        expected = expected_for(path.stem)
        counts, frames, with_hand = run_video(path, config, args.ya_en_espejo)
        got = ", ".join(f"{k}×{v}" for k, v in sorted(counts.items())) or "—"
        exp = "/".join(sorted(expected)) if expected else ("nada" if expected is not None else "?")
        extra = {k: v for k, v in counts.items() if expected is not None and k not in expected}
        ok = expected is not None and (bool(expected & counts.keys()) if expected else not counts) and not extra
        if expected is not None:
            total += 1
            hits += ok
            false_pos += sum(extra.values())
        print(f"{'✔' if ok else '✖'} {path.stem[:46]:46} {exp:28} {got}   (mano {with_hand}/{frames})")
    print(f"\nRESUMEN: {hits}/{total} videos con su gesto y sin eventos de otros gestos; falsos positivos: {false_pos}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
