"""La pinza no EMPIEZA con la mano desplazándose rápido (23-11-2026, en vivo: un movimiento lateral rápido con el
pulgar junto al índice se leía como pinza sostenida y arrastraba la ventana al borde). Con la mano quieta, clic y
arrastre funcionan como siempre."""

from __future__ import annotations

from motor_local.config import EngineConfig
from tests.test_engine import armed, make_open_palm


def test_mover_la_mano_rapido_con_el_pulgar_junto_al_indice_no_arrastra_la_ventana() -> None:
    """23-11-2026, en vivo: durante un movimiento rápido el pulgar junto al índice se leía como pinza sostenida, empezaba un
    arrastre y Windows acoplaba la ventana al borde derecho. Con la mano rápida no empieza ninguna pinza."""
    from motor_local.interpreter import EVENT_LEFT_CLICK, EVENT_START_DRAG

    interp = armed(EngineConfig.from_dict({"drag": True}))
    xs = [0.3] * 5 + [0.3 + 0.05 * i for i in range(1, 13)]      # ~4,7 palmas/s hacia la derecha durante 800 ms
    hands = [make_open_palm(x, 0.5, pinch_dist=0.14 if i < 5 else 0.02) for i, x in enumerate(xs)]
    hands += [make_open_palm(xs[-1], 0.5, pinch_dist=0.14)] * 6   # se detiene y abre la mano
    seen = [e.type for i, h in enumerate(hands) for e in interp.process_frame(h, now_ms=i * 1000.0 / 15)]
    assert EVENT_START_DRAG not in seen and EVENT_LEFT_CLICK not in seen, seen


def test_con_la_mano_quieta_la_pinza_sigue_haciendo_clic_y_arrastre() -> None:
    from motor_local.interpreter import EVENT_LEFT_CLICK, EVENT_START_DRAG

    interp = armed(EngineConfig.from_dict({"drag": True}))
    click = [make_open_palm(0.5, 0.5, pinch_dist=0.14)] * 4 + [make_open_palm(0.5, 0.5, pinch_dist=0.02)] * 4
    click += [make_open_palm(0.5, 0.5, pinch_dist=0.14)] * 4
    assert [e.type for i, h in enumerate(click) for e in interp.process_frame(h, now_ms=i * 1000.0 / 15)
            if e.type in (EVENT_LEFT_CLICK, EVENT_START_DRAG)] == [EVENT_LEFT_CLICK]
    interp = armed(EngineConfig.from_dict({"drag": True}))
    # 18 fotogramas = 1,2 s de pinza: por encima de drag_hold_ms (0,9 s desde el 24-11-2026).
    drag = [make_open_palm(0.5, 0.5, pinch_dist=0.14)] * 4 + [make_open_palm(0.5, 0.5, pinch_dist=0.02)] * 18
    assert EVENT_START_DRAG in [e.type for i, h in enumerate(drag) for e in interp.process_frame(h, now_ms=i * 1000.0 / 15)]

