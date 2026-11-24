"""Sacudida lateral para pestañas (23-11-2026, pedido «mover la mano de lado a lado»): ida rápida a un lado y vuelta.
Derecha = pestaña siguiente; izquierda = anterior. Mover el cursor (sin vuelta) no cambia de pestaña."""

from __future__ import annotations

from motor_local.config import EngineConfig
from motor_local.interpreter import EVENT_NEXT_TAB, EVENT_PREV_TAB
from tests.test_engine import armed, make_open_palm

TABS = {EVENT_NEXT_TAB, EVENT_PREV_TAB}


def cfg(**extra) -> EngineConfig:
    return EngineConfig.from_dict({"drag": False, "tabGestures": True, **extra})


def path(xs, y: float = 0.5, ys=None):
    return [make_open_palm(x, ys[i] if ys else y) for i, x in enumerate(xs)]


def tabs(hands, fps: float = 15.0, interp=None) -> list[str]:
    interp = interp or armed(cfg())
    return [e.type for i, h in enumerate(hands) for e in interp.process_frame(h, now_ms=i * 1000.0 / fps)
            if e.type in TABS]


def wave(sign: float, step: float = 0.07, n: int = 3, x0: float = 0.5) -> list[float]:
    """Quieta, ida de n pasos y vuelta de n pasos, quieta (palma = 0,16: 0,07 por paso a 15 fps = 6,6 palmas/s)."""
    out = [x0 + sign * step * i for i in range(1, n + 1)]
    return [x0] * 5 + out + out[-2::-1] + [x0] * 6


def test_sacudida_a_la_derecha_pasa_a_la_pestana_siguiente_una_vez() -> None:
    assert tabs(path(wave(+1))) == [EVENT_NEXT_TAB]


def test_sacudida_a_la_izquierda_vuelve_a_la_pestana_anterior() -> None:
    assert tabs(path(wave(-1))) == [EVENT_PREV_TAB]


def test_tambien_a_30_fps() -> None:
    xs = wave(+1, step=0.035, n=6)
    assert tabs(path(xs), fps=30.0) == [EVENT_NEXT_TAB]


def test_mover_el_cursor_rapido_sin_volver_no_cambia_de_pestana() -> None:
    xs = [0.3] * 5 + [0.3 + 0.07 * i for i in range(1, 7)] + [0.72] * 10
    assert tabs(path(xs)) == []


def test_un_vaiven_lento_de_ajustar_el_cursor_no_cambia_de_pestana() -> None:
    assert tabs(path(wave(+1, step=0.015, n=5))) == []


def test_sacudir_varias_veces_seguidas_no_alterna_siguiente_y_anterior() -> None:
    # Ida-vuelta-ida-vuelta sin pausa: una sola pestaña siguiente.
    one = wave(+1)
    shaking = one[:-6] + [0.5 - 0.07, 0.5 - 0.14, 0.5 - 0.21, 0.5 - 0.14, 0.5 - 0.07] + [0.5] * 6
    assert tabs(path(shaking)) == [EVENT_NEXT_TAB]
    # Con una pausa quieta entre medio, dos pestañas.
    assert tabs(path(wave(+1) + wave(+1)[5:])) == [EVENT_NEXT_TAB, EVENT_NEXT_TAB]


def test_una_sacudida_vertical_no_es_de_pestanas() -> None:
    ys = wave(+1)
    assert tabs([make_open_palm(0.5 + (y - 0.5) * 0.3, y) for y in ys]) == []


def test_respeta_el_interruptor_de_pestanas() -> None:
    assert tabs(path(wave(+1)), interp=armed(cfg(tabGestures=False))) == []


def test_mover_el_cursor_y_corregir_un_poco_hacia_atras_no_cambia_de_pestana() -> None:
    """La vuelta debe recorrer gran parte de la ida (WAVE_RETURN_FRAC): un pequeño ajuste de vuelta no basta."""
    xs = [0.3] * 5 + [0.3 + 0.07 * i for i in range(1, 7)] + [0.72 - 0.03, 0.72 - 0.06] + [0.66] * 8
    assert tabs(path(xs)) == []
    # Ida de 1,3 palmas y vuelta de solo el 55 %: tampoco.
    assert tabs(path([0.5] * 5 + [0.57, 0.64, 0.71, 0.65, 0.595] + [0.595] * 8)) == []


def test_sacudir_sin_parar_varias_veces_da_una_sola_pestana() -> None:
    """Tras un cambio hace falta quietud (WAVE_STILL_SPEED durante WAVE_REARM_MS); el enfriamiento solo no basta."""
    right = [0.5 + 0.06 * i for i in range(1, 5)] + [0.5 + 0.06 * i for i in range(3, -1, -1)]
    left = [0.5 - 0.06 * i for i in range(1, 5)] + [0.5 - 0.06 * i for i in range(3, -1, -1)]
    xs = [0.5] * 5 + right + left + right + left + [0.5] * 6
    assert tabs(path(xs)) == [EVENT_NEXT_TAB]


def test_una_ida_algo_lenta_no_cuenta() -> None:
    """0,9 palmas en 400 ms (2,25 palmas/s) es un movimiento normal del cursor, no una sacudida (WAVE_MIN_SPEED)."""
    assert tabs(path(wave(+1, step=0.024, n=6))) == []


def test_tras_un_cambio_una_pausa_muy_breve_no_rearma() -> None:
    """Ida y vuelta a la derecha, 3 fotogramas quieta (200 ms < WAVE_REARM_MS) y sacudida a la izquierda: solo la
    primera cuenta (el rebote de la mano tras una sacudida no debe devolver la pestaña)."""
    right = [0.5 + 0.06 * i for i in range(1, 5)] + [0.5 + 0.06 * i for i in range(3, -1, -1)]
    left = [0.5 - 0.06 * i for i in range(1, 5)] + [0.5 - 0.06 * i for i in range(3, -1, -1)]
    xs = [0.5] * 5 + right + [0.5] * 3 + left + [0.5] * 6
    assert tabs(path(xs)) == [EVENT_NEXT_TAB]


def test_una_sacudida_en_diagonal_no_es_de_pestanas() -> None:
    """El desvío vertical no puede pasar de WAVE_MAX_VERTICAL de la ida (aquí 0,75 de la ida)."""
    xs = wave(+1)
    assert tabs([make_open_palm(x, 0.5 + (x - 0.5) * 0.75) for x in xs]) == []
