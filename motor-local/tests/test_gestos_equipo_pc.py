"""Gestos locales del equipo para PC: pestañas (pulgar y meñique hacia abajo/arriba) y clic derecho
(pinza pulgar-medio). Todo sintético: sin cámara ni sistema operativo real."""

from __future__ import annotations

from motor_local import capabilities as caps
from motor_local.action_engine import MODE_CONTROL, MODE_OBSERVATION, LogicalActionEngine
from motor_local.config import EngineConfig
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import (
    EVENT_LEFT_CLICK,
    EVENT_MOVE_CURSOR,
    EVENT_NEXT_TAB,
    EVENT_PREV_TAB,
    EVENT_PRECISION,
    EVENT_RIGHT_CLICK,
    LogicalEvent,
)
from motor_local.os_adapter import ALLOWED_KEY_COMBOS, MockOSAdapter

from tests.test_engine import armed, make_closed_fist, make_open_palm

FRAME_MS = 33.0


# ------------------------------------------------------------ posturas sintéticas

def make_tab_pose(cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
    """Pulgar y meñique extendidos (🤙); índice, medio y anular plegados hacia la palma."""
    lms = list(make_open_palm(cx, cy, pinch_dist=0.14).landmarks)
    for mcp, pip, dip, tip in ((5, 6, 7, 8), (9, 10, 11, 12), (13, 14, 15, 16)):
        x = lms[mcp].x
        lms[pip] = Point3D(x, cy - 0.04)
        lms[dip] = Point3D(x, cy - 0.01)
        lms[tip] = Point3D(x, cy + 0.03)
    lms[4] = Point3D(cx - 0.15, cy - 0.03)  # pulgar hacia fuera
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def make_right_pinch(cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
    """Punta del pulgar con la punta del medio; índice extendido y lejos del pulgar."""
    lms = list(make_open_palm(cx, cy, pinch_dist=0.14).landmarks)
    meeting = Point3D(cx + 0.05, cy - 0.05)
    lms[12] = meeting
    lms[4] = meeting
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def run(interp, frames) -> list[LogicalEvent]:
    events: list[LogicalEvent] = []
    for hand, t in frames:
        events.extend(interp.process_frame(hand, now_ms=t))
    return events


def hold(make, ms: float, start: float = 0.0, **kwargs):
    t = start
    while t < start + ms:
        yield make(**kwargs), t
        t += FRAME_MS


def glide(make, ms: float, cy0: float, cy1: float, start: float = 0.0):
    t = start
    while t < start + ms:
        frac = (t - start) / ms
        yield make(cy=cy0 + (cy1 - cy0) * frac), t
        t += FRAME_MS


def types(events: list[LogicalEvent]) -> list[str]:
    return [e.type for e in events]


# ------------------------------------------------------------ pestañas

def test_bajar_la_mano_con_pulgar_y_menique_avanza_pestanas() -> None:
    interp = armed()
    events = run(interp, hold(make_tab_pose, 200.0))
    assert EVENT_NEXT_TAB not in types(events) and EVENT_PREV_TAB not in types(events)
    # Palma: 0,16 de alto; un paso = 0,5 palmas = 0,08. Bajar 0,2 en 0,8 s = 2 pestañas.
    events = run(interp, glide(make_tab_pose, 800.0, 0.5, 0.7, start=200.0))
    assert types(events).count(EVENT_NEXT_TAB) == 2
    assert EVENT_PREV_TAB not in types(events)
    assert EVENT_MOVE_CURSOR not in types(events), "el cursor no se mueve mientras se cambian pestañas"
    assert interp.telemetry.gesture == "PESTANAS"


def test_subir_la_mano_retrocede_pestanas() -> None:
    interp = armed()
    run(interp, hold(make_tab_pose, 200.0, cy=0.7))
    events = run(interp, glide(make_tab_pose, 800.0, 0.7, 0.5, start=200.0))
    assert types(events).count(EVENT_PREV_TAB) == 2
    assert EVENT_NEXT_TAB not in types(events)


def test_postura_de_pestanas_quieta_no_hace_nada() -> None:
    interp = armed()
    events = run(interp, hold(make_tab_pose, 2000.0))
    assert not {EVENT_NEXT_TAB, EVENT_PREV_TAB, EVENT_PRECISION, EVENT_LEFT_CLICK} & set(types(events))
    assert not interp.paused, "pulgar y meñique no es un puño"


def test_pestanas_respetan_el_interruptor_del_equipo() -> None:
    interp = armed(EngineConfig.from_dict({"tabGestures": False}))
    run(interp, hold(make_tab_pose, 200.0))
    events = run(interp, glide(make_tab_pose, 800.0, 0.5, 0.7, start=200.0))
    assert EVENT_NEXT_TAB not in types(events)


def test_pestanas_inyectan_solo_las_teclas_del_contrato() -> None:
    adapter = MockOSAdapter()
    engine = LogicalActionEngine(adapter, initial_mode=MODE_CONTROL)
    engine.dispatch([LogicalEvent(EVENT_NEXT_TAB, {}), LogicalEvent(EVENT_PREV_TAB, {})])
    combos = [payload["keys"] for name, payload in adapter.executed_actions if name == "KEY_COMBO"]
    assert combos == [["ctrl", "tab"], ["ctrl", "shift", "tab"]]
    assert [e["event"] for e in engine.take_app_events()] == [EVENT_NEXT_TAB, EVENT_PREV_TAB]


def test_pestanas_en_observacion_no_tocan_el_teclado() -> None:
    adapter = MockOSAdapter()
    engine = LogicalActionEngine(adapter, initial_mode=MODE_OBSERVATION)
    engine.dispatch([LogicalEvent(EVENT_NEXT_TAB, {})])
    assert not [a for a in adapter.executed_actions if a[0] == "KEY_COMBO"]
    assert engine.take_app_events() == [{"event": EVENT_NEXT_TAB, "injected": False}]


# ------------------------------------------------------------ clic derecho

def test_pinza_pulgar_medio_hace_un_clic_derecho() -> None:
    interp = armed()
    run(interp, hold(make_open_palm, 300.0, pinch_dist=0.14))
    events = run(interp, hold(make_right_pinch, 150.0, start=300.0))
    events += run(interp, hold(make_open_palm, 200.0, start=450.0, pinch_dist=0.14))
    assert types(events).count(EVENT_RIGHT_CLICK) == 1
    assert EVENT_LEFT_CLICK not in types(events)


def test_pinza_pulgar_medio_larga_no_hace_clic() -> None:
    interp = armed()
    events = run(interp, hold(make_right_pinch, 1200.0))
    events += run(interp, hold(make_open_palm, 200.0, start=1200.0, pinch_dist=0.14))
    assert EVENT_RIGHT_CLICK not in types(events)


def test_clic_derecho_respeta_el_interruptor() -> None:
    interp = armed(EngineConfig.from_dict({"rightClick": False}))
    events = run(interp, hold(make_right_pinch, 150.0))
    events += run(interp, hold(make_open_palm, 200.0, start=150.0, pinch_dist=0.14))
    assert EVENT_RIGHT_CLICK not in types(events)


def test_clic_derecho_llega_al_adaptador_solo_en_control() -> None:
    adapter = MockOSAdapter()
    engine = LogicalActionEngine(adapter, initial_mode=MODE_OBSERVATION)
    engine.dispatch([LogicalEvent(EVENT_RIGHT_CLICK, {})])
    assert not [a for a in adapter.executed_actions if a[0] == "RIGHT_CLICK"]
    engine.set_mode(MODE_CONTROL)
    engine.dispatch([LogicalEvent(EVENT_RIGHT_CLICK, {})])
    assert [a[0] for a in adapter.executed_actions].count("RIGHT_CLICK") == 1


def test_puno_sigue_pausando() -> None:
    interp = armed()
    run(interp, hold(make_closed_fist, 1000.0))
    assert interp.paused


# ------------------------------------------------------------ contrato y configuración

def test_teclas_del_equipo_estan_permitidas_y_separadas_del_catalogo() -> None:
    assert caps.DEVICE_KEYS == {"pestana_siguiente": ("ctrl", "tab"), "pestana_anterior": ("ctrl", "shift", "tab")}
    for keys in caps.DEVICE_KEYS.values():
        assert keys in ALLOWED_KEY_COMBOS
    # Gestos locales: no entran al catálogo sincronizado ni a la base.
    assert not set(caps.DEVICE_KEYS) & caps.KNOWN_ACTIONS
    assert {"tabGestures", "rightClick"} <= set(caps.CAPABILITIES["ajustes_equipo"])


def test_configuracion_de_gestos_locales_ida_y_vuelta() -> None:
    defaults = EngineConfig.from_dict({}).to_dict()
    assert defaults["tabGestures"] is True and defaults["rightClick"] is True
    custom = EngineConfig.from_dict({"tabGestures": False, "rightClick": False})
    assert custom.to_dict()["tabGestures"] is False and custom.to_dict()["rightClick"] is False
    assert EngineConfig.from_dict(custom.to_dict()) == custom
