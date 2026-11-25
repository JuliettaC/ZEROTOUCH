"""Importación de la exportación de la API (formato_version 1) con datos ficticios."""

from __future__ import annotations

import copy

import pytest

from motor_local.api_export import KNOWN_GESTURES, load_api_export
from motor_local.config import ConfigError

# Catálogo de gestos y acciones por defecto del seed de db/schema.sql (valores ficticios de prueba).
DEFAULT_GESTURES = [
    ("mano_abierta_sostenida", "activar_puntero", True),
    ("micro_pinza", "clic", True),
    ("pinza_sostenida", "arrastrar", True),
    ("liberacion_pinza", "soltar", True),
    ("palma_abierta", "navegacion", False),
    ("puno_cerrado", "pausar", True),
    ("dos_dedos", "desplazar", True),
    ("trazo_airswipe", "escritura_airswipe", False),
]


def _document() -> dict:
    return {
        "formato_version": 1,
        "modo": {
            "id": "00000000-0000-4000-8000-000000000001",
            "perfil_id": "00000000-0000-4000-8000-000000000002",
            "nombre": "Modo de prueba",
            "categoria": "manual",
            "plataforma": "pc",
            "sensibilidad_puntero": 72,
            "estabilizacion_puntero": 38,
            "tolerancia_micro_pinza": 44,
            "desk_rest_habilitado": True,
            "asistencia_mirada_habilitada": False,
            "activacion_contextual_movil": False,
            "version": 3,
            "creado_en": "2026-11-01T10:00:00.000Z",
            "actualizado_en": "2026-11-01T10:05:00.000Z",
        },
        "gestos": [
            {
                "gesto_codigo": code,
                "nombre": code.replace("_", " ").capitalize(),
                "accion_codigo": action,
                "habilitado": enabled,
                "asignacion_version": None,
            }
            for code, action, enabled in DEFAULT_GESTURES
        ],
    }


def test_valid_export_keeps_values_and_flags() -> None:
    doc = _document()
    doc["gestos"][6]["habilitado"] = False  # dos_dedos desactivado
    imported = load_api_export(doc, runtime={"cameraIndex": 2, "mirrorCamera": False, "preferredHand": "LEFT"})
    cfg = imported.config
    assert (cfg.sensitivity, cfg.stability, cfg.pinch_tolerance) == (72, 38, 44)
    assert cfg.desk_rest is True
    assert cfg.scroll_enabled is False
    assert cfg.pinch_enabled is True and cfg.drag_enabled is True and cfg.fist_pause_enabled is True
    assert (cfg.camera_index, cfg.mirror_camera, cfg.preferred_hand) == (2, False, "LEFT")
    assert imported.mode_name == "Modo de prueba"
    assert set(imported.gestures) == KNOWN_GESTURES


def test_disabled_unimplemented_actions_are_accepted_and_reported() -> None:
    doc = _document()
    doc["gestos"][1].update(accion_codigo="arrastrar", habilitado=False)  # micro_pinza no arrastra, pero está apagada
    imported = load_api_export(doc)
    assert any("micro_pinza" in note for note in imported.notes)
    assert imported.gestures["micro_pinza"] == {"accion_codigo": "arrastrar", "habilitado": False}
    assert imported.config.pinch_enabled is False
    assert imported.gestures["palma_abierta"] == {"accion_codigo": "navegacion", "habilitado": False}
    assert imported.config.palm_enabled is False


def test_enabled_unimplemented_action_is_rejected() -> None:
    doc = _document()
    doc["gestos"][7].update(accion_codigo="confirmar", habilitado=True)  # trazo_airswipe solo escribe
    with pytest.raises(ConfigError) as info:
        load_api_export(doc)
    assert info.value.code == "ACTION_NOT_IMPLEMENTED"


def test_catalog_defaults_all_enabled_are_loadable() -> None:
    """La exportación de un modo sin asignaciones (todo habilitado con la acción del catálogo) carga."""
    doc = _document()
    for item in doc["gestos"]:
        item["habilitado"] = True
    imported = load_api_export(doc)
    cfg = imported.config
    assert cfg.palm_enabled and cfg.airswipe_enabled
    assert cfg.discrete_actions == {"palma_abierta": "navegacion"}


def test_discrete_gestures_can_be_remapped_within_the_contract() -> None:
    doc = _document()
    doc["gestos"][4].update(accion_codigo="multimedia_siguiente", habilitado=True)  # palma_abierta
    doc["gestos"][6].update(accion_codigo="sin_accion", habilitado=True)            # dos_dedos sin acción
    imported = load_api_export(doc)
    assert imported.config.discrete_actions["palma_abierta"] == "multimedia_siguiente"
    assert imported.config.scroll_enabled is False, "sin_accion equivale a deshabilitar"
    doc["gestos"][4].update(accion_codigo="clic")  # un gesto discreto no puede hacer clic
    with pytest.raises(ConfigError) as info:
        load_api_export(doc)
    assert info.value.code == "ACTION_NOT_IMPLEMENTED"


def test_implemented_gesture_with_different_action_is_rejected_when_enabled() -> None:
    doc = _document()
    doc["gestos"][1]["accion_codigo"] = "arrastrar"  # micro_pinza no puede arrastrar en este motor
    with pytest.raises(ConfigError) as info:
        load_api_export(doc)
    assert info.value.code == "ACTION_NOT_IMPLEMENTED"


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda d: d.update(formato_version=2), "FORMAT_UNSUPPORTED"),
        (lambda d: d.update(formato_version=True), "FORMAT_UNSUPPORTED"),
        (lambda d: d.update(extra=1), "UNKNOWN_FIELD"),
        (lambda d: d["modo"].update(sensibilidad_puntero=101), "FIELD_OUT_OF_RANGE"),
        (lambda d: d["modo"].update(sensibilidad_puntero=True), "FIELD_INVALID"),
        (lambda d: d["modo"].update(sensibilidad_puntero="70"), "FIELD_INVALID"),
        (lambda d: d["modo"].update(desk_rest_habilitado=1), "FIELD_INVALID"),
        (lambda d: d["modo"].update(plataforma="movil"), "PLATFORM_UNSUPPORTED"),
        (lambda d: d["modo"].update(categoria="otra"), "FIELD_INVALID"),
        (lambda d: d["modo"].update(csrf_token="x"), "CREDENTIALS_NOT_ALLOWED"),
        (lambda d: d["modo"].pop("tolerancia_micro_pinza"), "FIELD_MISSING"),
        (lambda d: d["modo"].update(modo_extra=3), "UNKNOWN_FIELD"),
        (lambda d: d["gestos"].pop(), "GESTURE_MISSING"),
        (lambda d: d["gestos"].append(copy.deepcopy(d["gestos"][0])), "GESTURE_DUPLICATED"),
        (lambda d: d["gestos"][0].update(gesto_codigo="gesto_inventado"), "GESTURE_UNKNOWN"),
        (lambda d: d["gestos"][0].update(habilitado="si"), "FIELD_INVALID"),
        (lambda d: d["gestos"][0].update(asignacion_version=0), "FIELD_INVALID"),
        (lambda d: d["gestos"][0].update(shell="cmd /c calc"), "UNKNOWN_FIELD"),
    ],
)
def test_invalid_exports_are_rejected_with_stable_codes(mutate, code: str) -> None:
    doc = _document()
    mutate(doc)
    with pytest.raises(ConfigError) as info:
        load_api_export(doc)
    assert info.value.code == code


def test_non_object_document_is_rejected() -> None:
    with pytest.raises(ConfigError):
        load_api_export(["no", "es", "objeto"])


def test_runtime_values_follow_ipc_rules() -> None:
    with pytest.raises(ConfigError):
        load_api_export(_document(), runtime={"cameraIndex": 50})


def test_retired_gestures_are_unknown() -> None:
    """24-11-2026: barridos, pulgares y modo precisión se retiraron del catálogo; una exportación antigua que aún
    los traiga se rechaza con un código estable en vez de cargarse a medias."""
    for code in ("deslizamiento_izquierda", "deslizamiento_derecha", "pulgar_arriba", "pulgar_abajo", "modo_precision"):
        doc = _document()
        doc["gestos"].append({"gesto_codigo": code, "nombre": code, "accion_codigo": "sin_accion", "habilitado": False, "asignacion_version": None})
        with pytest.raises(ConfigError) as info:
            load_api_export(doc)
        assert info.value.code == "GESTURE_UNKNOWN", code
