"""Configuración local del motor gestual (formato IPC 2).

Dos entradas, sin mezclarlas:
- Mensajes IPC de la aplicación de escritorio (claves camelCase). Una clave ausente usa su
  valor por defecto documentado (los mismos que la interfaz); una clave presente con tipo o rango
  inválido se RECHAZA con ConfigError. Nunca se convierte silenciosamente un valor inválido en un
  default. El mapa `gestos` (gesto -> {accion, habilitado}) es la forma preferida de habilitar
  gestos; los interruptores camelCase (`pinch`, `scroll`, ...) se aceptan por compatibilidad.
- Exportación de la API (formato_version 1), validada en api_export.py.

Los valores de DEFAULT son hipótesis iniciales, no calibración medida.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

from .capabilities import (
    DEFAULT_ACTION,
    DISCRETE_GESTURES,
    GESTURES,
    GESTURE_TOGGLE,
    KNOWN_ACTIONS,
    NO_ACTION,
    TOGGLE_DEFAULTS,
    TOGGLE_GESTURE,
    is_allowed,
)

UI_FORMAT_VERSION = 2
_MISSING = object()
# Factor de salida de la pinza respecto a la entrada (histéresis). Hipótesis, calibrar con captura real.
PINCH_EXIT_FACTOR = 1.38


class ConfigError(ValueError):
    """Configuración rechazada. `code` es estable y apto para IPC; `message` no contiene secretos."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _pick(data: Mapping[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in data:
            return data[key]
    return _MISSING


def _int_field(data: Mapping[str, Any], keys: tuple[str, ...], default: int, lo: int, hi: int) -> int:
    value = _pick(data, keys)
    if value is _MISSING:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfigError("FIELD_INVALID", f"{keys[0]} debe ser un entero.")
    if isinstance(value, float) and not value.is_integer():
        raise ConfigError("FIELD_INVALID", f"{keys[0]} debe ser un entero.")
    number = int(value)
    if number < lo or number > hi:
        raise ConfigError("FIELD_OUT_OF_RANGE", f"{keys[0]} debe estar entre {lo} y {hi}.")
    return number


def _bool_field(data: Mapping[str, Any], keys: tuple[str, ...], default: bool) -> bool:
    value = _pick(data, keys)
    if value is _MISSING:
        return default
    if not isinstance(value, bool):
        raise ConfigError("FIELD_INVALID", f"{keys[0]} debe ser booleano JSON.")
    return value


_HAND_ALIASES = {
    "LEFT": "LEFT",
    "IZQUIERDA": "LEFT",
    "RIGHT": "RIGHT",
    "DERECHA": "RIGHT",
    "AUTO": "AUTO",
    "AUTOMATICO": "AUTO",
    "AUTOMÁTICO": "AUTO",
}


def _hand_field(data: Mapping[str, Any], keys: tuple[str, ...], default: str) -> str:
    value = _pick(data, keys)
    if value is _MISSING:
        return default
    if not isinstance(value, str) or value.strip().upper() not in _HAND_ALIASES:
        raise ConfigError("FIELD_INVALID", f"{keys[0]} debe ser LEFT, RIGHT o AUTO.")
    return _HAND_ALIASES[value.strip().upper()]


def _box_field(data: Mapping[str, Any]) -> tuple[float, float, float, float] | None:
    """Calibración de recorrido: [xMin, xMax, yMin, yMax] en coordenadas de cámara, o null."""
    value = _pick(data, ("activeBox",))
    if value is _MISSING or value is None:
        return None
    if not isinstance(value, (list, tuple)) or len(value) != 4 or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in value):
        raise ConfigError("FIELD_INVALID", "activeBox debe ser null o una lista de cuatro números.")
    x_min, x_max, y_min, y_max = (float(v) for v in value)
    if not (0.0 <= x_min < x_max <= 1.0 and 0.0 <= y_min < y_max <= 1.0):
        raise ConfigError("FIELD_OUT_OF_RANGE", "activeBox debe cumplir 0 <= min < max <= 1.")
    if (x_max - x_min) < 0.15 or (y_max - y_min) < 0.15:
        raise ConfigError("FIELD_OUT_OF_RANGE", "activeBox es demasiado pequeña (mínimo 0,15 por eje).")
    return round(x_min, 4), round(x_max, 4), round(y_min, 4), round(y_max, 4)


@dataclass(frozen=True)
class GazeConfig:
    """Asistencia por orientación de la cabeza (aproximación local; no es seguimiento ocular)."""

    enabled: bool = False
    yaw_tolerance: int = 22      # grados aproximados hacia los lados
    pitch_tolerance: int = 18    # grados aproximados arriba/abajo
    away_ms: int = 800           # tiempo mirando fuera antes de retener la interacción
    back_ms: int = 300           # tiempo mirando a la pantalla antes de reanudar
    calibration: tuple[float, float] | None = None  # (yaw, pitch) neutros medidos

    @classmethod
    def from_dict(cls, data: Any) -> "GazeConfig":
        if data is _MISSING or data is None:
            return cls()
        if not isinstance(data, Mapping):
            raise ConfigError("FIELD_INVALID", "gaze debe ser un objeto.")
        unknown = set(data) - {"enabled", "yawTolerance", "pitchTolerance", "awayMs", "backMs", "calibration"}
        if unknown:
            raise ConfigError("UNKNOWN_FIELD", f"Campos de gaze desconocidos: {sorted(unknown)}.")
        calibration = data.get("calibration")
        parsed: tuple[float, float] | None = None
        if calibration is not None:
            if not isinstance(calibration, Mapping) or any(isinstance(calibration.get(k), bool) or not isinstance(calibration.get(k), (int, float)) for k in ("yaw", "pitch")):
                raise ConfigError("FIELD_INVALID", "gaze.calibration debe tener yaw y pitch numéricos.")
            parsed = (round(float(calibration["yaw"]), 2), round(float(calibration["pitch"]), 2))
        return cls(
            enabled=_bool_field(data, ("enabled",), False),
            yaw_tolerance=_int_field(data, ("yawTolerance",), 22, 8, 45),
            pitch_tolerance=_int_field(data, ("pitchTolerance",), 18, 8, 45),
            away_ms=_int_field(data, ("awayMs",), 800, 200, 5000),
            back_ms=_int_field(data, ("backMs",), 300, 100, 3000),
            calibration=parsed,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "yawTolerance": self.yaw_tolerance,
            "pitchTolerance": self.pitch_tolerance,
            "awayMs": self.away_ms,
            "backMs": self.back_ms,
            "calibration": None if self.calibration is None else {"yaw": self.calibration[0], "pitch": self.calibration[1]},
        }


def _default_discrete() -> dict[str, str]:
    return {code: DEFAULT_ACTION[code] for code in DISCRETE_GESTURES}


def _parse_bindings(raw: Any) -> dict[str, dict[str, Any]]:
    """Valida el mapa `gestos` del IPC. Rechaza gestos o acciones desconocidos y combinaciones que el
    motor no ejecuta mientras estén habilitadas; nunca las sustituye por otra acción."""
    if not isinstance(raw, Mapping):
        raise ConfigError("FIELD_INVALID", "gestos debe ser un objeto gesto -> {accion, habilitado}.")
    unknown = set(raw) - set(GESTURES)
    if unknown:
        raise ConfigError("GESTURE_UNKNOWN", f"Gestos desconocidos: {sorted(unknown)}.")
    result: dict[str, dict[str, Any]] = {}
    for code, item in raw.items():
        if not isinstance(item, Mapping) or set(item) - {"accion", "habilitado"}:
            raise ConfigError("FIELD_INVALID", f"gestos.{code} debe tener solo accion y habilitado.")
        accion = item.get("accion", DEFAULT_ACTION[code])
        if not isinstance(accion, str) or accion not in KNOWN_ACTIONS:
            raise ConfigError("FIELD_INVALID", f"gestos.{code}.accion no pertenece al catálogo.")
        habilitado = item.get("habilitado", True)
        if not isinstance(habilitado, bool):
            raise ConfigError("FIELD_INVALID", f"gestos.{code}.habilitado debe ser booleano JSON.")
        if not is_allowed(code, accion, habilitado):
            raise ConfigError("ACTION_NOT_IMPLEMENTED", f"El gesto {code} con acción {accion} no está implementado en el motor local.")
        result[code] = {"accion": accion, "habilitado": habilitado}
    return result


@dataclass
class EngineConfig:
    """Configuración validada del motor. Los campos de runtime (cámara, espejo, mano, recorrido,
    exigencia de detección, gestos de ventana, calibraciones) no vienen de la exportación de la API:
    son ajustes locales del equipo."""

    format_version: int = UI_FORMAT_VERSION
    preferred_hand: str = "RIGHT"  # "RIGHT" | "LEFT" | "AUTO"
    mirror_camera: bool = True     # True when frame is horizontally flipped (selfie view)
    sensitivity: int = 65          # 0-100 (sensibilidad_puntero)
    stability: int = 40            # 0-100 (estabilizacion_puntero)
    pinch_tolerance: int = 50      # 0-100 (tolerancia_micro_pinza)
    movement_area: int = 65        # 20-100 (tamaño del área activa de movimiento en cámara)
    confidence_threshold: int = 65 # 30-95 (confianza mínima de detección, %)
    desk_rest: bool = True         # Modo Desk-Rest (reduced hand range / ergonomic anchor)
    pointer_enabled: bool = True   # mano_abierta_sostenida -> activar_puntero
    pinch_enabled: bool = True     # micro_pinza -> clic
    drag_enabled: bool = True      # pinza_sostenida -> arrastrar
    scroll_enabled: bool = True    # dos_dedos -> desplazar
    fist_pause_enabled: bool = True  # puno_cerrado -> pausar (siempre permite reanudar)
    swipe_left_enabled: bool = False   # deslizamiento_izquierda (apagado por defecto, como en la interfaz)
    swipe_right_enabled: bool = False  # deslizamiento_derecha
    palm_enabled: bool = True          # palma_abierta sostenida -> acción discreta (navegacion)
    thumbs_up_enabled: bool = False    # pulgar_arriba -> acción discreta (confirmar)
    thumbs_down_enabled: bool = False  # pulgar_abajo -> acción discreta (cancelar)
    precision_gesture_enabled: bool = True  # modo_precision (índice y meñique) -> acción discreta (precision)
    airswipe_enabled: bool = True      # trazo_airswipe, solo con el teclado Air-Swipe abierto
    window_gestures_enabled: bool = False  # tres dedos: minimizar/restaurar ventanas (opt-in local)
    window_swipe_enabled: bool = False     # mano abierta rápida hacia abajo/arriba: minimizar/restaurar ventana (opt-in: QA 19-11)
    tab_gestures_enabled: bool = True      # pulgar y meñique hacia abajo/arriba: pestaña siguiente/anterior (local)
    right_click_enabled: bool = True       # pinza pulgar-medio: clic derecho (local)
    pointer_acceleration: bool = True      # movimientos lentos más finos, rápidos completos (local, QA 19-11)
    precision_mode: bool = False   # Ganancia fina fija desde configuración (el gesto la alterna en tiempo de ejecución)
    camera_index: int = 0
    click_cooldown_ms: int = 320   # Prevent accidental repeated clicks
    drag_hold_ms: int = 380        # Sustained pinch duration to enter drag
    pause_hold_ms: int = 450       # Closed fist duration to toggle pause/resume
    tracking_loss_frames: int = 5  # Frames without hand before releasing held buttons
    # Acción configurada de cada gesto discreto (palma, barridos, pulgares, precisión).
    discrete_actions: dict[str, str] = field(default_factory=_default_discrete)
    active_box: tuple[float, float, float, float] | None = None
    gaze: GazeConfig = field(default_factory=GazeConfig)

    # --- interruptor <-> campo ---
    _TOGGLE_FIELDS = {
        "pointer": "pointer_enabled",
        "pinch": "pinch_enabled",
        "drag": "drag_enabled",
        "scroll": "scroll_enabled",
        "fistPause": "fist_pause_enabled",
        "swipeLeft": "swipe_left_enabled",
        "swipeRight": "swipe_right_enabled",
        "palm": "palm_enabled",
        "thumbsUp": "thumbs_up_enabled",
        "thumbsDown": "thumbs_down_enabled",
        "precision": "precision_gesture_enabled",
        "airswipe": "airswipe_enabled",
    }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any] | None = None) -> "EngineConfig":
        """Lee el formato IPC de la aplicación. Rechaza tipos/rangos inválidos y formatos ajenos."""
        if data is None:
            return cls()
        if not isinstance(data, Mapping):
            raise ConfigError("FORMAT_INVALID", "La configuración debe ser un objeto JSON.")
        if "formato_version" in data:
            raise ConfigError(
                "FORMAT_NOT_IPC",
                "La exportación de la API se carga con LOAD_EXPORT, no con SET_CONFIG.",
            )
        if "format_version" in data and not (
            isinstance(data["format_version"], int)
            and not isinstance(data["format_version"], bool)
            and data["format_version"] == UI_FORMAT_VERSION
        ):
            raise ConfigError("FORMAT_UNSUPPORTED", "Versión de formato IPC no compatible.")

        toggles = {
            toggle: _bool_field(data, (toggle,) if toggle != "pinch" else ("pinch", "pinch_enabled"), TOGGLE_DEFAULTS.get(toggle, True))
            for toggle in cls._TOGGLE_FIELDS
        }
        if "scroll_enabled" in data and "scroll" not in data:
            toggles["scroll"] = _bool_field(data, ("scroll_enabled",), True)
        discrete = _default_discrete()
        if "gestos" in data:
            bindings = _parse_bindings(data["gestos"])
            for code, item in bindings.items():
                toggle = GESTURE_TOGGLE[code]
                if toggle:
                    toggles[toggle] = bool(item["habilitado"] and item["accion"] != NO_ACTION)
                if code in discrete:
                    discrete[code] = item["accion"]

        kwargs: dict[str, Any] = {cls._TOGGLE_FIELDS[toggle]: value for toggle, value in toggles.items()}
        return cls(
            format_version=UI_FORMAT_VERSION,
            preferred_hand=_hand_field(data, ("preferredHand", "mano_preferida"), "RIGHT"),
            mirror_camera=_bool_field(data, ("mirrorCamera", "espejo_camara"), True),
            sensitivity=_int_field(data, ("sensitivity", "sensibilidad_puntero"), 65, 0, 100),
            stability=_int_field(data, ("stability", "estabilizacion_puntero"), 40, 0, 100),
            pinch_tolerance=_int_field(data, ("pinchTolerance", "tolerancia_micro_pinza"), 50, 0, 100),
            movement_area=_int_field(data, ("movementArea", "area_movimiento"), 65, 20, 100),
            confidence_threshold=_int_field(data, ("confidenceThreshold", "umbral_confianza"), 65, 30, 95),
            desk_rest=_bool_field(data, ("deskRest", "modo_desk_rest"), True),
            window_gestures_enabled=_bool_field(data, ("windowGestures",), False),
            window_swipe_enabled=_bool_field(data, ("windowSwipe",), False),
            tab_gestures_enabled=_bool_field(data, ("tabGestures",), True),
            right_click_enabled=_bool_field(data, ("rightClick",), True),
            pointer_acceleration=_bool_field(data, ("pointerAcceleration",), True),
            precision_mode=_bool_field(data, ("precisionMode", "modo_precision"), False),
            camera_index=_int_field(data, ("cameraIndex",), 0, 0, 10),
            discrete_actions=discrete,
            active_box=_box_field(data),
            gaze=GazeConfig.from_dict(_pick(data, ("gaze",))),
            **kwargs,
        )

    def bindings(self) -> dict[str, dict[str, Any]]:
        """Mapa gesto -> {accion, habilitado} equivalente a esta configuración."""
        result: dict[str, dict[str, Any]] = {}
        for code in GESTURES:
            toggle = GESTURE_TOGGLE[code]
            enabled = bool(getattr(self, self._TOGGLE_FIELDS[toggle])) if toggle else True
            accion = self.discrete_actions.get(code, DEFAULT_ACTION[code]) if code in self.discrete_actions else DEFAULT_ACTION[code]
            result[code] = {"accion": accion, "habilitado": enabled}
        return result

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "format_version": self.format_version,
            "preferredHand": self.preferred_hand,
            "mirrorCamera": self.mirror_camera,
            "sensitivity": self.sensitivity,
            "stability": self.stability,
            "pinchTolerance": self.pinch_tolerance,
            "movementArea": self.movement_area,
            "confidenceThreshold": self.confidence_threshold,
            "deskRest": self.desk_rest,
            "windowGestures": self.window_gestures_enabled,
            "windowSwipe": self.window_swipe_enabled,
            "tabGestures": self.tab_gestures_enabled,
            "rightClick": self.right_click_enabled,
            "pointerAcceleration": self.pointer_acceleration,
            "precisionMode": self.precision_mode,
            "cameraIndex": self.camera_index,
            "activeBox": None if self.active_box is None else list(self.active_box),
            "gaze": self.gaze.to_dict(),
        }
        for toggle, field_name in self._TOGGLE_FIELDS.items():
            data[toggle] = bool(getattr(self, field_name))
        data["gestos"] = self.bindings()
        return data

    # --- Mathematical transformations from 0-100 sliders to physical thresholds ---

    @property
    def cursor_gain(self) -> float:
        """Maps sensitivity (0-100) to cursor gain [0.85 .. 1.60].

        El área activa ya escala el recorrido de la mano a la pantalla; una ganancia alta encima de un
        área pequeña multiplicaba el temblor de MediaPipe (con 65 % y Desk-Rest cada píxel de cámara
        movía ~17 px de pantalla). Por eso el rango es más corto y Desk-Rest ya no la multiplica."""
        base = 0.85 + (self.sensitivity / 100.0) * 0.75
        if self.precision_mode:
            base *= PRECISION_GAIN_FACTOR
        return round(base, 4)

    @property
    def active_bounds(self) -> tuple[float, float, float, float]:
        """Returns (x_min, x_max, y_min, y_max) in normalized camera coordinates [0..1].
        A measured `active_box` (calibración de recorrido) takes precedence. Otherwise a smaller
        movement_area or Desk-Rest tightens the active region so the user reaches all four screen
        corners without stretching their arm to the edges of the webcam FOV.
        """
        if self.active_box is not None:
            return self.active_box
        # movement_area = 100 -> span ~ 0.76; movement_area = 20 -> span ~ 0.36
        span_x = 0.36 + (self.movement_area / 100.0) * 0.40
        span_y = 0.32 + (self.movement_area / 100.0) * 0.38
        if self.desk_rest:
            span_x *= 0.85
            span_y *= 0.82

        center_x = 0.50
        # Natural hand posture sits slightly below the vertical center of the frame
        center_y = 0.56 if self.desk_rest else 0.52

        x_min = max(0.05, center_x - span_x * 0.5)
        x_max = min(0.95, center_x + span_x * 0.5)
        y_min = max(0.05, center_y - span_y * 0.5)
        y_max = min(0.95, center_y + span_y * 0.5)
        return round(x_min, 4), round(x_max, 4), round(y_min, 4), round(y_max, 4)

    @property
    def active_margin(self) -> float:
        x_min, _, _, _ = self.active_bounds
        return x_min

    @property
    def smoothing_alpha(self) -> float:
        """Base EMA alpha [0.15 .. 0.85] used alongside velocity-adaptive One-Euro filtering."""
        alpha = 0.85 - (self.stability / 100.0) * 0.68
        return round(max(0.15, min(0.88, alpha)), 4)

    @property
    def min_cutoff_hz(self) -> float:
        """One-Euro Filter minimum cutoff frequency (Hz): higher stability -> lower min_cutoff (less jitter)."""
        return round(1.6 - (self.stability / 100.0) * 1.2, 3)

    @property
    def beta_speed(self) -> float:
        """One-Euro Filter speed coefficient (beta): reduces lag during fast cursor movements.
        Since coordinates are normalized [0..1], dx/dt during fast sweeps is ~1.5..8.0 units/s,
        so beta in [1.8 .. 6.5] raises cutoff_hz by +5..+25 Hz during fast intentional motion.
        """
        return round(1.5 + ((100 - self.stability) / 100.0) * 3.5, 3)

    @property
    def deadzone_norm(self) -> float:
        """Micro-tremor deadzone [0.0008 .. 0.0050] of the screen (~2-10 px at 1920 px).
        El movimiento de salida lo suaviza el adaptador (interpolación a ~120 Hz), así que una zona
        algo mayor elimina el temblor en reposo sin que el cursor avance a saltos."""
        return round(0.0008 + (self.stability / 100.0) * 0.0042, 5)

    @property
    def settle_radius_norm(self) -> float:
        """Radio de «cursor asentado» [0.0035 .. 0.0085] de la pantalla (~7-16 px a 1920 px). Con la mano
        quieta en el aire, su balanceo natural se amplifica ~7 veces hasta la pantalla (QA 19-11); dentro
        de este radio el cursor no se mueve. Más estabilidad -> radio mayor."""
        return round(0.0035 + (self.stability / 100.0) * 0.005, 5)

    @property
    def pinch_enter_ratio(self) -> float:
        """Pinch enter threshold as a ratio of hand palm scale (distance wrist[0] to middle_mcp[9]).
        Because it is normalized by palm size, pinch detection works consistently regardless of
        whether the user's hand is 30 cm or 75 cm from the webcam.
        Maps pinch_tolerance (0-100) to [0.22 .. 0.48] of palm size.
        """
        return round(0.22 + (self.pinch_tolerance / 100.0) * 0.26, 4)

    @property
    def pinch_exit_ratio(self) -> float:
        """Hysteresis exit ratio (PINCH_EXIT_FACTOR x enter ratio) to prevent pinch flicker."""
        return round(self.pinch_enter_ratio * PINCH_EXIT_FACTOR, 4)

    @property
    def pinch_enter_threshold(self) -> float:
        """Fallback absolute 2D distance threshold when palm scale is near reference 0.15."""
        return round(self.pinch_enter_ratio * 0.15, 4)

    @property
    def pinch_exit_threshold(self) -> float:
        return round(self.pinch_exit_ratio * 0.15, 4)

    @property
    def min_detection_confidence(self) -> float:
        return round(self.confidence_threshold / 100.0, 2)


# Ganancia del cursor en modo precisión respecto a la normal. Hipótesis inicial.
PRECISION_GAIN_FACTOR = 0.55
