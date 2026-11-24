"""Cursor sobre el escritorio virtual (varias pantallas). Todo sintético, salvo la lectura de Windows."""

from __future__ import annotations

import sys

import pytest

from motor_local.os_adapter import MockOSAdapter, get_virtual_screen, map_normalized_to_screen


def test_single_primary_screen_corners_are_unchanged() -> None:
    assert map_normalized_to_screen(0.0, 0.0, 0, 0, 1920, 1080) == (0, 0)
    assert map_normalized_to_screen(1.0, 1.0, 0, 0, 1920, 1080) == (1919, 1079)


def test_monitor_placed_left_of_primary_uses_negative_coordinates() -> None:
    # Dos pantallas 1920x1080: la externa a la izquierda (x = -1920) y la principal a la derecha.
    left, top, width, height = -1920, 0, 3840, 1080
    assert map_normalized_to_screen(0.0, 0.5, left, top, width, height)[0] == -1920
    assert map_normalized_to_screen(1.0, 0.5, left, top, width, height)[0] == 1919
    middle_x = map_normalized_to_screen(0.5, 0.5, left, top, width, height)[0]
    assert -1 <= middle_x <= 1  # frontera entre las dos pantallas


def test_cursor_can_reach_the_secondary_screen_above_the_primary() -> None:
    # Pantalla secundaria arriba: coordenadas Y negativas.
    left, top, width, height = 0, -1080, 1920, 2160
    x, y = map_normalized_to_screen(0.5, 0.0, left, top, width, height)
    assert y == -1080
    assert 0 <= x < 1920


def test_margin_keeps_the_cursor_inside_the_rectangle() -> None:
    assert map_normalized_to_screen(-5.0, -5.0, -1920, 0, 3840, 1080, margin=2) == (-1918, 2)
    assert map_normalized_to_screen(5.0, 5.0, -1920, 0, 3840, 1080, margin=2) == (1917, 1077)


def test_degenerate_rectangle_does_not_divide_by_zero() -> None:
    assert map_normalized_to_screen(0.4, 0.4, 10, 20, 1, 1) == (10, 20)


def test_mock_adapter_maps_to_a_screen_left_of_primary() -> None:
    adapter = MockOSAdapter(screen_width=3840, screen_height=1080, screen_left=-1920)
    adapter.move_cursor(0.0, 0.0)
    assert (adapter.cursor_x, adapter.cursor_y) == (-1920, 0)
    adapter.move_cursor(1.0, 1.0)
    assert (adapter.cursor_x, adapter.cursor_y) == (1919, 1079)


def test_virtual_screen_reports_a_real_rectangle_on_windows() -> None:
    if sys.platform != "win32":
        pytest.skip("Lectura de escritorio virtual solo en Windows")
    left, top, width, height = get_virtual_screen()
    assert all(isinstance(v, int) for v in (left, top, width, height))
    assert width > 0 and height > 0
