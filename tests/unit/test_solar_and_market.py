"""Solar/fan placement, sun cycle, sentiment-driven token demand."""


def test_solar_placement_recorded(game, place):
    place("1", 10, 8)
    assert game.evaluate("window.__state.grid[8][10]?.t") == "solar"


def test_sun_factor_stays_in_range(game):
    sun = game.evaluate("window.__state.sun")
    assert 0.2 <= sun <= 1.0


def test_fan_adds_cooling_supply(game, place):
    place("2", 2, 2)
    place("3", 3, 3)
    place("3", 4, 3)
    place("3", 5, 3)
    place("3", 6, 3)
    game.wait_for_timeout(700)
    assert game.evaluate("window.__state.totalCooling") > 10


def test_token_demand_follows_public_sentiment(game, place):
    place("2", 2, 2)
    place("5", 2, 3)
    game.evaluate("window.__state.sentiment = 95")
    game.wait_for_timeout(700)
    hi = game.evaluate("window.__state.tokenPrice")
    game.evaluate("window.__state.god.pinSentiment = false; window.__state.sentiment = 5")
    game.wait_for_timeout(700)
    lo = game.evaluate("window.__state.tokenPrice")
    assert hi > 1.45 and lo < 0.95, f"hi={hi:.3f} lo={lo:.3f}"


def test_revenue_dial_4x_boosts_token_price(game):
    game.click("#dev-toggle")
    base = game.evaluate("window.__state.tokenPrice")
    game.click('input[name="god-revenue"][value="4"]')
    game.wait_for_timeout(700)
    boosted = game.evaluate("window.__state.tokenPrice")
    assert boosted > base * 2.5, f"{base:.2f}->{boosted:.2f}"
