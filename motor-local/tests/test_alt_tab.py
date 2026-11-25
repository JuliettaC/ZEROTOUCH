"""Alt+Tab (23-11-2026, video «alt tab»): índice, medio y anular bajan rápido respecto de sus nudillos con el meñique
quieto y vuelven antes de 400 ms. (Antes este archivo probaba también el golpe de muñeca, retirado el 24-11-2026.)"""

from __future__ import annotations

from motor_local.config import EngineConfig
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import EVENT_ALT_TAB
from tests.test_engine import armed, make_open_palm

FRAME_MS = 1000.0 / 15


def flick_hand(dy: float, fingers=(8, 12, 16, 20), cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
    """Mano abierta con las puntas desplazadas `dy` (positivo = hacia abajo) respecto de su posición de reposo."""
    lms = list(make_open_palm(cx, cy, pinch_dist=0.14).landmarks)
    for tip in fingers:
        lms[tip] = Point3D(lms[tip].x, lms[tip].y + dy)
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def run(interp, hands, start: float = 0.0) -> list[str]:
    return [e.type for i, h in enumerate(hands) for e in interp.process_frame(h, now_ms=start + i * FRAME_MS)]


def config(**extra) -> EngineConfig:
    return EngineConfig.from_dict({"drag": False, **extra})


REST = [flick_hand(0.0)] * 4
DOWN_AND_BACK = REST + [flick_hand(0.07), flick_hand(0.0)] + REST


def test_alt_tab_tres_dedos_rapidos_con_el_menique_arriba() -> None:
    """23-11-2026 (video «alt tab»): índice, medio y anular bajan y vuelven en < 400 ms con el meñique quieto."""
    three = (8, 12, 16)
    quick = [flick_hand(0.0, fingers=three)] * 4 + [flick_hand(0.07, fingers=three), flick_hand(0.0, fingers=three)] + [flick_hand(0.0, fingers=three)] * 4
    events = run(armed(config()), quick)
    assert events.count(EVENT_ALT_TAB) == 1, events
    # Sostener los tres dedos doblados no es el Alt+Tab directo.
    slow = [flick_hand(0.0, fingers=three)] * 4 + [flick_hand(0.07, fingers=three)] * 8 + [flick_hand(0.0, fingers=three)] * 4
    assert EVENT_ALT_TAB not in run(armed(config()), slow)
    # Con los cuatro dedos (también se mueve el meñique) no es Alt+Tab.
    assert EVENT_ALT_TAB not in run(armed(config()), DOWN_AND_BACK)
    assert EVENT_ALT_TAB not in run(armed(config(altTab=False)), quick)
