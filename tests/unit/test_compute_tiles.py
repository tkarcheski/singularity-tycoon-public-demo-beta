"""Compute Tiles V2 (issue #37): CPU / TPU / Quantum join the GPU family."""


def free_build(game):
    game.evaluate("window.__god.freeBuild = true")


def test_cpu_rack_produces_compute(game, place):
    free_build(game)
    place("2", 0, 0)  # power plant
    place("4", 1, 0)  # coolant loop
    place("q", 2, 0)  # CPU rack
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.grid[0][2].t") == "cpu"
    assert game.evaluate("window.__state.totalCompute") > 0


def test_tpu_locked_until_cash_unlock(game, place):
    place("w", 0, 0)  # TPU hotkey while locked
    game.wait_for_timeout(600)
    assert game.evaluate("window.__state.grid[0][0]") is None
    game.evaluate("window.__state.unlocks.tpu = true")
    free_build(game)
    place("w", 0, 0)
    game.wait_for_timeout(600)
    assert game.evaluate("window.__state.grid[0][0].t") == "tpu"


def test_quantum_locked_until_rp_unlock(game, place):
    place("e", 0, 0)
    game.wait_for_timeout(600)
    assert game.evaluate("window.__state.grid[0][0]") is None
    game.evaluate("window.__state.unlocks.quantum = true")
    free_build(game)
    place("e", 0, 0)
    game.wait_for_timeout(600)
    assert game.evaluate("window.__state.grid[0][0].t") == "quantum"


def test_tpu_draws_power_and_cooling(game, place):
    free_build(game)
    game.evaluate("window.__state.unlocks.tpu = true")
    for x in range(3):
        place("2", x, 0)  # 3 plants = 36 MW
        place("4", x, 1)  # 3 loops = 30 kW
    place("w", 5, 5)
    game.wait_for_timeout(1200)
    # TPU needs 12 MW + 14 kW — a working pod shows up in the used pools
    assert game.evaluate("window.__state.powerUsed") >= 12
    assert game.evaluate("window.__state.coolingUsed") >= 14
    assert game.evaluate("window.__state.totalCompute") >= 40 * 0.9


def test_quantum_starved_without_cooling(game, place):
    free_build(game)
    game.evaluate("window.__state.unlocks.quantum = true")
    for x in range(2):
        place("2", x, 0)  # 24 MW, but only one 10 kW loop — quantum needs 30 kW
    place("4", 0, 1)
    place("e", 5, 5)
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.totalCompute") == 0


def test_save_roundtrips_new_tiles(game, place):
    free_build(game)
    game.evaluate("window.__state.unlocks.tpu = true; window.__state.unlocks.quantum = true")
    place("q", 0, 0)
    place("w", 1, 0)
    place("e", 2, 0)
    game.wait_for_timeout(600)
    game.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    game.reload()
    game.wait_for_timeout(900)
    row = game.evaluate("window.__state.grid[0].slice(0,3).map(c => c && c.t)")
    assert row == ["cpu", "tpu", "quantum"]


def test_new_tiles_no_console_errors(game, place, errors):
    free_build(game)
    game.evaluate("window.__state.unlocks.tpu = true; window.__state.unlocks.quantum = true")
    place("q", 0, 0)
    place("w", 1, 0)
    place("e", 2, 0)
    game.wait_for_timeout(1500)
    assert errors == [], f"errors: {errors[:3]}"
