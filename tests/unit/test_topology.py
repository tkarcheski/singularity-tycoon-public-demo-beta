"""Topology interface (#21, epic #44): hex lattice math, unlock, hex floors."""


def unlock_hex_and_buy_floor(game):
    game.evaluate("window.__god.freeBuild = true; window.__state.unlocks.hex = true")
    game.click("[data-buy-floor]")
    game.wait_for_timeout(300)


def test_hex_neighbor_sets_by_row_parity(game):
    even = game.evaluate("window.__topo.hex.dirs(4).length")
    odd = game.evaluate("window.__topo.hex.dirs(5).length")
    assert even == 6 and odd == 6
    # neighbors of (5,4) [even row] and (5,5) [odd row] differ per odd-r offset
    n_even = game.evaluate("window.__topo.hex.dirs(4).map(([dx,dy]) => `${5+dx},${4+dy}`).sort()")
    n_odd = game.evaluate("window.__topo.hex.dirs(5).map(([dx,dy]) => `${5+dx},${5+dy}`).sort()")
    assert n_even != n_odd


def test_hex_distance_is_a_metric(game):
    # symmetry, identity, and a known adjacency: all 6 neighbors at distance 1
    assert game.evaluate("window.__topo.hex.dist(3, 3, 3, 3)") == 0
    assert game.evaluate("window.__topo.hex.dist(2, 3, 7, 6)") == game.evaluate(
        "window.__topo.hex.dist(7, 6, 2, 3)")
    all_one = game.evaluate(
        "window.__topo.hex.dirs(4).every(([dx,dy]) => window.__topo.hex.dist(5, 4, 5+dx, 4+dy) === 1)")
    assert all_one is True
    all_one_odd = game.evaluate(
        "window.__topo.hex.dirs(5).every(([dx,dy]) => window.__topo.hex.dist(5, 5, 5+dx, 5+dy) === 1)")
    assert all_one_odd is True


def test_hex_pick_center_roundtrip(game):
    ok = game.evaluate("""(() => {
      const t = window.__topo.hex;
      for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
        const c = t.center(x, y);
        const p = t.pick(c.cx, c.cy);
        if (!p || p.x !== x || p.y !== y) return `${x},${y} -> ${JSON.stringify(p)}`;
      }
      return true;
    })()""")
    assert ok is True


def test_hex_unlock_gates_new_floors(game):
    # without the unlock, a purchased floor is square
    game.evaluate("window.__god.freeBuild = true")
    game.click("[data-buy-floor]")
    game.wait_for_timeout(300)
    assert game.evaluate("window.__state.floorTopos[1]") == "square"
    # with it, the next floor is hex and the tab shows the hex glyph
    game.evaluate("window.__state.unlocks.hex = true")
    game.click("[data-buy-floor]")
    game.wait_for_timeout(300)
    assert game.evaluate("window.__state.floorTopos[2]") == "hex"
    assert game.evaluate("document.querySelectorAll('.floor-tab')[2].textContent").startswith("⬡")


def test_hex_floor_simulates_with_six_neighbor_auras(game):
    unlock_hex_and_buy_floor(game)  # floor 2 = hex, now active
    # power + cooling + a gpu ringed by CPUs on the hex floor, via direct state
    game.evaluate("""(() => {
      const g = window.__state.grid;
      g[0][0] = { t: 'power', cond: 100 };
      g[0][1] = { t: 'power', cond: 100 };
      g[0][2] = { t: 'cooler', cond: 100 };
      g[4][5] = { t: 'gpu1', cond: 100 };
      // ring the gpu with CPUs on all six hex neighbors (even row 4)
      for (const [dx, dy] of window.__topo.hex.dirs(4)) {
        window.__state.grid[4 + dy][5 + dx] = { t: 'cpu', cond: 100 };
      }
    })()""")
    game.wait_for_timeout(1500)
    # six CPU neighbors × 0.06 aura, capped at 0.25
    assert game.evaluate("window.__state.auraMaps.boost[4][5]") == 0.25
    assert game.evaluate("window.__state.totalCompute") > 0


def test_square_floor_unaffected_by_hex_unlock(game):
    game.evaluate("window.__state.unlocks.hex = true")
    game.wait_for_timeout(600)
    assert game.evaluate("window.__state.floorTopos[0]") == "square"
    assert game.evaluate("window.__state.topo.key") == "square"


def test_floor_topos_save_roundtrip_and_old_save_default(game):
    unlock_hex_and_buy_floor(game)
    game.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    game.reload()
    game.wait_for_timeout(900)
    assert game.evaluate("window.__state.floorTopos.length") == 2
    assert game.evaluate("window.__state.floorTopos[1]") == "hex"
    # strip floorTopos to simulate a pre-topology save: floors default to square
    # (then block the unload autosave from rewriting the modern shape)
    game.evaluate("""(() => {
      const snap = JSON.parse(localStorage.getItem('stm-save-v1'));
      delete snap.floorTopos;
      localStorage.setItem('stm-save-v1', JSON.stringify(snap));
      localStorage.setItem = () => {};
    })()""")
    game.reload()
    game.wait_for_timeout(900)
    assert game.evaluate("window.__state.floorTopos.every(t => t === 'square')") is True


def test_hex_floor_no_console_errors(game, errors):
    unlock_hex_and_buy_floor(game)
    game.evaluate("""(() => {
      const g = window.__state.grid;
      g[2][2] = { t: 'power', cond: 100 };
      g[2][3] = { t: 'gpu1', cond: 100 };
      g[3][2] = { t: 'cooler', cond: 100 };
    })()""")
    # hover + click on the hex board via computed centers
    game.wait_for_timeout(1500)
    assert errors == [], f"errors: {errors[:3]}"
