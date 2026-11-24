"""Layer 5: Operating System Input Adapter.

Translates logical events into native OS cursor/scroll/click operations.
Solves Windows DPI scaling (125%, 150%, 175%) by declaring Per-Monitor v2 / System DPI
awareness before querying display metrics or moving the mouse cursor via pynput.

Provides:
- OSAdapterProtocol (abstract interface)
- MockOSAdapter (for automated testing without touching real mouse/keyboard)
- PynputOSAdapter (real Windows mouse & keyboard control via pynput + emergency stop shortcut)
"""

from __future__ import annotations

import ctypes
import math
import threading
import time
from typing import Any, Callable, Protocol

from .capabilities import ALLOWED_KEYS, DEVICE_KEYS


def enable_windows_dpi_awareness() -> None:
    """Enables Per-Monitor v2 DPI awareness on Windows 10/11 so GetSystemMetrics and
    SendInput/SetCursorPos use true physical screen pixels instead of scaled virtual pixels.
    """
    try:
        # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        return
    except Exception:
        pass
    try:
        # PROCESS_PER_MONITOR_DPI_AWARE = 2
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
        return
    except Exception:
        pass
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


def get_screen_size() -> tuple[int, int]:
    """Queries the primary display physical pixel resolution on Windows, falling back to 1920x1080."""
    enable_windows_dpi_awareness()
    try:
        user32 = ctypes.windll.user32
        width = int(user32.GetSystemMetrics(0))
        height = int(user32.GetSystemMetrics(1))
        if width > 0 and height > 0:
            return width, height
    except Exception:
        pass
    return 1920, 1080


SM_XVIRTUALSCREEN = 76
SM_YVIRTUALSCREEN = 77
SM_CXVIRTUALSCREEN = 78
SM_CYVIRTUALSCREEN = 79


def get_virtual_screen() -> tuple[int, int, int, int]:
    """Escritorio virtual completo: (izquierda, arriba, ancho, alto) con todas las pantallas.

    Las coordenadas pueden ser negativas si una pantalla queda a la izquierda o arriba de la principal.
    Si Windows no responde, se usa la pantalla principal.
    """
    enable_windows_dpi_awareness()
    try:
        user32 = ctypes.windll.user32
        left = int(user32.GetSystemMetrics(SM_XVIRTUALSCREEN))
        top = int(user32.GetSystemMetrics(SM_YVIRTUALSCREEN))
        width = int(user32.GetSystemMetrics(SM_CXVIRTUALSCREEN))
        height = int(user32.GetSystemMetrics(SM_CYVIRTUALSCREEN))
        if width > 0 and height > 0:
            return left, top, width, height
    except Exception:
        pass
    width, height = get_screen_size()
    return 0, 0, width, height


def map_normalized_to_screen(
    norm_x: float,
    norm_y: float,
    left: int,
    top: int,
    width: int,
    height: int,
    margin: int = 0,
) -> tuple[int, int]:
    """Convierte coordenadas normalizadas [0..1] del área activa a píxeles del escritorio virtual.

    El resultado siempre queda dentro del rectángulo, separado `margin` píxeles de sus bordes.
    """
    if width <= 1 or height <= 1:
        return left, top
    x = max(0.0, min(1.0, float(norm_x)))
    y = max(0.0, min(1.0, float(norm_y)))
    px = left + int(round(x * (width - 1)))
    py = top + int(round(y * (height - 1)))
    px = max(left + margin, min(left + width - 1 - margin, px))
    py = max(top + margin, min(top + height - 1 - margin, py))
    return px, py


# Únicas combinaciones de teclado que el motor puede emitir (contrato capacidades.json,
# `teclas_permitidas` y `teclas_equipo`). Cualquier otra se rechaza.
ALLOWED_KEY_COMBOS = frozenset(ALLOWED_KEYS.values()) | frozenset(DEVICE_KEYS.values())
# Teclas de edición del teclado Air-Swipe (solo con el teclado abierto y en CONTROL).
EDIT_KEYS = frozenset({"backspace", "enter", "space"})
TEXT_MAX_CHARS = 64


def validate_text(text: Any) -> tuple[bool, str]:
    """Texto que puede escribirse en la aplicación activa: imprimible, sin saltos ni controles."""
    if not isinstance(text, str) or not text:
        return False, "El texto debe ser una cadena no vacía."
    if len(text) > TEXT_MAX_CHARS:
        return False, f"El texto supera {TEXT_MAX_CHARS} caracteres."
    if any((not ch.isprintable()) or ch in "\r\n\t" for ch in text):
        return False, "El texto solo admite caracteres imprimibles."
    return True, ""


class OSAdapterProtocol(Protocol):
    def move_cursor(self, norm_x: float, norm_y: float) -> None: ...
    def left_click(self) -> None: ...
    def right_click(self) -> None: ...
    def start_drag(self) -> None: ...
    def end_drag(self) -> None: ...
    def scroll(self, dy: int) -> None: ...
    def key_combo(self, keys: tuple[str, ...]) -> None: ...
    def type_text(self, text: str) -> None: ...
    def press_key(self, key: str) -> None: ...
    def alt_switcher(self, phase: str) -> None: ...
    def release_all(self) -> None: ...
    def close(self) -> None: ...


class MockOSAdapter:
    """In-memory OS input adapter used by automated unit/integration tests and simulation."""

    def __init__(
        self,
        screen_width: int = 1920,
        screen_height: int = 1080,
        screen_left: int = 0,
        screen_top: int = 0,
    ) -> None:
        self.screen_left = screen_left
        self.screen_top = screen_top
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.cursor_x: int = screen_left + screen_width // 2
        self.cursor_y: int = screen_top + screen_height // 2
        self.button_held: bool = False
        self.executed_actions: list[tuple[str, dict[str, Any]]] = []
        # Simulado: el adaptador de prueba no depende de un atajo global real.
        self.hotkey_active: bool = True
        self.hotkey_error: str = ""

    def move_cursor(self, norm_x: float, norm_y: float) -> None:
        self.cursor_x, self.cursor_y = map_normalized_to_screen(
            norm_x, norm_y, self.screen_left, self.screen_top, self.screen_width, self.screen_height
        )
        self.executed_actions.append(("MOVE_CURSOR", {"x": self.cursor_x, "y": self.cursor_y}))

    def left_click(self) -> None:
        self.executed_actions.append(("LEFT_CLICK", {"x": self.cursor_x, "y": self.cursor_y}))

    def right_click(self) -> None:
        self.executed_actions.append(("RIGHT_CLICK", {"x": self.cursor_x, "y": self.cursor_y}))

    def start_drag(self) -> None:
        if not self.button_held:
            self.button_held = True
            self.executed_actions.append(("START_DRAG", {"x": self.cursor_x, "y": self.cursor_y}))

    def end_drag(self) -> None:
        if self.button_held:
            self.button_held = False
            self.executed_actions.append(("END_DRAG", {"x": self.cursor_x, "y": self.cursor_y}))

    def scroll(self, dy: int) -> None:
        self.executed_actions.append(("SCROLL", {"dy": int(dy)}))

    def key_combo(self, keys: tuple[str, ...]) -> None:
        if tuple(keys) not in ALLOWED_KEY_COMBOS:
            raise ValueError("Combinación de teclado no permitida.")
        self.executed_actions.append(("KEY_COMBO", {"keys": list(keys)}))

    def type_text(self, text: str) -> None:
        ok, message = validate_text(text)
        if not ok:
            raise ValueError(message)
        # El doble de pruebas registra solo la longitud: el texto escrito nunca se conserva.
        self.executed_actions.append(("TYPE_TEXT", {"chars": len(text)}))
        self.typed = getattr(self, "typed", "") + text

    def press_key(self, key: str) -> None:
        if key not in EDIT_KEYS:
            raise ValueError("Tecla no permitida.")
        self.executed_actions.append(("PRESS_KEY", {"key": key}))

    def alt_switcher(self, phase: str) -> None:
        held = getattr(self, "alt_held", False)
        if phase == "abrir":
            self.alt_held = True
            self.executed_actions.append(("ALT_SWITCHER", {"fase": "abrir"}))
        elif phase in ("siguiente", "soltar") and held:
            self.alt_held = phase == "siguiente"
            self.executed_actions.append(("ALT_SWITCHER", {"fase": phase}))

    def release_all(self) -> None:
        if getattr(self, "alt_held", False):
            self.alt_held = False
            self.executed_actions.append(("ALT_SWITCHER", {"fase": "cancelar"}))
        if self.button_held:
            self.button_held = False
            self.executed_actions.append(("RELEASE_ALL", {}))

    def close(self) -> None:
        self.release_all()


class CursorGlide:
    """Interpolación del cursor entre fotogramas de la cámara (lógica pura, sin hilos).

    La cámara entrega ~15-30 FPS; mover el ratón solo en cada fotograma hace que el cursor avance a
    saltos. Aquí el cursor se acerca al último objetivo con una aproximación exponencial de constante
    `tau_ms`, evaluada a la cadencia que marque quien llame (el adaptador real, ~125 Hz). Solo escribe
    mientras haya distancia que recorrer: con la mano quieta no toca el ratón.
    """

    def __init__(self, tau_ms: float = 45.0, snap_px: float = 0.6, jump_px: float = 900.0) -> None:
        self.tau_ms = tau_ms
        self.snap_px = snap_px
        self.jump_px = jump_px            # un salto mayor (p. ej. la primera muestra) se aplica de golpe
        self._pos: tuple[float, float] | None = None
        self._target: tuple[float, float] | None = None
        self._last_ms: float | None = None
        self._pending_jump = False

    @property
    def target(self) -> tuple[int, int] | None:
        return None if self._target is None else (int(round(self._target[0])), int(round(self._target[1])))

    def set_target(self, x: float, y: float, now_ms: float) -> None:
        self._target = (float(x), float(y))
        if self._pos is None or math.hypot(x - self._pos[0], y - self._pos[1]) > self.jump_px:
            self._pos = (float(x), float(y))
            self._last_ms = now_ms
            self._pending_jump = True
        elif self._last_ms is None:
            self._last_ms = now_ms

    def snap(self) -> tuple[int, int] | None:
        """Lleva el cursor al objetivo ya (antes de un clic o de pulsar el botón)."""
        if self._target is None:
            return None
        self._pos = self._target
        return self.target

    def cancel(self) -> None:
        """Deja de moverse donde esté (parada, pausa, pérdida de mano)."""
        if self._pos is not None:
            self._target = self._pos

    def step(self, now_ms: float) -> tuple[int, int] | None:
        """Nueva posición entera si el cursor debe moverse, o None si ya está en el objetivo."""
        if self._target is None or self._pos is None:
            return None
        if self._pending_jump:
            self._pending_jump = False
            self._last_ms = now_ms
            return int(round(self._pos[0])), int(round(self._pos[1]))
        last = self._last_ms if self._last_ms is not None else now_ms
        dt = max(0.0, min(100.0, now_ms - last))
        self._last_ms = now_ms
        tx, ty = self._target
        px, py = self._pos
        if math.hypot(tx - px, ty - py) <= self.snap_px:
            if (int(round(px)), int(round(py))) == (int(round(tx)), int(round(ty))):
                self._pos = self._target
                return None
            self._pos = self._target
            return self.target
        alpha = 1.0 - math.exp(-dt / max(1.0, self.tau_ms))
        nx, ny = px + (tx - px) * alpha, py + (ty - py) * alpha
        before = (int(round(px)), int(round(py)))
        self._pos = (nx, ny)
        after = (int(round(nx)), int(round(ny)))
        return None if after == before else after


GLIDE_INTERVAL_S = 0.008  # ~125 Hz


class PynputOSAdapter:
    """Real Windows OS input adapter using pynput with DPI awareness and Emergency Stop (<ctrl>+<alt>+z)."""

    def __init__(self, on_emergency_stop: Callable[[], None] | None = None) -> None:
        enable_windows_dpi_awareness()
        from pynput import keyboard, mouse

        self._mouse_mod = mouse
        self._keyboard_mod = keyboard
        self._keyboard_ctl: Any = None
        self._mouse = mouse.Controller()
        # Escritorio virtual: el cursor puede recorrer todas las pantallas, no solo la principal.
        self.screen_left, self.screen_top, self.screen_width, self.screen_height = get_virtual_screen()
        self.button_held: bool = False
        # Movimiento suave del cursor entre fotogramas (hilo propio; se detiene en close()).
        self._glide = CursorGlide()
        self._glide_lock = threading.Lock()
        self._glide_stop = threading.Event()
        self._glide_thread = threading.Thread(target=self._glide_loop, name="zt-cursor-glide", daemon=True)
        self._glide_thread.start()
        self._on_emergency_stop = on_emergency_stop
        self._hotkeys: Any = None
        # El control solo se habilita si el atajo de parada quedó realmente activo (no basta con no lanzar excepción).
        self.hotkey_active: bool = False
        self.hotkey_error: str = ""

        if on_emergency_stop is None:
            self.hotkey_error = "Sin manejador de parada de emergencia."
        else:
            try:
                self._hotkeys = keyboard.GlobalHotKeys({"<ctrl>+<alt>+z": self._trigger_emergency})
                self._hotkeys.daemon = True
                self._hotkeys.start()
                wait = getattr(self._hotkeys, "wait", None)
                if callable(wait):
                    wait()
                self.hotkey_active = bool(getattr(self._hotkeys, "running", False))
                if not self.hotkey_active:
                    self.hotkey_error = "El listener de teclado no quedó activo."
            except Exception as exc:  # pragma: no cover - depende del sistema operativo
                self._hotkeys = None
                self.hotkey_error = f"No se pudo registrar Ctrl+Alt+Z: {exc}"

    def _trigger_emergency(self) -> None:
        self.release_all()
        if self._on_emergency_stop:
            self._on_emergency_stop()

    def move_cursor(self, norm_x: float, norm_y: float) -> None:
        x, y = map_normalized_to_screen(
            norm_x,
            norm_y,
            self.screen_left,
            self.screen_top,
            self.screen_width,
            self.screen_height,
            margin=2,
        )
        with self._glide_lock:
            self._glide.set_target(x, y, time.monotonic() * 1000.0)

    def _glide_loop(self) -> None:
        while not self._glide_stop.wait(GLIDE_INTERVAL_S):
            with self._glide_lock:
                position = self._glide.step(time.monotonic() * 1000.0)
            if position is not None:
                try:
                    self._mouse.position = position
                except Exception:  # pragma: no cover - depende del sistema operativo
                    pass

    def _snap_cursor(self) -> None:
        with self._glide_lock:
            position = self._glide.snap()
        if position is not None:
            try:
                self._mouse.position = position
            except Exception:  # pragma: no cover
                pass

    def left_click(self) -> None:
        self._snap_cursor()
        if self.button_held:
            self.end_drag()
        self._mouse.click(self._mouse_mod.Button.left, 1)

    def right_click(self) -> None:
        """Clic derecho (menú contextual) en la posición del puntero. Suelta antes un arrastre en curso."""
        self._snap_cursor()
        if self.button_held:
            self.end_drag()
        self._mouse.click(self._mouse_mod.Button.right, 1)

    def start_drag(self) -> None:
        self._snap_cursor()
        if not self.button_held:
            self.button_held = True
            self._mouse.press(self._mouse_mod.Button.left)

    def end_drag(self) -> None:
        if self.button_held:
            self.button_held = False
            try:
                self._mouse.release(self._mouse_mod.Button.left)
            except Exception:
                pass

    def scroll(self, dy: int) -> None:
        steps = max(-15, min(15, int(dy)))
        if steps != 0:
            self._mouse.scroll(0, steps)

    def _key_names(self) -> dict[str, Any]:
        key = self._keyboard_mod.Key
        return {
            "alt": key.alt,
            "ctrl": key.ctrl,
            "shift": key.shift,
            "tab": key.tab,
            "left": key.left,
            "right": key.right,
            "down": key.down,
            "win": key.cmd,
            "h": "h",  # letra: solo dentro de la combinación permitida Win+H (dictado)
            "t": "t",  # letra: solo dentro de la combinación permitida Ctrl+T (pestaña nueva)
            "enter": key.enter,
            "esc": key.esc,
            "backspace": key.backspace,
            "space": key.space,
            "media_play_pause": key.media_play_pause,
            "media_next": key.media_next,
        }

    def _controller(self) -> Any:
        if self._keyboard_ctl is None:
            self._keyboard_ctl = self._keyboard_mod.Controller()
        return self._keyboard_ctl

    def key_combo(self, keys: tuple[str, ...]) -> None:
        """Pulsa una combinación de la lista permitida: modificadores, tecla, y suelta en orden inverso."""
        if tuple(keys) not in ALLOWED_KEY_COMBOS:
            raise ValueError("Combinación de teclado no permitida.")
        names = self._key_names()
        mapped = [names[k] for k in keys]
        ctl = self._controller()
        pressed: list[Any] = []
        try:
            for key in mapped:
                ctl.press(key)
                pressed.append(key)
        finally:
            for key in reversed(pressed):
                try:
                    ctl.release(key)
                except Exception:
                    pass

    def type_text(self, text: str) -> None:
        """Escribe texto imprimible en la aplicación activa (Air-Swipe). No se registra ni conserva."""
        ok, message = validate_text(text)
        if not ok:
            raise ValueError(message)
        self._controller().type(text)

    def press_key(self, key: str) -> None:
        """Pulsa una tecla de edición de la lista permitida (backspace, enter, space)."""
        if key not in EDIT_KEYS:
            raise ValueError("Tecla no permitida.")
        mapped = self._key_names()[key]
        ctl = self._controller()
        try:
            ctl.press(mapped)
        finally:
            try:
                ctl.release(mapped)
            except Exception:
                pass

    def _tap(self, key: Any) -> None:
        ctl = self._controller()
        ctl.press(key)
        try:
            ctl.release(key)
        except Exception:
            pass

    def alt_switcher(self, phase: str) -> None:
        """Selector de ventanas de Windows: «abrir» deja Alt pulsado y pulsa Tab; «siguiente» pulsa Tab con Alt aún
        pulsado; «soltar» suelta Alt (Windows cambia a la ventana elegida). Solo Alt y Tab: el atajo «cambiar_ventana»."""
        names = self._key_names()
        held = getattr(self, "_alt_held", False)
        if phase == "abrir":
            if not held:
                self._controller().press(names["alt"])
                self._alt_held = True
            self._tap(names["tab"])
        elif phase == "siguiente" and held:
            self._tap(names["tab"])
        elif phase == "soltar" and held:
            self._alt_held = False
            try:
                self._controller().release(names["alt"])
            except Exception:
                pass

    def _cancel_alt_switcher(self) -> None:
        """Parada, pausa o mano perdida con el selector abierto: Esc lo cierra sin cambiar de ventana y se suelta Alt."""
        if not getattr(self, "_alt_held", False):
            return
        self._alt_held = False
        names = self._key_names()
        try:
            self._tap(names["esc"])
        except Exception:
            pass
        try:
            self._controller().release(names["alt"])
        except Exception:
            pass

    def release_all(self) -> None:
        self._cancel_alt_switcher()
        with self._glide_lock:
            self._glide.cancel()
        if self.button_held:
            self.button_held = False
        try:
            self._mouse.release(self._mouse_mod.Button.left)
        except Exception:
            pass

    def close(self) -> None:
        self._glide_stop.set()
        self.release_all()
        if self._hotkeys is not None:
            try:
                self._hotkeys.stop()
            except Exception:
                pass
            finally:
                self._hotkeys = None
