"""Contrato de capacidades del motor (copia local de contracts/capacidades.json).

El motor se distribuye sin el repositorio, por eso lleva su propia copia; una prueba comprueba que
ambas coinciden. Aquí se decide qué acción puede ejecutar cada gesto. Nada fuera de este contrato
se ejecuta: ni comandos, ni rutas, ni teclas que no estén en `teclas_permitidas`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_PATH = Path(__file__).with_name("capacidades.json")
CAPABILITIES: dict[str, Any] = json.loads(_PATH.read_text(encoding="utf-8"))

NO_ACTION = "sin_accion"
GESTURES: tuple[str, ...] = tuple(CAPABILITIES["gestos"])
ACTIONS: tuple[str, ...] = tuple(CAPABILITIES["acciones"])
DISCRETE_ACTIONS: tuple[str, ...] = tuple(CAPABILITIES["acciones_discretas"])
KNOWN_GESTURES = frozenset(GESTURES)
KNOWN_ACTIONS = frozenset(ACTIONS)
# Gesto -> acción predeterminada del catálogo.
DEFAULT_ACTION: dict[str, str] = {code: entry["predeterminada"] for code, entry in CAPABILITIES["gestos"].items()}
# Gesto -> interruptor camelCase de la interfaz (None para liberacion_pinza).
GESTURE_TOGGLE: dict[str, str | None] = {code: entry.get("interruptor") for code, entry in CAPABILITIES["gestos"].items()}
TOGGLE_GESTURE: dict[str, str] = {toggle: code for code, toggle in GESTURE_TOGGLE.items() if toggle}
# Valor inicial de cada interruptor (coherente con la interfaz).
TOGGLE_DEFAULTS: dict[str, bool] = dict(CAPABILITIES["predeterminados_interfaz"])
# Acción -> combinación de teclas permitida (única vía hacia el teclado del SO).
ALLOWED_KEYS: dict[str, tuple[str, ...]] = {accion: tuple(keys) for accion, keys in CAPABILITIES["teclas_permitidas"].items()}
# Gestos locales del equipo (no se sincronizan ni están en el catálogo de la base) -> teclas permitidas.
# Hoy: abanico con la mano ladeada -> pestaña siguiente (Ctrl+Tab). La anterior queda permitida pero sin gesto.
DEVICE_KEYS: dict[str, tuple[str, ...]] = {nombre: tuple(keys) for nombre, keys in CAPABILITIES.get("teclas_equipo", {}).items()}
# Acciones que no tocan el SO: se entregan a la interfaz de ZeroTouch.
APP_ACTIONS: frozenset[str] = frozenset(CAPABILITIES["eventos_interfaz"])
# Gestos discretos (los que admiten acción configurable).
DISCRETE_GESTURES: tuple[str, ...] = tuple(code for code, entry in CAPABILITIES["gestos"].items() if entry["tipo"] == "discreto")


def is_allowed(gesto: str, accion: str, habilitado: bool = True) -> bool:
    """Una asignación habilitada es válida solo si el contrato la lista; sin_accion siempre vale."""
    entry = CAPABILITIES["gestos"].get(gesto)
    if entry is None or accion not in KNOWN_ACTIONS:
        return False
    if not habilitado or accion == NO_ACTION:
        return True
    return accion in entry["acciones"]


def default_bindings() -> dict[str, dict[str, Any]]:
    """Asignaciones iniciales: acción predeterminada y el interruptor de la interfaz."""
    result: dict[str, dict[str, Any]] = {}
    for code in GESTURES:
        toggle = GESTURE_TOGGLE[code]
        enabled = TOGGLE_DEFAULTS.get(toggle, True) if toggle else True
        result[code] = {"accion": DEFAULT_ACTION[code], "habilitado": bool(enabled)}
    return result
