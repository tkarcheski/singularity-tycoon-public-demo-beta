"""Neighbor-bonus visualization: influencedCells geometry + overlay rendering."""


def test_cpu_aura_influence_ring(game):
    cells = game.evaluate("window.__influence(window.__tileDef('cpu'), 5, 5)")
    boosts = [c for c in cells if c["kind"] == "boost"]
    assert len(boosts) == 4  # square lattice: 4 neighbors at range 1


def test_drain_influence_falls_off(game):
    cells = game.evaluate("window.__influence(window.__tileDef('cooler'), 5, 5)")
    d1 = [c for c in cells if abs(c["x"] - 5) + abs(c["y"] - 5) == 1]
    d2 = [c for c in cells if abs(c["x"] - 5) + abs(c["y"] - 5) == 2]
    assert len(d1) == 4 and len(d2) == 8
    assert d1[0]["strength"] > d2[0]["strength"]


def test_immersion_shows_drain_and_guard(game):
    cells = game.evaluate("window.__influence(window.__tileDef('immersion'), 5, 5)")
    kinds = {c["kind"] for c in cells}
    assert "drain" in kinds and "guard" in kinds


def test_life_support_bubble_matches_range(game):
    cells = game.evaluate("window.__influence(window.__tileDef('life'), 5, 5)")
    air = [c for c in cells if c["kind"] == "air"]
    # square lattice, range 2: 4 at d1 + 8 at d2 = 12
    assert len(air) == 12


def test_gpu_cluster_partners_highlighted(game):
    game.evaluate("""(() => {
      window.__state.grid[5][6] = { t: 'gpu1', cond: 100 };
      window.__state.grid[5][4] = { t: 'gpu2', cond: 100 };
    })()""")
    cells = game.evaluate("window.__influence(window.__tileDef('gpu1'), 5, 5)")
    assert len([c for c in cells if c["kind"] == "cluster"]) == 2


def test_influence_no_console_errors_while_hovering(game, errors):
    game.evaluate("window.__god.freeBuild = true")
    game.evaluate("""(() => {
      window.__state.grid[3][3] = { t: 'immersion', cond: 100 };
      window.__state.unlocks.immersion = true;
    })()""")
    for tool, x, y in [("q", 5, 5), ("4", 3, 4), ("u", 7, 7), ("5", 2, 2)]:
        game.keyboard.press(tool)
        game.evaluate(f"window.__state.hover = {{ x: {x}, y: {y} }}")
        game.wait_for_timeout(250)
    # hovering a placed tile shows its reach
    game.evaluate("window.__state.hover = { x: 3, y: 3 }")
    game.wait_for_timeout(400)
    assert errors == [], f"errors: {errors[:3]}"
