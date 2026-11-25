"""Protocolo IPC del motor: ACK por comando, rechazos estables y orden de apagado.

Se ejecuta run_engine en el mismo proceso con cámara y detector falsos: no abre la webcam
ni carga MediaPipe. Es una prueba sintética del protocolo, no del hardware.
"""

from __future__ import annotations

import io
import json
import sys

import base64
import cv2
import numpy as np
import pytest

from motor_local import main as engine_main
from motor_local.detector import HandLandmarks, Point3D
from motor_local.os_adapter import MockOSAdapter


class FakeCapture:
    def __init__(self, camera_index: int = 0, width: int = 640, height: int = 480, mirror: bool = True) -> None:
        self.camera_index = camera_index
        self.mirror = mirror
        self.fps = 0.0
        self._open = False
        self.open_result = True

    @property
    def is_open(self) -> bool:
        return self._open

    def open(self, camera_index: int | None = None) -> bool:
        if camera_index is not None:
            self.camera_index = camera_index
        self._open = self.open_result
        return self._open

    def read_rgb_frame(self):
        return False, None

    def release(self) -> None:
        self._open = False


class FakeDetector:
    def __init__(self, **_: object) -> None:
        pass

    def detect(self, *_: object, **__: object):
        return None

    def close(self) -> None:
        pass


VALID_DOC = {
    "formato_version": 1,
    "modo": {
        "nombre": "Prueba IPC",
        "categoria": "manual",
        "plataforma": "pc",
        "sensibilidad_puntero": 60,
        "estabilizacion_puntero": 40,
        "tolerancia_micro_pinza": 50,
        "desk_rest_habilitado": False,
    },
    "gestos": [
        {"gesto_codigo": c, "nombre": c, "accion_codigo": a, "habilitado": e, "asignacion_version": None}
        for c, a, e in [
            ("mano_abierta_sostenida", "activar_puntero", True),
            ("micro_pinza", "clic", True),
            ("pinza_sostenida", "arrastrar", True),
            ("liberacion_pinza", "soltar", True),
            ("palma_abierta", "navegacion", False),
            ("puno_cerrado", "pausar", True),
            ("dos_dedos", "desplazar", True),
            ("trazo_airswipe", "escritura_airswipe", False),
        ]
    ],
}


def _run(monkeypatch, capsys, commands: list[dict], *, capture_open: bool = True, hotkey: bool = True):
    monkeypatch.setattr(engine_main, "CameraCapture", FakeCapture)
    monkeypatch.setattr(engine_main, "HandDetector", FakeDetector)

    def capture_factory(**kwargs):
        cap = FakeCapture(**kwargs)
        cap.open_result = capture_open
        return cap

    monkeypatch.setattr(engine_main, "CameraCapture", capture_factory)

    if hotkey:
        monkeypatch.setattr(engine_main, "MockOSAdapter", MockOSAdapter)
    else:
        class NoHotkey(MockOSAdapter):
            def __init__(self) -> None:
                super().__init__()
                self.hotkey_active = False
                self.hotkey_error = "Atajo no disponible en esta prueba."

        monkeypatch.setattr(engine_main, "MockOSAdapter", NoHotkey)

    stdin_text = "\n".join(json.dumps(c) for c in commands) + "\n"
    monkeypatch.setattr(sys, "stdin", io.StringIO(stdin_text))
    code = engine_main.run_engine(use_mock_os=True)
    out = capsys.readouterr().out
    messages = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
    return code, messages


def _acks(messages: list[dict]) -> dict:
    return {m["id"]: m for m in messages if m.get("type") == "ACK"}


def test_preview_uses_the_tracked_frame_and_stays_out_of_telemetry(monkeypatch, capsys):
    commands = [
        {"cmd": "PREVIEW_FRAME", "id": 1},
        {"cmd": "SET_MODE", "mode": "CONTROL", "id": 2},
        {"cmd": "PREVIEW_FRAME", "id": 3},
        {"cmd": "SET_PAUSED", "paused": True, "id": 4},
        {"cmd": "PREVIEW_FRAME", "id": 5},
        {"cmd": "EMERGENCY_STOP", "id": 6},
        {"cmd": "PREVIEW_FRAME", "id": 7},
        {"cmd": "STOP", "id": 8},
    ]
    rgb = np.zeros((360, 640, 3), dtype=np.uint8)
    rgb[:, :, 0] = 220
    rgb[:32, -32:] = [0, 220, 0]
    rgb[-32:, :32] = [0, 0, 220]
    points = [Point3D(0.4 + i * 0.01, 0.5) for i in range(21)]
    pending = []

    class PreviewCapture(FakeCapture):
        def read_rgb_frame(self):
            for command in commands:
                pending[0].put(command)
            return True, rgb

    class PreviewDetector(FakeDetector):
        def detect(self, frame, **kwargs):
            assert frame is rgb
            return HandLandmarks(points, "Right", 0.99)

    monkeypatch.setattr(engine_main, "CameraCapture", PreviewCapture)
    monkeypatch.setattr(engine_main, "HandDetector", PreviewDetector)
    monkeypatch.setattr(engine_main, "stdin_reader", lambda queue, stop: pending.append(queue))

    assert engine_main.run_engine(use_mock_os=True) == 0
    messages = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
    acks = _acks(messages)
    frame = acks[1]["preview"]
    assert frame["landmarks"] == [[round(point.x, 4), point.y] for point in points]
    jpg = np.frombuffer(base64.b64decode(frame["jpeg"]), dtype=np.uint8)
    bgr = cv2.imdecode(jpg, cv2.IMREAD_COLOR)
    assert bgr.shape == rgb.shape
    assert bgr[0, 0, 2] > 200 and bgr[0, 0, 0] < 10
    assert bgr[0, -1, 1] > 200 and bgr[-1, 0, 0] > 200
    assert acks[2]["ok"] and acks[3]["preview"]["jpeg"] == frame["jpeg"]
    assert acks[4]["ok"] and acks[5]["preview"]["jpeg"] == frame["jpeg"]
    assert acks[6]["ok"] and acks[7]["code"] == "PREVIEW_MODE"
    assert all("preview" not in message for message in messages if message["type"] != "ACK")


def test_every_command_gets_an_ack_and_stop_is_last(monkeypatch, capsys) -> None:
    commands = [
        {"id": 1, "cmd": "SET_CONFIG", "config": {"sensitivity": 101}},
        {"id": 2, "cmd": "SET_CONFIG", "config": {"sensitivity": 70}},
        {"id": 3, "cmd": "SET_MODE", "mode": "CONTROL"},
        {"id": 4, "cmd": "SET_MODE", "mode": "BOGUS"},
        {"id": 5, "cmd": "LOAD_EXPORT", "document": {**VALID_DOC, "formato_version": 2}},
        {"id": 6, "cmd": "LOAD_EXPORT", "document": VALID_DOC},
        {"id": 7, "cmd": "NOPE"},
        {"id": 8, "cmd": "STOP"},
    ]
    code, messages = _run(monkeypatch, capsys, commands)
    assert code == 0
    acks = _acks(messages)
    assert set(acks) == {1, 2, 3, 4, 5, 6, 7, 8}
    assert acks[1]["ok"] is False and acks[1]["code"] == "FIELD_OUT_OF_RANGE"
    assert acks[2]["ok"] is True
    assert acks[3]["ok"] is True and acks[3]["mode"] == "CONTROL"
    assert acks[4]["ok"] is False and acks[4]["code"] == "MODE_INVALID"
    assert acks[5]["ok"] is False and acks[5]["code"] == "FORMAT_UNSUPPORTED"
    assert acks[6]["ok"] is True and acks[6]["mode"] == "Prueba IPC"
    assert acks[7]["ok"] is False and acks[7]["code"] == "UNKNOWN_COMMAND"
    assert acks[8]["ok"] is True
    assert messages[-1]["type"] == "STOPPED"


def test_control_is_refused_without_emergency_hotkey(monkeypatch, capsys) -> None:
    code, messages = _run(
        monkeypatch,
        capsys,
        [{"id": 1, "cmd": "SET_MODE", "mode": "CONTROL"}, {"id": 2, "cmd": "STOP"}],
        hotkey=False,
    )
    assert code == 0
    acks = _acks(messages)
    assert acks[1]["ok"] is False
    assert acks[1]["code"] == "EMERGENCY_HOTKEY_UNAVAILABLE"
    assert all(m.get("mode") != "CONTROL" for m in messages if m.get("type") == "MODE_CHANGED")


def test_control_is_refused_without_camera(monkeypatch, capsys) -> None:
    code, messages = _run(
        monkeypatch,
        capsys,
        [{"id": 1, "cmd": "SET_MODE", "mode": "CONTROL"}, {"id": 2, "cmd": "STOP"}],
        capture_open=False,
    )
    assert code == 0
    assert _acks(messages)[1]["code"] == "CAMERA_NOT_OPEN"


def test_stop_does_not_discard_commands_sent_before_it(monkeypatch, capsys) -> None:
    commands = [{"id": i, "cmd": "SET_PAUSED", "paused": True} for i in range(1, 6)] + [{"id": 9, "cmd": "STOP"}]
    _, messages = _run(monkeypatch, capsys, commands)
    acks = _acks(messages)
    assert all(acks[i]["ok"] for i in range(1, 6))
    assert acks[9]["ok"] is True


def test_invalid_json_line_is_reported_not_fatal(monkeypatch, capsys) -> None:
    monkeypatch.setattr(engine_main, "HandDetector", FakeDetector)
    monkeypatch.setattr(engine_main, "CameraCapture", FakeCapture)
    monkeypatch.setattr(sys, "stdin", io.StringIO('{"cmd": "STOP", \n' + json.dumps({"cmd": "STOP"}) + "\n"))
    assert engine_main.run_engine(use_mock_os=True) == 0
    out = capsys.readouterr().out
    messages = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
    assert any(m.get("type") == "ACK" and m.get("code") == "IPC_INVALID_JSON" for m in messages)


def test_invalid_initial_config_is_rejected_before_devices(monkeypatch, capsys) -> None:
    opened = []
    monkeypatch.setattr(engine_main, "CameraCapture", lambda **kw: opened.append(kw) or FakeCapture(**kw))
    code = engine_main.run_engine(use_mock_os=True, initial_config={"sensitivity": "alta"})
    assert code == 2
    assert opened == []
    out = capsys.readouterr().out
    assert '"code": "FIELD_INVALID"' in out
