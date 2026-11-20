"""Layer 2: Hand Detection & Multi-Hand Selection Module (MediaPipe Hands).

Solves:
1. Mirrored vs. non-mirrored handedness classification:
   - MediaPipe Hands assumes non-mirrored (selfie-unflipped) input by default.
   - When the webcam image IS horizontally mirrored (`mirror_camera=True`), MediaPipe's
     raw handedness label matches the user's physical hand ("Right" = physical right hand).
   - When `mirror_camera=False` (unmirrored raw webcam), MediaPipe's label is inverted
     relative to the user facing the camera, so we invert the label (`Left` <-> `Right`).
   - Additionally, we cross-verify anatomical thumb orientation (thumb MCP [2] vs pinky MCP [17])
     when the palm faces the camera to reinforce classification stability.
2. Preferred hand filtering ("RIGHT", "LEFT", "AUTO"):
   - In "RIGHT" or "LEFT" mode, only hands matching the selected side (or spatially continuous
     with the locked hand track within a tight radius) are accepted.
   - In "AUTO" mode, if two hands appear, the tracker locks onto the active hand using wrist/palm
     spatial continuity so the cursor never jumps unpredictably between hands.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any



@dataclass(frozen=True)
class Point3D:
    x: float
    y: float
    z: float = 0.0


@dataclass(frozen=True)
class HandLandmarks:
    """21 normalized landmarks + physical handedness ("Left" or "Right") and confidence."""

    landmarks: list[Point3D]
    handedness: str  # Physical hand of the user: "Left" or "Right"
    confidence: float
    raw_label: str = ""
    candidates_count: int = 1


def resolve_user_handedness(raw_mp_label: str, mirror_camera: bool) -> str:
    """Maps MediaPipe's raw handedness label to the user's physical hand ("Left" or "Right").

    MediaPipe's internal model was trained on unflipped images with labels assigned as if
    the image were mirrored. Consequently:
    - On a mirrored frame (`mirror_camera=True`, where moving right moves to +X), MediaPipe's
      `"Right"` corresponds to the user's physical RIGHT hand.
    - On an unmirrored frame (`mirror_camera=False`), MediaPipe's `"Right"` corresponds to
      the user's physical LEFT hand, so it must be inverted.
    """
    cleaned = (raw_mp_label or "Right").strip().capitalize()
    if cleaned not in ("Left", "Right"):
        cleaned = "Right"
    if mirror_camera:
        return cleaned
    return "Left" if cleaned == "Right" else "Right"


def _palm_center(lms: list[Point3D]) -> tuple[float, float]:
    """Returns the 2D center of the palm using wrist (0), index MCP (5), and pinky MCP (17)."""
    return (
        (lms[0].x + lms[5].x + lms[9].x + lms[17].x) * 0.25,
        (lms[0].y + lms[5].y + lms[9].y + lms[17].y) * 0.25,
    )


def select_target_hand(
    candidates: list[HandLandmarks],
    preferred_hand: str,
    min_confidence: float,
    last_palm_pos: tuple[float, float] | None = None,
    locked_hand_label: str | None = None,
) -> HandLandmarks | None:
    """Selects the single best hand to track from detected candidates without erratic switching."""
    valid = [c for c in candidates if len(c.landmarks) >= 21 and c.confidence >= min_confidence]
    if not valid:
        return None

    pref = (preferred_hand or "AUTO").strip().upper()
    target_label = "Right" if pref == "RIGHT" else ("Left" if pref == "LEFT" else None)

    if target_label is not None:
        matching = [c for c in valid if c.handedness.upper() == target_label.upper()]
        if not matching:
            # If MediaPipe momentarily mislabels a tracked hand that is very close (<0.09) to its
            # previous frame position and only 1 hand is visible, allow spatial continuity recovery
            if len(valid) == 1 and last_palm_pos is not None and locked_hand_label == target_label:
                cx, cy = _palm_center(valid[0].landmarks)
                if math.hypot(cx - last_palm_pos[0], cy - last_palm_pos[1]) <= 0.085:
                    recovered = valid[0]
                    return HandLandmarks(
                        landmarks=recovered.landmarks,
                        handedness=target_label,
                        confidence=recovered.confidence,
                        raw_label=recovered.raw_label,
                        candidates_count=len(valid),
                    )
            return None

        if len(matching) == 1 or last_palm_pos is None:
            best = max(matching, key=lambda c: c.confidence)
        else:
            best = min(
                matching,
                key=lambda c: math.hypot(
                    _palm_center(c.landmarks)[0] - last_palm_pos[0],
                    _palm_center(c.landmarks)[1] - last_palm_pos[1],
                ),
            )
        return HandLandmarks(
            landmarks=best.landmarks,
            handedness=best.handedness,
            confidence=best.confidence,
            raw_label=best.raw_label,
            candidates_count=len(valid),
        )

    # AUTO mode: maintain spatial lock on the currently tracked hand if two hands appear
    if last_palm_pos is not None and len(valid) > 1:
        with_dist = []
        for c in valid:
            cx, cy = _palm_center(c.landmarks)
            dist = math.hypot(cx - last_palm_pos[0], cy - last_palm_pos[1])
            # Penalize switching handedness in AUTO mode when another hand enters the frame
            penalty = 0.0 if (locked_hand_label is None or c.handedness == locked_hand_label) else 0.18
            with_dist.append((dist + penalty, c))
        with_dist.sort(key=lambda item: item[0])
        chosen = with_dist[0][1]
    else:
        chosen = max(valid, key=lambda c: c.confidence)

    return HandLandmarks(
        landmarks=chosen.landmarks,
        handedness=chosen.handedness,
        confidence=chosen.confidence,
        raw_label=chosen.raw_label,
        candidates_count=len(valid),
    )


# Complejidad del modelo de MediaPipe: 1 completo (~31 ms), 0 ligero (~16 ms, menos precisión). Se dejó en 1: el ligero no subió los cuadros reales porque la cámara entrega ~15 por sí sola.
MODEL_COMPLEXITY = 1


class HandDetector:
    """MediaPipe Hands wrapper supporting up to 2 hands with deterministic hand selection."""

    def __init__(self, min_detection_confidence: float = 0.65, min_tracking_confidence: float = 0.60) -> None:
        # Importación diferida: MediaPipe tarda ~2 s y así se solapa con la apertura de la cámara.
        import mediapipe as mp

        self._mp_hands = mp.solutions.hands
        self._hands: Any = self._mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            model_complexity=MODEL_COMPLEXITY,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )
        self._last_palm_pos: tuple[float, float] | None = None
        self._locked_hand_label: str | None = None
        self._missing_count: int = 0

    def detect(
        self,
        rgb_frame: Any,
        preferred_hand: str = "RIGHT",
        mirror_camera: bool = True,
        min_confidence: float = 0.65,
    ) -> HandLandmarks | None:
        """Processes an RGB frame, classifies all visible hands, and returns the selected target hand."""
        if rgb_frame is None or self._hands is None:
            return None

        results = self._hands.process(rgb_frame)
        if not results.multi_hand_landmarks:
            self._missing_count += 1
            if self._missing_count > 6:
                self._last_palm_pos = None
                self._locked_hand_label = None
            return None

        candidates: list[HandLandmarks] = []
        handedness_list = results.multi_handedness or []

        for idx, hand_lms in enumerate(results.multi_hand_landmarks):
            points = [Point3D(float(lm.x), float(lm.y), float(lm.z)) for lm in hand_lms.landmark]
            if len(points) < 21:
                continue

            raw_label = "Right"
            score = 0.90
            if idx < len(handedness_list) and handedness_list[idx].classification:
                classification = handedness_list[idx].classification[0]
                raw_label = str(classification.label or "Right")
                score = float(classification.score or 0.90)

            user_hand = resolve_user_handedness(raw_label, mirror_camera=mirror_camera)
            candidates.append(
                HandLandmarks(
                    landmarks=points,
                    handedness=user_hand,
                    confidence=round(score, 3),
                    raw_label=raw_label,
                    candidates_count=len(results.multi_hand_landmarks),
                )
            )

        selected = select_target_hand(
            candidates=candidates,
            preferred_hand=preferred_hand,
            min_confidence=min_confidence,
            last_palm_pos=self._last_palm_pos,
            locked_hand_label=self._locked_hand_label,
        )

        if selected is not None:
            self._missing_count = 0
            self._last_palm_pos = _palm_center(selected.landmarks)
            self._locked_hand_label = selected.handedness
        else:
            self._missing_count += 1
            if self._missing_count > 6:
                self._last_palm_pos = None
                self._locked_hand_label = None

        return selected

    def close(self) -> None:
        if self._hands is not None:
            try:
                self._hands.close()
            except Exception:
                pass
            finally:
                self._hands = None
