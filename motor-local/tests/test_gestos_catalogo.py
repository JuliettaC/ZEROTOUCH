"""Gestos del Anexo A completados: mano abierta sostenida (armado del puntero), pulgares, modo
precisión, palma abierta (navegación), acciones discretas configurables, multimedia, temporizador
y trazo Air-Swipe. Todo sintético: sin cámara ni sistema operativo real."""

from __future__ import annotations

import pytest

from motor_local.action_engine import MODE_CONTROL, MODE_OBSERVATION, LogicalActionEngine
from motor_local.config import ConfigError, EngineConfig
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import (
    EVENT_AIRSWIPE_TRACE,
    EVENT_CANCEL,
    EVENT_CONFIRM,
    EVENT_LEFT_CLICK,
    EVENT_MEDIA_NEXT,
    EVENT_MOVE_CURSOR,
    EVENT_NAVIGATION,
    EVENT_PAUSE,
    EVENT_PRECISION,
    EVENT_TIMER,
    GestureInterpreter,
)
from motor_local.os_adapter import MockOSAdapter, validate_text

from tests.test_engine import armed, make_closed_fist, make_open_palm


# ------------------------------------------------------------ posturas sintéticas

def make_thumbs_up(cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
    hand = make_closed_fist(cx, cy)
    lms = list(hand.landmarks)
    lms[4] = Point3D(cx + 0.04, cy - 0.11)  # punta del pulgar por encima de la mano
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def make_thumbs_down(cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
    hand = make_closed_fist(cx, cy)
    lms = list(hand.landmarks)
    lms[4] = Point3D(cx + 0.04, cy + 0.17)  # punta del pulgar por debajo de la mano
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def make_precision_pose(cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
    """Índice y meñique extendidos; medio y anular plegados."""
    hand = make_open_palm(cx, cy, pinch_dist=0.14)
    lms = list(hand.landmarks)
    lms[12] = Point3D(cx, cy + 0.09)
    lms[16] = Point3D(cx, cy + 0.09)
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def make_pointing(cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
    """Solo el índice extendido (apuntar), pinza abierta."""
    hand = make_open_palm(cx, cy, pinch_dist=0.14)
    lms = list(hand.landmarks)
    for idx in (12, 16, 20):
        lms[idx] = Point3D(cx, cy + 0.09)
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def _run(interp: GestureInterpreter, frames, engine: LogicalActionEngine | None = None) -> list:
    out = []
    for hand, t in frames:
        events = interp.process_frame(hand, now_ms=t)
        if engine is not None:
            engine.dispatch(events)
        out.extend(events)
    return out


def _types(events) -> list[str]:
    return [e.type for e in events]


def _hold(make, start_ms: float, duration_ms: float, step: float = 33.0):
    t = start_ms
    frames = []
    while t <= start_ms + duration_ms:
        frames.append((make(), t))
        t += step
    return frames


# ------------------------------------------------------------ mano abierta sostenida

def test_pointer_needs_a_sustained_open_hand_before_moving_or_clicking() -> None:
    interp = GestureInterpreter(EngineConfig(click_cooldown_ms=0))
    engine = LogicalActionEngine(MockOSAdapter(), initial_mode=MODE_CONTROL)
    # Pinza y movimiento sin haber mostrado la mano abierta: nada.
    frames = [(make_open_palm(0.3 + 0.02 * i, 0.4, pinch_dist=0.02), 33.0 * i) for i in range(8)]
    frames += [(make_open_palm(0.5, 0.4, pinch_dist=0.14), 300.0), (make_open_palm(0.5, 0.4, pinch_dist=0.14), 333.0)]
    seen = _types(_run(interp, frames[:8], engine))
    assert EVENT_MOVE_CURSOR not in seen and EVENT_LEFT_CLICK not in seen
    assert interp.pointer_armed is False
    assert interp.telemetry.gesture == "PINCH" or interp.telemetry.gesture == "NONE"
    # Mano abierta durante menos de POINTER_ARM_MS: todavía no.
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), t) for t in (400.0, 500.0, 600.0)], engine)
    assert interp.pointer_armed is False
    assert interp.telemetry.gesture == "ARMING"
    # Sostenida: se arma y desde entonces el puntero se mueve y la pinza hace clic.
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), t) for t in (700.0, 800.0)], engine)
    assert interp.pointer_armed is True
    seen = _types(_run(interp, [(make_open_palm(0.6, 0.6, pinch_dist=0.14), 900.0)], engine))
    assert EVENT_MOVE_CURSOR in seen
    seen = _types(_run(interp, [(make_open_palm(0.6, 0.6, pinch_dist=0.02), t) for t in (1000.0, 1040.0, 1080.0)]
                       + [(make_open_palm(0.6, 0.6, pinch_dist=0.14), t) for t in (1120.0, 1160.0)], engine))
    assert EVENT_LEFT_CLICK in seen


def test_pointer_disarms_after_pause_and_after_a_long_tracking_loss() -> None:
    interp = armed(EngineConfig(pause_hold_ms=400, tracking_loss_frames=3))
    assert interp.pointer_armed
    _run(interp, [(make_closed_fist(), float(t)) for t in range(0, 1000, 33)])  # pausa
    assert interp.paused and interp.pointer_armed is False
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 1100.0)])        # suelta el puño
    _run(interp, [(make_closed_fist(), float(t)) for t in range(1200, 2000, 33)])  # reanuda
    assert interp.paused is False and interp.pointer_armed is False, "tras reanudar hay que volver a mostrar la mano"
    interp = armed(EngineConfig(tracking_loss_frames=3))
    _run(interp, [(None, 100.0 + 33.0 * i) for i in range(5)])   # pérdida breve (~130 ms)
    assert interp.pointer_armed is True
    _run(interp, [(None, 300.0 + 100.0 * i) for i in range(20)])  # pérdida de ~2 s: aún armado
    assert interp.pointer_armed is True, "una pérdida corta no obliga a volver a abrir la mano"
    _run(interp, [(None, 2300.0 + 100.0 * i) for i in range(20)])  # ~4 s: bajar la mano a descansar
    assert interp.pointer_armed is True, "descansar la mano unos segundos no obliga a re-armar (QA 19-11)"
    _run(interp, [(None, 4300.0 + 100.0 * i) for i in range(50)])  # pérdida larga (> 8 s)
    assert interp.pointer_armed is False


def test_pointer_toggle_off_moves_nothing_but_needs_no_arming() -> None:
    interp = GestureInterpreter(EngineConfig(pointer_enabled=False, click_cooldown_ms=0))
    engine = LogicalActionEngine(MockOSAdapter(), initial_mode=MODE_CONTROL)
    frames = [(make_open_palm(0.3, 0.3, pinch_dist=0.14), 0.0)]
    # La mano salta de 0,3 a 0,5 en 40 ms: con la mano tan rápida no empieza la pinza (PINCH_START_MAX_HAND_SPEED,
    # 23-11-2026); empieza en el fotograma siguiente, ya quieta.
    frames += [(make_open_palm(0.5, 0.5, pinch_dist=0.02), t) for t in (40.0, 80.0, 120.0, 160.0)]
    frames += [(make_open_palm(0.5, 0.5, pinch_dist=0.14), t) for t in (200.0, 240.0)]
    seen = _types(_run(interp, frames, engine))
    assert EVENT_LEFT_CLICK in seen and EVENT_MOVE_CURSOR not in seen


# ------------------------------------------------------------ pulgares

def test_thumbs_up_confirms_once_per_hold_and_thumbs_down_cancels() -> None:
    adapter = MockOSAdapter()
    interp = armed(EngineConfig(thumbs_up_enabled=True, thumbs_down_enabled=True))
    engine = LogicalActionEngine(adapter, initial_mode=MODE_CONTROL)
    seen = _types(_run(interp, _hold(make_thumbs_up, 0.0, 1500.0), engine))
    assert seen.count(EVENT_CONFIRM) == 1, "una pulsación por postura sostenida, sin repetir"
    assert EVENT_PAUSE not in seen, "el pulgar no es un puño: no pausa"
    assert ("KEY_COMBO", {"keys": ["enter"]}) in adapter.executed_actions
    # Soltar y volver a hacerlo: se rearma y dispara de nuevo.
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), t) for t in (1600.0, 1700.0, 1800.0, 1900.0)], engine)
    seen = _types(_run(interp, _hold(make_thumbs_up, 2000.0, 700.0), engine))
    assert seen.count(EVENT_CONFIRM) == 1
    seen = _types(_run(interp, _hold(make_thumbs_down, 3500.0, 700.0), engine))
    assert seen.count(EVENT_CANCEL) == 1
    assert ("KEY_COMBO", {"keys": ["esc"]}) in adapter.executed_actions


def test_thumbs_are_off_by_default_and_brief_thumbs_do_not_fire() -> None:
    interp = armed(EngineConfig())
    seen = _types(_run(interp, _hold(make_thumbs_up, 0.0, 1500.0)))
    assert EVENT_CONFIRM not in seen
    assert interp.telemetry.gesture == "THUMBS_UP", "se detecta y se informa aunque esté apagado"
    interp = armed(EngineConfig(thumbs_up_enabled=True))
    seen = _types(_run(interp, _hold(make_thumbs_up, 0.0, 300.0)))  # menos de THUMB_HOLD_MS
    assert EVENT_CONFIRM not in seen


def test_discrete_gestures_can_be_remapped_to_media_and_timer() -> None:
    adapter = MockOSAdapter()
    cfg = EngineConfig(thumbs_up_enabled=True, thumbs_down_enabled=True)
    cfg.discrete_actions["pulgar_arriba"] = "multimedia_siguiente"
    cfg.discrete_actions["pulgar_abajo"] = "temporizador_iniciar"
    interp = armed(cfg)
    engine = LogicalActionEngine(adapter, initial_mode=MODE_CONTROL)
    seen = _run(interp, _hold(make_thumbs_up, 0.0, 700.0), engine)
    assert EVENT_MEDIA_NEXT in _types(seen)
    assert ("KEY_COMBO", {"keys": ["media_next"]}) in adapter.executed_actions
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), t) for t in (800.0, 900.0, 1000.0)], engine)
    seen = _run(interp, _hold(make_thumbs_down, 1200.0, 700.0), engine)
    timer = [e for e in seen if e.type == EVENT_TIMER]
    assert len(timer) == 1 and timer[0].payload["gesto"] == "pulgar_abajo"
    app = engine.take_app_events()
    assert [e["event"] for e in app] == [EVENT_MEDIA_NEXT, EVENT_TIMER], "aviso de multimedia y temporizador para la interfaz"
    assert app[0]["injected"] is True
    assert not any(a[0] == "KEY_COMBO" and a[1]["keys"] != ["media_next"] for a in adapter.executed_actions), "ningún temporizador llega al SO"


def test_discrete_actions_are_not_injected_in_observation_but_app_events_still_flow() -> None:
    adapter = MockOSAdapter()
    cfg = EngineConfig(thumbs_up_enabled=True, thumbs_down_enabled=True)
    cfg.discrete_actions["pulgar_abajo"] = "temporizador_iniciar"
    interp = armed(cfg)
    engine = LogicalActionEngine(adapter, initial_mode=MODE_OBSERVATION)
    _run(interp, _hold(make_thumbs_up, 0.0, 700.0), engine)
    assert adapter.executed_actions == []
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), t) for t in (800.0, 900.0, 1000.0)], engine)
    _run(interp, _hold(make_thumbs_down, 1200.0, 700.0), engine)
    assert [e["event"] for e in engine.take_app_events()] == [EVENT_TIMER]


def test_media_and_window_feedback_reports_whether_it_reached_the_system() -> None:
    from motor_local.interpreter import EVENT_MEDIA_PLAY_PAUSE, EVENT_MINIMIZE_WINDOW, LogicalEvent
    from motor_local.window_control import MockWindowController, WindowActions, WindowRef
    controller = MockWindowController()
    controller.add(WindowRef(hwnd=20, pid=200, started=2), foreground=True)
    adapter = MockOSAdapter()
    engine = LogicalActionEngine(adapter, initial_mode=MODE_OBSERVATION, window_actions=WindowActions(controller, own_pid=1))
    engine.dispatch([LogicalEvent(EVENT_MEDIA_PLAY_PAUSE, {"gesto": "palma_abierta"})])
    assert engine.take_app_events() == [{"event": EVENT_MEDIA_PLAY_PAUSE, "injected": False, "gesto": "palma_abierta"}]
    assert adapter.executed_actions == []
    engine.set_mode(MODE_CONTROL)
    engine.dispatch([LogicalEvent(EVENT_MEDIA_PLAY_PAUSE, {}), LogicalEvent(EVENT_MINIMIZE_WINDOW, {"dy_palm": 1.5})])
    app = engine.take_app_events()
    assert app[0] == {"event": EVENT_MEDIA_PLAY_PAUSE, "injected": True}
    assert app[1]["event"] == EVENT_MINIMIZE_WINDOW and app[1]["result"] == "WIN_DOWN"
    assert ("KEY_COMBO", {"keys": ["win", "down"]}) in adapter.executed_actions


# ------------------------------------------------------------ precisión y palma

def test_precision_pose_toggles_precision_and_shrinks_cursor_travel() -> None:
    interp = armed(EngineConfig(stability=0))
    engine = LogicalActionEngine(MockOSAdapter(), initial_mode=MODE_CONTROL)

    def travel(base_ms: float) -> float:
        xs = []
        for i, t in enumerate(range(0, 400, 33)):
            evts = interp.process_frame(make_open_palm(0.40 + 0.01 * i, 0.5, pinch_dist=0.14), now_ms=base_ms + t)
            xs.extend(e.payload["x"] for e in evts if e.type == EVENT_MOVE_CURSOR)
        return max(xs) - min(xs) if xs else 0.0

    normal = travel(5000.0)
    seen = _run(interp, _hold(make_precision_pose, 6000.0, 600.0), engine)
    precision_events = [e for e in seen if e.type == EVENT_PRECISION]
    assert len(precision_events) == 1 and precision_events[0].payload["active"] is True
    assert interp.precision_active is True
    assert EVENT_MOVE_CURSOR not in _types(seen), "durante la postura el cursor no se mueve"
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 7000.0)], engine)
    fine = travel(7100.0)
    assert 0 < fine < normal * 0.75
    # La misma postura otra vez la desactiva; palma abierta sostenida también vuelve a navegación.
    _run(interp, _hold(make_precision_pose, 8000.0, 600.0), engine)
    assert interp.precision_active is False
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), t) for t in (8650.0, 8750.0, 8850.0, 8950.0)], engine)  # soltar: rearme
    _run(interp, _hold(make_precision_pose, 9500.0, 600.0), engine)  # tras el cooldown de 800 ms
    assert interp.precision_active is True
    seen = _run(interp, _hold(lambda: make_open_palm(0.5, 0.5, pinch_dist=0.14), 10000.0, 1200.0), engine)
    assert EVENT_NAVIGATION in _types(seen)
    assert interp.precision_active is False


def test_open_palm_must_be_still_to_count_as_sustained() -> None:
    interp = armed(EngineConfig())
    frames = [(make_open_palm(0.3 + 0.004 * i, 0.5, pinch_dist=0.14), 33.0 * i) for i in range(60)]  # se desplaza
    assert EVENT_NAVIGATION not in _types(_run(interp, frames))
    frames = [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 3000.0 + 33.0 * i) for i in range(45)]  # quieta 1,5 s
    assert _types(_run(interp, frames)).count(EVENT_NAVIGATION) == 1


def test_precision_pose_does_not_scroll_click_or_pause() -> None:
    interp = armed(EngineConfig())
    seen = _types(_run(interp, [(make_precision_pose(0.5, 0.5 - 0.01 * i), 33.0 * i) for i in range(30)]))
    assert not {EVENT_LEFT_CLICK, "SCROLL", "START_DRAG", EVENT_PAUSE} & set(seen)


# ------------------------------------------------------------ Air-Swipe

def test_pointing_records_a_trace_only_with_the_keyboard_open() -> None:
    interp = armed(EngineConfig())
    engine = LogicalActionEngine(MockOSAdapter(), initial_mode=MODE_CONTROL)
    path = [(make_pointing(0.35 + 0.02 * i, 0.5 + 0.005 * i), 33.0 * i) for i in range(16)]
    release = [(make_open_palm(0.65, 0.58, pinch_dist=0.14), 600.0 + 33.0 * i) for i in range(6)]
    seen = _run(interp, path + release, engine)
    assert EVENT_AIRSWIPE_TRACE not in _types(seen), "sin teclado abierto, apuntar no traza"

    interp.set_airswipe(True)
    engine.airswipe_active = True
    seen = _run(interp, [(h, t + 2000.0) for h, t in path + release], engine)
    traces = [e for e in seen if e.type == EVENT_AIRSWIPE_TRACE]
    assert len(traces) == 1
    points = traces[0].payload["points"]
    assert len(points) >= 8 and all(len(p) == 2 for p in points)
    assert points[-1][0] > points[0][0], "el trazo sigue el recorrido de la mano"
    assert EVENT_LEFT_CLICK not in _types(seen)
    assert engine.take_app_events()[0]["event"] == EVENT_AIRSWIPE_TRACE
    assert interp.telemetry.tracing is False


def test_airswipe_confirm_and_cancel_go_to_the_interface_not_the_os() -> None:
    adapter = MockOSAdapter()
    interp = armed(EngineConfig(thumbs_up_enabled=True, thumbs_down_enabled=True))
    engine = LogicalActionEngine(adapter, initial_mode=MODE_CONTROL)
    interp.set_airswipe(True)
    engine.airswipe_active = True
    _run(interp, _hold(make_thumbs_up, 0.0, 700.0), engine)
    assert [e["event"] for e in engine.take_app_events()] == [EVENT_CONFIRM]
    assert adapter.executed_actions == [], "con el teclado abierto Intro no se inyecta"


def test_type_text_and_edit_keys_are_bounded_and_require_control_with_keyboard_open() -> None:
    adapter = MockOSAdapter()
    engine = LogicalActionEngine(adapter, initial_mode=MODE_OBSERVATION)
    assert engine.type_text("hola")[1] == "AIRSWIPE_INACTIVE"
    engine.airswipe_active = True
    assert engine.type_text("hola")[1] == "CONTROL_REQUIRED"
    engine.set_mode(MODE_CONTROL)
    assert engine.type_text("año ñandú ")[0] is True
    assert adapter.typed == "año ñandú "
    assert ("TYPE_TEXT", {"chars": 10}) in adapter.executed_actions
    for bad in ("", "a\nb", "x" * 65, 42, "tab\tulado", "\x1b[2J"):
        assert engine.type_text(bad)[1] == "TEXT_INVALID", repr(bad)
    assert engine.press_edit_key("backspace")[0] is True
    assert engine.press_edit_key("enter")[0] is True
    assert engine.press_edit_key("f4")[1] == "KEY_NOT_ALLOWED"
    assert engine.press_edit_key("ctrl+c")[1] == "KEY_NOT_ALLOWED"
    assert validate_text("ok")[0] is True


def test_airswipe_safety_blocks_pause_gaze_tracking_loss_config_and_emergency() -> None:
    adapter = MockOSAdapter()
    interp = armed(EngineConfig(thumbs_up_enabled=True, tracking_loss_frames=3))
    engine = LogicalActionEngine(adapter, initial_mode=MODE_CONTROL)
    interp.set_airswipe(True)
    engine.airswipe_active = True

    # 1. Pausa bloquea TYPE_TEXT y PRESS_KEY; reanudar restablece (incluso con pointer_armed=False).
    engine.dispatch(interp.set_paused(True, 100.0))
    assert interp.pointer_armed is False
    assert engine.type_text("pausa") == (False, "INTERACTION_PAUSED", "El control gestual está en pausa.")
    assert engine.press_edit_key("backspace")[1] == "INTERACTION_PAUSED"
    assert adapter.executed_actions == []

    engine.dispatch(interp.set_paused(False, 200.0))
    assert interp.pointer_armed is False, "reanudar no arma el puntero por sí solo"
    assert engine.type_text("a")[0] is True, "la escritura Air-Swipe no queda bloqueada por pointer_armed=False"
    assert adapter.typed == "a"

    # 2. Retención por mirada (external_hold) bloquea TYPE_TEXT y PRESS_KEY.
    engine.dispatch(interp.set_external_hold(True))
    engine.set_external_hold(interp.external_hold)
    assert engine.type_text("mirada")[1] == "GAZE_HOLD"
    assert engine.press_edit_key("space")[1] == "GAZE_HOLD"
    assert adapter.typed == "a"

    engine.dispatch(interp.set_external_hold(False))
    engine.set_external_hold(interp.external_hold)
    assert engine.type_text("b")[0] is True
    assert adapter.typed == "ab"

    # 3. Pérdida de mano durante un trazo cancela el trazo (NO emite AIRSWIPE_TRACE) y bloquea inyección.
    # Tras la pausa anterior, hay que rearmar el puntero con mano abierta para poder trazar.
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 220.0 + 100.0 * i) for i in range(5)], engine)
    assert interp.pointer_armed is True
    path = [(make_pointing(0.35 + 0.02 * i, 0.5), 750.0 + 33.0 * i) for i in range(8)]
    evts = _run(interp, path, engine)
    assert interp.telemetry.tracing is True
    loss_evts = _run(interp, [(None, 1050.0 + 33.0 * i) for i in range(3)], engine)
    assert EVENT_AIRSWIPE_TRACE not in _types(evts + loss_evts), "perder la mano nunca cierra un trazo como válido"
    assert engine.take_app_events() == []
    assert engine.tracking_lost is True
    assert engine.type_text("perdido")[1] == "TRACKING_LOST"
    assert engine.press_edit_key("enter")[1] == "TRACKING_LOST"

    # Recuperar la mano limpia tracking_lost y permite volver a escribir.
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 1200.0 + 100.0 * i) for i in range(5)], engine)
    assert engine.tracking_lost is False
    assert engine.type_text("c")[0] is True
    assert adapter.typed == "abc"

    # 4. Deshabilitar Air-Swipe en configuración apaga airswipe_active, cancela trazo y detiene redirección.
    _run(interp, [(make_pointing(0.4 + 0.02 * i, 0.5), 1750.0 + 33.0 * i) for i in range(5)], engine)
    assert interp.telemetry.tracing is True
    engine.dispatch(interp.update_config(EngineConfig(airswipe_enabled=False, thumbs_up_enabled=True)))
    if not interp.config.airswipe_enabled:
        engine.airswipe_active = False
    assert interp.airswipe_active is False and engine.airswipe_active is False
    assert interp.telemetry.tracing is False
    assert engine.type_text("deshabilitado")[1] == "AIRSWIPE_INACTIVE"
    assert engine.press_edit_key("backspace")[1] == "AIRSWIPE_INACTIVE"

    # Con Air-Swipe desactivado, pulgar arriba vuelve a inyectarse al SO en vez de redirigirse a app_events.
    _run(interp, [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 1950.0 + 100.0 * i) for i in range(5)], engine)
    _run(interp, _hold(make_thumbs_up, 2500.0, 700.0), engine)
    assert engine.take_app_events() == []
    assert ("KEY_COMBO", {"keys": ["enter"]}) in adapter.executed_actions

    # 5. Parada de emergencia libera botones, desactiva Air-Swipe y bloquea inyección.
    interp.set_airswipe(True)
    engine.airswipe_active = True
    adapter.start_drag()
    assert adapter.button_held is True
    engine.trigger_emergency_stop()
    engine.dispatch(interp.set_paused(True, 3300.0))
    engine.dispatch(interp.set_airswipe(False))
    assert adapter.button_held is False
    assert engine.airswipe_active is False and interp.airswipe_active is False
    assert engine.type_text("emergencia")[1] == "AIRSWIPE_INACTIVE"
    assert engine.press_edit_key("space")[1] == "AIRSWIPE_INACTIVE"


def test_mock_adapter_rejects_keys_outside_the_contract() -> None:
    adapter = MockOSAdapter()
    with pytest.raises(ValueError):
        adapter.key_combo(("ctrl", "alt", "delete"))
    with pytest.raises(ValueError):
        adapter.key_combo(("alt", "f4"))
    with pytest.raises(ValueError):
        adapter.press_key("delete")
    adapter.key_combo(("enter",))
    adapter.key_combo(("media_play_pause",))


# ------------------------------------------------------------ configuración IPC

def test_ipc_gestos_map_sets_flags_and_discrete_actions() -> None:
    cfg = EngineConfig.from_dict({
        "gestos": {
            "micro_pinza": {"accion": "clic", "habilitado": False},
            "pulgar_arriba": {"accion": "multimedia_play_pause", "habilitado": True},
            "dos_dedos": {"accion": "sin_accion", "habilitado": True},
        },
        "activeBox": [0.2, 0.8, 0.3, 0.9],
        "gaze": {"enabled": True, "calibration": {"yaw": 3.5, "pitch": -2}},
    })
    assert cfg.pinch_enabled is False and cfg.scroll_enabled is False and cfg.thumbs_up_enabled is True
    assert cfg.discrete_actions["pulgar_arriba"] == "multimedia_play_pause"
    assert cfg.active_bounds == (0.2, 0.8, 0.3, 0.9)
    assert cfg.gaze.enabled and cfg.gaze.calibration == (3.5, -2.0)
    restored = EngineConfig.from_dict(cfg.to_dict())
    assert restored == cfg
    assert restored.to_dict()["gestos"]["pulgar_arriba"] == {"accion": "multimedia_play_pause", "habilitado": True}


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"gestos": {"gesto_x": {"accion": "clic", "habilitado": True}}}, "GESTURE_UNKNOWN"),
        ({"gestos": {"micro_pinza": {"accion": "arrastrar", "habilitado": True}}}, "ACTION_NOT_IMPLEMENTED"),
        ({"gestos": {"micro_pinza": {"accion": "calculadora", "habilitado": True}}}, "FIELD_INVALID"),
        ({"gestos": {"micro_pinza": {"accion": "clic", "habilitado": "si"}}}, "FIELD_INVALID"),
        ({"gestos": {"micro_pinza": {"accion": "clic", "shell": "calc"}}}, "FIELD_INVALID"),
        ({"activeBox": [0.9, 0.2, 0.1, 0.8]}, "FIELD_OUT_OF_RANGE"),
        ({"activeBox": [0.1, 0.15, 0.1, 0.9]}, "FIELD_OUT_OF_RANGE"),
        ({"activeBox": "todo"}, "FIELD_INVALID"),
        ({"gaze": {"enabled": "si"}}, "FIELD_INVALID"),
        ({"gaze": {"yawTolerance": 90}}, "FIELD_OUT_OF_RANGE"),
        ({"gaze": {"otro": 1}}, "UNKNOWN_FIELD"),
    ],
)
def test_ipc_rejects_invalid_bindings_boxes_and_gaze(payload: dict, code: str) -> None:
    with pytest.raises(ConfigError) as info:
        EngineConfig.from_dict(payload)
    assert info.value.code == code


def test_ipc_defaults_match_the_interface_defaults_in_the_contract() -> None:
    from motor_local.capabilities import TOGGLE_DEFAULTS

    cfg = EngineConfig.from_dict({})
    for toggle, value in TOGGLE_DEFAULTS.items():
        assert cfg.to_dict()[toggle] is value, toggle
    assert cfg.swipe_left_enabled is False and cfg.thumbs_up_enabled is False


def test_dispatch_cuenta_cada_evento_disparado_sin_contar_el_movimiento() -> None:
    from motor_local.action_engine import LogicalActionEngine
    from motor_local.interpreter import EVENT_MOVE_CURSOR, EVENT_RIGHT_CLICK, LogicalEvent
    from motor_local.os_adapter import MockOSAdapter

    engine = LogicalActionEngine(MockOSAdapter())
    engine.dispatch([LogicalEvent(EVENT_RIGHT_CLICK), LogicalEvent(EVENT_MOVE_CURSOR), LogicalEvent(EVENT_RIGHT_CLICK)])
    assert engine.event_counts == {EVENT_RIGHT_CLICK: 2}


def test_dispatch_cuenta_el_destino_de_cada_evento_y_por_que_se_bloquea() -> None:
    """«Reconoce el gesto pero no actúa en Control» (22-11-2026): el informe debe decir adónde fue cada evento."""
    from motor_local.action_engine import MODE_CONTROL, LogicalActionEngine
    from motor_local.interpreter import (
        EVENT_LEFT_CLICK, EVENT_MINIMIZE_WINDOW, EVENT_MOVE_CURSOR, EVENT_NEXT_TAB, EVENT_PRECISION, LogicalEvent,
    )
    from motor_local.os_adapter import MockOSAdapter
    from motor_local.window_control import MockWindowController, WindowActions

    adapter = MockOSAdapter()
    engine = LogicalActionEngine(adapter, window_actions=WindowActions(MockWindowController()))
    engine.dispatch([LogicalEvent(EVENT_LEFT_CLICK), LogicalEvent(EVENT_PRECISION)])          # Observar
    engine.set_mode(MODE_CONTROL)
    engine.dispatch([LogicalEvent(EVENT_LEFT_CLICK), LogicalEvent(EVENT_NEXT_TAB), LogicalEvent(EVENT_MOVE_CURSOR)])
    engine.dispatch([LogicalEvent(EVENT_MINIMIZE_WINDOW)])
    engine.set_external_hold(True)
    engine.dispatch([LogicalEvent(EVENT_LEFT_CLICK)])
    engine.set_external_hold(False)
    engine.paused = True
    engine.dispatch([LogicalEvent(EVENT_LEFT_CLICK)])

    assert engine.delivery_counts[EVENT_LEFT_CLICK] == {
        "BLOQUEADO_OBSERVAR": 1, "SO": 1, "BLOQUEADO_MIRADA": 1, "BLOQUEADO_PAUSA": 1,
    }
    assert engine.delivery_counts[EVENT_NEXT_TAB] == {"SO": 1}
    assert engine.delivery_counts[EVENT_PRECISION] == {"INTERFAZ": 1}
    assert set(engine.delivery_counts[EVENT_MINIMIZE_WINDOW]) == {f"VENTANA_{engine.last_window_result}"}
    assert EVENT_MOVE_CURSOR not in engine.delivery_counts
    # Lo contado como «SO» es exactamente lo que recibió el adaptador.
    assert [a for a, _ in adapter.executed_actions if a != "MOVE_CURSOR"] == ["LEFT_CLICK", "KEY_COMBO"]


def test_pinza_de_medio_segundo_es_clic_y_no_arrastre_con_la_configuracion_por_defecto() -> None:
    """Medido en vivo (22-11-2026): las pinzas de la persona duran 0,31-0,49 s y con 380 ms se volvían arrastre."""
    from motor_local.interpreter import EVENT_LEFT_CLICK, EVENT_START_DRAG

    interp = armed(EngineConfig())
    seen: list[str] = []
    t = 0.0
    for pinch, duration in ((0.14, 200.0), (0.02, 500.0), (0.14, 200.0)):
        end = t + duration
        while t < end:
            seen.extend(e.type for e in interp.process_frame(make_open_palm(0.5, 0.5, pinch_dist=pinch, scale=0.55), now_ms=t))
            t += 66.0
    assert EVENT_LEFT_CLICK in seen
    assert EVENT_START_DRAG not in seen
