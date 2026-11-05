"""Minimizar y restaurar ventanas de forma acotada (gestos de tres dedos).

Reglas:
- Solo se minimiza la ventana en primer plano en el momento del gesto.
- Solo se restaura la última ventana que ESTE motor minimizó, y una única vez.
- Una referencia guarda HWND, PID y hora de creación del proceso. Si cualquiera ya no
  coincide (ventana cerrada, identificador reutilizado o proceso distinto) no se restaura nada.
- Nunca se minimizan todas las ventanas, ni se muestra el escritorio, ni se cierra una aplicación.
- Restaurar no garantiza el foco: SetForegroundWindow puede ser rechazado por Windows y se informa.

Win32 se usa mediante ctypes con firmas explícitas para procesos de 64 bits.
"""

from __future__ import annotations

import ctypes
import os
import sys
from dataclasses import dataclass
from typing import Protocol

SW_MINIMIZE = 6
SW_RESTORE = 9
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


@dataclass(frozen=True)
class WindowRef:
    hwnd: int
    pid: int
    started: int  # FILETIME de creación del proceso, identifica el proceso aunque el PID se reutilice


@dataclass(frozen=True)
class WindowResult:
    ok: bool
    code: str
    focused: bool = False


class WindowController(Protocol):
    def foreground(self) -> WindowRef | None: ...
    def is_valid(self, ref: WindowRef) -> bool: ...
    def is_minimized(self, ref: WindowRef) -> bool: ...
    def minimize(self, ref: WindowRef) -> bool: ...
    def restore(self, ref: WindowRef) -> tuple[bool, bool]: ...  # (restaurada, con foco)


class WindowActions:
    """Máquina mínima: una sola ventana recordada, consumida al restaurarse."""

    def __init__(self, controller: WindowController, own_pid: int | None = None) -> None:
        self.controller = controller
        self.own_pid = own_pid if own_pid is not None else os.getpid()
        self._last: WindowRef | None = None

    @property
    def last_minimized(self) -> WindowRef | None:
        return self._last

    def minimize_target(self) -> WindowResult:
        ref = self.controller.foreground()
        if ref is None:
            return WindowResult(False, "NO_FOREGROUND")
        if ref.pid == self.own_pid:
            return WindowResult(False, "OWN_WINDOW")
        if self.controller.is_minimized(ref):
            return WindowResult(False, "ALREADY_MINIMIZED")
        if not self.controller.minimize(ref) or not self.controller.is_minimized(ref):
            return WindowResult(False, "MINIMIZE_FAILED")
        self._last = ref
        return WindowResult(True, "MINIMIZED")

    def restore_last(self) -> WindowResult:
        ref = self._last
        if ref is None:
            return WindowResult(False, "NO_LAST_WINDOW")
        # Una referencia se usa una sola vez: aunque falle, no se reintenta sobre otra ventana.
        self._last = None
        if not self.controller.is_valid(ref):
            return WindowResult(False, "WINDOW_GONE")
        if not self.controller.is_minimized(ref):
            return WindowResult(False, "NOT_MINIMIZED")
        shown, focused = self.controller.restore(ref)
        return WindowResult(shown, "RESTORED" if shown else "RESTORE_FAILED", focused)


class MockWindowController:
    """Ventanas simuladas para pruebas. No toca el sistema operativo."""

    def __init__(self) -> None:
        self.foreground_ref: WindowRef | None = None
        self.alive: set[WindowRef] = set()
        self.minimized: set[WindowRef] = set()
        self.log: list[tuple[str, int]] = []

    def add(self, ref: WindowRef, foreground: bool = False) -> None:
        self.alive.add(ref)
        if foreground:
            self.foreground_ref = ref

    def close(self, ref: WindowRef) -> None:
        self.alive.discard(ref)
        self.minimized.discard(ref)

    def foreground(self) -> WindowRef | None:
        return self.foreground_ref if self.foreground_ref in self.alive else None

    def is_valid(self, ref: WindowRef) -> bool:
        return ref in self.alive

    def is_minimized(self, ref: WindowRef) -> bool:
        return ref in self.minimized

    def minimize(self, ref: WindowRef) -> bool:
        self.log.append(("MINIMIZE", ref.hwnd))
        self.minimized.add(ref)
        return True

    def restore(self, ref: WindowRef) -> tuple[bool, bool]:
        self.log.append(("RESTORE", ref.hwnd))
        self.minimized.discard(ref)
        return True, True


class Win32WindowController:
    """Implementación real con user32/kernel32. Solo funciona en Windows."""

    def __init__(self) -> None:
        if sys.platform != "win32":
            raise RuntimeError("Win32WindowController requiere Windows.")
        from ctypes import wintypes

        self._wt = wintypes
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self._user32 = user32
        self._kernel32 = kernel32

        user32.GetForegroundWindow.argtypes = []
        user32.GetForegroundWindow.restype = wintypes.HWND
        user32.IsWindow.argtypes = [wintypes.HWND]
        user32.IsWindow.restype = wintypes.BOOL
        user32.IsIconic.argtypes = [wintypes.HWND]
        user32.IsIconic.restype = wintypes.BOOL
        user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.ShowWindow.restype = wintypes.BOOL
        user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        user32.SetForegroundWindow.restype = wintypes.BOOL
        user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        user32.GetWindowThreadProcessId.restype = wintypes.DWORD

        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.GetProcessTimes.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(wintypes.FILETIME),
            ctypes.POINTER(wintypes.FILETIME),
            ctypes.POINTER(wintypes.FILETIME),
            ctypes.POINTER(wintypes.FILETIME),
        ]
        kernel32.GetProcessTimes.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL

    def _process_started(self, pid: int) -> int | None:
        handle = self._kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return None
        try:
            created, exited, kernel, user = (self._wt.FILETIME() for _ in range(4))
            if not self._kernel32.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited),
                                                  ctypes.byref(kernel), ctypes.byref(user)):
                return None
            return (created.dwHighDateTime << 32) | created.dwLowDateTime
        finally:
            self._kernel32.CloseHandle(handle)

    def _pid_of(self, hwnd: int) -> int:
        pid = self._wt.DWORD()
        self._user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return int(pid.value)

    def foreground(self) -> WindowRef | None:
        hwnd = self._user32.GetForegroundWindow()
        if not hwnd:
            return None
        pid = self._pid_of(hwnd)
        started = self._process_started(pid) if pid else None
        if not pid or started is None:
            return None
        return WindowRef(hwnd=int(hwnd), pid=pid, started=started)

    def is_valid(self, ref: WindowRef) -> bool:
        if not self._user32.IsWindow(ref.hwnd):
            return False
        if self._pid_of(ref.hwnd) != ref.pid:
            return False
        return self._process_started(ref.pid) == ref.started

    def is_minimized(self, ref: WindowRef) -> bool:
        return bool(self._user32.IsIconic(ref.hwnd))

    def minimize(self, ref: WindowRef) -> bool:
        self._user32.ShowWindow(ref.hwnd, SW_MINIMIZE)
        return True

    def restore(self, ref: WindowRef) -> tuple[bool, bool]:
        self._user32.ShowWindow(ref.hwnd, SW_RESTORE)
        shown = not self._user32.IsIconic(ref.hwnd)
        focused = bool(self._user32.SetForegroundWindow(ref.hwnd)) if shown else False
        return bool(shown), focused
