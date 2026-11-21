"""Golpe de muñeca para ventanas (21-11-2026, medido en videos reales): las cuatro puntas bajan (o suben) rápido
respecto de sus nudillos y vuelven antes de 0,5 s. Bajar y volver minimiza; subir y volver restaura."""

from __future__ import annotations

from motor_local.config import EngineConfig
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import EVENT_MINIMIZE_WINDOW, EVENT_RESTORE_WINDOW, FLICK_OPPOSITE_MS
from tests.test_engine import armed, make_closed_fist, make_open_palm

FRAME_MS = 1000.0 / 15
WINDOW_EVENTS = {EVENT_MINIMIZE_WINDOW, EVENT_RESTORE_WINDOW}


def flick_hand(dy: float, fingers=(8, 12, 16, 20), cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
    """Mano abierta con las puntas desplazadas `dy` (positivo = hacia abajo) respecto de su posición de reposo."""
    lms = list(make_open_palm(cx, cy, pinch_dist=0.14).landmarks)
    for tip in fingers:
        lms[tip] = Point3D(lms[tip].x, lms[tip].y + dy)
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def run(interp, hands, start: float = 0.0) -> list[str]:
    return [e.type for i, h in enumerate(hands) for e in interp.process_frame(h, now_ms=start + i * FRAME_MS)]


def config(**extra) -> EngineConfig:
    return EngineConfig.from_dict({"windowSwipe": True, "drag": False, **extra})


REST = [flick_hand(0.0)] * 4
DOWN_AND_BACK = REST + [flick_hand(0.07), flick_hand(0.0)] + REST
UP_AND_BACK = REST + [flick_hand(-0.07), flick_hand(0.0)] + REST


def test_bajar_los_dedos_y_volver_minimiza_una_vez() -> None:
    events = run(armed(config()), DOWN_AND_BACK)
    assert events.count(EVENT_MINIMIZE_WINDOW) == 1 and EVENT_RESTORE_WINDOW not in events


def test_subir_los_dedos_y_volver_restaura_una_vez() -> None:
    events = run(armed(config()), UP_AND_BACK)
    assert events.count(EVENT_RESTORE_WINDOW) == 1 and EVENT_MINIMIZE_WINDOW not in events


def test_bajar_y_quedarse_no_es_un_golpe() -> None:
    events = run(armed(config()), REST + [flick_hand(0.07)] * 12)
    assert not WINDOW_EVENTS & set(events), "sin vuelta antes de 0,5 s (como abrir la mano y sostenerla)"


def test_la_vuelta_tardia_no_cuenta() -> None:
    events = run(armed(config()), REST + [flick_hand(0.07)] * 9 + [flick_hand(0.0)] + REST)
    assert not WINDOW_EVENTS & set(events)


def test_solo_indice_y_medio_es_scroll_no_ventana() -> None:
    frames = REST + [flick_hand(0.07, fingers=(8, 12)), flick_hand(0.0)] * 3 + REST
    assert not WINDOW_EVENTS & set(run(armed(config()), frames))


def test_mover_toda_la_mano_no_es_un_golpe() -> None:
    # Toda la mano baja y sube rápido (puntas fijas respecto de los nudillos): eso es mover el cursor.
    frames = [flick_hand(0.0, cy=0.5 + d) for d in (0, 0, 0, 0.07, 0.0, 0.07, 0.0)]
    assert not WINDOW_EVENTS & set(run(armed(config()), frames))


def test_brazo_rapido_con_la_muneca_que_se_retrasa_no_es_un_golpe() -> None:
    # Mover el cursor rápido hacia abajo y volver: la mano entera se desplaza y, además, los dedos se quedan
    # atrás (las puntas se mueven respecto de los nudillos). La mano no está quieta: no es un golpe de muñeca.
    frames = [flick_hand(0.0)] * 4 + [flick_hand(0.07, cy=0.62), flick_hand(0.0, cy=0.5)] + [flick_hand(0.0)] * 4
    assert not WINDOW_EVENTS & set(run(armed(config()), frames))


def test_respeta_el_interruptor() -> None:
    interp = armed(EngineConfig.from_dict({"windowSwipe": False}))
    assert not WINDOW_EVENTS & set(run(interp, DOWN_AND_BACK + UP_AND_BACK))


def test_el_rebote_tras_minimizar_no_restaura_enseguida() -> None:
    interp = armed(config())
    events = run(interp, DOWN_AND_BACK + UP_AND_BACK)          # ~1,1 s entre los dos golpes
    assert events.count(EVENT_MINIMIZE_WINDOW) == 1 and EVENT_RESTORE_WINDOW not in events
    later = run(interp, [flick_hand(0.0)] * 30 + UP_AND_BACK, start=len(DOWN_AND_BACK + UP_AND_BACK) * FRAME_MS)
    assert FLICK_OPPOSITE_MS < 30 * FRAME_MS and later.count(EVENT_RESTORE_WINDOW) == 1


def test_abrir_el_puno_no_restaura() -> None:
    interp = armed(config())
    events = run(interp, [make_closed_fist(0.5, 0.5)] * 3)
    events += run(interp, [flick_hand(-0.07), flick_hand(0.0)] + REST, start=3 * FRAME_MS)
    assert not WINDOW_EVENTS & set(events)
