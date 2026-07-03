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


def test_four_alloc_sliders_plus_ubi(game):
    assert game.eval_on_selector_all("#allocation input[data-alloc]", "els => els.length") == 4
    assert game.eval_on_selector_all("#allocation input[data-ubi]", "els => els.length") == 1


def test_public_compute_lifts_sentiment_and_cuts_revenue(game, place):
    build_farm(game, place)
    game.wait_for_timeout(1500)
    rev_before = game.evaluate("window.__state.revenue")
    sent_target_before = game.evaluate("window.__state.sentiment")
    # donate half the compute
    set_slider(game, 'input[data-alloc="ubc"]', 100)  # sell 100 + ubc 100 → 50/50
    game.wait_for_timeout(2500)
    assert game.evaluate("window.__state.alloc.ubc") == 0.5
    assert game.evaluate("window.__state.revenue") < rev_before
    assert game.evaluate("window.__state.sentiment") > sent_target_before


def test_ubi_funds_jobs_and_costs_revenue(game, place):
    build_farm(game, place)
    game.wait_for_timeout(1500)
    jobs_before = game.evaluate("window.__state.netJobs")
    set_slider(game, "input[data-ubi]", 30)
    game.wait_for_timeout(2000)
    assert abs(game.evaluate("window.__state.ubiShare") - 0.3) < 1e-9
    assert game.evaluate("window.__state.ubiSpend") > 0
    assert game.evaluate("window.__state.netJobs") > jobs_before


def test_ubi_share_persists(game, place):
    set_slider(game, "input[data-ubi]", 20)
    game.wait_for_timeout(300)
    game.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    game.reload()
    game.wait_for_timeout(900)
    assert abs(game.evaluate("window.__state.ubiShare") - 0.2) < 1e-9


def test_public_programs_no_console_errors(game, place, errors):
    build_farm(game, place)
    set_slider(game, 'input[data-alloc="ubc"]', 60)
    set_slider(game, "input[data-ubi]", 15)
    game.wait_for_timeout(2000)
    assert errors == [], f"errors: {errors[:3]}"
