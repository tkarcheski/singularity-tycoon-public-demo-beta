"""Space realism (#53): life support, vacuum power constraints, fission."""


def launch_station(game):
    game.evaluate("window.__god.freeBuild = true; window.__state.goalUnlocked = true")
    game.wait_for_timeout(600)
    game.click("[data-space]")
    game.wait_for_timeout(300)


def test_pod_suffocates_without_life_support(game):
    launch_station(game)
    game.evaluate("""(() => {
      const g = window.__state.floors.at(-1);
      g[5][5] = { t: 'human', cond: 100, skill: 80 };
    })()""")
    game.wait_for_timeout(1200)
    # 80-skill pod would produce 2.4 TFLOPS — but there's no air
    assert game.evaluate("window.__state.totalCompute") == 0
    assert game.evaluate("window.__state.lifeMap[5][5]") is False
    # add life support within range 2 → the pod breathes and produces
    game.evaluate("window.__state.floors.at(-1)[5][7] = { t: 'life', cond: 100 }")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.lifeMap[5][5]") is True
    assert game.evaluate("window.__state.totalCompute") > 2.3


def test_suffocating_desk_and_jobs_dont_count(game):
    launch_station(game)
    game.evaluate("""(() => {
      const g = window.__state.floors.at(-1);
      g[2][2] = { t: 'retrain', cond: 100 };  // +8 jobs normally
    })()""")
    game.wait_for_timeout(1200)
    jobs_suffocating = game.evaluate("window.__state.jobsCreated")
    game.evaluate("window.__state.floors.at(-1)[2][3] = { t: 'life', cond: 100 }")
    game.wait_for_timeout(1200)
    jobs_breathing = game.evaluate("window.__state.jobsCreated")
    assert jobs_breathing == jobs_suffocating + 8


def test_earth_needs_no_life_support(game, place):
    game.evaluate("window.__god.freeBuild = true")
    place("9", 5, 5)  # worker pod on Earth
    game.evaluate("window.__state.grid[5][5].skill = 50")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.lifeMap") is None
    assert game.evaluate("window.__state.totalCompute") > 1.4


def test_power_plant_blocked_and_inert_in_vacuum(game):
    launch_station(game)
    # placement blocked via the game's own click path
    game.evaluate("window.__state.selectedTool = 'power'")
    placed = game.evaluate("""(() => {
      const t = window.__state.topo, c = t.center(5, 5), b = t.boardSize();
      const cv = document.getElementById('game');
      const ox = Math.floor((cv.clientWidth - b.w) / 2), oy = Math.floor((cv.clientHeight - b.h) / 2);
      const r = cv.getBoundingClientRect();
      cv.dispatchEvent(new MouseEvent('click', { clientX: r.left + ox + c.cx, clientY: r.top + oy + c.cy, bubbles: true }));
      return window.__state.grid[5][5];
    })()""")
    assert placed is None
    # a plant smuggled in via state supplies nothing in vacuum
    game.evaluate("window.__state.floors.at(-1)[5][5] = { t: 'power', cond: 100 }")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.totalPower") == 0


def test_fission_core_gated_and_powers_vacuum(game):
    launch_station(game)
    game.evaluate("window.__state.unlocks.fission = true")
    game.evaluate("window.__state.floors.at(-1)[5][5] = { t: 'fission', cond: 100 }")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.totalPower") >= 30
    # and it runs HOT — vacuum retention doubles its 12 heat
    assert game.evaluate("window.__state.heatMap[5][5]") > 0.9


def test_fission_unlock_gate_enforced_on_earth(game, place):
    place("i", 5, 5)  # locked fission hotkey
    game.wait_for_timeout(600)
    assert game.evaluate("window.__state.grid[5][5]") is None
    game.evaluate("window.__god.freeBuild = true")
    place("i", 5, 5)
    game.wait_for_timeout(600)
    assert game.evaluate("window.__state.grid[5][5].t") == "fission"


def test_life_and_fission_save_roundtrip(game):
    launch_station(game)
    game.evaluate("""(() => {
      const g = window.__state.floors.at(-1);
      g[0][0] = { t: 'life', cond: 100 };
      g[4][4] = { t: 'fission', cond: 100 };
    })()""")
    game.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    game.reload()
    game.wait_for_timeout(900)
    assert game.evaluate("window.__state.floors.at(-1)[0][0].t") == "life"
    assert game.evaluate("window.__state.floors.at(-1)[4][4].t") == "fission"


def test_space_realism_no_console_errors(game, errors):
    launch_station(game)
    game.evaluate("""(() => {
      const g = window.__state.floors.at(-1);
      g[5][5] = { t: 'human', cond: 100, skill: 40 };
      g[5][7] = { t: 'life', cond: 100 };
      g[0][0] = { t: 'fission', cond: 100 };
      g[1][0] = { t: 'cooler', cond: 100 };
    })()""")
    game.wait_for_timeout(1800)
    assert errors == [], f"errors: {errors[:3]}"


# ---------- Durability research (#32 first step) ----------

def test_durability_research_slows_wear(game):
    game.evaluate("window.__god.freeBuild = true; window.__god.entropyMult = 0")
    game.evaluate("""(() => {
      window.__state.grid[2][2] = { t: 'cpu', cond: 100 };
      window.__state.grid[7][7] = { t: 'cpu', cond: 100 };
    })()""")
    game.wait_for_timeout(2500)
    base_loss = game.evaluate("100 - window.__state.grid[2][2].cond")
    game.evaluate("""(() => {
      window.__state.tech.durability = 2;
      window.__state.grid[2][2].cond = 100;
      window.__state.grid[7][7].cond = 100;
    })()""")
    game.wait_for_timeout(2500)
    slowed_loss = game.evaluate("100 - window.__state.grid[2][2].cond")
    # ×0.75² ≈ 0.5625 of the base rate
    assert slowed_loss < base_loss * 0.75


def test_research_panel_has_four_tracks(game):
    assert game.evaluate("document.querySelectorAll('.research-row').length") == 4
    names = game.evaluate("[...document.querySelectorAll('.research-name')].map(e => e.textContent)")
    assert any("Durability" in n for n in names)
