"""Placement, tutorial progression, and the gpu2 unlock gate."""


def test_placing_a_power_plant_writes_to_grid(game, place):
    place("2", 2, 2)
    assert game.evaluate("window.__state.grid[2][2]?.t") == "power"


def test_music_auto_starts_on_first_interaction(game, place):
    place("2", 2, 2)
    game.wait_for_timeout(500)
    assert game.evaluate("window.GameMusic.isAudioStarted()") is True


def test_tutorial_advances_as_starter_setup_is_built(game, place):
    place("2", 2, 2)        # power
    place("4", 3, 3)        # cooler
    place("5", 2, 3)        # gpu1
    place("5", 2, 4)        # gpu1 cluster
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.tutStep") >= 4


def test_gpu2_starts_locked(game):
    assert game.evaluate("!window.__state.unlocks.gpu2") is True


def test_gpu2_unlock_refused_without_cash(game):
    game.click('.tool[data-tool="gpu2"]')
    assert game.evaluate("!window.__state.unlocks.gpu2") is True


def test_gpu2_unlock_purchased_when_funded(game):
    game.evaluate("window.__state.cash = 2000")
    game.click('.tool[data-tool="gpu2"]')
    assert game.evaluate("window.__state.unlocks.gpu2") is True


def test_maintain_is_an_allocation_slider_now(game):
    # the old Finance radios are gone; Maintain lives in the allocation group
    assert game.evaluate("document.querySelector('.fin-maint')") is None
    assert game.evaluate("!!document.querySelector('input[data-alloc=\"maintain\"]')") is True
