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
from typing import Any, Callable, Protocol


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


class OSAdapterProtocol(Protocol):
    def move_cursor(self, norm_x: float, norm_y: float) -> None: ...
    def left_click(self) -> None: ...
    def start_drag(self) -> None: ...
    def end_drag(self) -> None: ...
    def scroll(self, dy: int) -> None: ...
    def release_all(self) -> None: ...
    def close(self) -> None: ...


class MockOSAdapter:
    """In-memory OS input adapter used by automated unit/integration tests and simulation."""

    def __init__(self, screen_width: int = 1920, screen_height: int = 1080) -> None:
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.cursor_x: int = screen_width // 2
        self.cursor_y: int = screen_height // 2
        self.button_held: bool = False
        self.executed_actions: list[tuple[str, dict[str, Any]]] = []
        # Simulado: el adaptador de prueba no depende de un atajo global real.
        self.hotkey_active: bool = True
        self.hotkey_error: str = ""

    def move_cursor(self, norm_x: float, norm_y: float) -> None:
        clamped_x = max(0.0, min(1.0, float(norm_x)))
        clamped_y = max(0.0, min(1.0, float(norm_y)))
        self.cursor_x = int(round(clamped_x * (self.screen_width - 1)))
        self.cursor_y = int(round(clamped_y * (self.screen_height - 1)))
        self.executed_actions.append(("MOVE_CURSOR", {"x": self.cursor_x, "y": self.cursor_y}))

    def left_click(self) -> None:
        self.executed_actions.append(("LEFT_CLICK", {"x": self.cursor_x, "y": self.cursor_y}))

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

    def release_all(self) -> None:
        if self.button_held:
            self.button_held = False
            self.executed_actions.append(("RELEASE_ALL", {}))

    def close(self) -> None:
        self.release_all()


class PynputOSAdapter:
    """Real Windows OS input adapter using pynput with DPI awareness and Emergency Stop (<ctrl>+<alt>+z)."""

    def __init__(self, on_emergency_stop: Callable[[], None] | None = None) -> None:
        enable_windows_dpi_awareness()
        from pynput import keyboard, mouse

        self._mouse_mod = mouse
        self._keyboard_mod = keyboard
        self._mouse = mouse.Controller()
        self.screen_width, self.screen_height = get_screen_size()
        self.button_held: bool = False
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
        margin_px = 2
        x = int(round(max(0.0, min(1.0, float(norm_x))) * (self.screen_width - 1)))
        y = int(round(max(0.0, min(1.0, float(norm_y))) * (self.screen_height - 1)))
        x = max(margin_px, min(self.screen_width - margin_px, x))
        y = max(margin_px, min(self.screen_height - margin_px, y))
        self._mouse.position = (x, y)

    def left_click(self) -> None:
        if self.button_held:
            self.end_drag()
        self._mouse.click(self._mouse_mod.Button.left, 1)

    def start_drag(self) -> None:
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

    def release_all(self) -> None:
        if self.button_held:
            self.button_held = False
        try:
            self._mouse.release(self._mouse_mod.Button.left)
        except Exception:
            pass

    def close(self) -> None:
        self.release_all()
        if self._hotkeys is not None:
            try:
                self._hotkeys.stop()
            except Exception:
                pass
            finally:
                self._hotkeys = None
