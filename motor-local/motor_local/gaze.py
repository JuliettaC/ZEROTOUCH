"""Asistencia por orientación de la cabeza (aproximación local de "mirada").

NO es seguimiento ocular: estima yaw (giro lateral) y pitch (inclinación) de la cabeza a partir
de los seis puntos de MediaPipe Face Detection (ojos, nariz, boca, orejas). Todo se procesa en el
equipo; no se guarda ni envía ninguna imagen ni punto facial.

Semántica:
- "presente": la cabeza está orientada hacia la pantalla dentro de las tolerancias.
- "ausente": orientada fuera durante al menos `away_ms` -> la interacción se retiene (no se
  inyectan entradas, se liberan botones). Al volver durante `back_ms` se reanuda.
- "sin_rostro": no se detecta cara durante un tiempo -> se trata como ausente.
- Nunca habilita el control ni anula la parada de emergencia: solo retiene.

La calibración guarda la orientación neutra (mirando a la pantalla) y resta ese sesgo.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from .config import GazeConfig

NO_FACE_MS = 1500.0  # sin rostro durante este tiempo -> ausente
CALIBRATION_SAMPLES = 20


@dataclass(frozen=True)
class HeadPose:
    yaw: float    # grados aproximados; positivo = gira hacia la derecha de la imagen
    pitch: float  # grados aproximados; positivo = mira hacia abajo
    confidence: float


def estimate_head_pose(keypoints: list[tuple[float, float]], confidence: float = 1.0) -> HeadPose | None:
    """Puntos normalizados [ojo_der, ojo_izq, nariz, boca, oreja_der, oreja_izq] (orden MediaPipe).

    Aproximación geométrica: la nariz se desplaza respecto al centro de los ojos cuando la cabeza
    gira. Se normaliza por la distancia entre ojos para no depender de la distancia a la cámara.
    """
    if len(keypoints) < 4:
        return None
    (rx, ry), (lx, ly), (nx, ny), (mx, my) = keypoints[:4]
    eye_cx, eye_cy = (rx + lx) / 2.0, (ry + ly) / 2.0
    eye_dist = math.hypot(lx - rx, ly - ry)
    if eye_dist < 1e-4:
        return None
    # Giro lateral: desplazamiento horizontal de la nariz respecto al centro de los ojos.
    yaw_ratio = (nx - eye_cx) / eye_dist
    # Inclinación: posición de la nariz entre la línea de ojos y la boca (0,5 ≈ neutro).
    mouth_dist = max(1e-4, my - eye_cy)
    pitch_ratio = (ny - eye_cy) / mouth_dist - 0.55
    yaw = max(-60.0, min(60.0, yaw_ratio * 90.0))
    pitch = max(-60.0, min(60.0, pitch_ratio * 120.0))
    return HeadPose(round(yaw, 2), round(pitch, 2), confidence)


class GazeGate:
    """Máquina de estados con histéresis temporal. Devuelve si la interacción puede continuar."""

    def __init__(self, config: GazeConfig) -> None:
        self.config = config
        self.state = "desactivado" if not config.enabled else "sin_rostro"
        self.holding = False          # True cuando la interacción está retenida
        self._away_since: float | None = None
        self._back_since: float | None = None
        self._no_face_since: float | None = None
        self.last_pose: HeadPose | None = None
        self._calibrating: list[tuple[float, float]] | None = None
        self.calibration_result: tuple[float, float] | None = None

    def update_config(self, config: GazeConfig) -> None:
        self.config = config
        if not config.enabled:
            self.state = "desactivado"
            self.holding = False
            self._away_since = self._back_since = self._no_face_since = None

    def start_calibration(self) -> None:
        self._calibrating = []
        self.calibration_result = None

    @property
    def calibrating(self) -> bool:
        return self._calibrating is not None

    def _corrected(self, pose: HeadPose) -> tuple[float, float]:
        if self.config.calibration is None:
            return pose.yaw, pose.pitch
        return pose.yaw - self.config.calibration[0], pose.pitch - self.config.calibration[1]

    def looking_at_screen(self, pose: HeadPose) -> bool:
        yaw, pitch = self._corrected(pose)
        return abs(yaw) <= self.config.yaw_tolerance and abs(pitch) <= self.config.pitch_tolerance

    def update(self, pose: HeadPose | None, now_ms: float) -> bool:
        """Actualiza el estado. Devuelve True si la interacción puede continuar (no retenida)."""
        self.last_pose = pose
        if self._calibrating is not None and pose is not None:
            self._calibrating.append((pose.yaw, pose.pitch))
            if len(self._calibrating) >= CALIBRATION_SAMPLES:
                yaws = sorted(y for y, _ in self._calibrating)
                pitches = sorted(p for _, p in self._calibrating)
                mid = len(yaws) // 2
                self.calibration_result = (round(yaws[mid], 2), round(pitches[mid], 2))
                self._calibrating = None
        if not self.config.enabled:
            self.state = "desactivado"
            self.holding = False
            return True

        if pose is None:
            if self._no_face_since is None:
                self._no_face_since = now_ms
            self._back_since = None
            if (now_ms - self._no_face_since) >= NO_FACE_MS:
                self.state = "sin_rostro"
                self.holding = True
            return not self.holding

        self._no_face_since = None
        if self.looking_at_screen(pose):
            self._away_since = None
            if self.holding:
                if self._back_since is None:
                    self._back_since = now_ms
                if (now_ms - self._back_since) >= self.config.back_ms:
                    self.holding = False
                    self.state = "presente"
            else:
                self.state = "presente"
        else:
            self._back_since = None
            if self._away_since is None:
                self._away_since = now_ms
            if not self.holding and (now_ms - self._away_since) >= self.config.away_ms:
                self.holding = True
            if self.holding:
                self.state = "ausente"
        return not self.holding

    def telemetry(self) -> dict[str, Any]:
        pose = self.last_pose
        corrected = self._corrected(pose) if pose is not None else (0.0, 0.0)
        return {
            "state": self.state,
            "holding": self.holding,
            "calibrating": self.calibrating,
            "yaw": round(corrected[0], 1) if pose else None,
            "pitch": round(corrected[1], 1) if pose else None,
            "calibrated": self.config.calibration is not None,
        }


class FaceOrientationDetector:
    """Envoltura de MediaPipe Face Detection (modelo corto, cámara cercana). Importación diferida."""

    def __init__(self, min_confidence: float = 0.5) -> None:
        import mediapipe as mp

        self._solution = mp.solutions.face_detection
        self._detector: Any = self._solution.FaceDetection(model_selection=0, min_detection_confidence=min_confidence)

    def detect(self, rgb_frame: Any) -> HeadPose | None:
        if rgb_frame is None or self._detector is None:
            return None
        results = self._detector.process(rgb_frame)
        if not results.detections:
            return None
        best = max(results.detections, key=lambda d: float(d.score[0]) if d.score else 0.0)
        points = [(float(kp.x), float(kp.y)) for kp in best.location_data.relative_keypoints]
        return estimate_head_pose(points, float(best.score[0]) if best.score else 0.0)

    def close(self) -> None:
        if self._detector is not None:
            try:
                self._detector.close()
            except Exception:
                pass
            finally:
                self._detector = None
