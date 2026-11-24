"""Gestos locales del equipo para PC: pestaña siguiente (abanico con la mano abierta y ladeada; antes pulgar y
meñique) y clic derecho (pinza pulgar-medio). Todo sintético: sin cámara ni sistema operativo real."""

from __future__ import annotations

import math

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


def test_un_abanico_con_la_mano_ladeada_pasa_una_pestana() -> None:
    interp = armed()
    events = run(interp, fan(ONE_FAN))
    assert types(events).count(EVENT_NEXT_TAB) == 1, "el regreso del abanico no cuenta como otra pestaña"
    assert EVENT_PREV_TAB not in types(events)
    assert EVENT_LEFT_CLICK not in types(events)


def test_dos_abanicos_pasan_dos_pestanas() -> None:
    interp = armed()
    events = run(interp, fan(ONE_FAN + ONE_FAN))
    assert types(events).count(EVENT_NEXT_TAB) == 2


def test_el_cursor_no_se_mueve_durante_el_abanico() -> None:
    interp = armed()
    run(interp, fan([0, 0, 0]))
    events = run(interp, fan([-45, -55, -30, -5, 0], start=3 * FAN_MS))
    assert EVENT_MOVE_CURSOR not in types(events)
    assert interp.telemetry.gesture == "PESTANAS"


def test_con_la_mano_vertical_el_mismo_giro_no_pasa_pestana() -> None:
    interp = armed()
    events = run(interp, fan(ONE_FAN, tilt=95.0))
    assert EVENT_NEXT_TAB not in types(events), "en los videos los demás gestos tienen el palmo a 91-107°"


def test_mano_que_se_desplaza_no_es_un_abanico() -> None:
    interp = armed()
    frames = [(make_fan_hand(bend=b, cx=0.3 + 0.06 * i), i * FAN_MS) for i, b in enumerate(ONE_FAN)]
    assert EVENT_NEXT_TAB not in types(run(interp, frames))


def test_giro_hacia_el_otro_lado_no_pasa_pestana() -> None:
    interp = armed()
    events = run(interp, fan([0, 0, 0, 45, 55, 30, 5, 0, 0]))
    assert EVENT_NEXT_TAB not in types(events)


def test_mano_izquierda_en_espejo() -> None:
    interp = armed(EngineConfig.from_dict({"preferredHand": "LEFT"}))
    events = run(interp, fan([-b for b in ONE_FAN], tilt=120.0, handedness="Left"))
    assert types(events).count(EVENT_NEXT_TAB) == 1
    interp = armed(EngineConfig.from_dict({"preferredHand": "LEFT"}))
    assert EVENT_NEXT_TAB not in types(run(interp, fan(ONE_FAN, tilt=60.0, handedness="Left")))


def test_postura_de_pestanas_quieta_no_hace_nada() -> None:
    interp = armed()
    events = run(interp, hold(make_tab_pose, 2000.0) )
    assert not {EVENT_NEXT_TAB, EVENT_PREV_TAB, EVENT_PRECISION, EVENT_LEFT_CLICK} & set(types(events))
    assert not interp.paused, "pulgar y meñique no es un puño"
    interp = armed()
    events = run(interp, fan([0] * 30))
    assert EVENT_NEXT_TAB not in types(events), "la mano ladeada quieta no pasa pestañas"


def test_pestanas_respetan_el_interruptor_del_equipo() -> None:
    interp = armed(EngineConfig.from_dict({"tabGestures": False}))
    events = run(interp, fan(ONE_FAN + ONE_FAN))
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
    assert caps.DEVICE_KEYS == {
        "pestana_siguiente": ("ctrl", "tab"), "pestana_anterior": ("ctrl", "shift", "tab"), "minimizar_ventana": ("win", "down"),
        "dictado": ("win", "h"), "cambiar_ventana": ("alt", "tab"),
    }
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


def test_un_barrido_lateral_con_la_mano_ladeada_no_es_un_abanico() -> None:
    """Medido en vivo (22-11-2026): al barrer de lado con la mano ladeada salían pestañas en vez de atrás/adelante."""
    interp = armed()
    frames = [(make_fan_hand(bend=b, cx=0.3 + 0.03 * i), i * FAN_MS) for i, b in enumerate(ONE_FAN)]
    assert EVENT_NEXT_TAB not in types(run(interp, frames))


def test_el_barrido_lateral_con_la_mano_ladeada_llega_a_atras_o_adelante() -> None:
    from motor_local.interpreter import EVENT_BACK, EVENT_FORWARD

    interp = armed(EngineConfig.from_dict({"swipeLeft": True, "swipeRight": True}))
    frames = [(make_fan_hand(bend=0.0, cx=0.2 + 0.05 * i), i * FAN_MS) for i in range(14)]
    seen = set(types(run(interp, frames)))
    assert EVENT_FORWARD in seen or EVENT_BACK in seen, seen
    assert EVENT_NEXT_TAB not in seen


def test_el_abanico_no_dispara_tambien_el_golpe_de_muneca() -> None:
    """Informe en vivo (22-11-2026): con los dos gestos activos, un abanico minimizaba o restauraba la ventana
    además de pasar la pestaña (doblar la muñeca mueve las puntas como el golpe de muñeca)."""
    from motor_local.interpreter import EVENT_MINIMIZE_WINDOW, EVENT_RESTORE_WINDOW

    cfg = EngineConfig.from_dict({"windowSwipe": True, "tabGestures": True})
    for bends in (ONE_FAN, [0, 0, 0, -60, -70, -40, -5, 0, 0, 0], ONE_FAN + ONE_FAN):
        events = types(run(armed(cfg), fan(bends)))
        assert EVENT_NEXT_TAB in events
        assert EVENT_MINIMIZE_WINDOW not in events and EVENT_RESTORE_WINDOW not in events, bends


def test_con_la_mano_ladeada_subir_trae_la_ventana_y_bajar_pasa_de_pestana() -> None:
    """23-11-2026. Con la mano ladeada, bajar las puntas rápido es geométricamente un abanico (la longitud aparente del
    dedo no los separa: varía 0,75-10× en los abanicos reales). Regla: ladeada y bajando = pestaña; subir y volver
    sigue trayendo la ventana. Sin gestos de pestaña, la misma bajada minimiza (antes una guarda por inclinación lo
    bloqueaba y dejó de bajar ventanas en vivo)."""
    from motor_local.interpreter import EVENT_MINIMIZE_WINDOW, EVENT_RESTORE_WINDOW

    def tilted(dy: float, tilt: float) -> HandLandmarks:
        lms = list(make_fan_hand(tilt=tilt).landmarks)
        for tip in (8, 12, 16, 20):
            lms[tip] = Point3D(lms[tip].x, lms[tip].y + dy)
        return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)

    for tilt in (60.0, 75.0):
        seq = lambda dy: [tilted(0.0, tilt)] * 4 + [tilted(dy, tilt), tilted(0.0, tilt)] + [tilted(0.0, tilt)] * 4
        frames = lambda dy: [(h, i * FAN_MS) for i, h in enumerate(seq(dy))]
        tabs = EngineConfig.from_dict({"windowSwipe": True, "tabGestures": True, "drag": False})
        no_tabs = EngineConfig.from_dict({"windowSwipe": True, "tabGestures": False, "drag": False})
        down = types(run(armed(tabs), frames(0.07)))
        # Nunca las dos cosas a la vez; muy ladeada (60°) gana la pestaña, casi vertical (75°) puede minimizar.
        assert down.count(EVENT_NEXT_TAB) + down.count(EVENT_MINIMIZE_WINDOW) == 1, (tilt, down)
        if tilt == 60.0:
            assert EVENT_NEXT_TAB in down
        up = types(run(armed(tabs), frames(-0.07)))
        assert up.count(EVENT_RESTORE_WINDOW) == 1 and EVENT_NEXT_TAB not in up, (tilt, up)
        assert types(run(armed(no_tabs), frames(0.07))).count(EVENT_MINIMIZE_WINDOW) == 1, tilt


def test_un_abanico_rapido_pero_suave_tambien_pasa_pestana() -> None:
    """Informe en vivo (23-11-2026): solo pasaba la pestaña «golpeando muy fuerte». Un abanico de ~25° por fotograma
    a 15 fps (375 °/s) y el mismo abanico a 30 fps deben pasar una pestaña; con el umbral anterior (500) no pasaban."""
    soft = [0, 0, 0, -25, -50, -60, -40, -15, 0, 0, 0]
    assert types(run(armed(), fan(soft))).count(EVENT_NEXT_TAB) == 1
    at_30 = [(make_fan_hand(bend=b), i * 1000.0 / 30) for i, b in enumerate([0] * 6 + [-12, -25, -37, -50, -58, -60, -50, -35, -20, -8] + [0] * 6)]
    assert types(run(armed(), at_30)).count(EVENT_NEXT_TAB) == 1


# ------------------------------------------------------------ dictado (🤙)

def test_llamada_sostenida_abre_el_dictado_una_vez() -> None:
    """23-11-2026 (demo): 🤙 sostenido medio segundo = Win+H. Una vez por postura; breve no cuenta."""
    from motor_local.interpreter import EVENT_DICTATION

    assert make_tab_pose().landmarks  # la antigua postura de pestañas es exactamente 🤙
    events = types(run(armed(), hold(make_tab_pose, 1200.0)))
    assert events.count(EVENT_DICTATION) == 1
    assert EVENT_DICTATION not in types(run(armed(), hold(make_tab_pose, 300.0)))
    # Soltar y volver a hacerla pasado el enfriamiento la cierra (Win+H otra vez).
    frames = list(hold(make_tab_pose, 700.0)) + list(hold(make_open_palm, 300.0, start=700.0)) + list(hold(make_tab_pose, 700.0, start=2300.0))
    assert types(run(armed(), frames)).count(EVENT_DICTATION) == 2


def test_llamada_respeta_su_interruptor_y_no_mueve_el_cursor() -> None:
    from motor_local.interpreter import EVENT_DICTATION

    assert EVENT_DICTATION not in types(run(armed(EngineConfig.from_dict({"dictation": False})), hold(make_tab_pose, 1200.0)))
    events = types(run(armed(), hold(make_tab_pose, 1200.0)))
    assert EVENT_MOVE_CURSOR not in events
    assert EngineConfig.from_dict({}).to_dict()["dictation"] is True


def test_llamada_solo_pulsa_win_h_en_control() -> None:
    from motor_local.interpreter import EVENT_DICTATION

    adapter = MockOSAdapter()
    engine = LogicalActionEngine(adapter, initial_mode=MODE_OBSERVATION)
    engine.dispatch([LogicalEvent(EVENT_DICTATION)])
    assert adapter.executed_actions == []
    engine.set_mode(MODE_CONTROL)
    engine.dispatch([LogicalEvent(EVENT_DICTATION)])
    assert adapter.executed_actions == [("KEY_COMBO", {"keys": ["win", "h"]})]
    assert ("win", "h") in ALLOWED_KEY_COMBOS


# ------------------------------------------------------------ abrir el teclado (☝️)

def test_indice_sostenido_y_quieto_pide_abrir_el_teclado() -> None:
    """23-11-2026: abrir el teclado Air-Swipe con un gesto en vez de ir a la app. Un evento por postura."""
    from motor_local.interpreter import EVENT_KEYBOARD
    from tests.test_gestos_catalogo import make_pointing

    assert types(run(armed(), hold(make_pointing, 1500.0))).count(EVENT_KEYBOARD) == 1
    assert EVENT_KEYBOARD not in types(run(armed(), hold(make_pointing, 700.0)))
    # Apuntar moviendo la mano (mover el cursor) no lo abre: la espera se reinicia.
    moving = [(make_pointing(cx=0.3 + 0.01 * i), i * FRAME_MS) for i in range(60)]
    assert EVENT_KEYBOARD not in types(run(armed(), moving))


def test_indice_sostenido_no_actua_con_el_teclado_abierto_ni_apagado() -> None:
    from motor_local.interpreter import EVENT_KEYBOARD
    from tests.test_gestos_catalogo import make_pointing

    interp = armed()
    interp.set_airswipe(True)  # con el teclado abierto, apuntar es trazar
    assert EVENT_KEYBOARD not in types(run(interp, hold(make_pointing, 1500.0)))
    assert EVENT_KEYBOARD not in types(run(armed(EngineConfig.from_dict({"keyboardGesture": False})), hold(make_pointing, 1500.0)))
    assert EVENT_KEYBOARD not in types(run(armed(EngineConfig.from_dict({"airswipe": False})), hold(make_pointing, 1500.0)))
    assert EngineConfig.from_dict({}).to_dict()["keyboardGesture"] is True


def test_abrir_teclado_va_a_la_interfaz_y_nunca_al_sistema() -> None:
    from motor_local.interpreter import EVENT_KEYBOARD

    for mode in (MODE_OBSERVATION, MODE_CONTROL):
        adapter = MockOSAdapter()
        engine = LogicalActionEngine(adapter, initial_mode=mode)
        engine.dispatch([LogicalEvent(EVENT_KEYBOARD, {"gesto": "indice_sostenido"})])
        assert adapter.executed_actions == []
        assert engine.take_app_events() == [{"event": EVENT_KEYBOARD, "gesto": "indice_sostenido"}]


# ------------------------------------------------------------ gestos del 23-11 (videos con la mano izquierda)

def test_pulgar_arriba_suelto_confirma_y_no_rompe_el_golpe_de_muneca() -> None:
    """Puño de lado con el pulgar fuera 0,5-0,7 palmas: la regla estricta no lo veía; la suelta sí (sostenido)."""
    from motor_local.interpreter import EVENT_CONFIRM

    def loose_thumb(cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
        lms = list(make_closed_fist(cx, cy).landmarks)
        lms[2] = Point3D(cx - 0.05, cy - 0.02)
        lms[3] = Point3D(cx - 0.06, cy - 0.06)
        lms[4] = Point3D(cx - 0.07, cy - 0.10)
        return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)

    events = types(run(armed(EngineConfig.from_dict({"thumbsUp": True})), hold(loose_thumb, 900.0)))
    assert events.count(EVENT_CONFIRM) == 1, events
    assert EVENT_CONFIRM not in types(run(armed(EngineConfig.from_dict({"thumbsUp": True})), hold(loose_thumb, 300.0)))


def test_abanico_hacia_el_menique_devuelve_la_pestana_y_su_vuelta_no_pasa() -> None:
    """Abanico inverso rápido (> 900 °/s) = pestaña anterior; la vuelta de un abanico normal no cuenta."""
    inverse = [0, 0, 0, 70, 80, 40, 5, 0, 0, 0]   # 70° en un fotograma a 15 fps ≈ 1050 °/s
    events = types(run(armed(), fan(inverse)))
    assert events.count(EVENT_PREV_TAB) == 1 and EVENT_NEXT_TAB not in events, events
    normal = types(run(armed(), fan(ONE_FAN)))
    assert normal.count(EVENT_NEXT_TAB) == 1 and EVENT_PREV_TAB not in normal, normal
    # Un giro inverso lento (impulso antes de abanicar) no devuelve la pestaña.
    assert EVENT_PREV_TAB not in types(run(armed(), fan([0, 0, 0, 30, 45, 30, 5, 0, 0, 0])))


def test_desplazar_con_la_mano_abierta_agarrando_primero() -> None:
    """Experimental (apagado por defecto): mano abierta quieta ~0,35 s agarra; subirla baja la página (táctil)."""
    from motor_local.interpreter import EVENT_SCROLL

    def frames(cfg):
        still = [(make_open_palm(0.5, 0.6), i * FRAME_MS) for i in range(15)]
        rise = [(make_open_palm(0.5, 0.6 - 0.02 * i), (15 + i) * FRAME_MS) for i in range(1, 15)]
        return [e for e in run(armed(EngineConfig.from_dict(cfg)), still + rise) if e.type == EVENT_SCROLL]

    on = frames({"openHandScroll": True})
    assert on and sum(e.payload["dy"] for e in on) < 0, [e.payload for e in on]
    assert frames({}) == [], "apagado por defecto: mover la mano abierta solo mueve el cursor"
    assert EngineConfig.from_dict({}).to_dict()["openHandScroll"] is False
