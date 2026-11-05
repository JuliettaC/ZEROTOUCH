"""Importación explícita de la exportación `GET /api/v1/modos/:id/gestos` (formato_version 1).

Forma aceptada (contrato docs/api/openapi.yaml, componente Configuracion):
  {"formato_version": 1,
   "modo": {nombre, categoria, plataforma, sensibilidad_puntero, estabilizacion_puntero,
            tolerancia_micro_pinza, desk_rest_habilitado, asistencia_mirada_habilitada?,
            activacion_contextual_movil?, id?, perfil_id?, version?, creado_en?, actualizado_en?},
   "gestos": [{gesto_codigo, nombre, accion_codigo, habilitado, asignacion_version}, ...]}

Reglas:
- Claves desconocidas, tipos o rangos inválidos, formato distinto de 1, gestos desconocidos,
  duplicados o ausentes y cualquier clave con nombre de credencial -> rechazo (ConfigError).
- Una asignación HABILITADA solo se acepta si el motor implementa esa acción para ese gesto.
  Las asignaciones deshabilitadas, o con acción no implementada y deshabilitada, se aceptan
  y quedan listadas en `notes` como inactivas. Nada se convierte silenciosamente en default.
- Campos de runtime local (cámara, espejo, mano preferida, área de movimiento, confianza) no
  forman parte de la exportación: se leen de `runtime` con las mismas reglas que el IPC.
- Este módulo no abre red, no lee archivos y no contiene credenciales.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import Any, Mapping

from .config import ConfigError, EngineConfig

SUPPORTED_EXPORT_VERSIONS = frozenset({1})

# Catálogo de gestos sembrado en db/schema.sql (13 códigos).
KNOWN_GESTURES = frozenset(
    {
        "mano_abierta_sostenida",
        "micro_pinza",
        "pinza_sostenida",
        "liberacion_pinza",
        "palma_abierta",
        "puno_cerrado",
        "deslizamiento_izquierda",
        "deslizamiento_derecha",
        "dos_dedos",
        "pulgar_arriba",
        "pulgar_abajo",
        "modo_precision",
        "trazo_airswipe",
    }
)

# Acción que el motor SÍ ejecuta para cada gesto. Cualquier otra combinación habilitada se rechaza.
IMPLEMENTED_BINDINGS: dict[str, str] = {
    "mano_abierta_sostenida": "activar_puntero",
    "micro_pinza": "clic",
    "pinza_sostenida": "arrastrar",
    "liberacion_pinza": "soltar",  # implícita en el arrastre; no tiene interruptor propio
    "dos_dedos": "desplazar",
    "puno_cerrado": "pausar",
}

# Interruptor del motor controlado por cada gesto implementado.
GESTURE_FLAG: dict[str, str] = {
    "mano_abierta_sostenida": "pointer_enabled",
    "micro_pinza": "pinch_enabled",
    "pinza_sostenida": "drag_enabled",
    "dos_dedos": "scroll_enabled",
    "puno_cerrado": "fist_pause_enabled",
}

_MODO_REQUIRED = frozenset(
    {
        "nombre",
        "categoria",
        "plataforma",
        "sensibilidad_puntero",
        "estabilizacion_puntero",
        "tolerancia_micro_pinza",
        "desk_rest_habilitado",
    }
)
_MODO_OPTIONAL_BOOL = frozenset({"asistencia_mirada_habilitada", "activacion_contextual_movil"})
_MODO_METADATA = frozenset({"id", "perfil_id", "version", "creado_en", "actualizado_en"})
_CATEGORIAS = frozenset({"manual", "oficina", "accesibilidad", "personalizado"})
_GESTO_KEYS = frozenset({"gesto_codigo", "nombre", "accion_codigo", "habilitado", "asignacion_version"})
_TOP_KEYS = frozenset({"formato_version", "modo", "gestos"})
_FORBIDDEN_KEY_PARTS = ("token", "csrf", "cookie", "contrasena", "password", "secret", "session", "sesion")


@dataclass(frozen=True)
class ImportedConfig:
    config: EngineConfig
    gestures: dict[str, dict[str, Any]]  # gesto_codigo -> {accion_codigo, habilitado}
    notes: tuple[str, ...] = field(default_factory=tuple)
    mode_name: str = ""


def _reject(code: str, message: str) -> ConfigError:
    return ConfigError(code, message)


def _check_no_credentials(node: Any, path: str = "") -> None:
    if isinstance(node, Mapping):
        for key, value in node.items():
            lowered = str(key).lower()
            if any(part in lowered for part in _FORBIDDEN_KEY_PARTS):
                raise _reject("CREDENTIALS_NOT_ALLOWED", f"El documento no puede contener credenciales ({path}{key}).")
            _check_no_credentials(value, f"{path}{key}.")
    elif isinstance(node, list):
        for item in node:
            _check_no_credentials(item, path)


def _int_0_100(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise _reject("FIELD_INVALID", f"{name} debe ser un entero JSON.")
    if value < 0 or value > 100:
        raise _reject("FIELD_OUT_OF_RANGE", f"{name} debe estar entre 0 y 100.")
    return value


def _bool(value: Any, name: str) -> bool:
    if not isinstance(value, bool):
        raise _reject("FIELD_INVALID", f"{name} debe ser booleano JSON.")
    return value


def _parse_modo(modo: Any) -> tuple[dict[str, Any], str, list[str]]:
    if not isinstance(modo, Mapping):
        raise _reject("FIELD_INVALID", "modo debe ser un objeto.")
    allowed = _MODO_REQUIRED | _MODO_OPTIONAL_BOOL | _MODO_METADATA
    unknown = set(modo) - allowed
    if unknown:
        raise _reject("UNKNOWN_FIELD", f"Campos de modo desconocidos: {sorted(unknown)}.")
    missing = _MODO_REQUIRED - set(modo)
    if missing:
        raise _reject("FIELD_MISSING", f"Faltan campos de modo: {sorted(missing)}.")

    nombre = modo["nombre"]
    if not isinstance(nombre, str) or not nombre.strip():
        raise _reject("FIELD_INVALID", "modo.nombre debe ser texto no vacío.")
    if modo["categoria"] not in _CATEGORIAS:
        raise _reject("FIELD_INVALID", "modo.categoria no es válida.")
    if modo["plataforma"] != "pc":
        raise _reject("PLATFORM_UNSUPPORTED", "El motor local solo ejecuta modos de plataforma pc.")

    values = {
        "sensitivity": _int_0_100(modo["sensibilidad_puntero"], "sensibilidad_puntero"),
        "stability": _int_0_100(modo["estabilizacion_puntero"], "estabilizacion_puntero"),
        "pinch_tolerance": _int_0_100(modo["tolerancia_micro_pinza"], "tolerancia_micro_pinza"),
        "desk_rest": _bool(modo["desk_rest_habilitado"], "desk_rest_habilitado"),
    }
    notes: list[str] = []
    for key in sorted(_MODO_OPTIONAL_BOOL):
        if key in modo:
            flag = _bool(modo[key], key)
            if flag:
                notes.append(f"{key}=true: dato previsto, sin efecto en el motor de este hito.")
    return values, nombre.strip(), notes


def _parse_gestos(gestos: Any) -> tuple[dict[str, dict[str, Any]], list[str]]:
    if not isinstance(gestos, list):
        raise _reject("FIELD_INVALID", "gestos debe ser una lista.")
    parsed: dict[str, dict[str, Any]] = {}
    notes: list[str] = []
    for item in gestos:
        if not isinstance(item, Mapping):
            raise _reject("FIELD_INVALID", "Cada gesto debe ser un objeto.")
        unknown = set(item) - _GESTO_KEYS
        if unknown:
            raise _reject("UNKNOWN_FIELD", f"Campos de gesto desconocidos: {sorted(unknown)}.")
        missing = _GESTO_KEYS - {"asignacion_version"} - set(item)
        if missing:
            raise _reject("FIELD_MISSING", f"Faltan campos de gesto: {sorted(missing)}.")

        code = item["gesto_codigo"]
        if not isinstance(code, str) or code not in KNOWN_GESTURES:
            raise _reject("GESTURE_UNKNOWN", "gesto_codigo no pertenece al catálogo.")
        if code in parsed:
            raise _reject("GESTURE_DUPLICATED", f"Gesto repetido en la exportación: {code}.")
        action = item["accion_codigo"]
        if not isinstance(action, str) or not action:
            raise _reject("FIELD_INVALID", "accion_codigo debe ser texto.")
        enabled = _bool(item["habilitado"], "habilitado")
        version = item.get("asignacion_version")
        if version is not None and (isinstance(version, bool) or not isinstance(version, int) or version < 1):
            raise _reject("FIELD_INVALID", "asignacion_version debe ser entero positivo o null.")

        implemented = IMPLEMENTED_BINDINGS.get(code)
        if enabled and action != implemented:
            # Acción no implementada para ese gesto: no se ejecuta ni se sustituye.
            raise _reject(
                "ACTION_NOT_IMPLEMENTED",
                f"El gesto {code} con acción {action} no está implementado en el motor local.",
            )
        if not enabled and action != implemented:
            notes.append(f"{code}: acción {action} deshabilitada; sin efecto.")
        if code == "liberacion_pinza" and not enabled:
            notes.append("liberacion_pinza: implícita en el arrastre; su interruptor no cambia el motor.")
        parsed[code] = {"accion_codigo": action, "habilitado": enabled}

    missing_gestures = KNOWN_GESTURES - set(parsed)
    if missing_gestures:
        raise _reject("GESTURE_MISSING", f"Faltan gestos en la exportación: {sorted(missing_gestures)}.")
    return parsed, notes


def load_api_export(document: Any, runtime: Mapping[str, Any] | None = None) -> ImportedConfig:
    """Valida una exportación de la API y devuelve la configuración del motor.

    Lanza ConfigError con código estable si algo no es válido. No aplica nada por sí mismo.
    """
    if not isinstance(document, Mapping):
        raise _reject("FORMAT_INVALID", "La exportación debe ser un objeto JSON.")
    _check_no_credentials(document)
    keys = set(document)
    if keys != _TOP_KEYS:
        raise _reject("UNKNOWN_FIELD", f"La exportación debe tener exactamente {sorted(_TOP_KEYS)}.")
    version = document["formato_version"]
    if isinstance(version, bool) or not isinstance(version, int) or version not in SUPPORTED_EXPORT_VERSIONS:
        raise _reject("FORMAT_UNSUPPORTED", "formato_version no compatible con este motor.")

    mode_values, mode_name, mode_notes = _parse_modo(document["modo"])
    gestures, gesture_notes = _parse_gestos(document["gestos"])

    base = EngineConfig.from_dict(dict(runtime) if runtime is not None else None)
    flags = {flag: gestures.get(code, {}).get("habilitado", True) for code, flag in GESTURE_FLAG.items()}
    config = dataclasses.replace(
        base,
        format_version=base.format_version,
        sensitivity=mode_values["sensitivity"],
        stability=mode_values["stability"],
        pinch_tolerance=mode_values["pinch_tolerance"],
        desk_rest=mode_values["desk_rest"],
        pointer_enabled=bool(flags["pointer_enabled"]),
        pinch_enabled=bool(flags["pinch_enabled"]),
        drag_enabled=bool(flags["drag_enabled"]),
        scroll_enabled=bool(flags["scroll_enabled"]),
        fist_pause_enabled=bool(flags["fist_pause_enabled"]),
    )
    return ImportedConfig(
        config=config,
        gestures=gestures,
        notes=tuple(mode_notes + gesture_notes),
        mode_name=mode_name,
    )
