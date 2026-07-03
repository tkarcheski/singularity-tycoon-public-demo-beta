"""Second floor purchase (#20 v1): $150k, shared economy, per-floor grids."""


def test_floor_button_gated_by_cash(game):
    assert game.evaluate("document.querySelector('[data-floor2]').disabled") is True
    game.evaluate("window.__state.cash = 200000")
    game.wait_for_timeout(700)
    assert game.evaluate("document.querySelector('[data-floor2]').disabled") is False


def test_buy_floor_creates_empty_second_floor(game):
    game.evaluate("window.__state.cash = 200000")
    game.wait_for_timeout(600)
    game.click("[data-floor2]")
    game.wait_for_timeout(300)
    assert game.evaluate("window.__state.floors.length") == 2
    assert game.evaluate("window.__state.cash") < 60000
    assert game.evaluate("window.__state.floor") == 1
    assert game.evaluate("window.__state.grid.flat().every(c => c === null)") is True
    # tabs appear, button disappears
    assert game.evaluate("document.getElementById('floor-tabs').hidden") is False
    assert game.evaluate("document.querySelector('[data-floor2]').hidden") is True


def test_floors_hold_independent_grids(game, place):
    game.evaluate("window.__god.freeBuild = true")
    place("2", 0, 0)  # plant on F1
    game.evaluate("window.__state.cash = 200000")
    game.wait_for_timeout(600)
    game.click("[data-floor2]")
    game.wait_for_timeout(300)
    assert game.evaluate("window.__state.grid[0][0]") is None  # F2 empty
    place("4", 0, 0)  # cooler on F2
    game.wait_for_timeout(300)
    assert game.evaluate("window.__state.floors[0][0][0].t") == "power"
    assert game.evaluate("window.__state.floors[1][0][0].t") == "cooler"


def test_both_floors_produce_while_viewing_one(game, place):
    game.evaluate("window.__god.freeBuild = true")
    # working farm on F1
    place("2", 0, 0)
    place("4", 1, 0)
    place("5", 3, 3)
    game.evaluate("window.__state.cash = 200000")
    game.wait_for_timeout(600)
    game.click("[data-floor2]")  # switches view to empty F2
    game.wait_for_timeout(1500)
    # F1's farm still supplies and computes
    assert game.evaluate("window.__state.totalCompute") > 0
    assert game.evaluate("window.__state.totalPower") > 0


def test_floor_switching_via_tabs(game):
    game.evaluate("window.__state.cash = 200000")
    game.wait_for_timeout(600)
    game.click("[data-floor2]")
    game.wait_for_timeout(300)
    game.click('[data-floor="0"]')
    assert game.evaluate("window.__state.floor") == 0
    game.click('[data-floor="1"]')
    assert game.evaluate("window.__state.floor") == 1


def test_old_single_grid_save_migrates(game, place):
    game.evaluate("window.__god.freeBuild = true")
    place("2", 5, 5)
    game.wait_for_timeout(300)
    # rewrite the save into the pre-floors format
    game.evaluate("""(() => {
      window.dispatchEvent(new Event('beforeunload'));
      const snap = JSON.parse(localStorage.getItem('stm-save-v1'));
      snap.grid = snap.floors[0];
      delete snap.floors;
      delete snap.floor;
      localStorage.setItem('stm-save-v1', JSON.stringify(snap));
    })()""")
    game.reload()
    game.wait_for_timeout(900)
    assert game.evaluate("window.__state.floors.length") == 1
    assert game.evaluate("window.__state.grid[5][5]?.t") == "power"


def test_two_floor_save_roundtrips(game, place):
    game.evaluate("window.__god.freeBuild = true")
    place("2", 0, 0)
    game.evaluate("window.__state.cash = 200000")
    game.wait_for_timeout(600)
    game.click("[data-floor2]")
    game.wait_for_timeout(300)
    place("4", 2, 2)  # cooler on F2
    game.wait_for_timeout(300)
    game.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    game.reload()
    game.wait_for_timeout(900)
    assert game.evaluate("window.__state.floors.length") == 2
    assert game.evaluate("window.__state.floor") == 1
    assert game.evaluate("window.__state.floors[0][0][0].t") == "power"
    assert game.evaluate("window.__state.floors[1][2][2].t") == "cooler"


def test_floors_no_console_errors(game, place, errors):
    game.evaluate("window.__god.freeBuild = true")
    place("2", 0, 0)
    place("5", 3, 3)
    game.evaluate("window.__state.cash = 200000")
    game.wait_for_timeout(600)
    game.click("[data-floor2]")
    place("q", 1, 1)
    game.wait_for_timeout(2000)
    assert errors == [], f"errors: {errors[:3]}"
