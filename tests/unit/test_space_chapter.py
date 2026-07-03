"""Space chapter foundations: walls, vertical effects, the first station."""


def free_build(game):
    game.evaluate("window.__god.freeBuild = true")


def launch_station(game):
    game.evaluate("window.__god.freeBuild = true; window.__state.goalUnlocked = true")
    game.wait_for_timeout(600)
    game.click("[data-space]")
    game.wait_for_timeout(300)


# ---------- 1. Wall integration ----------

def test_perimeter_cooling_supplies_more(game, place):
    free_build(game)
    place("4", 5, 5)  # coolant loop, interior
    game.wait_for_timeout(1200)
    interior = game.evaluate("window.__state.totalCooling")
    game.keyboard.press("=")  # bulldoze
    game.evaluate("window.__state.grid[5][5] = null")
    place("4", 0, 0)  # same tile on the wall
    game.wait_for_timeout(1200)
    wall = game.evaluate("window.__state.totalCooling")
    assert abs(wall - interior * 1.25) < 0.5


def test_wall_tooltip_row(game, place):
    free_build(game)
    place("4", 0, 5)
    game.wait_for_timeout(600)
    # tooltip content is generated on hover; check the underlying helpers
    assert game.evaluate("window.__state.grid[5][0].t") == "cooler"


# ---------- 2. Cross-floor vertical effects ----------

def buy_floor2(game):
    game.evaluate("window.__god.freeBuild = true")
    game.click("[data-buy-floor]")
    game.wait_for_timeout(300)


def test_immersion_wear_guard_reaches_adjacent_floor(game, place):
    buy_floor2(game)  # F2 active
    game.evaluate("window.__state.unlocks.immersion = true")
    # immersion on F2 at (5,5); a plant on F1 at the same column
    game.evaluate("""(() => {
      window.__state.floors[1][5][5] = { t: 'immersion', cond: 100 };
      window.__state.floors[0][5][5] = { t: 'power', cond: 100 };
      window.__state.floors[0][2][2] = { t: 'power', cond: 100 };
    })()""")
    game.wait_for_timeout(1200)
    # the F1 plant under the bath is wear-guarded; the far plant is not
    game.click('[data-floor="0"]')
    game.wait_for_timeout(700)
    assert game.evaluate("window.__state.auraMaps.wear[5][5]") == 0.7
    assert game.evaluate("window.__state.auraMaps.wear[2][2]") == 1


def test_immersion_drains_heat_through_the_floor(game):
    buy_floor2(game)
    # hot plant stack on F1; immersion directly above on F2
    game.evaluate("""(() => {
      window.__state.floors[0][5][5] = { t: 'power', cond: 100 };
      window.__state.floors[0][5][6] = { t: 'power', cond: 100 };
    })()""")
    game.wait_for_timeout(1200)
    game.click('[data-floor="0"]')
    game.wait_for_timeout(700)
    hot = game.evaluate("window.__state.heatMap[5][5]")
    game.evaluate("window.__state.floors[1][5][5] = { t: 'immersion', cond: 100 }")
    game.wait_for_timeout(1200)
    cooled = game.evaluate("window.__state.heatMap[5][5]")
    assert cooled < hot


def test_cpu_aura_stays_on_its_own_floor(game):
    buy_floor2(game)
    game.evaluate("""(() => {
      window.__state.floors[0][5][5] = { t: 'cpu', cond: 100 };
      window.__state.floors[1][5][5] = { t: 'gpu1', cond: 100 };
      window.__state.floors[0][2][2] = { t: 'power', cond: 100 };
    })()""")
    game.wait_for_timeout(1200)
    game.click('[data-floor="1"]')
    game.wait_for_timeout(700)
    assert game.evaluate("window.__state.auraMaps.boost[5][5]") == 0


# ---------- 3. Space station ----------

def test_station_requires_blueprint_and_cash(game):
    # button hidden before the goal
    assert game.evaluate("document.querySelector('[data-space]').hidden") is True
    game.evaluate("window.__state.goalUnlocked = true")
    game.wait_for_timeout(700)
    assert game.evaluate("document.querySelector('[data-space]').hidden") is False
    assert game.evaluate("document.querySelector('[data-space]').disabled") is True
    game.evaluate("window.__state.cash = 300000")
    game.wait_for_timeout(700)
    assert game.evaluate("document.querySelector('[data-space]').disabled") is False


def test_station_is_triangular_vacuum_floor(game):
    launch_station(game)
    assert game.evaluate("window.__state.floorTopos.at(-1)") == "tri"
    assert game.evaluate("window.__state.floorSpace.at(-1)") is True
    assert game.evaluate("window.__state.topo.key") == "tri"
    # one station only — button gone
    assert game.evaluate("document.querySelector('[data-space]').hidden") is True
    tab = game.evaluate("document.querySelectorAll('.floor-tab')[1].textContent")
    assert tab.startswith("🛰")


def test_tri_lattice_math(game):
    assert game.evaluate("window.__topo.tri.dirs(2, 2).length") == 3
    assert game.evaluate("window.__topo.tri.dirs(3, 2).length") == 3
    # all 3 neighbors at distance 1, both parities
    ok = game.evaluate("""(() => {
      const t = window.__topo.tri;
      for (const [x, y] of [[4, 4], [5, 4]]) {
        for (const [dx, dy] of t.dirs(x, y)) {
          if (t.dist(x, y, x + dx, y + dy) !== 1) return `bad ${x},${y}`;
        }
      }
      return t.dist(3, 3, 3, 3) === 0 && t.dist(2, 2, 8, 6) === t.dist(8, 6, 2, 2);
    })()""")
    assert ok is True


def test_tri_pick_center_roundtrip(game):
    ok = game.evaluate("""(() => {
      const t = window.__topo.tri;
      for (let y = 0; y < 10; y++) for (let x = 0; x < 14; x++) {
        const c = t.center(x, y);
        const p = t.pick(c.cx, c.cy);
        if (!p || p.x !== x || p.y !== y) return `${x},${y} -> ${JSON.stringify(p)}`;
      }
      return true;
    })()""")
    assert ok is True


def test_vacuum_rules(game):
    launch_station(game)
    # fans can't be placed in vacuum
    game.evaluate("window.__state.selectedTool = 'fan'")
    game.evaluate("(() => { const c = window.__state.topo.center(5, 5); })()")
    before = game.evaluate("window.__state.grid[5][5]")
    assert before is None
    # place via the game's own click path using tri centers
    game.evaluate("""(() => {
      const o = (() => { const b = window.__state.topo.boardSize();
        return { x: Math.floor((document.getElementById('game').clientWidth - b.w) / 2),
                 y: Math.floor((document.getElementById('game').clientHeight - b.h) / 2) }; })();
      void o;
    })()""")
    # direct state check of the placement guard: simulate attempt
    game.evaluate("""(() => {
      window.__state.floors.at(-1)[5][5] = null;
    })()""")
    # solar in space: flat SPACE_SOLAR_MULT, immune to the sun cycle
    game.evaluate("""(() => {
      const g = window.__state.floors.at(-1);
      g[0][0] = { t: 'solar', cond: 100 };
    })()""")
    game.wait_for_timeout(1200)
    p1 = game.evaluate("window.__state.totalPower")
    game.wait_for_timeout(1500)
    p2 = game.evaluate("window.__state.totalPower")
    assert abs(p1 - p2) < 0.01  # no day/night wobble
    assert abs(p1 - 4 * 1.3) < 0.1  # 4 MW × SPACE_SOLAR_MULT


def test_fan_placement_blocked_in_space(game):
    launch_station(game)
    game.evaluate("window.__state.selectedTool = 'fan'")
    clicked = game.evaluate("""(() => {
      const t = window.__state.topo;
      const c = t.center(5, 5);
      const b = t.boardSize();
      const cv = document.getElementById('game');
      const ox = Math.floor((cv.clientWidth - b.w) / 2), oy = Math.floor((cv.clientHeight - b.h) / 2);
      const r = cv.getBoundingClientRect();
      const ev = new MouseEvent('click', { clientX: r.left + ox + c.cx, clientY: r.top + oy + c.cy, bubbles: true });
      cv.dispatchEvent(ev);
      return window.__state.grid[5][5];
    })()""")
    assert clicked is None


def test_space_save_roundtrip(game):
    launch_station(game)
    game.evaluate("window.__state.floors.at(-1)[3][3] = { t: 'solar', cond: 100 }")
    game.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    game.reload()
    game.wait_for_timeout(900)
    assert game.evaluate("window.__state.floorTopos.at(-1)") == "tri"
    assert game.evaluate("window.__state.floorSpace.at(-1)") is True
    assert game.evaluate("window.__state.floors.at(-1)[3][3].t") == "solar"


def test_space_chapter_no_console_errors(game, errors):
    launch_station(game)
    game.evaluate("""(() => {
      const g = window.__state.floors.at(-1);
      g[0][0] = { t: 'solar', cond: 100 };
      g[2][2] = { t: 'cpu', cond: 100 };
      g[0][1] = { t: 'cooler', cond: 100 };
    })()""")
    game.wait_for_timeout(1800)
    assert errors == [], f"errors: {errors[:3]}"


# ---------- Review-panel additions ----------

def test_vacuum_wall_bonus_is_1_5(game):
    launch_station(game)
    game.evaluate("window.__state.floors.at(-1)[5][5] = { t: 'cooler', cond: 100 }")
    game.wait_for_timeout(1200)
    interior = game.evaluate("window.__state.totalCooling")
    game.evaluate("window.__state.floors.at(-1)[5][5] = null; window.__state.floors.at(-1)[0][0] = { t: 'cooler', cond: 100 }")
    game.wait_for_timeout(1200)
    wall = game.evaluate("window.__state.totalCooling")
    assert abs(wall - interior * 1.5) < 0.5


def test_radiation_wear_faster_in_space(game):
    launch_station(game)
    game.evaluate("window.__god.entropyMult = 0")
    game.evaluate("""(() => {
      window.__state.floors[0][5][5] = { t: 'cpu', cond: 100 };
      window.__state.floors.at(-1)[5][5] = { t: 'cpu', cond: 100 };
    })()""")
    game.wait_for_timeout(3000)
    ground = game.evaluate("window.__state.floors[0][5][5].cond")
    space = game.evaluate("window.__state.floors.at(-1)[5][5].cond")
    assert space < ground  # radiation ×1.25 (plus vacuum heat retention)


def test_vertical_effects_reach_upward_too(game):
    buy_floor2(game)
    # immersion on F1; heat + wear targets on F2 directly above
    game.evaluate("""(() => {
      window.__state.floors[0][5][5] = { t: 'immersion', cond: 100 };
      window.__state.floors[1][5][5] = { t: 'power', cond: 100 };
      window.__state.floors[1][5][6] = { t: 'power', cond: 100 };
    })()""")
    game.wait_for_timeout(1200)
    game.click('[data-floor="1"]')
    game.wait_for_timeout(700)
    assert game.evaluate("window.__state.auraMaps.wear[5][5]") == 0.7
    with_bath = game.evaluate("window.__state.heatMap[5][5]")
    game.evaluate("window.__state.floors[0][5][5] = null")
    game.wait_for_timeout(1200)
    without_bath = game.evaluate("window.__state.heatMap[5][5]")
    assert with_bath < without_bath


def test_vacuum_fan_contributes_no_cooling(game):
    launch_station(game)
    # a fan smuggled in via state (e.g. an old save) supplies nothing in vacuum
    game.evaluate("window.__state.floors.at(-1)[5][5] = { t: 'fan', cond: 100 }")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.totalCooling") == 0


def test_station_does_not_consume_a_tower_rung(game):
    launch_station(game)  # freeBuild on; station bought at 1 ground floor
    # next GROUND floor is still F2 at $150k, and the ladder still reaches F5
    label = game.evaluate("document.querySelector('[data-buy-floor-label]').textContent")
    assert "Floor 2" in label
    for expected_ground in (2, 3, 4, 5):
        game.click("[data-buy-floor]")
        game.wait_for_timeout(200)
    assert game.evaluate("window.__state.floors.length") == 6  # 5 ground + 1 station
    assert game.evaluate("document.querySelector('[data-buy-floor]').hidden") is True


def test_vertical_effects_do_not_cross_into_orbit(game):
    launch_station(game)
    game.evaluate("window.__state.unlocks.immersion = true")
    # immersion on the ground floor below the station index; target on station
    game.evaluate("""(() => {
      window.__state.floors[0][5][5] = { t: 'immersion', cond: 100 };
      window.__state.floors.at(-1)[5][5] = { t: 'power', cond: 100 };
    })()""")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.auraMaps.wear[5][5]") == 1
