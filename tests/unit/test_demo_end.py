"""Demo end screen: the $1M Dyson moment becomes a real screen with a CTA."""


def test_goal_triggers_demo_end_screen(game):
    game.evaluate("window.__state.cash = 1000001")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.goalUnlocked") is True
    assert game.evaluate("document.getElementById('demo-end').hidden") is False
    stats = game.evaluate("document.getElementById('demo-end-stats').textContent")
    assert "Final compute" in stats and "Floors built" in stats
    # wishlist slot present (disabled placeholder until the store page exists)
    label = game.evaluate("document.getElementById('btn-wishlist').textContent")
    assert "Steam" in label


def test_keep_playing_dismisses_and_game_continues(game):
    game.evaluate("window.__state.cash = 1000001")
    game.wait_for_timeout(1200)
    game.click("#btn-keep-playing")
    assert game.evaluate("document.getElementById('demo-end').hidden") is True
    tick_before = game.evaluate("window.__state.tick")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.tick") > tick_before


def test_demo_end_shows_once_not_on_reload(game):
    game.evaluate("window.__state.cash = 1000001")
    game.wait_for_timeout(1200)
    game.click("#btn-keep-playing")
    game.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    game.reload()
    game.wait_for_timeout(900)
    # goalUnlocked persists, so the unlock branch (and screen) don't re-fire
    assert game.evaluate("window.__state.goalUnlocked") is True
    assert game.evaluate("document.getElementById('demo-end').hidden") is True


def test_demo_end_no_console_errors(game, errors):
    game.evaluate("window.__state.cash = 1000001")
    game.wait_for_timeout(1500)
    assert errors == [], f"errors: {errors[:3]}"
