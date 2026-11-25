"""Pestaña nueva con ✌️ (23-11-2026, pedido): índice y medio extendidos y SEPARADOS, sostenida y quieta -> Ctrl+T.
Desplazar usa los mismos dedos pero juntos y moviéndose."""

from __future__ import annotations

from motor_local.action_engine import LogicalActionEngine
from motor_local.config import EngineConfig
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import EVENT_NEW_TAB, EVENT_SCROLL, NEWTAB_HOLD_MS
from motor_local.os_adapter import MockOSAdapter
from tests.test_engine import armed, make_two_fingers

FRAME_MS = 1000.0 / 15


def make_v(cx: float = 0.5, cy: float = 0.5, spread: float = 0.055) -> HandLandmarks:
    """Dos dedos con las puntas separadas 2·spread (palma 0,16: 0,055 -> ~0,69 palmas)."""
    lms = list(make_two_fingers(cx, cy).landmarks)
    lms[6] = Point3D(cx - spread * 0.5, cy - 0.06)
    lms[8] = Point3D(cx - spread, cy - 0.14)
    lms[10] = Point3D(cx + spread * 0.5, cy - 0.06)
    lms[12] = Point3D(cx + spread, cy - 0.14)
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def run(hands, interp=None, start: float = 0.0) -> list[str]:
    interp = interp or armed(EngineConfig.from_dict({"drag": False}))
    return [e.type for i, h in enumerate(hands) for e in interp.process_frame(h, now_ms=start + i * FRAME_MS)]


def frames(ms: float) -> int:
    return int(ms / FRAME_MS) + 1


def test_v_sostenida_y_quieta_abre_una_pestana_nueva_una_sola_vez() -> None:
    seen = run([make_v()] * frames(3000))
    assert seen.count(EVENT_NEW_TAB) == 1, seen


def test_v_breve_no_abre_nada() -> None:
    assert EVENT_NEW_TAB not in run([make_v()] * frames(NEWTAB_HOLD_MS - 200))


def test_los_dedos_juntos_del_desplazar_no_abren_pestana() -> None:
    assert EVENT_NEW_TAB not in run([make_two_fingers()] * frames(3000))
    # Separación de 0,45 palmas (lo máximo que se ve en un desplazar real más de un fotograma): tampoco.
    assert EVENT_NEW_TAB not in run([make_v(spread=0.036)] * frames(3000))


def test_la_v_en_movimiento_no_abre_pestana_ni_desplaza() -> None:
    # 24-11-2026: desplazar es con los dos dedos JUNTOS y sostenidos; la V separada solo es la pestaña nueva (quieta).
    hands = [make_v(cy=0.5 + 0.012 * i) for i in range(frames(2000))]
    seen = run(hands)
    assert EVENT_NEW_TAB not in seen
    assert EVENT_SCROLL not in seen


def test_soltar_y_repetir_abre_otra() -> None:
    interp = armed(EngineConfig.from_dict({"drag": False}))
    first = run([make_v()] * frames(1200), interp)
    rest = [make_two_fingers()] * frames(1700) + [make_v()] * frames(1200)
    second = run(rest, interp, start=frames(1200) * FRAME_MS)
    assert first.count(EVENT_NEW_TAB) == 1 and second.count(EVENT_NEW_TAB) == 1


def test_respeta_su_interruptor_y_envia_ctrl_t_en_control() -> None:
    assert EVENT_NEW_TAB not in run([make_v()] * frames(2000), armed(EngineConfig.from_dict({"newTab": False})))
    adapter = MockOSAdapter()
    engine = LogicalActionEngine(adapter)
    engine.set_mode("CONTROL")
    interp = armed(EngineConfig.from_dict({"drag": False}))
    for i, hand in enumerate([make_v()] * frames(1500)):
        engine.dispatch(interp.process_frame(hand, now_ms=i * FRAME_MS))
    assert ("KEY_COMBO", {"keys": ["ctrl", "t"]}) in adapter.executed_actions
