"""El contrato de capacidades del motor coincide con el del repositorio y todo lo que promete se ejecuta."""

from __future__ import annotations

import json
from pathlib import Path

from motor_local import capabilities as caps
from motor_local.action_engine import ALLOWED_EVENTS
from motor_local.interpreter import ACTION_EVENTS
from motor_local.os_adapter import ALLOWED_KEY_COMBOS

ROOT_CONTRACT = Path(__file__).resolve().parents[2] / "contracts" / "capacidades.json"


def test_motor_copy_matches_repository_contract() -> None:
    if not ROOT_CONTRACT.is_file():
        return  # motor distribuido sin el repositorio: solo aplica la copia local
    assert json.loads(ROOT_CONTRACT.read_text(encoding="utf-8")) == caps.CAPABILITIES


def test_every_allowed_binding_is_executable_by_the_motor() -> None:
    continuous = {"activar_puntero", "clic", "arrastrar", "soltar", "desplazar", "pausar", "escritura_airswipe"}
    for code, entry in caps.CAPABILITIES["gestos"].items():
        for accion in entry["acciones"]:
            assert accion in caps.KNOWN_ACTIONS
            if accion in continuous:
                continue
            assert accion in ACTION_EVENTS, f"{code}: {accion} no tiene evento lógico"
            assert ACTION_EVENTS[accion] in ALLOWED_EVENTS
        assert entry["predeterminada"] in entry["acciones"], f"{code}: la acción predeterminada debe ser ejecutable"
    for accion, keys in caps.ALLOWED_KEYS.items():
        assert tuple(keys) in ALLOWED_KEY_COMBOS, accion
    assert caps.is_allowed("palma_abierta", "sin_accion")
    assert not caps.is_allowed("palma_abierta", "clic")
    assert caps.is_allowed("palma_abierta", "clic", habilitado=False)
    assert set(caps.DISCRETE_GESTURES) == {"palma_abierta"}
    assert not caps.is_allowed("pulgar_arriba", "sin_accion"), "gesto retirado el 24-11-2026"


def test_default_bindings_follow_interface_defaults() -> None:
    bindings = caps.default_bindings()
    assert set(bindings) == caps.KNOWN_GESTURES
    assert bindings["micro_pinza"] == {"accion": "clic", "habilitado": True}
    assert bindings["palma_abierta"] == {"accion": "navegacion", "habilitado": True}
    assert len(bindings) == 8
    assert bindings["liberacion_pinza"]["habilitado"] is True
