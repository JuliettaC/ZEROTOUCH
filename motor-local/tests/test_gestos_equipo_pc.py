"""Gestos locales del equipo para PC: clic derecho (pinza pulgar-medio) y las teclas del equipo (Alt+Tab, pestaña
nueva). Los gestos de pestañas, dictado y ☝️ se retiraron el 24-11-2026. Todo sintético: sin cámara ni sistema operativo real."""

from __future__ import annotations

import math

from motor_local import capabilities as caps
from motor_local.action_engine import MODE_CONTROL, MODE_OBSERVATION, LogicalActionEngine
from motor_local.config import EngineConfig
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import (
    EVENT_LEFT_CLICK,
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

FAN_MS = 1000.0 / 15  # la webcam de los videos del abanico graba a 15 fps


def make_fan_hand(tilt: float = 60.0, bend: float = 0.0, cx: float = 0.5, cy: float = 0.6, handedness: str = "Right") -> HandLandmarks:
    """Mano abierta con el palmo (muñeca -> nudillo del medio) a `tilt` grados (90 = vertical) y los dedos girados
    `bend` grados respecto del palmo (negativo = horario, hacia el pulgar de la mano derecha en espejo)."""
    t = math.radians(tilt)
    u = (math.cos(t), -math.sin(t))              # eje del palmo (y de la imagen hacia abajo)
    p = (math.sin(t), math.cos(t))               # perpendicular
    f = (math.cos(t + math.radians(bend)), -math.sin(t + math.radians(bend)))
    wrist = Point3D(cx, cy)
    lms = [wrist] * 21
    for (mcp, pip, dip, tip), off in zip(((5, 6, 7, 8), (9, 10, 11, 12), (13, 14, 15, 16), (17, 18, 19, 20)), (-0.04, 0.0, 0.03, 0.06)):
        base = (cx + 0.16 * u[0] + off * p[0], cy + 0.16 * u[1] + off * p[1])
        for idx, d in ((mcp, 0.0), (pip, 0.06), (dip, 0.10), (tip, 0.14)):
            lms[idx] = Point3D(base[0] + d * f[0], base[1] + d * f[1])
    thumb = (math.cos(t + 0.9), -math.sin(t + 0.9))
    lms[2] = Point3D(cx + 0.05 * thumb[0], cy + 0.05 * thumb[1])
    lms[3] = Point3D(cx + 0.09 * thumb[0], cy + 0.09 * thumb[1])
    lms[4] = Point3D(cx + 0.13 * thumb[0], cy + 0.13 * thumb[1])
    return HandLandmarks(landmarks=lms, handedness=handedness, confidence=0.95)


def fan(bends, start: float = 0.0, **kwargs):
    """Una muestra por fotograma a 15 fps con los giros de dedos dados."""
    return [(make_fan_hand(bend=b, **kwargs), start + i * FAN_MS) for i, b in enumerate(bends)]


# Abanico medido: ida rápida hacia el pulgar (-45° en un fotograma ≈ -680 °/s), regreso, mano quieta.
ONE_FAN = [0, 0, 0, -45, -55, -30, -5, 0, 0, 0]


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
    assert caps.DEVICE_KEYS == {"cambiar_ventana": ("alt", "tab"), "nueva_pestana": ("ctrl", "t")}
    for keys in caps.DEVICE_KEYS.values():
        assert keys in ALLOWED_KEY_COMBOS
    # Gestos locales: no entran al catálogo sincronizado ni a la base.
    assert not set(caps.DEVICE_KEYS) & caps.KNOWN_ACTIONS
    assert {"rightClick", "altTab", "newTab"} <= set(caps.CAPABILITIES["ajustes_equipo"])
    retirados = {"windowGestures", "windowSwipe", "tabGestures", "dictation", "keyboardGesture", "openHandScroll"}
    assert not retirados & set(caps.CAPABILITIES["ajustes_equipo"])


def test_configuracion_de_gestos_locales_ida_y_vuelta() -> None:
    defaults = EngineConfig.from_dict({}).to_dict()
    assert defaults["rightClick"] is True and "tabGestures" not in defaults and "dictation" not in defaults
    custom = EngineConfig.from_dict({"rightClick": False})
    assert custom.to_dict()["rightClick"] is False
    assert EngineConfig.from_dict(custom.to_dict()) == custom


def test_el_adaptador_rechaza_combinaciones_fuera_de_la_lista_permitida() -> None:
    import pytest

    with pytest.raises(ValueError):
        MockOSAdapter().key_combo(("ctrl", "alt", "delete"))
    with pytest.raises(ValueError):
        MockOSAdapter().key_combo(("win", "h"))   # el dictado se retiró: su atajo ya no está permitido
