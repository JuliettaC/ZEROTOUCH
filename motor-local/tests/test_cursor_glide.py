"""Interpolación del cursor entre fotogramas (CursorGlide). Lógica pura, sin ratón real."""

from __future__ import annotations

from motor_local.os_adapter import CursorGlide


def _run(glide: CursorGlide, start_ms: float, end_ms: float, step_ms: float = 8.0):
    out = []
    t = start_ms
    while t <= end_ms:
        pos = glide.step(t)
        if pos is not None:
            out.append(pos)
        t += step_ms
    return out


def test_first_target_is_applied_immediately() -> None:
    glide = CursorGlide()
    glide.set_target(500, 400, 0.0)
    assert glide.step(0.0) == (500, 400)
    assert glide.step(8.0) is None, "sin objetivo nuevo no se vuelve a mover el ratón"


def test_moves_in_many_small_steps_and_reaches_the_target() -> None:
    glide = CursorGlide(tau_ms=45.0)
    glide.set_target(100, 100, 0.0)
    glide.step(0.0)
    glide.set_target(300, 100, 10.0)
    path = _run(glide, 10.0, 400.0)
    assert len(path) >= 8, "un salto de 200 px se reparte en varios pasos"
    assert max(abs(path[i][0] - path[i - 1][0]) for i in range(1, len(path))) < 120
    assert path[-1] == (300, 100)
    xs = [p[0] for p in path]
    assert xs == sorted(xs), "avanza siempre hacia el objetivo, sin rebotes"


def test_snap_puts_the_cursor_on_the_target_for_a_click() -> None:
    glide = CursorGlide()
    glide.set_target(0, 0, 0.0)
    glide.step(0.0)
    glide.set_target(80, 60, 1.0)
    glide.step(9.0)
    assert glide.snap() == (80, 60)
    assert glide.step(17.0) is None


def test_cancel_stops_where_it_is() -> None:
    glide = CursorGlide(tau_ms=45.0)
    glide.set_target(0, 0, 0.0)
    glide.step(0.0)
    glide.set_target(400, 0, 1.0)
    moved = glide.step(20.0)
    assert moved is not None and 0 < moved[0] < 400
    glide.cancel()
    assert _run(glide, 28.0, 300.0) == [], "tras parar no sigue moviendo el ratón"


def test_large_jump_is_not_animated() -> None:
    glide = CursorGlide(jump_px=900.0)
    glide.set_target(0, 0, 0.0)
    glide.step(0.0)
    glide.set_target(1800, 0, 5.0)
    assert glide.step(6.0) == (1800, 0)
