"""Micro-pinza con la forma medida en los videos reales del 21-11-2026 (sin imágenes ni puntos guardados).

En esos videos el motor no hacía NINGÚN clic: con la palma hacia abajo y los dedos colgando hacia la cámara, las
puntas de índice, medio y anular quedan en la imagen más cerca de la muñeca que sus nudillos, y la regla de
entonces («la mano se cierra en puño») descartaba la pinza. Las manos de estas pruebas reproducen las medidas:
pinza = índice doblado (51-132°) y separado del medio (0,52-0,87 palmas); scroll = índice y medio juntos
(0,13-0,61) y rectos (152-173°) con el pulgar cerca de la punta del índice.
"""

from __future__ import annotations

from motor_local.config import EngineConfig
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import (
    FIST_PINCH_GUARD_MS, PINCH_INDEX_MAX_ANGLE, PINCH_INDEX_SEPARATION, _dist2d, _index_pinch_shape, _palm_scale, _pip_angle,
)
from tests.test_engine import armed, make_closed_fist

FRAME_MS = 1000.0 / 15  # la webcam de los videos graba a 15 fps


def hanging_pinch(gap: float) -> HandLandmarks:
    """Palma hacia abajo, dedos colgando; `gap` = distancia pulgar-índice en la imagen."""
    lms = [Point3D(0.50, 0.20)] * 21
    lms[5], lms[9], lms[13], lms[17] = Point3D(0.46, 0.34), Point3D(0.50, 0.35), Point3D(0.535, 0.345), Point3D(0.565, 0.355)
    lms[6], lms[8] = Point3D(0.44, 0.38), Point3D(0.47, 0.31)            # índice doblado hacia el pulgar
    lms[10], lms[12] = Point3D(0.55, 0.38), Point3D(0.60, 0.27)          # medio colgando, aparte
    lms[14], lms[16] = Point3D(0.58, 0.37), Point3D(0.62, 0.24)
    lms[18], lms[20] = Point3D(0.60, 0.37), Point3D(0.66, 0.28)
    lms[2], lms[3] = Point3D(0.44, 0.28), Point3D(0.45, 0.30)
    lms[4] = Point3D(0.47 + gap, 0.31)
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def two_fingers_with_thumb(gap: float) -> HandLandmarks:
    """Scroll de los videos: índice y medio rectos y juntos hacia abajo, pulgar junto a la punta del índice."""
    lms = [Point3D(0.50, 0.20)] * 21
    lms[5], lms[9], lms[13], lms[17] = Point3D(0.46, 0.34), Point3D(0.50, 0.35), Point3D(0.535, 0.345), Point3D(0.565, 0.355)
    lms[6], lms[8] = Point3D(0.465, 0.42), Point3D(0.47, 0.50)
    lms[10], lms[12] = Point3D(0.50, 0.43), Point3D(0.50, 0.51)
    lms[14], lms[16] = Point3D(0.54, 0.39), Point3D(0.535, 0.36)         # anular y meñique plegados
    lms[18], lms[20] = Point3D(0.565, 0.39), Point3D(0.56, 0.37)
    lms[2], lms[3] = Point3D(0.44, 0.30), Point3D(0.45, 0.40)
    lms[4] = Point3D(0.47 + gap, 0.50)
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def _feed(interp, frames, start: float = 0.0) -> list[str]:
    out = []
    for i, hand in enumerate(frames):
        out += [e.type for e in interp.process_frame(hand, now_ms=start + i * FRAME_MS)]
    return out


def test_la_pinza_con_los_dedos_colgando_hace_un_clic() -> None:
    closed = hanging_pinch(0.015)
    lms, scale = closed.landmarks, _palm_scale(closed.landmarks)
    # La regla anterior la habría descartado: las tres puntas quedan más cerca de la muñeca que sus nudillos.
    assert all(_dist2d(lms[t], lms[0]) < _dist2d(lms[m], lms[0]) for t, m in ((8, 5), (12, 9), (16, 13)))
    assert _index_pinch_shape(lms, scale)
    interp = armed(EngineConfig.from_dict({"drag": False}))
    events = _feed(interp, [hanging_pinch(0.12)] * 3 + [closed] * 3 + [hanging_pinch(0.12)] * 4)
    assert events.count("LEFT_CLICK") == 1


def test_dos_dedos_juntos_con_el_pulgar_cerca_no_son_un_clic() -> None:
    near = two_fingers_with_thumb(0.02)
    lms, scale = near.landmarks, _palm_scale(near.landmarks)
    assert _dist2d(lms[8], lms[12]) / scale < PINCH_INDEX_SEPARATION
    assert _pip_angle(lms[5], lms[6], lms[8]) > PINCH_INDEX_MAX_ANGLE
    interp = armed(EngineConfig.from_dict({"drag": False}))
    # 5 fotogramas cerrados (~330 ms): más que el margen del scroll, para que una pinza SÍ alcanzara a confirmarse.
    frames = ([two_fingers_with_thumb(0.12)] * 2 + [near] * 5) * 4
    assert "LEFT_CLICK" not in _feed(interp, frames)


def test_abrir_el_puno_no_hace_clic() -> None:
    interp = armed(EngineConfig.from_dict({"drag": False}))
    events = _feed(interp, [make_closed_fist(0.5, 0.35)] * 4)          # puño breve (no llega a pausar)
    # Justo al abrirlo la mano pasa por una postura de pinza: dentro del margen de guarda no cuenta.
    assert FIST_PINCH_GUARD_MS > 2 * FRAME_MS
    events += _feed(interp, [hanging_pinch(0.015)] * 2 + [hanging_pinch(0.12)] * 4, start=4 * FRAME_MS)
    assert "LEFT_CLICK" not in events
    assert "PAUSE" not in events


def test_angulo_de_la_articulacion() -> None:
    assert round(_pip_angle(Point3D(0, 0), Point3D(0, 1), Point3D(0, 2))) == 180
    assert round(_pip_angle(Point3D(0, 0), Point3D(0, 1), Point3D(1, 1))) == 90
    assert _pip_angle(Point3D(0, 0), Point3D(0, 0), Point3D(1, 1)) == 180.0  # puntos repetidos: sin dividir por cero
