"""Ajustes del 24-11-2026 (pedido en vivo): arrastre más largo, desplazar doblando dos dedos y pestañas que no se
deshacen con la vuelta de la mano. Manos sintéticas; los umbrales se midieron con los videos de la persona usuaria."""

from __future__ import annotations

from motor_local.config import EngineConfig
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import (
    CURL_HOLD_MS,
    EVENT_LEFT_CLICK,
    EVENT_NEXT_TAB,
    EVENT_PREV_TAB,
    EVENT_RIGHT_CLICK,
    EVENT_SCROLL,
    EVENT_START_DRAG,
    TAB_FAN_OPPOSITE_MS,
)
from tests.test_engine import armed, make_open_palm
from tests.test_gestos_equipo_pc import ONE_FAN, fan, run as run_timed, types

FRAME_MS = 1000.0 / 15


def make_curl(cx: float = 0.5, cy: float = 0.5, thumb_out: bool = False) -> HandLandmarks:
    """Índice y medio doblados hacia la palma; anular y meñique arriba; pulgar recogido (o afuera)."""
    lms = list(make_open_palm(cx, cy).landmarks)
    lms[6] = Point3D(cx - 0.04, cy - 0.05)
    lms[8] = Point3D(cx - 0.03, cy + 0.01)
    lms[10] = Point3D(cx, cy - 0.05)
    lms[12] = Point3D(cx + 0.005, cy + 0.01)
    lms[4] = Point3D(cx + 0.20, cy - 0.10) if thumb_out else Point3D(cx + 0.01, cy + 0.05)
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def run(hands, interp=None, start: float = 0.0):
    interp = interp or armed(EngineConfig.from_dict({"drag": False}))
    return [e for i, h in enumerate(hands) for e in interp.process_frame(h, now_ms=start + i * FRAME_MS)]


def frames(ms: float) -> int:
    return max(1, round(ms / FRAME_MS))


def scrolls(events) -> list[int]:
    return [e.payload["dy"] for e in events if e.type == EVENT_SCROLL]


OPEN = make_open_palm()


# --------------------------------------------------------------------------- desplazar doblando dos dedos

def test_un_toque_de_dos_dedos_sube_la_pagina_una_vez() -> None:
    dys = scrolls(run([OPEN] * 5 + [make_curl()] * frames(270) + [OPEN] * 5))
    assert len(dys) == 1 and dys[0] > 0, dys


def test_tres_toques_suben_tres_veces() -> None:
    tap = [make_curl()] * frames(250) + [OPEN] * frames(400)
    dys = scrolls(run([OPEN] * 5 + tap * 3))
    assert len(dys) == 3 and all(d > 0 for d in dys), dys


def test_mantener_los_dedos_doblados_baja_sin_parar_y_al_soltar_no_sube() -> None:
    dys = scrolls(run([OPEN] * 5 + [make_curl()] * frames(CURL_HOLD_MS + 1500) + [OPEN] * 5))
    assert dys and all(d < 0 for d in dys), dys
    assert -sum(dys) >= 8, f"1,5 s de bajada continua deberían ser varias muescas: {dys}"


def test_la_postura_de_paso_entre_otros_gestos_no_desplaza() -> None:
    # Videos: al pasar por el dictado o el golpe de muñeca la postura aparece solo 2 fotogramas.
    assert not scrolls(run([OPEN] * 5 + [make_curl()] * 2 + [OPEN] * 5))


def test_con_el_pulgar_afuera_no_es_el_gesto_de_desplazar() -> None:
    assert not scrolls(run([OPEN] * 5 + [make_curl(thumb_out=True)] * frames(270) + [OPEN] * 5))
    assert not scrolls(run([OPEN] * 5 + [make_curl(thumb_out=True)] * frames(1500) + [OPEN] * 5))


def test_doblar_dos_dedos_no_hace_clic_ni_clic_derecho() -> None:
    kinds = {e.type for e in run([OPEN] * 5 + ([make_curl()] * frames(270) + [OPEN] * 6) * 2)}
    assert not {EVENT_LEFT_CLICK, EVENT_RIGHT_CLICK, EVENT_START_DRAG} & kinds, kinds


def test_respeta_el_interruptor_de_desplazar() -> None:
    interp = armed(EngineConfig.from_dict({"drag": False, "scroll": False}))
    assert not scrolls(run([OPEN] * 5 + [make_curl()] * frames(1500) + [OPEN] * 5, interp))


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


# --------------------------------------------------------------------------- pestañas

INVERSE_FAN = [0, 0, 0, 70, 80, 40, 5, 0, 0, 0]   # ~1050 °/s hacia el meñique: pestaña anterior
FAN_STEP_MS = 1000.0 / 15


def test_la_vuelta_del_abanico_inverso_no_pasa_a_la_siguiente() -> None:
    # Video «devolver pestaña»: tras la anterior, la mano vuelve con un giro hacia el pulgar 380 ms después.
    # La mano se queda un instante en el extremo (el abanico se rearma) y regresa rápido hacia el pulgar.
    seq = [0, 0, 0, 70, 80, 80, 80, 80, 80, 30, 0, 0, 0]
    events = types(run_timed(armed(), fan(seq)))
    assert events.count(EVENT_PREV_TAB) == 1 and EVENT_NEXT_TAB not in events, events


def test_la_vuelta_del_abanico_normal_no_devuelve_la_pestana() -> None:
    seq = [0, 0, 0, -45, -55, -55, -55, -55, -55, 10, 0, 0, 0]   # regreso ~975 °/s hacia el meñique
    events = types(run_timed(armed(), fan(seq)))
    assert events.count(EVENT_NEXT_TAB) == 1 and EVENT_PREV_TAB not in events, events


def test_pasado_el_bloqueo_el_sentido_contrario_vuelve_a_funcionar() -> None:
    interp = armed()
    first = types(run_timed(interp, fan(INVERSE_FAN)))
    pause = int(TAB_FAN_OPPOSITE_MS / FAN_STEP_MS) + 2
    later = types(run_timed(interp, fan([0] * pause + ONE_FAN, start=len(INVERSE_FAN) * FAN_STEP_MS)))
    assert first.count(EVENT_PREV_TAB) == 1 and later.count(EVENT_NEXT_TAB) == 1, (first, later)
