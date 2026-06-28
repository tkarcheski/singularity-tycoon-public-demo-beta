"""Issue #30 — localStorage save/restore + New Game button.

Each test starts by wiping any prior save and reloading, so they're hermetic
against state left over from another run. Note: the autosave's `beforeunload`
handler fires when reload() navigates away, which writes whatever state is
currently in memory. Tests account for that.
"""
import pytest


@pytest.fixture
def fresh(game):
    """Clear any existing save and reload — guarantees default starter state."""
    game.evaluate("localStorage.clear()")
    game.reload()
    game.wait_for_timeout(800)
    return game


def test_new_game_button_present(fresh):
    assert fresh.evaluate("!!document.getElementById('btn-new-game')") is True


def test_clean_boot_holds_starter_defaults(fresh):
    # After clear+reload, in-memory state is the starter — even if the unload
    # path wrote a default save snapshot back to localStorage.
    assert fresh.evaluate("window.__state.cash") == 500
    assert fresh.evaluate("window.__state.grid.flat().every(c => c === null)") is True
    assert fresh.evaluate("window.__state.tutStep") == 0


def test_save_writes_versioned_payload(fresh, place):
    place("2", 5, 5)
    fresh.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    raw = fresh.evaluate("localStorage.getItem('stm-save-v1')")
    assert raw is not None
    assert '"_v":1' in raw
    assert '"t":"power"' in raw


def test_grid_cash_and_tutstep_restore_after_reload(fresh, place):
    place("2", 5, 5)
    fresh.evaluate("window.__state.cash = 50000; window.__state.tutStep = 3")
    fresh.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    fresh.reload()
    fresh.wait_for_timeout(800)
    assert fresh.evaluate("window.__state.grid[5][5]?.t") == "power"
    # A tick or two after restore can shave a fraction off via upkeep — accept
    # near-equality (drift bounded by a few seconds of upkeep at most).
    assert abs(fresh.evaluate("window.__state.cash") - 50000) < 5
    assert fresh.evaluate("window.__state.tutStep") == 3


def test_ticker_announces_restored_save(fresh, place):
    place("2", 5, 5)
    fresh.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    fresh.reload()
    fresh.wait_for_timeout(800)
    assert "Save restored" in fresh.evaluate("document.getElementById('ticker').textContent")


def test_unknown_save_version_is_ignored(fresh):
    fresh.evaluate("localStorage.setItem('stm-save-v1', JSON.stringify({_v: 99, cash: 9999}))")
    fresh.reload()
    fresh.wait_for_timeout(800)
    assert fresh.evaluate("window.__state.cash") == 500


def test_new_game_button_clears_save_and_resets(fresh, place):
    place("2", 5, 5)
    fresh.evaluate("window.__state.cash = 9999")
    fresh.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    fresh.evaluate("window.confirm = () => true")
    fresh.click("#btn-new-game")
    fresh.wait_for_timeout(800)
    # New Game must detach the autosave-on-unload so the reload doesn't write
    # the just-cleared state right back. Verify the fresh page restored defaults.
    assert fresh.evaluate("window.__state.grid[5][5]") is None
    assert fresh.evaluate("window.__state.cash") == 500
