"""Ajustes del 24-11-2026 (pedidos en vivo): arrastre más largo y desplazar con dos dedos SOSTENIDOS (hacia arriba
sube, hacia abajo baja; antes había que mover la mano o doblar los dedos). Manos sintéticas."""

from __future__ import annotations

from motor_local.config import EngineConfig
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import (
    EVENT_LEFT_CLICK,
    EVENT_MOVE_CURSOR,
    EVENT_RIGHT_CLICK,
    EVENT_SCROLL,
    EVENT_START_DRAG,
    SCROLL_HOLD_MS,
)
from tests.test_engine import armed, make_open_palm, make_two_fingers

FRAME_MS = 1000.0 / 15


def two_fingers(direction: str = "arriba", cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
    """Índice y medio extendidos y juntos, anular y meñique plegados, con las puntas hacia arriba, abajo o de lado."""
    lms = list(make_two_fingers(cx, cy).landmarks)
    if direction == "abajo":    # mano girada: la muñeca arriba y las puntas abajo
        lms = [Point3D(p.x, 2 * cy - p.y, p.z) for p in lms]
    elif direction == "lado":   # mano tumbada: las puntas hacia un costado
        lms = [Point3D(cx + (cy - p.y), cy + (p.x - cx), p.z) for p in lms]
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def run(hands, interp=None, start: float = 0.0):
    interp = interp or armed(EngineConfig.from_dict({"drag": False}))
    return [e for i, h in enumerate(hands) for e in interp.process_frame(h, now_ms=start + i * FRAME_MS)]


def frames(ms: float) -> int:
    return max(1, round(ms / FRAME_MS))


def scrolls(events) -> list[int]:
    return [e.payload["dy"] for e in events if e.type == EVENT_SCROLL]


OPEN = make_open_palm()


# --------------------------------------------------------------------------- desplazar con dos dedos sostenidos

def test_dos_dedos_hacia_arriba_sostenidos_suben_sin_parar() -> None:
    dys = scrolls(run([OPEN] * 5 + [two_fingers("arriba")] * frames(1500) + [OPEN] * 5))
    assert dys and all(d > 0 for d in dys), dys
    assert sum(dys) >= 8, f"1,5 s sostenidos deberían ser varias muescas: {dys}"


def test_el_mismo_gesto_hacia_abajo_baja_sin_parar() -> None:
    dys = scrolls(run([OPEN] * 5 + [two_fingers("abajo")] * frames(1500) + [OPEN] * 5))
    assert dys and all(d < 0 for d in dys), dys
    assert -sum(dys) >= 8, dys


def test_al_soltar_la_postura_se_detiene() -> None:
    events = run([OPEN] * 5 + [two_fingers("arriba")] * frames(1000) + [OPEN] * frames(1000))
    last_scroll = max(i for i, e in enumerate(events) if e.type == EVENT_SCROLL)
    assert not any(e.type == EVENT_SCROLL for e in events[last_scroll + 1:])


def test_una_postura_breve_no_desplaza() -> None:
    assert not scrolls(run([OPEN] * 5 + [two_fingers("arriba")] * frames(SCROLL_HOLD_MS - 100) + [OPEN] * 5))


def test_con_los_dedos_de_lado_no_desplaza() -> None:
    assert not scrolls(run([OPEN] * 5 + [two_fingers("lado")] * frames(1500) + [OPEN] * 5))


def test_cambiar_de_sentido_cambia_la_direccion_tras_la_espera() -> None:
    dys = scrolls(run([OPEN] * 5 + [two_fingers("arriba")] * frames(1000) + [two_fingers("abajo")] * frames(1000)))
    first_down = next(i for i, d in enumerate(dys) if d < 0)
    assert dys[:first_down] and all(d > 0 for d in dys[:first_down]), dys
    assert all(d < 0 for d in dys[first_down:]), dys


def test_el_cursor_no_se_mueve_mientras_se_desplaza() -> None:
    events = run([OPEN] * 5 + [two_fingers("arriba", cx=0.5 + 0.002 * i) for i in range(frames(1500))])
    after = events[next(i for i, e in enumerate(events) if e.type == EVENT_SCROLL):]
    assert not any(e.type == EVENT_MOVE_CURSOR for e in after)


def test_la_v_separada_es_pestana_nueva_y_no_desplaza() -> None:
    lms = list(two_fingers("arriba").landmarks)
    lms[8] = Point3D(lms[8].x - 0.06, lms[8].y)
    lms[12] = Point3D(lms[12].x + 0.06, lms[12].y)
    v = HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)
    assert not scrolls(run([OPEN] * 5 + [v] * frames(1500) + [OPEN] * 5))


def test_dos_dedos_no_hacen_clic_ni_clic_derecho_ni_arrastre() -> None:
    kinds = {e.type for e in run([OPEN] * 5 + ([two_fingers("arriba")] * frames(600) + [OPEN] * 6
                                              + [two_fingers("abajo")] * frames(600) + [OPEN] * 6))}
    assert not {EVENT_LEFT_CLICK, EVENT_RIGHT_CLICK, EVENT_START_DRAG} & kinds, kinds


def test_respeta_el_interruptor_de_desplazar() -> None:
    interp = armed(EngineConfig.from_dict({"drag": False, "scroll": False}))
    assert not scrolls(run([OPEN] * 5 + [two_fingers("arriba")] * frames(1500) + [OPEN] * 5, interp))


# --------------------------------------------------------------------------- arrastre

PINCH = make_open_palm(pinch_dist=0.02)


def test_el_arrastre_espera_0_9_s_de_pinza() -> None:
    assert EngineConfig().drag_hold_ms == 900
    assert EngineConfig.from_dict({}).drag_hold_ms == 900
    interp = armed(EngineConfig.from_dict({"drag": True}))
    held_700 = {e.type for e in run([OPEN] * 5 + [PINCH] * frames(700) + [OPEN] * 5, interp)}
    assert EVENT_START_DRAG not in held_700, "0,7 s de pinza ya no es arrastre (antes bastaban 0,6 s)"
    interp = armed(EngineConfig.from_dict({"drag": True}))
    held_1100 = {e.type for e in run([OPEN] * 5 + [PINCH] * frames(1100) + [OPEN] * 5, interp)}
    assert EVENT_START_DRAG in held_1100, "el video «arrastrar» sostiene la pinza ~1,1 s"


def test_un_clic_corto_sigue_siendo_clic() -> None:
    interp = armed(EngineConfig.from_dict({"drag": True}))
    kinds = [e.type for e in run([OPEN] * 5 + [PINCH] * frames(300) + [OPEN] * 5, interp)]
    assert kinds.count(EVENT_LEFT_CLICK) == 1 and EVENT_START_DRAG not in kinds, kinds
