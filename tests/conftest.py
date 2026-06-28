"""Shared fixtures for the Singularity Tycoon Mini pytest suite.

The game is a single-page browser app loaded over file://. Every test gets a
fresh Playwright `page`; the `game` fixture below boots it and waits for the
loop to settle. Helpers expose the canvas grid in pixel space so tests can
click cells the same way a player would.
"""
import pytest
from pathlib import Path

INDEX = Path(__file__).resolve().parent.parent / "index.html"
COLS, ROWS, TILE = 14, 10, 56


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {**browser_context_args, "viewport": {"width": 1440, "height": 900}}


@pytest.fixture
def game_url():
    return INDEX.as_uri()


@pytest.fixture
def errors(page):
    """Collect every pageerror and console.error fired during the test."""
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    return errs


@pytest.fixture
def game(page, errors, game_url):
    """A loaded game page with the boot tick run."""
    page.goto(game_url)
    page.wait_for_timeout(900)
    return page


@pytest.fixture
def grid_origin(game):
    geo = game.evaluate(
        """() => { const r = document.getElementById('game').getBoundingClientRect();
        return {l: r.left, t: r.top,
                w: document.getElementById('game').clientWidth,
                h: document.getElementById('game').clientHeight}; }"""
    )
    ox = geo["l"] + (geo["w"] - COLS * TILE) // 2
    oy = geo["t"] + (geo["h"] - ROWS * TILE) // 2
    return ox, oy


@pytest.fixture
def click_cell(game, grid_origin):
    ox, oy = grid_origin

    def _click(gx, gy):
        game.mouse.click(ox + gx * TILE + TILE / 2, oy + gy * TILE + TILE / 2)

    return _click


@pytest.fixture
def place(game, click_cell):
    """Press a tool hotkey then click a cell — shorthand for the common pattern."""
    def _place(tool_key, gx, gy):
        game.keyboard.press(tool_key)
        click_cell(gx, gy)
    return _place
