"""Heat, wear, manual repair, bot bay auto-repair, and auto-maintenance."""


def _starter_cluster(place):
    place("2", 2, 2)
    place("4", 3, 3)
    place("5", 2, 3)
    place("5", 2, 4)


def _enable_god(game):
    game.click("#dev-toggle")
    game.click('input[data-god="freeBuild"]')
    game.click('input[data-god="fast"]')


def test_heat_map_is_populated(game, place):
    _starter_cluster(place)
    _enable_god(game)
    game.wait_for_timeout(700)
    h = game.evaluate("window.__state.heatMap[3][2]")
    assert h is not None and h >= 0


def test_condition_decays_under_wear(game, place):
    _starter_cluster(place)
    _enable_god(game)
    game.wait_for_timeout(700)
    c0 = game.evaluate("window.__state.grid[3][2].cond")
    game.wait_for_timeout(2200)
    c1 = game.evaluate("window.__state.grid[3][2].cond")
    assert c1 < c0, f"{c0:.1f}->{c1:.1f}"


def test_no_wear_dev_toggle_freezes_condition(game, place):
    _starter_cluster(place)
    _enable_god(game)
    game.click('input[data-god="noWear"]')
    game.wait_for_timeout(400)
    c0 = game.evaluate("window.__state.grid[3][2].cond")
    game.wait_for_timeout(1500)
    c1 = game.evaluate("window.__state.grid[3][2].cond")
    assert abs(c1 - c0) < 0.01, f"{c0:.2f}->{c1:.2f}"


def test_manual_repair_restores_to_full(game, place, click_cell):
    _starter_cluster(place)
    _enable_god(game)
    game.evaluate("window.__state.grid[3][2].cond = 20")
    game.keyboard.press("-")
    click_cell(2, 3)
    assert game.evaluate("window.__state.grid[3][2].cond") == 100


def test_bot_bay_heals_nearby_damage_over_time(game, place, click_cell):
    _starter_cluster(place)
    _enable_god(game)
    place("2", 5, 4)   # extra plant for bay
    game.evaluate("window.__state.unlocks.ops = true")
    place("0", 5, 5)   # bot bay
    game.evaluate("window.__state.grid[4][2].cond = 30")
    game.wait_for_timeout(4600)
    healed = game.evaluate("window.__state.grid[4][2].cond")
    assert healed > 30, f"30->{healed:.0f}"


def test_auto_maintenance_heals_from_revenue(game, place):
    _starter_cluster(place)
    _enable_god(game)
    game.evaluate("window.__state.unlocks.ops = true")
    # Re-render finance so the radio appears
    game.evaluate("window.__state.cash = 10000")
    game.wait_for_timeout(600)
    game.click('input[name="maintain"][value="0.25"]')
    game.evaluate("window.__state.grid[2][2].cond = 50")
    game.wait_for_timeout(2500)
    assert game.evaluate("window.__state.grid[2][2].cond") > 50


def test_entropy_dial_zero_zeroes_meter(game, place):
    _starter_cluster(place)
    _enable_god(game)
    game.click('input[name="god-entropy"][value="0"]')
    game.wait_for_timeout(700)
    assert game.evaluate("window.__state.entropy") == 0


def test_entropy_dial_high_drives_meter_up(game, place):
    _starter_cluster(place)
    _enable_god(game)
    game.click('input[name="god-entropy"][value="25"]')
    game.wait_for_timeout(700)
    assert game.evaluate("window.__state.entropy") > 80
