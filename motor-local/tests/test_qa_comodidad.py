"""Regresiones del QA de comodidad y reconocimiento (19-11-2026). Cada prueba fija un defecto medido con
el banco sintético (motor-local/tools/banco_qa.py). Todo sintético: sin cámara ni sistema operativo."""

from __future__ import annotations

import math

from motor_local.config import EngineConfig
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import (
    EVENT_LEFT_CLICK,
    EVENT_MOVE_CURSOR,
    EVENT_PAUSE,
    EVENT_START_DRAG,
    POINTER_DISARM_MS,
    GestureInterpreter,
    pointer_gain,
)

from tests.test_engine import armed, make_closed_fist, make_open_palm

FRAME = 33.0


def _run(interp, frames):
    out = []
    for hand, t in frames:
        out.extend(interp.process_frame(hand, now_ms=t))
    return out


def _types(events):
    return [e.type for e in events]


def _cursor(events):
    moves = [e for e in events if e.type == EVENT_MOVE_CURSOR]
    return (moves[-1].payload["x"], moves[-1].payload["y"]) if moves else None


def _closing_hand(cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
    """Mano cerrándose: índice enrollado con el pulgar encima, meñique aún extendido (todavía no es puño)."""
    lms = list(make_closed_fist(cx, cy).landmarks)
    lms[18] = Point3D(cx, cy - 0.05)
    lms[20] = Point3D(cx, cy - 0.10)
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def test_cerrar_el_puno_pausa_y_no_arrastra() -> None:
    # Antes: al cerrar la mano el pulgar toca el índice enrollado, eso confirmaba una pinza y empezaba un arrastre.
    interp = armed(EngineConfig(pause_hold_ms=450))
    seen = _types(_run(interp, [(_closing_hand(), float(t)) for t in range(0, 600, 33)]))
    assert EVENT_START_DRAG not in seen and EVENT_LEFT_CLICK not in seen
    seen = _types(_run(interp, [(make_closed_fist(), float(t)) for t in range(600, 1800, 33)]))
    assert EVENT_START_DRAG not in seen and EVENT_LEFT_CLICK not in seen
    assert EVENT_PAUSE in seen


def test_un_cuadro_sin_mano_no_reinicia_el_puno() -> None:
    interp = armed(EngineConfig(pause_hold_ms=450))
    frames = [(make_closed_fist(), float(t)) for t in range(0, 700, 33)]
    frames[6] = (None, frames[6][1])     # MediaPipe pierde la mano en cuadros sueltos
    frames[11] = (None, frames[11][1])
    assert EVENT_PAUSE in _types(_run(interp, frames)), "un cuadro perdido no debe reiniciar el puño"


def test_un_cuadro_dudoso_no_reinicia_el_puno() -> None:
    interp = armed(EngineConfig(pause_hold_ms=450))
    frames = [(make_closed_fist(), float(t)) for t in range(0, 700, 33)]
    frames[6] = (_closing_hand(), frames[6][1])    # un cuadro en que el meñique parece suelto
    frames[11] = (_closing_hand(), frames[11][1])
    assert EVENT_PAUSE in _types(_run(interp, frames)), "un cuadro dudoso no debe reiniciar el puño"


def test_la_pausa_cuenta_desde_que_se_forma_el_puno() -> None:
    interp = armed(EngineConfig(pause_hold_ms=450))
    paused_at = None
    for t in range(0, 1500, 33):
        if EVENT_PAUSE in _types(interp.process_frame(make_closed_fist(), now_ms=float(t))):
            paused_at = t
            break
    assert paused_at is not None and paused_at <= 450 + 2 * FRAME, f"pausó a los {paused_at} ms (antes ~750)"


def test_pinza_con_la_mano_lejos_hace_clic_y_suelta() -> None:
    # Antes: el umbral absoluto (pensado para palma 0,15) mantenía la pinza con la mano lejos: clic -> arrastre.
    interp = armed(EngineConfig(click_cooldown_ms=0))
    frames = [(make_open_palm(0.5, 0.5, pinch_dist=0.14, scale=0.45), float(t)) for t in range(0, 200, 33)]
    frames += [(make_open_palm(0.5, 0.5, pinch_dist=0.01, scale=0.45), float(t)) for t in range(200, 330, 33)]
    frames += [(make_open_palm(0.5, 0.5, pinch_dist=0.09, scale=0.45), float(t)) for t in range(330, 900, 33)]
    seen = _types(_run(interp, frames))
    assert seen.count(EVENT_LEFT_CLICK) == 1
    assert EVENT_START_DRAG not in seen


def test_al_armar_la_mano_queda_en_el_centro_de_la_pantalla() -> None:
    # Antes: con la mano a la altura natural frente a la webcam, el cursor quedaba pegado al borde superior.
    interp = GestureInterpreter(EngineConfig())
    events = _run(interp, [(make_open_palm(0.5, 0.33, pinch_dist=0.14), float(t)) for t in range(0, 700, 33)])
    assert interp.pointer_armed
    x, y = _cursor(events)
    assert abs(x - 0.5) < 0.05 and abs(y - 0.5) < 0.05, (x, y)


def test_descansar_la_mano_unos_segundos_no_desarma() -> None:
    interp = armed()
    _run(interp, [(None, 100.0 + 100.0 * i) for i in range(50)])   # 5 s sin mano
    assert interp.pointer_armed
    assert POINTER_DISARM_MS >= 8000.0


def _sway(cx: float, cy: float, t: float, amp: float) -> HandLandmarks:
    hand = make_open_palm(cx + amp * math.sin(t / 90.0), cy + amp * math.cos(t / 130.0), pinch_dist=0.14)
    return hand


def _still_drift_and_sweep(accel: bool) -> tuple[float, float]:
    interp = armed(EngineConfig(pointer_acceleration=accel))
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 100.0 + FRAME * i) for i in range(15)])
    start = interp._smoothed_x, interp._smoothed_y
    # Balanceo de ±0,004 de imagen (≈ 2-3 px de cámara): una mano sostenida en el aire.
    _run(interp, [(_sway(0.5, 0.5, 600.0 + FRAME * i, 0.004), 600.0 + FRAME * i) for i in range(60)])
    drift = math.hypot(interp._smoothed_x - start[0], interp._smoothed_y - start[1])
    # Barrido rápido de 0,12 de imagen en ~0,25 s.
    x0 = interp._smoothed_x
    _run(interp, [(make_open_palm(0.5 + 0.015 * i, 0.5, pinch_dist=0.14), 2700.0 + FRAME * i) for i in range(9)])
    _run(interp, [(make_open_palm(0.62, 0.5, pinch_dist=0.14), 3000.0 + FRAME * i) for i in range(10)])
    return drift, interp._smoothed_x - x0


def test_aceleracion_menos_temblor_y_mas_alcance_con_menos_brazo() -> None:
    drift_on, sweep_on = _still_drift_and_sweep(True)
    drift_off, sweep_off = _still_drift_and_sweep(False)
    assert sweep_on > sweep_off * 1.5, f"el barrido rápido debe llegar más lejos ({sweep_on:.2f} vs {sweep_off:.2f})"
    assert drift_on <= drift_off + 1e-9, f"la mano quieta no debe temblar más ({drift_on:.4f} vs {drift_off:.4f})"


def test_ganancia_de_aceleracion_monotona_y_mayor_que_uno_en_rapido() -> None:
    gains = [pointer_gain(v / 100) for v in range(0, 200)]
    assert all(b >= a for a, b in zip(gains, gains[1:]))
    assert gains[0] < 1.0 < gains[-1]
    assert pointer_gain(2.0) >= 2.0, "la 1ª versión nunca superaba ×1: no se llegaba a las esquinas"


def test_pinza_con_el_indice_muy_doblado_hace_clic() -> None:
    # 2ª iteración: «índice enrollado» solo no basta para descartar la pinza; con la palma hacia la cámara el
    # índice doblado de una pinza real se proyecta cerca del nudillo. Solo se descarta si también se cierran
    # medio y anular (puño en formación).
    interp = armed(EngineConfig(click_cooldown_ms=0))
    def pinch(closed: bool) -> HandLandmarks:
        lms = list(make_open_palm(0.5, 0.5, pinch_dist=0.14).landmarks)
        lms[6], lms[7], lms[8] = Point3D(0.46, 0.47), Point3D(0.47, 0.52), Point3D(0.48, 0.55)  # punta bajo el nudillo
        lms[4] = Point3D(0.485, 0.55) if closed else Point3D(0.60, 0.40)
        return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)
    frames = [(pinch(False), 100.0 + FRAME * i) for i in range(5)]
    frames += [(pinch(True), 300.0 + FRAME * i) for i in range(4)]
    frames += [(pinch(False), 450.0 + FRAME * i) for i in range(6)]
    seen = _types(_run(interp, frames))
    assert seen.count(EVENT_LEFT_CLICK) == 1


def test_el_clic_cae_donde_apuntaba_antes_de_juntar_los_dedos() -> None:
    interp = armed(EngineConfig(click_cooldown_ms=0, pointer_acceleration=False, stability=0))
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 100.0 + FRAME * i) for i in range(10)])
    aimed = (interp._smoothed_x, interp._smoothed_y)
    # Al juntar los dedos la mano se desplaza un poco (el ancla se mueve) justo antes de la pinza.
    _run(interp, [(make_open_palm(0.5 + 0.004 * i, 0.5, pinch_dist=0.14 - 0.02 * i), 430.0 + FRAME * i) for i in range(1, 4)])
    drifted = (interp._smoothed_x, interp._smoothed_y)
    events = _run(interp, [(make_open_palm(0.512, 0.5, pinch_dist=0.01), 560.0 + FRAME * i) for i in range(3)])
    at_click = (interp._smoothed_x, interp._smoothed_y)
    events += _run(interp, [(make_open_palm(0.512, 0.5, pinch_dist=0.14), 660.0 + FRAME * i) for i in range(3)])
    assert EVENT_LEFT_CLICK in _types(events)
    assert math.hypot(drifted[0] - aimed[0], drifted[1] - aimed[1]) > 0.01, "el escenario debe desplazar el cursor"
    assert math.hypot(at_click[0] - aimed[0], at_click[1] - aimed[1]) < 0.6 * math.hypot(drifted[0] - aimed[0], drifted[1] - aimed[1]), (aimed, drifted, at_click)


def test_aceleracion_del_cursor_viene_encendida() -> None:
    # (El barrido vertical de ventanas que esta prueba fijaba apagado se retiró el 24-11-2026.)
    assert "windowSwipe" not in EngineConfig.from_dict({}).to_dict()
    assert EngineConfig.from_dict({}).to_dict()["pointerAcceleration"] is True


def test_con_la_mano_fuera_del_area_activa_el_cursor_sigue_respondiendo() -> None:
    # 2ª iteración: la posición se recortaba a [0, 1] antes de la aceleración; con la mano fuera del área activa
    # el cursor se congelaba hasta que volvía («pegajoso», «hay que mover mucho el brazo»).
    interp = armed(EngineConfig(pointer_acceleration=True))
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 100.0 + FRAME * i) for i in range(10)])
    _run(interp, [(make_open_palm(0.5 + 0.05 * i, 0.5, pinch_dist=0.14), 500.0 + FRAME * i) for i in range(9)])  # hasta 0,9
    _run(interp, [(make_open_palm(0.9, 0.5, pinch_dist=0.14), 800.0 + FRAME * i) for i in range(8)])
    at_edge = interp._smoothed_x
    _run(interp, [(make_open_palm(0.9 - 0.01 * i, 0.5, pinch_dist=0.14), 1100.0 + FRAME * i) for i in range(11)])  # vuelve a 0,8
    assert interp._smoothed_x < at_edge - 0.05, (at_edge, interp._smoothed_x)
