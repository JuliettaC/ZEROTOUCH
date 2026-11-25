"""Teclado Air-Swipe según el foco (24-11-2026): se abre al entrar en un campo de texto y se cierra al salir.
Sin Windows real: la regla de «editable», el vigilante y su paso a eventos se prueban con muestras ficticias."""

from __future__ import annotations

import time

from motor_local.action_engine import MODE_CONTROL, LogicalActionEngine
from motor_local.interpreter import EVENT_KEYBOARD, EVENT_KEYBOARD_CLOSE
from motor_local.os_adapter import MockOSAdapter
from motor_local.text_focus import (
    CONTROL_COMBO_BOX,
    CONTROL_DOCUMENT,
    CONTROL_EDIT,
    FOCUS_STABLE_MS,
    FocusPoller,
    TextFocusWatcher,
    is_editable,
    keyboard_events,
)

BUTTON, PANE = 50000, 50033


def test_regla_de_campo_editable() -> None:
    assert is_editable(CONTROL_EDIT, True, True, False)
    assert is_editable(CONTROL_EDIT, True, None, None), "un Edit sin patrón de valor sigue siendo un campo"
    assert not is_editable(CONTROL_EDIT, True, True, True), "solo lectura"
    assert not is_editable(CONTROL_EDIT, False, True, False), "deshabilitado"
    assert is_editable(CONTROL_DOCUMENT, True, True, False), "documento editable (procesador de texto)"
    assert not is_editable(CONTROL_DOCUMENT, True, False, None), "una página web que solo se lee"
    assert not is_editable(CONTROL_DOCUMENT, True, True, True)
    assert is_editable(CONTROL_COMBO_BOX, True, True, False), "cuadro combinado donde se escribe"
    assert not is_editable(CONTROL_COMBO_BOX, True, False, None), "lista desplegable"
    assert not is_editable(BUTTON, True, False, True)
    assert not is_editable(None, True, True, False)


def feed(watcher: TextFocusWatcher, samples) -> list[str]:
    """samples = [(editable, desde_ms, hasta_ms)] muestreado cada 50 ms."""
    orders = []
    for editable, start, end in samples:
        t = start
        while t < end:
            order = watcher.update(editable, t)
            if order:
                orders.append(order)
            t += 50
    return orders


def test_entrar_y_salir_de_un_campo_abre_y_cierra() -> None:
    orders = feed(TextFocusWatcher(), [(False, 0, 1000), (True, 1000, 2000), (False, 2000, 3000)])
    assert orders == ["open", "close"]


def test_un_salto_breve_del_foco_no_cierra_ni_abre() -> None:
    # Al hacer clic el foco pasa un instante por la ventana o un botón antes de llegar al campo.
    blip = FOCUS_STABLE_MS - 100
    orders = feed(TextFocusWatcher(), [(True, 0, 1000), (False, 1000, 1000 + blip), (True, 1000 + blip, 3000)])
    assert orders == ["open"]
    orders = feed(TextFocusWatcher(), [(False, 0, 1000), (True, 1000, 1000 + blip), (False, 1000 + blip, 3000)])
    assert orders == []


def test_al_empezar_fuera_de_un_campo_no_cierra_el_teclado_abierto_con_su_boton() -> None:
    assert feed(TextFocusWatcher(), [(False, 0, 3000)]) == []


def test_pasar_de_un_campo_a_otro_no_cierra() -> None:
    assert feed(TextFocusWatcher(), [(True, 0, 1000), (True, 1000, 2000)]) == ["open"]


def test_sin_respuesta_de_la_sonda_no_decide_nada() -> None:
    assert feed(TextFocusWatcher(), [(True, 0, 1000), (None, 1000, 3000)]) == ["open"]


def test_solo_actua_en_control_y_al_activarse_abre_si_ya_hay_un_campo() -> None:
    watcher = TextFocusWatcher()
    assert all(keyboard_events(watcher, True, t, active=False) == [] for t in range(0, 1000, 50))
    seen = [e for t in range(1000, 2000, 50) for e in keyboard_events(watcher, True, t, active=True)]
    assert [e.type for e in seen] == [EVENT_KEYBOARD] and seen[0].payload == {"origen": "foco"}
    seen = [e for t in range(2000, 3000, 50) for e in keyboard_events(watcher, False, t, active=True)]
    assert [e.type for e in seen] == [EVENT_KEYBOARD_CLOSE]


def test_las_ordenes_del_foco_van_a_la_interfaz_y_nunca_al_sistema() -> None:
    adapter = MockOSAdapter()
    engine = LogicalActionEngine(adapter, initial_mode=MODE_CONTROL)
    watcher = TextFocusWatcher()
    for t in range(0, 1000, 50):
        engine.dispatch(keyboard_events(watcher, True, t, active=True))
    for t in range(1000, 2000, 50):
        engine.dispatch(keyboard_events(watcher, False, t, active=True))
    assert adapter.executed_actions == []
    assert [e["event"] for e in engine.take_app_events()] == [EVENT_KEYBOARD, EVENT_KEYBOARD_CLOSE]


class _FakeProbe:
    def __init__(self, values) -> None:
        self.values = list(values)

    def editable_focus(self):
        if len(self.values) > 1:
            return self.values.pop(0)
        return self.values[0]


def test_el_hilo_de_consulta_publica_la_ultima_respuesta_y_sobrevive_a_errores() -> None:
    poller = FocusPoller(lambda: _FakeProbe([True]), interval_ms=5).start()
    deadline = time.monotonic() + 2
    while poller.latest() is None and time.monotonic() < deadline:
        time.sleep(0.01)
    poller.stop()
    assert poller.latest() is True

    def broken():
        raise OSError("sin UI Automation")

    failed = FocusPoller(broken, interval_ms=5).start()
    time.sleep(0.05)
    failed.stop()
    assert failed.latest() is None
