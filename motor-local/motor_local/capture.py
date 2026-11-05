"""Layer 1: Camera Capture Module.

Manages OpenCV VideoCapture initialization, mirror-flipping for natural interaction,
low-latency buffer flushing, FPS measurement, and guaranteed resource release.
Never uploads or persists raw video frames.
"""

from __future__ import annotations

import time
from typing import Any

import cv2


class CameraCapture:
    """Safe webcam capture wrapper with guaranteed cleanup and buffer minimizing."""

    def __init__(self, camera_index: int = 0, width: int = 640, height: int = 480, mirror: bool = True) -> None:
        self.camera_index = camera_index
        self.width = width
        self.height = height
        self.mirror = mirror
        self._cap: Any = None
        self._last_frame_time: float = 0.0
        self._fps_ema: float = 0.0
        self._consecutive_failures: int = 0

    @property
    def is_open(self) -> bool:
        return self._cap is not None and bool(self._cap.isOpened())

    @property
    def fps(self) -> float:
        return round(self._fps_ema, 1)

    def open(self, camera_index: int | None = None) -> bool:
        """Initializes the webcam on Windows (tries CAP_DSHOW first for fast startup, then default)."""
        if camera_index is not None:
            self.camera_index = int(camera_index)
        self.release()
        try:
            cap = cv2.VideoCapture(self.camera_index, cv2.CAP_DSHOW)
            if not cap or not cap.isOpened():
                if cap:
                    cap.release()
                cap = cv2.VideoCapture(self.camera_index)
            if not cap or not cap.isOpened():
                if cap:
                    cap.release()
                self._cap = None
                return False

            # Minimize internal frame queue lag so cursor tracking is responsive
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except Exception:
                pass
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
            cap.set(cv2.CAP_PROP_FPS, 30)

            # Warm-up read to verify the stream actually delivers frames
            ok, frame = cap.read()
            if not ok or frame is None:
                cap.release()
                self._cap = None
                return False

            self._cap = cap
            self._consecutive_failures = 0
            self._last_frame_time = time.monotonic()
            return True
        except Exception:
            self.release()
            return False

    def read_rgb_frame(self) -> tuple[bool, Any]:
        """Reads a frame, optionally flips horizontally (mirror mode), and converts BGR to RGB."""
        if not self.is_open:
            return False, None
        ok, frame = self._cap.read()
        if not ok or frame is None:
            self._consecutive_failures += 1
            if self._consecutive_failures >= 15:
                # Camera was disconnected or locked by another application
                self.release()
            return False, None

        self._consecutive_failures = 0
        now = time.monotonic()
        dt = now - self._last_frame_time
        self._last_frame_time = now
        if 0.001 < dt < 2.0:
            instant_fps = 1.0 / dt
            self._fps_ema = instant_fps if self._fps_ema == 0.0 else (0.25 * instant_fps + 0.75 * self._fps_ema)

        processed = cv2.flip(frame, 1) if self.mirror else frame
        rgb = cv2.cvtColor(processed, cv2.COLOR_BGR2RGB)
        return True, rgb

    def release(self) -> None:
        """Releases the camera handle safely."""
        self._fps_ema = 0.0
        if self._cap is not None:
            try:
                self._cap.release()
            except Exception:
                pass
            finally:
                self._cap = None

    def __enter__(self) -> "CameraCapture":
        self.open()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.release()
