"""Fail state (#28): insolvency countdown, bankruptcy overlay, restart."""


def test_insolvency_banner_appears_and_recovers(game):
    game.evaluate("window.__state.cash = -50")
    game.wait_for_timeout(1200)
    assert game.evaluate("document.getElementById('insolvency').hidden") is False
    assert game.evaluate("window.__state.insolvencyS") > 0
    text = game.evaluate("document.getElementById('insolvency').textContent")
    assert "INSOLVENT" in text and "bankruptcy in" in text
    game.evaluate("window.__state.cash = 100")
    game.wait_for_timeout(1200)
    assert game.evaluate("document.getElementById('insolvency').hidden") is True
    assert game.evaluate("window.__state.insolvencyS") == 0


def test_sustained_insolvency_triggers_bankruptcy(game):
    game.evaluate("window.__state.cash = -50; window.__state.insolvencyS = 59.9")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.bankrupt") is True
    assert game.evaluate("document.getElementById('gameover').hidden") is False
    stats = game.evaluate("document.getElementById('gameover-stats').textContent")
    assert "Peak cash" in stats


def test_free_build_suspends_countdown(game):
    game.evaluate("window.__god.freeBuild = true; window.__state.cash = -50")
    game.wait_for_timeout(1500)
    assert game.evaluate("window.__state.insolvencyS") == 0
    assert game.evaluate("window.__state.bankrupt") is False


def test_start_over_resets_the_run(game):
    game.evaluate("window.__state.cash = -50; window.__state.insolvencyS = 60")
    game.wait_for_timeout(1200)
    game.click("#btn-start-over")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.cash") == 500
    assert game.evaluate("window.__state.bankrupt") is False
    assert game.evaluate("document.getElementById('gameover').hidden") is True
    assert game.evaluate("window.__state.grid.flat().every(c => c === null)") is True


def test_insolvency_clock_persists_across_reload(game):
    game.evaluate("window.__state.cash = -50")
    game.wait_for_timeout(2000)
    before = game.evaluate("window.__state.insolvencyS")
    assert before > 0
    game.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    game.reload()
    game.wait_for_timeout(900)
    assert game.evaluate("window.__state.insolvencyS") >= before


def test_bankrupt_save_reshows_overlay_on_boot(game):
    game.evaluate("window.__state.cash = -50; window.__state.insolvencyS = 60")
    game.wait_for_timeout(1200)
    game.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    game.reload()
    game.wait_for_timeout(900)
    assert game.evaluate("document.getElementById('gameover').hidden") is False


def test_fail_state_no_console_errors(game, errors):
    game.evaluate("window.__state.cash = -50")
    game.wait_for_timeout(1500)
    game.evaluate("window.__state.insolvencyS = 60")
    game.wait_for_timeout(1200)
    assert errors == [], f"errors: {errors[:3]}"
