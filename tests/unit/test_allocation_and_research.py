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


def test_research_climbs_to_max_then_caps(game):
    """A track researches up its full ladder, then buyResearch no-ops at MAX."""
    game.evaluate("window.__state.god.freeBuild = true")  # ignore RP cost
    max_lvl = game.evaluate("window.__research.compute.tiers.length - 1")
    assert max_lvl >= 4, "compute should have 5 tiers (I-V)"
    # climb to the top (each click enabled until MAX)
    for _ in range(max_lvl):
        game.click('.research-row[data-track="compute"] [data-buy]')
    assert game.evaluate("window.__state.tech.compute") == max_lvl
    btn = '.research-row[data-track="compute"] [data-buy]'
    assert game.evaluate(f"document.querySelector('{btn}').textContent") == "MAX"
    assert game.evaluate(f"document.querySelector('{btn}').disabled") is True
    # buying past the top must no-op, not over-index
    game.evaluate("buyResearch('compute'); buyResearch('compute')")
    assert game.evaluate("window.__state.tech.compute") == max_lvl


def test_breakthrough_tiers_flatten_wear(game):
    """Late tiers (IV-V) keep raising output while the wear ratio improves."""
    tiers = game.evaluate("window.__research.power.tiers.map(t => ({out: t.out, wear: t.wear}))")
    # output strictly increases across the ladder
    outs = [t["out"] for t in tiers]
    assert outs == sorted(outs) and len(set(outs)) == len(outs)
    # the output-per-wear ratio is better at the top tier than at tier III
    ratio_iii = tiers[2]["out"] / tiers[2]["wear"]
    ratio_v = tiers[-1]["out"] / tiers[-1]["wear"]
    assert ratio_v > ratio_iii, f"breakthrough should improve ratio: {ratio_iii:.2f}->{ratio_v:.2f}"
