"""Balance milestones — the starter base from a fresh normal-mode game
should be profitable but not silly rich."""


def test_starter_base_lands_in_profit_band(game, place, click_cell):
    game.evaluate("localStorage.clear()")
    game.reload()
    game.wait_for_timeout(700)
    game.keyboard.press("2"); click_cell(4, 4)        # power plant
    game.keyboard.press("4"); click_cell(5, 4)        # coolant loop
    game.keyboard.press("c"); click_cell(4, 5)        # CPU to feed the GPUs (v0.7)
    game.keyboard.press("5"); click_cell(5, 3); click_cell(6, 4)  # 2x GPU v1 (fits $500 with a CPU)
    game.wait_for_timeout(4000)
    rev = game.evaluate("window.__state.revenue")
    assert 4 < rev < 30, f"revenue out of band: {rev:+.2f}/s"
