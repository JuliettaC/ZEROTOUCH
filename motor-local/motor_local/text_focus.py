"""Abrir y cerrar el teclado Air-Swipe según el foco del sistema (24-11-2026, pedido: «al apretar un cuadro donde se
pueda escribir se abra y al salir se cierre; tener un gesto es incómodo»).

- `TextFocusWatcher` (pura, con pruebas): recibe muestras «¿el foco está en un campo editable?» y devuelve "open" o
  "close" solo en los CAMBIOS estables (FOCUS_STABLE_MS). Al empezar, un foco que no es de texto no cierra nada: así
  no se baja un teclado abierto con su botón fuera de un campo.
- `Win32TextFocusProbe`: pregunta a UI Automation (la API de accesibilidad de Windows) por el elemento con foco y
  decide si es editable por su tipo de control y por si su valor es de solo lectura. Si UI Automation no responde,
  usa el cursor de texto del sistema (GetGUIThreadInfo) como respaldo.
- `FocusPoller`: hilo que consulta la sonda cada FOCUS_POLL_MS. La consulta cruza procesos y puede tardar si otra
  aplicación está colgada; por eso no se hace en el bucle de la cámara.

No se lee el texto del campo ni su contenido: solo tipo de control, solo lectura y habilitado.
"""

from __future__ import annotations

import ctypes
import sys
import threading
import time
from ctypes import wintypes
from typing import Callable, Protocol

FOCUS_POLL_MS = 250.0
FOCUS_STABLE_MS = 300.0   # el foco salta un instante al hacer clic (ventana, botón, campo): se espera a que se asiente

# UI Automation: identificadores de propiedades y tipos de control (UIAutomationClient.h).
UIA_CONTROL_TYPE = 30003
UIA_IS_ENABLED = 30010
UIA_IS_VALUE_PATTERN_AVAILABLE = 30043
UIA_VALUE_IS_READ_ONLY = 30046
CONTROL_EDIT = 50004
CONTROL_COMBO_BOX = 50003
CONTROL_DOCUMENT = 50030


def is_editable(control_type: int | None, enabled: bool | None, has_value: bool | None, read_only: bool | None) -> bool:
    """Regla de «campo donde se puede escribir». Un documento (p. ej. una página web) solo cuenta si se puede editar."""
    if enabled is False or control_type is None:
        return False
    if control_type == CONTROL_EDIT:
        return read_only is not True
    if control_type in (CONTROL_DOCUMENT, CONTROL_COMBO_BOX):
        return has_value is True and read_only is False
    return False


class TextFocusProbe(Protocol):
    def editable_focus(self) -> bool | None: ...  # None = no se pudo saber


class TextFocusWatcher:
    """Convierte muestras del foco en órdenes "open"/"close" para el teclado."""

    def __init__(self, stable_ms: float = FOCUS_STABLE_MS) -> None:
        self.stable_ms = stable_ms
        self.reset()

    def reset(self) -> None:
        """Olvida el estado: la próxima muestra estable vuelve a decidir (al pasar a CONTROL, por ejemplo)."""
        self._state: bool | None = None
        self._candidate: bool | None = None
        self._since: float = 0.0

    def update(self, editable: bool | None, now_ms: float) -> str | None:
        if editable is None:
            return None
        if editable != self._candidate:
            self._candidate = editable
            self._since = now_ms
            return None
        if editable == self._state or now_ms - self._since < self.stable_ms:
            return None
        previous, self._state = self._state, editable
        if editable:
            return "open"
        return "close" if previous is True else None


def keyboard_events(watcher: TextFocusWatcher, editable: bool | None, now_ms: float, active: bool) -> list:
    """Órdenes del foco para el teclado como eventos lógicos (van a la interfaz, nunca al sistema). `active` = el motor
    controla (CONTROL, sin pausa) y el teclado Air-Swipe está habilitado. Mientras no lo esté, el estado se olvida:
    al activarse, si ya hay un campo de texto con foco, el teclado se abre."""
    from .interpreter import EVENT_KEYBOARD, EVENT_KEYBOARD_CLOSE, LogicalEvent

    if not active:
        watcher.reset()
        return []
    order = watcher.update(editable, now_ms)
    if order == "open":
        return [LogicalEvent(EVENT_KEYBOARD, {"origen": "foco"})]
    if order == "close":
        return [LogicalEvent(EVENT_KEYBOARD_CLOSE, {"origen": "foco"})]
    return []


class _Variant(ctypes.Structure):
    _fields_ = [("vt", ctypes.c_ushort), ("r1", ctypes.c_ushort), ("r2", ctypes.c_ushort), ("r3", ctypes.c_ushort),
                ("val", ctypes.c_longlong), ("extra", ctypes.c_longlong)]


class _GUID(ctypes.Structure):
    _fields_ = [("d1", ctypes.c_ulong), ("d2", ctypes.c_ushort), ("d3", ctypes.c_ushort), ("d4", ctypes.c_ubyte * 8)]

    @classmethod
    def parse(cls, text: str) -> "_GUID":
        h = text.strip("{}").replace("-", "")
        return cls(int(h[0:8], 16), int(h[8:12], 16), int(h[12:16], 16), (ctypes.c_ubyte * 8)(*bytes.fromhex(h[16:])))


class _GuiThreadInfo(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("flags", wintypes.DWORD), ("hwndActive", wintypes.HWND),
                ("hwndFocus", wintypes.HWND), ("hwndCapture", wintypes.HWND), ("hwndMenuOwner", wintypes.HWND),
                ("hwndMoveSize", wintypes.HWND), ("hwndCaret", wintypes.HWND), ("rcCaret", wintypes.RECT)]


CLSID_CUIAUTOMATION = "{FF48DBA4-60EF-4201-AA87-54103EEF594E}"
IID_IUIAUTOMATION = "{30CBE57D-D9D0-452A-AB13-7AC5AC4825EE}"
VT_I4, VT_BOOL = 3, 11


def _vcall(ptr: ctypes.c_void_p, index: int, *args: tuple) -> int:
    """Llama al método `index` de la tabla virtual de un objeto COM. `args` = pares (tipo, valor)."""
    vtbl = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
    proto = ctypes.WINFUNCTYPE(ctypes.HRESULT, ctypes.c_void_p, *[t for t, _ in args])
    return proto(vtbl[index])(ptr, *[v for _, v in args])


def _release(ptr: ctypes.c_void_p) -> None:
    if ptr:
        vtbl = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
        ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtbl[2])(ptr)


class Win32TextFocusProbe:
    """Sonda real de Windows. Crearla en el hilo que la va a usar (inicializa COM en ese hilo)."""

    # IUIAutomation::GetFocusedElement y IUIAutomationElement::GetCurrentPropertyValue (orden de la tabla virtual).
    _GET_FOCUSED = 8
    _GET_PROPERTY = 10

    def __init__(self) -> None:
        if sys.platform != "win32":
            raise OSError("UI Automation solo existe en Windows")
        self._ole32 = ctypes.WinDLL("ole32")
        self._oleaut = ctypes.WinDLL("oleaut32")
        self._user32 = ctypes.WinDLL("user32")
        self._ole32.CoInitializeEx(None, 0)  # COINIT_MULTITHREADED
        self._uia = ctypes.c_void_p()
        clsid, iid = _GUID.parse(CLSID_CUIAUTOMATION), _GUID.parse(IID_IUIAUTOMATION)
        hr = self._ole32.CoCreateInstance(ctypes.byref(clsid), None, 1, ctypes.byref(iid), ctypes.byref(self._uia))
        if hr != 0 or not self._uia:
            self._uia = ctypes.c_void_p()
        self._user32.GetForegroundWindow.restype = wintypes.HWND
        self._user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        self._user32.GetGUIThreadInfo.argtypes = [wintypes.DWORD, ctypes.POINTER(_GuiThreadInfo)]

    def _property(self, element: ctypes.c_void_p, prop: int) -> int | bool | None:
        var = _Variant()
        try:
            if _vcall(element, self._GET_PROPERTY, (ctypes.c_int, prop), (ctypes.POINTER(_Variant), ctypes.byref(var))) != 0:
                return None
            if var.vt == VT_I4:
                return ctypes.c_int32(var.val & 0xFFFFFFFF).value
            if var.vt == VT_BOOL:
                return (var.val & 0xFFFF) != 0
            return None  # propiedad no admitida (UIA devuelve un objeto «no admitido»)
        finally:
            self._oleaut.VariantClear(ctypes.byref(var))

    def _uia_editable(self) -> bool | None:
        if not self._uia:
            return None
        element = ctypes.c_void_p()
        try:
            if _vcall(self._uia, self._GET_FOCUSED, (ctypes.POINTER(ctypes.c_void_p), ctypes.byref(element))) != 0 or not element:
                return None
            ctype = self._property(element, UIA_CONTROL_TYPE)
            return is_editable(
                ctype if isinstance(ctype, int) and not isinstance(ctype, bool) else None,
                self._property(element, UIA_IS_ENABLED),
                self._property(element, UIA_IS_VALUE_PATTERN_AVAILABLE),
                self._property(element, UIA_VALUE_IS_READ_ONLY),
            )
        except OSError:
            return None
        finally:
            _release(element)

    def _caret_present(self) -> bool | None:
        hwnd = self._user32.GetForegroundWindow()
        if not hwnd:
            return None
        thread = self._user32.GetWindowThreadProcessId(hwnd, None)
        info = _GuiThreadInfo(cbSize=ctypes.sizeof(_GuiThreadInfo))
        if not self._user32.GetGUIThreadInfo(thread, ctypes.byref(info)):
            return None
        return bool(info.hwndCaret)

    def editable_focus(self) -> bool | None:
        result = self._uia_editable()
        return result if result is not None else self._caret_present()


class FocusPoller:
    """Hilo de consulta. `latest()` devuelve la última respuesta (o None si aún no hay / la sonda falló)."""

    def __init__(self, make_probe: Callable[[], TextFocusProbe], interval_ms: float = FOCUS_POLL_MS) -> None:
        self._make_probe = make_probe
        self._interval = interval_ms / 1000.0
        self._value: bool | None = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="zt-foco-texto", daemon=True)

    def start(self) -> "FocusPoller":
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()

    def latest(self) -> bool | None:
        return self._value

    def _run(self) -> None:
        try:
            probe = self._make_probe()
        except Exception:
            return  # sin sonda el teclado se sigue abriendo con su botón
        while not self._stop.is_set():
            try:
                self._value = probe.editable_focus()
            except Exception:
                self._value = None
            time.sleep(self._interval)
