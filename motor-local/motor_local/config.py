"""Configuración local del motor gestual.

Dos entradas, sin mezclarlas:
- Mensajes IPC de la aplicación de escritorio (claves camelCase). Una clave ausente usa su
  valor por defecto documentado; una clave presente con tipo o rango inválido se RECHAZA
  con ConfigError. Nunca se convierte silenciosamente un valor inválido en un default.
- Exportación de la API (formato_version 1), validada en api_export.py.

Los valores de DEFAULT son hipótesis iniciales, no calibración medida.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

UI_FORMAT_VERSION = 2
_MISSING = object()


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


@dataclass
class EngineConfig:
    """Configuración validada del motor. Los campos de runtime (cámara, espejo, mano) no vienen
    de la exportación de la API: son ajustes locales del equipo."""

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
    swipe_left_enabled: bool = True   # deslizamiento_izquierda -> atras
    swipe_right_enabled: bool = True  # deslizamiento_derecha -> adelante
    window_gestures_enabled: bool = False  # tres dedos: minimizar/restaurar ventanas (opt-in local)
    precision_mode: bool = False   # Fine cursor movement multiplier (sin gesto asignable aún)
    camera_index: int = 0
    click_cooldown_ms: int = 320   # Prevent accidental repeated clicks
    drag_hold_ms: int = 380        # Sustained pinch duration to enter drag
    pause_hold_ms: int = 450       # Closed fist duration to toggle pause/resume
    tracking_loss_frames: int = 5  # Frames without hand before releasing held buttons

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
            pointer_enabled=_bool_field(data, ("pointer",), True),
            pinch_enabled=_bool_field(data, ("pinch", "pinch_enabled"), True),
            drag_enabled=_bool_field(data, ("drag",), True),
            scroll_enabled=_bool_field(data, ("scroll", "scroll_enabled"), True),
            fist_pause_enabled=_bool_field(data, ("fistPause",), True),
            swipe_left_enabled=_bool_field(data, ("swipeLeft",), True),
            swipe_right_enabled=_bool_field(data, ("swipeRight",), True),
            window_gestures_enabled=_bool_field(data, ("windowGestures",), False),
            precision_mode=_bool_field(data, ("precisionMode", "modo_precision"), False),
            camera_index=_int_field(data, ("cameraIndex",), 0, 0, 10),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "format_version": self.format_version,
            "preferredHand": self.preferred_hand,
            "mirrorCamera": self.mirror_camera,
            "sensitivity": self.sensitivity,
            "stability": self.stability,
            "pinchTolerance": self.pinch_tolerance,
            "movementArea": self.movement_area,
            "confidenceThreshold": self.confidence_threshold,
            "deskRest": self.desk_rest,
            "pointer": self.pointer_enabled,
            "pinch": self.pinch_enabled,
            "drag": self.drag_enabled,
            "scroll": self.scroll_enabled,
            "fistPause": self.fist_pause_enabled,
            "swipeLeft": self.swipe_left_enabled,
            "swipeRight": self.swipe_right_enabled,
            "windowGestures": self.window_gestures_enabled,
            "precisionMode": self.precision_mode,
            "cameraIndex": self.camera_index,
        }

    # --- Mathematical transformations from 0-100 sliders to physical thresholds ---

    @property
    def cursor_gain(self) -> float:
        """Maps sensitivity (0-100) to cursor speed/gain multiplier [0.65 .. 2.25]."""
        base = 0.65 + (self.sensitivity / 100.0) * 1.60
        if self.precision_mode:
            base *= 0.55
        elif self.desk_rest:
            base *= 1.15
        return round(base, 4)

    @property
    def active_bounds(self) -> tuple[float, float, float, float]:
        """Returns (x_min, x_max, y_min, y_max) in normalized camera coordinates [0..1].
        Smaller movement_area or Desk-Rest tightens the active region so the user reaches all
        four screen corners without stretching their arm to the edges of the webcam FOV.
        """
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
        return round(2.4 - (self.stability / 100.0) * 1.95, 3)

    @property
    def beta_speed(self) -> float:
        """One-Euro Filter speed coefficient (beta): reduces lag during fast cursor movements.
        Since coordinates are normalized [0..1], dx/dt during fast sweeps is ~1.5..8.0 units/s,
        so beta in [1.8 .. 6.5] raises cutoff_hz by +5..+25 Hz during fast intentional motion.
        """
        return round(1.8 + ((100 - self.stability) / 100.0) * 4.7, 3)

    @property
    def deadzone_norm(self) -> float:
        """Micro-tremor deadzone [0.0005 .. 0.0040] — kept small so slow movements never freeze."""
        return round(0.0005 + (self.stability / 100.0) * 0.0035, 5)

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
        """Hysteresis exit ratio (1.38x enter ratio) to prevent pinch flicker."""
        return round(self.pinch_enter_ratio * 1.38, 4)

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
