"""Cooling tiles + synergy auras (issues #37 slice 2 and #17 v1)."""


def free_build(game):
    game.evaluate("window.__god.freeBuild = true")


def test_heat_exchanger_drains_at_distance_three(game, place):
    free_build(game)
    place("2", 5, 5)  # power plant: heat source 4
    game.wait_for_timeout(1200)
    hot = game.evaluate("window.__state.heatMap[5][5]")
    assert hot > 0
    place("r", 8, 5)  # exchanger at Manhattan distance 3
    game.wait_for_timeout(1200)
    cooled = game.evaluate("window.__state.heatMap[5][5]")
    assert cooled < hot


def test_immersion_wear_guard_aura(game, place):
    free_build(game)
    game.evaluate("window.__state.unlocks.immersion = true")
    place("2", 3, 3)  # plant to power the bath
    place("t", 5, 5)  # immersion bath
    place("2", 5, 6)  # plant adjacent to the bath
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.auraMaps.wear[6][5]") == 0.7
    # the far plant is unguarded
    assert game.evaluate("window.__state.auraMaps.wear[3][3]") == 1


def test_cpu_orchestration_boosts_adjacent_gpu(game, place):
    free_build(game)
    place("2", 0, 0)
    place("4", 1, 0)
    place("5", 5, 5)  # gpu1
    place("q", 5, 6)  # cpu adjacent
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.auraMaps.boost[5][5]") == 0.06
    # cpu doesn't boost itself or its own kind
    assert game.evaluate("window.__state.auraMaps.boost[6][5]") == 0


def test_cryo_plant_powers_a_quantum_annealer(game, place):
    free_build(game)
    game.evaluate("window.__state.unlocks.quantum = true; window.__state.unlocks.cryo = true")
    for x in range(3):
        place("2", x, 0)  # 36 MW
    place("y", 5, 5)  # cryo: +40 kW, -8 MW
    place("e", 5, 6)  # quantum: needs 20 MW + 30 kW
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.totalCompute") >= 90 * 0.9


def test_cooling_gates_enforce(game, place):
    place("t", 0, 0)
    place("y", 1, 0)
    game.wait_for_timeout(600)
    assert game.evaluate("window.__state.grid[0][0]") is None
    assert game.evaluate("window.__state.grid[0][1]") is None


def test_save_roundtrips_cooling_tiles(game, place):
    free_build(game)
    game.evaluate("window.__state.unlocks.immersion = true; window.__state.unlocks.cryo = true")
    place("r", 0, 0)
    place("t", 1, 0)
    place("y", 2, 0)
    game.wait_for_timeout(600)
    game.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    game.reload()
    game.wait_for_timeout(900)
    row = game.evaluate("window.__state.grid[0].slice(0,3).map(c => c && c.t)")
    assert row == ["exch", "immersion", "cryo"]


def test_cooling_tiles_no_console_errors(game, place, errors):
    free_build(game)
    game.evaluate("window.__state.unlocks.immersion = true; window.__state.unlocks.cryo = true")
    place("r", 0, 0)
    place("t", 1, 0)
    place("y", 2, 0)
    place("q", 3, 0)
    game.wait_for_timeout(1500)
    assert errors == [], f"errors: {errors[:3]}"
