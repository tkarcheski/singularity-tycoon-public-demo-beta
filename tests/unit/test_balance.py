"""Balance milestones — the starter base from a fresh normal-mode game
should be profitable but not silly rich."""


def test_starter_base_lands_in_profit_band(game, place, click_cell):
    game.evaluate("localStorage.clear()")
    game.reload()
    game.wait_for_timeout(700)
    game.keyboard.press("2"); click_cell(4, 4)
    game.keyboard.press("4"); click_cell(5, 4)
    game.keyboard.press("5"); click_cell(5, 3); click_cell(6, 4); click_cell(5, 5)
    game.wait_for_timeout(4000)
    rev = game.evaluate("window.__state.revenue")
    assert 4 < rev < 30, f"revenue out of band: {rev:+.2f}/s"
