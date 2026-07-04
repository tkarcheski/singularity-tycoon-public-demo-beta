"""Universal Basic Compute + Universal Basic Income allocation."""


def build_farm(game, place):
    """A working revenue farm: plants, cooling, GPUs."""
    game.evaluate("window.__god.freeBuild = true")
    for x in range(2):
        place("2", x, 0)  # plants: 24 MW
        place("4", x, 1)  # loops: 20 kW
    place("5", 4, 4)
    place("5", 5, 4)  # 2x gpu1


def set_slider(game, selector, value):
    game.evaluate(
        f"""(() => {{
          const s = document.querySelector('{selector}');
          s.value = {value};
          s.dispatchEvent(new Event('input'));
        }})()"""
    )


def test_six_normalized_alloc_sliders(game):
    assert game.eval_on_selector_all("#allocation input[data-alloc]", "els => els.length") == 6
    # UBI is a full member of the normalized group — no separate capped slider
    assert game.eval_on_selector_all("#allocation input[data-ubi]", "els => els.length") == 0


def test_ubi_rebalances_with_other_sliders(game):
    set_slider(game, 'input[data-alloc="ubi"]', 100)  # sell 100 + ubi 100 → 50/50
    assert game.evaluate("window.__state.alloc.ubi") == 0.5
    assert game.evaluate("window.__state.alloc.sell") == 0.5
    set_slider(game, 'input[data-alloc="sell"]', 0)  # ubi alone → 100%
    assert game.evaluate("window.__state.alloc.ubi") == 1.0


def test_public_compute_lifts_sentiment_and_cuts_revenue(game, place):
    build_farm(game, place)
    game.wait_for_timeout(1500)
    rev_before = game.evaluate("window.__state.revenue")
    sent_before = game.evaluate("window.__state.sentiment")
    set_slider(game, 'input[data-alloc="ubc"]', 100)  # 50/50 with sell
    game.wait_for_timeout(2500)
    assert game.evaluate("window.__state.alloc.ubc") == 0.5
    assert game.evaluate("window.__state.revenue") < rev_before
    assert game.evaluate("window.__state.sentiment") > sent_before


def test_ubi_funds_jobs_and_costs_revenue(game, place):
    build_farm(game, place)
    game.wait_for_timeout(1500)
    jobs_before = game.evaluate("window.__state.netJobs")
    rev_before = game.evaluate("window.__state.revenue")
    set_slider(game, 'input[data-alloc="ubi"]', 100)  # half the compute now pays dividends
    game.wait_for_timeout(2000)
    assert game.evaluate("window.__state.ubiSpend") > 0
    assert game.evaluate("window.__state.netJobs") > jobs_before
    assert game.evaluate("window.__state.revenue") < rev_before


def test_alloc_mix_persists_across_reload(game):
    set_slider(game, 'input[data-alloc="ubi"]', 50)
    set_slider(game, 'input[data-alloc="research"]', 50)
    game.wait_for_timeout(300)
    game.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    game.reload()
    game.wait_for_timeout(900)
    assert abs(game.evaluate("window.__state.alloc.ubi") - 0.25) < 0.02
    assert abs(game.evaluate("window.__state.alloc.research") - 0.25) < 0.02
    assert abs(game.evaluate("window.__state.alloc.sell") - 0.5) < 0.02


def test_public_programs_no_console_errors(game, place, errors):
    build_farm(game, place)
    set_slider(game, 'input[data-alloc="ubc"]', 60)
    set_slider(game, 'input[data-alloc="ubi"]', 40)
    game.wait_for_timeout(2000)
    assert errors == [], f"errors: {errors[:3]}"
