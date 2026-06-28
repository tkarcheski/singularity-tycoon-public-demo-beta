"""Allocation sliders feed RP/self-improve; research spends RP for output."""


def _starter_cluster(place):
    place("2", 2, 2)
    place("4", 3, 3)
    place("5", 2, 3)
    place("5", 2, 4)


def test_research_allocation_earns_rp(game, place):
    _starter_cluster(place)
    game.evaluate(
        "const r = document.querySelector('input[data-alloc=\"research\"]');"
        "r.value = 50; r.dispatchEvent(new Event('input'))"
    )
    game.wait_for_timeout(1600)
    assert game.evaluate("window.__state.rp") > 0


def test_self_allocation_compounds_multiplier(game, place):
    _starter_cluster(place)
    game.evaluate(
        "const r = document.querySelector('input[data-alloc=\"self\"]');"
        "r.value = 60; r.dispatchEvent(new Event('input'))"
    )
    game.wait_for_timeout(1600)
    assert game.evaluate("window.__state.selfImprove") > 0


def test_allocation_shares_always_normalize_to_one(game):
    game.evaluate(
        "const r = document.querySelector('input[data-alloc=\"research\"]');"
        "r.value = 70; r.dispatchEvent(new Event('input'))"
    )
    total = game.evaluate(
        "window.__state.alloc.sell + window.__state.alloc.research + window.__state.alloc.self"
    )
    assert abs(total - 1) < 1e-6


def test_research_boosts_compute_output(game, place):
    _starter_cluster(place)
    game.evaluate("window.__state.rp = 500")
    before = game.evaluate("window.__state.totalCompute")
    game.click('.research-row[data-track="compute"] [data-buy]')
    game.wait_for_timeout(1200)
    after = game.evaluate("window.__state.totalCompute")
    assert game.evaluate("window.__state.tech.compute") == 1
    assert after > before * 1.2, f"{before:.1f}->{after:.1f}"
