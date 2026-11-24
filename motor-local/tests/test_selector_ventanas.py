"""Selector de ventanas (23-11-2026, pedido): los tres dedos de Alt+Tab MANTENIDOS abajo dejan Alt pulsado para que
Windows muestre todas las ventanas; mantenidos más tiempo pasan a la siguiente; al subirlos se suelta Alt."""

from __future__ import annotations

from motor_local.action_engine import LogicalActionEngine
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import ALT_HOLD_STEP_MS, EVENT_ALT_SWITCHER, EVENT_ALT_TAB
from motor_local.os_adapter import MockOSAdapter
from tests.test_golpe_muneca import FRAME_MS, config, flick_hand
from tests.test_engine import armed

THREE = (8, 12, 16)
REST = [flick_hand(0.0, fingers=THREE)] * 4


def down(thumb_out: bool = False) -> HandLandmarks:
    """Tres dedos abajo y meñique arriba. Pulgar recogido junto al nudillo del índice (video «alt tab»: 0,35-0,51
    palmas) o afuera como en la llamada del dictado (la mano sintética lo tiene a ~1,4 palmas)."""
    hand = flick_hand(0.07, fingers=THREE)
    if thumb_out:
        return hand
    lms = list(hand.landmarks)
    lms[4] = Point3D(lms[5].x + 0.01, lms[5].y + 0.02)
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def phases(interp, hands, start: float = 0.0) -> list[str]:
    out = []
    for i, hand in enumerate(hands):
        for event in interp.process_frame(hand, now_ms=start + i * FRAME_MS):
            if event.type == EVENT_ALT_SWITCHER:
                out.append(event.payload["fase"])
            elif event.type == EVENT_ALT_TAB:
                out.append("ALT_TAB")
    return out


def test_mantener_los_tres_dedos_abre_el_selector_avanza_y_suelta_al_subirlos() -> None:
    hold = REST + [down()] * 45 + REST   # 3 s abajo a 15 fps
    got = phases(armed(config(windowSwipe=False)), hold)
    assert got[0] == "abrir" and got[-1] == "soltar", got
    assert got.count("abrir") == 1 and got.count("soltar") == 1, got
    # ~2,5 s mantenido tras abrir: una ventana más por segundo.
    assert got.count("siguiente") == int((45 * FRAME_MS - 500) // ALT_HOLD_STEP_MS), got
    assert "ALT_TAB" not in got, "subir los dedos suelta Alt: no es además el Alt+Tab rápido"


def test_bajar_y_subir_rapido_sigue_siendo_el_alt_tab_directo() -> None:
    quick = REST + [down(), flick_hand(0.0, fingers=THREE)] + REST
    assert phases(armed(config(windowSwipe=False)), quick) == ["ALT_TAB"]


def test_poco_tiempo_abajo_no_abre_el_selector() -> None:
    short = REST + [down()] * 6 + REST   # 400 ms
    assert "abrir" not in phases(armed(config(windowSwipe=False)), short)


def test_con_el_pulgar_afuera_es_el_dictado_no_el_selector() -> None:
    call = REST + [down(thumb_out=True)] * 20 + REST
    assert "abrir" not in phases(armed(config(windowSwipe=False)), call)
    # Sin el dictado, el pulgar no importa.
    assert "abrir" in phases(armed(config(windowSwipe=False, dictation=False)), call)


def test_respeta_el_interruptor_y_un_fotograma_dudoso_no_suelta() -> None:
    hold = REST + [down()] * 20 + REST
    assert phases(armed(config(windowSwipe=False, altTab=False)), hold) == []
    flicker = REST + [down()] * 12 + [flick_hand(0.0, fingers=THREE)] + [down()] * 12 + REST
    got = phases(armed(config(windowSwipe=False)), flicker)
    assert got.count("abrir") == 1 and got.count("soltar") == 1, got


def test_perder_la_mano_con_el_selector_abierto_lo_cancela_sin_cambiar_de_ventana() -> None:
    interp = armed(config(windowSwipe=False))
    adapter = MockOSAdapter()
    engine = LogicalActionEngine(adapter)
    engine.set_mode("CONTROL")
    hands = REST + [down()] * 15 + [None] * 30
    for i, hand in enumerate(hands):
        engine.dispatch(interp.process_frame(hand, now_ms=i * FRAME_MS))
    done = [a[1]["fase"] for a in adapter.executed_actions if a[0] == "ALT_SWITCHER"]
    assert done == ["abrir", "cancelar"], done
    assert not getattr(adapter, "alt_held", False)
    # La mano vuelve con la postura de reposo: no queda nada a medias.
    later = phases(interp, REST * 3, start=len(hands) * FRAME_MS)
    assert later == []


def test_en_control_llega_al_sistema_y_la_pausa_lo_cancela() -> None:
    interp = armed(config(windowSwipe=False))
    adapter = MockOSAdapter()
    engine = LogicalActionEngine(adapter)
    engine.set_mode("CONTROL")
    for i, hand in enumerate(REST + [down()] * 30 + REST):
        engine.dispatch(interp.process_frame(hand, now_ms=i * FRAME_MS))
    done = [a[1]["fase"] for a in adapter.executed_actions if a[0] == "ALT_SWITCHER"]
    assert done[0] == "abrir" and done[-1] == "soltar" and "siguiente" in done, done
    # Abierto y en pausa (puño, parada, Observar): Esc + soltar Alt.
    adapter.alt_switcher("abrir")
    engine.set_mode("OBSERVATION")
    assert adapter.executed_actions[-1] == ("ALT_SWITCHER", {"fase": "cancelar"})
