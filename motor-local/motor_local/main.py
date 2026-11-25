"""Main entry point for the ZeroTouch Local Gesture Engine sidecar process.

Protocolo JSON-lines: comandos por stdin, respuestas por stdout.
- Cada comando puede llevar "id". Toda orden recibe un mensaje ACK con el mismo "id":
  ok=true si se aplicó, ok=false con "code" y "message" si se rechazó. La aplicación no debe
  dar por hecho un cambio sin ACK ok=true. El ACK de SET_CONFIG y LOAD_EXPORT incluye la
  configuración realmente aplicada (`config`) para que la interfaz la compare con la deseada.
- Comandos: SET_MODE, SET_PAUSED, SET_CONFIG (formato IPC), LOAD_EXPORT (exportación de la API),
  AIRSWIPE (abrir/cerrar teclado), TYPE_TEXT y PRESS_KEY (escritura Air-Swipe), GAZE_CALIBRATE,
  PREVIEW_FRAME (fotograma local de la cámara activa), EMERGENCY_STOP, STOP.
- Mensajes de salida: READY, TELEMETRY (~16 Hz), MODE_CHANGED, EVENT (acciones de aplicación:
  TIMER, PRECISION, NAVIGATION, AIRSWIPE_TRACE, CONFIRM/CANCEL/BACK/FORWARD con el teclado
  abierto, GAZE_CALIBRATED), ERROR, STOPPED.

Garantías:
- Cámara y botones se liberan en finally ante STOP, EOF, fallo o excepción.
- No se activa CONTROL sin cámara abierta y sin atajo de parada de emergencia activo.
- Un cambio de configuración libera el botón antes de aplicarse.
- La asistencia por mirada solo retiene la interacción; nunca habilita el control ni anula la
  parada de emergencia.
"""

from __future__ import annotations

import json
import queue
import sys
import threading
import time
from typing import Any

from .action_engine import MODE_CONTROL, MODE_OBSERVATION, LogicalActionEngine
from .api_export import load_api_export
from .capture import CameraCapture, preview_jpeg
from .config import ConfigError, EngineConfig, GazeConfig
from .detector import HandDetector
from .gaze import FaceOrientationDetector, GazeGate
from .interpreter import GestureInterpreter
from .os_adapter import MockOSAdapter, PynputOSAdapter
from .text_focus import FocusPoller, TextFocusWatcher, Win32TextFocusProbe, keyboard_events

DETECTOR_MAX_CONSECUTIVE_FAILURES = 30
VALID_MODES = (MODE_OBSERVATION, MODE_CONTROL)
GAZE_EVERY_N_FRAMES = 3


def emit_json(payload: dict[str, Any]) -> None:
    try:
        sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
        sys.stdout.flush()
    except Exception:
        pass


def emit_ack(cmd_id: Any, cmd: str, ok: bool, code: str = "", message: str = "", **extra: Any) -> None:
    payload: dict[str, Any] = {"type": "ACK", "id": cmd_id, "cmd": cmd, "ok": ok}
    if ok:
        payload.update(extra)
        if message:
            payload["message"] = message
    else:
        payload["code"] = code
        payload["message"] = message
    emit_json(payload)


def stdin_reader(cmd_queue: "queue.Queue[dict[str, Any]]", stop_event: threading.Event, source: Any = None) -> None:
    """Solo encola. El apagado lo ejecuta el bucle principal al procesar STOP, en orden,
    para que los comandos anteriores no se pierdan.

    Se leen BYTES y se decodifican como UTF-8 (lo que escribe el puente Rust). Con `sys.stdin` en texto, Python en
    Windows usa la página de códigos ANSI (cp1252) para una tubería y el texto del teclado llegaba dañado:
    «cómo» se escribía «cÃ³mo» y «ñ» «Ã±» (23-11-2026, captura de la persona usuaria)."""
    if source is None:
        source = getattr(sys.stdin, "buffer", sys.stdin)
    try:
        for raw in source:
            line = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
            text = line.strip()
            if not text:
                continue
            try:
                msg = json.loads(text)
            except Exception:
                cmd_queue.put({"cmd": "__INVALID_JSON__"})
                continue
            if isinstance(msg, dict):
                cmd_queue.put(msg)
                if str(msg.get("cmd", "")).upper() == "STOP":
                    break
            else:
                cmd_queue.put({"cmd": "__INVALID_JSON__"})
    except Exception:
        pass
    finally:
        cmd_queue.put({"cmd": "STOP", "reason": "eof"})


def run_engine(use_mock_os: bool = False, initial_config: dict[str, Any] | None = None) -> int:
    try:
        config = EngineConfig.from_dict(initial_config)
    except ConfigError as exc:
        emit_json({"type": "ERROR", "running": False, "code": exc.code, "message": exc.message})
        return 2

    stop_event = threading.Event()
    cmd_queue: "queue.Queue[dict[str, Any]]" = queue.Queue()

    reader_thread = threading.Thread(target=stdin_reader, args=(cmd_queue, stop_event), daemon=True)
    reader_thread.start()

    capture = CameraCapture(camera_index=config.camera_index, mirror=config.mirror_camera)
    detector: HandDetector | None = None
    face_detector: FaceOrientationDetector | None = None
    face_error = ""
    interpreter = GestureInterpreter(config)
    gaze_gate = GazeGate(config.gaze)
    action_engine: LogicalActionEngine | None = None
    detector_failures = 0
    camera_thread: threading.Thread | None = None
    camera_result: dict[str, bool] = {}
    last_telemetry_emit = 0.0
    frame_counter = 0
    event_seq = 0
    rgb = None
    # Teclado Air-Swipe según el foco (text_focus.py): solo con el sistema real y en Windows.
    focus_poller: FocusPoller | None = None
    focus_watcher = TextFocusWatcher()
    if not use_mock_os and sys.platform == "win32":
        focus_poller = FocusPoller(Win32TextFocusProbe).start()

    def dispatch(events: list[Any]) -> list[str]:
        return action_engine.dispatch(events) if action_engine is not None else []

    def hotkey_state() -> tuple[bool, str]:
        adapter = action_engine.adapter if action_engine is not None else None
        return bool(getattr(adapter, "hotkey_active", False)), str(getattr(adapter, "hotkey_error", ""))

    def emit_app_events() -> None:
        nonlocal event_seq
        if action_engine is None:
            return
        for event in action_engine.take_app_events():
            event_seq += 1
            emit_json({"type": "EVENT", "seq": event_seq, **event})

    def ensure_face_detector() -> None:
        nonlocal face_detector, face_error
        if face_detector is not None or not config.gaze.enabled:
            return
        try:
            face_detector = FaceOrientationDetector()
            face_error = ""
        except Exception as exc:  # pragma: no cover - depende del entorno
            face_error = f"Sin detector facial: {exc}"

    def apply_config(new_config: EngineConfig) -> list[str]:
        """Libera lo que estuviera retenido, aplica la configuración y reabre cámara si cambió."""
        nonlocal config, rgb
        rgb = None
        events = interpreter.update_config(new_config)
        dispatched = dispatch(events)
        config = new_config
        if action_engine is not None and not config.airswipe_enabled:
            action_engine.airswipe_active = False
        capture.mirror = config.mirror_camera
        if config.camera_index != capture.camera_index or not capture.is_open:
            capture.open(config.camera_index)
        gaze_gate.update_config(config.gaze)
        if not config.gaze.enabled:
            dispatch(interpreter.set_external_hold(False))
            if action_engine is not None:
                action_engine.set_external_hold(False)
        ensure_face_detector()
        return dispatched

    def telemetry_payload(latency_ms: float, dispatched: list[str]) -> dict[str, Any]:
        assert action_engine is not None
        tel = interpreter.telemetry
        x_min, x_max, y_min, y_max = config.active_bounds
        hotkey_ok, _ = hotkey_state()
        _ = dispatched
        return {
            "type": "TELEMETRY",
            "running": True,
            "cameraOpen": capture.is_open,
            "cameraIndex": config.camera_index,
            "preferredHand": config.preferred_hand,
            "mirrorCamera": config.mirror_camera,
            "activeBounds": [x_min, x_max, y_min, y_max],
            "mode": action_engine.mode,
            "paused": tel.paused,
            "emergencyStopped": action_engine.emergency_stopped,
            "hotkeyActive": hotkey_ok,
            "handDetected": tel.hand_detected,
            "handedness": (
                "DERECHA"
                if tel.handedness == "Right"
                else ("IZQUIERDA" if tel.handedness == "Left" else "NINGUNA")
            ),
            "confidence": round(tel.confidence * 100),
            "gesture": tel.gesture,
            "lastEvent": action_engine.last_dispatched_event,
            "pointerArmed": tel.pointer_armed,
            "precision": interpreter.precision_active,
            "airswipe": interpreter.airswipe_active,
            "tracing": tel.tracing,
            "gaze": {**gaze_gate.telemetry(), "error": face_error},
            "pinchDistancePx": tel.pinch_distance_px,
            "pinchRatio": tel.pinch_ratio,
            "cursorX": tel.cursor_norm_x,
            "cursorY": tel.cursor_norm_y,
            "rawAnchorX": tel.raw_anchor_x,
            "rawAnchorY": tel.raw_anchor_y,
            "landmarks": tel.landmarks_2d,
            "fps": capture.fps,
            "latencyMs": latency_ms,
            "totalClicks": action_engine.total_clicks,
            "totalScrolls": action_engine.total_scrolls,
            "eventCounts": dict(action_engine.event_counts),
            "pinchDiag": dict(interpreter.pinch_diag),
            "deliveryCounts": {event: dict(outcomes) for event, outcomes in action_engine.delivery_counts.items()},
        }

    def handle_command(msg: dict[str, Any]) -> bool:
        """Ejecuta un comando y emite su ACK. Devuelve False si el motor debe detenerse."""
        nonlocal config
        cmd_id = msg.get("id")
        cmd = str(msg.get("cmd", "")).upper()
        assert action_engine is not None

        if cmd == "STOP":
            emit_ack(cmd_id, cmd, True, message="Parada solicitada.")
            return False

        if cmd == "__INVALID_JSON__":
            emit_ack(cmd_id, "INVALID", False, "IPC_INVALID_JSON", "Línea de comando no es JSON objeto.")
            return True

        if cmd == "PREVIEW_FRAME":
            if action_engine.emergency_stopped:
                emit_ack(cmd_id, cmd, False, "PREVIEW_MODE", "Vista de cámara detenida por emergencia.")
                return True
            if not capture.is_open or rgb is None:
                emit_ack(cmd_id, cmd, True, preview=None)
                return True
            try:
                jpeg = preview_jpeg(rgb)
            except Exception:
                jpeg = ""
            if not jpeg:
                emit_ack(cmd_id, cmd, False, "PREVIEW_FRAME", "No se pudo preparar la imagen de cámara.")
                return True
            tel = interpreter.telemetry
            emit_ack(cmd_id, cmd, True, preview={
                "jpeg": jpeg,
                "landmarks": tel.landmarks_2d if tel.hand_detected else [],
                "gesture": tel.gesture,
                "pinchRatio": tel.pinch_ratio if tel.hand_detected else None,
            })
            return True

        if cmd == "EMERGENCY_STOP":
            action_engine.trigger_emergency_stop()
            dispatch(interpreter.set_paused(True, time.monotonic() * 1000.0))
            dispatch(interpreter.set_airswipe(False))
            emit_ack(cmd_id, cmd, True, message="Parada de emergencia aplicada.")
            emit_json(
                {
                    "type": "TELEMETRY",
                    "running": True,
                    "cameraOpen": capture.is_open,
                    "cameraIndex": config.camera_index,
                    "preferredHand": config.preferred_hand,
                    "mirrorCamera": config.mirror_camera,
                    "mode": action_engine.mode,
                    "paused": interpreter.paused,
                    "emergencyStopped": True,
                    "airswipe": interpreter.airswipe_active,
                    "tracing": False,
                    "handDetected": False,
                    "gesture": "EMERGENCY_STOP",
                    "fps": capture.fps,
                    "message": "Parada de emergencia activada (Ctrl+Alt+Z). Control del SO desactivado.",
                }
            )
            return True

        if cmd == "SET_MODE":
            requested = str(msg.get("mode", "")).upper().strip()
            if requested not in VALID_MODES:
                emit_ack(cmd_id, cmd, False, "MODE_INVALID", "Modo no válido: use OBSERVATION o CONTROL.")
                return True
            if requested == MODE_CONTROL:
                hotkey_ok, hotkey_error = hotkey_state()
                if not hotkey_ok:
                    emit_ack(cmd_id, cmd, False, "EMERGENCY_HOTKEY_UNAVAILABLE",
                             hotkey_error or "Sin parada de emergencia activa; el control no se habilita.")
                    return True
                if not capture.is_open:
                    emit_ack(cmd_id, cmd, False, "CAMERA_NOT_OPEN", "La cámara no está abierta; el control no se habilita.")
                    return True
            new_mode = action_engine.set_mode(requested)
            if new_mode == MODE_CONTROL:
                dispatch(interpreter.set_paused(False, time.monotonic() * 1000.0))
            emit_ack(cmd_id, cmd, True, mode=new_mode, paused=interpreter.paused,
                     emergencyStopped=action_engine.emergency_stopped)
            emit_json({"type": "MODE_CHANGED", "mode": new_mode, "paused": interpreter.paused,
                       "emergencyStopped": action_engine.emergency_stopped})
            return True

        if cmd == "SET_PAUSED":
            paused_val = msg.get("paused")
            if not isinstance(paused_val, bool):
                emit_ack(cmd_id, cmd, False, "FIELD_INVALID", "paused debe ser booleano JSON.")
                return True
            dispatch(interpreter.set_paused(paused_val, time.monotonic() * 1000.0))
            emit_ack(cmd_id, cmd, True, paused=interpreter.paused)
            return True

        if cmd == "SET_CONFIG":
            try:
                candidate = EngineConfig.from_dict(msg.get("config"))
            except ConfigError as exc:
                emit_ack(cmd_id, cmd, False, exc.code, exc.message)
                return True
            apply_config(candidate)
            emit_ack(cmd_id, cmd, True, message="Configuración aplicada.", format="ipc", config=config.to_dict())
            return True

        if cmd == "LOAD_EXPORT":
            try:
                imported = load_api_export(msg.get("document"), msg.get("runtime"))
            except ConfigError as exc:
                emit_ack(cmd_id, cmd, False, exc.code, exc.message)
                return True
            apply_config(imported.config)
            emit_ack(
                cmd_id,
                cmd,
                True,
                message="Exportación aplicada.",
                format="api-v1",
                mode=imported.mode_name,
                notes=list(imported.notes),
                gestures={code: dict(value) for code, value in imported.gestures.items()},
                config=config.to_dict(),
            )
            return True

        if cmd == "AIRSWIPE":
            active = msg.get("active")
            if not isinstance(active, bool):
                emit_ack(cmd_id, cmd, False, "FIELD_INVALID", "active debe ser booleano JSON.")
                return True
            if active and not config.airswipe_enabled:
                emit_ack(cmd_id, cmd, False, "AIRSWIPE_DISABLED", "El trazo Air-Swipe está deshabilitado en el modo actual.")
                return True
            dispatch(interpreter.set_airswipe(active))
            action_engine.airswipe_active = active
            emit_ack(cmd_id, cmd, True, airswipe=active)
            return True

        if cmd == "TYPE_TEXT":
            ok, code, message = action_engine.type_text(msg.get("text"))
            if ok:
                emit_ack(cmd_id, cmd, True)
            else:
                emit_ack(cmd_id, cmd, False, code, message)
            return True

        if cmd == "PRESS_KEY":
            ok, code, message = action_engine.press_edit_key(msg.get("key"))
            if ok:
                emit_ack(cmd_id, cmd, True)
            else:
                emit_ack(cmd_id, cmd, False, code, message)
            return True

        if cmd == "GAZE_CALIBRATE":
            if not config.gaze.enabled:
                emit_ack(cmd_id, cmd, False, "GAZE_DISABLED", "Activa la asistencia por mirada antes de calibrar.")
                return True
            if face_detector is None:
                emit_ack(cmd_id, cmd, False, "GAZE_UNAVAILABLE", face_error or "Detector facial no disponible.")
                return True
            gaze_gate.start_calibration()
            emit_ack(cmd_id, cmd, True, message="Mira a la pantalla; calibrando orientación neutra.")
            return True

        emit_ack(cmd_id, cmd or "UNKNOWN", False, "UNKNOWN_COMMAND", "Comando no soportado.")
        return True

    try:
        # La cámara se abre en un hilo mientras MediaPipe se carga en este: los dos arranques se solapan.
        camera_thread = threading.Thread(
            target=lambda: camera_result.update(ok=capture.open(config.camera_index)),
            daemon=True,
        )
        camera_thread.start()
        if use_mock_os:
            adapter = MockOSAdapter()
        else:
            adapter = PynputOSAdapter(on_emergency_stop=lambda: cmd_queue.put({"cmd": "EMERGENCY_STOP"}))

        action_engine = LogicalActionEngine(adapter=adapter, initial_mode=MODE_OBSERVATION)
        detector = HandDetector(min_detection_confidence=0.50, min_tracking_confidence=0.50)
        ensure_face_detector()
        camera_thread.join()
        camera_ok = bool(camera_result.get("ok", False))
        x_min, x_max, y_min, y_max = config.active_bounds
        hotkey_ok, hotkey_error = hotkey_state()

        emit_json(
            {
                "type": "READY",
                "running": True,
                "cameraOpen": camera_ok,
                "cameraIndex": config.camera_index,
                "preferredHand": config.preferred_hand,
                "mirrorCamera": config.mirror_camera,
                "activeBounds": [x_min, x_max, y_min, y_max],
                "mode": action_engine.mode,
                "paused": interpreter.paused,
                "emergencyStopped": action_engine.emergency_stopped,
                "hotkeyActive": hotkey_ok,
                "hotkeyError": hotkey_error,
                "config": config.to_dict(),
                "message": (
                    "Motor gestual iniciado en Modo Simulación (Observación)."
                    if camera_ok
                    else f"No se detectó cámara web en el índice {config.camera_index}; verifica que esté conectada y libre."
                ),
            }
        )

        while not stop_event.is_set():
            # 1. Process incoming commands in order; each one gets an ACK.
            while True:
                try:
                    msg = cmd_queue.get_nowait()
                except queue.Empty:
                    break
                if not handle_command(msg):
                    stop_event.set()
                    break
            if stop_event.is_set():
                break

            # 2. Capture and process webcam frame at native camera rate (~30 FPS)
            t0 = time.monotonic()
            now_ms = t0 * 1000.0
            frame_counter += 1

            rgb = None
            if capture.is_open and detector is not None:
                ok, rgb = capture.read_rgb_frame()
                if ok and rgb is not None:
                    try:
                        hand = detector.detect(
                            rgb,
                            preferred_hand=config.preferred_hand,
                            mirror_camera=config.mirror_camera,
                            min_confidence=config.min_detection_confidence,
                        )
                        detector_failures = 0
                    except Exception as exc:
                        detector_failures += 1
                        hand = None
                        if detector_failures >= DETECTOR_MAX_CONSECUTIVE_FAILURES:
                            raise RuntimeError(f"DETECTOR_FAILED: {exc}") from exc
                    # Asistencia por orientación de la cabeza: cada N fotogramas, solo si está activa.
                    if config.gaze.enabled and face_detector is not None and frame_counter % GAZE_EVERY_N_FRAMES == 0:
                        try:
                            pose = face_detector.detect(rgb)
                        except Exception:
                            pose = None
                        allowed = gaze_gate.update(pose, now_ms)
                        dispatch(interpreter.set_external_hold(not allowed))
                        action_engine.set_external_hold(not allowed)
                        if gaze_gate.calibration_result is not None:
                            yaw, pitch = gaze_gate.calibration_result
                            gaze_gate.calibration_result = None
                            config = EngineConfig(**{**config.__dict__, "gaze": GazeConfig(**{**config.gaze.__dict__, "calibration": (yaw, pitch)})})
                            gaze_gate.update_config(config.gaze)
                            action_engine.app_events.append({"event": "GAZE_CALIBRATED", "yaw": yaw, "pitch": pitch})
                    events = interpreter.process_frame(hand, now_ms)
                else:
                    events = interpreter.process_frame(None, now_ms)
                dispatched = dispatch(events)
            else:
                events = interpreter.process_frame(None, now_ms)
                dispatched = dispatch(events)
                time.sleep(0.05)

            action_engine.paused = interpreter.paused
            action_engine.set_external_hold(interpreter.external_hold)
            action_engine.set_tracking_lost(interpreter._tracking_lost_emitted)

            # Sin cámara no hay control: pasar a observación libera cualquier botón retenido.
            if action_engine.mode == MODE_CONTROL and not capture.is_open:
                action_engine.set_mode(MODE_OBSERVATION)
                dispatch(interpreter.process_frame(None, now_ms))
                emit_json({"type": "MODE_CHANGED", "mode": MODE_OBSERVATION, "paused": interpreter.paused,
                           "emergencyStopped": action_engine.emergency_stopped,
                           "reason": "CAMERA_LOST"})

            # Foco en un campo de texto: abrir el teclado; al salir, cerrarlo.
            if focus_poller is not None:
                focus_active = (action_engine.mode == MODE_CONTROL and not interpreter.paused
                                and interpreter.config.airswipe_enabled)
                dispatch(keyboard_events(focus_watcher, focus_poller.latest(), now_ms, focus_active))

            emit_app_events()
            latency_ms = round((time.monotonic() - t0) * 1000.0, 1)

            # 3. Emit telemetry at ~16 Hz (or immediately on click/scroll/pause events)
            now_sec = time.monotonic()
            important_event = any(
                e in dispatched
                for e in (
                    "LEFT_CLICK",
                    "SCROLL",
                    "START_DRAG",
                    "END_DRAG",
                    "PAUSE",
                    "RESUME",
                    "TRACKING_LOST",
                    "BACK",
                    "FORWARD",
                    "CONFIRM",
                    "CANCEL",
                    "MEDIA_PLAY_PAUSE",
                    "MEDIA_NEXT",
                    "PRECISION",
                    "NAVIGATION",
                    "TIMER",
                    "AIRSWIPE_TRACE",
                    "MINIMIZE_WINDOW",
                    "RESTORE_WINDOW",
                )
            )
            if important_event or (now_sec - last_telemetry_emit) >= 0.060:
                last_telemetry_emit = now_sec
                emit_json(telemetry_payload(latency_ms, dispatched))

            # Yield only 1ms when camera is open so VideoCapture.read() paces the loop naturally
            if capture.is_open:
                time.sleep(0.001)

        return 0
    except Exception as exc:
        emit_json({"type": "ERROR", "running": False, "message": f"Error en motor gestual: {exc}"})
        return 1
    finally:
        if focus_poller is not None:
            focus_poller.stop()
        if camera_thread is not None:
            camera_thread.join(timeout=5)  # no liberar la cámara mientras aún se está abriendo
        if action_engine is not None:
            try:
                action_engine.shutdown()
            except Exception:
                pass
        if detector is not None:
            try:
                detector.close()
            except Exception:
                pass
        if face_detector is not None:
            try:
                face_detector.close()
            except Exception:
                pass
        try:
            capture.release()
        except Exception:
            pass
        emit_json({"type": "STOPPED", "running": False, "cameraOpen": False, "mode": MODE_OBSERVATION})


def _initial_config_from_argv(argv: list[str]) -> dict[str, Any] | None:
    """Lee --config-json. La configuración inicial viaja en la línea de comandos para no esperar un ACK."""
    if "--config-json" not in argv:
        return None
    index = argv.index("--config-json")
    raw = argv[index + 1] if index + 1 < len(argv) else ""
    try:
        return json.loads(raw)
    except ValueError:
        emit_json({"type": "ERROR", "running": False, "code": "IPC_INVALID_JSON",
                   "message": "--config-json no es JSON válido."})
        sys.exit(2)


if __name__ == "__main__":
    mock_flag = "--mock-os" in sys.argv
    sys.exit(run_engine(use_mock_os=mock_flag, initial_config=_initial_config_from_argv(sys.argv)))
