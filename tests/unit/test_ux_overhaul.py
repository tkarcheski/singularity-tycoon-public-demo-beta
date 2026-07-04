"""Research tree modal, maintain slider, floor overhaul, space-blocked palette."""


def launch_station(game):
    game.evaluate("window.__god.freeBuild = true; window.__state.goalUnlocked = true")
    game.wait_for_timeout(600)
    game.click("[data-space]")
    game.wait_for_timeout(300)


def test_six_allocation_sliders(game):
    assert game.eval_on_selector_all("#allocation input[data-alloc]", "els => els.length") == 6


def test_maintain_slider_fills_pool(game, place):
    game.evaluate("window.__god.freeBuild = true")
    place("2", 0, 0)
    place("4", 1, 0)
    place("5", 3, 3)
    game.evaluate(
        "const r = document.querySelector('input[data-alloc=\"maintain\"]');"
        "r.value = 50; r.dispatchEvent(new Event('input'))"
    )
    game.wait_for_timeout(2000)
    assert game.evaluate("window.__state.maintainPool") > 0


def test_research_modal_opens_and_buys(game):
    game.evaluate("window.__state.rp = 100")
    game.click("#btn-research")
    assert game.evaluate("document.getElementById('research-modal').hidden") is False
    game.click('.research-row[data-track="durability"] [data-buy]')
    assert game.evaluate("window.__state.tech.durability") == 1
    game.click("#research-close")
    assert game.evaluate("document.getElementById('research-modal').hidden") is True


def test_space_research_locked_until_blueprint(game):
    game.evaluate("window.__state.rp = 1000")
    game.click("#btn-research")
    game.click('.research-row[data-track="shielding"] [data-buy]', force=True)
    assert game.evaluate("window.__state.tech.shielding") == 0
    game.evaluate("window.__state.goalUnlocked = true")
    game.wait_for_timeout(700)
    game.click('.research-row[data-track="shielding"] [data-buy]')
    assert game.evaluate("window.__state.tech.shielding") == 1


def test_space_research_effects_apply(game):
    launch_station(game)
    # radiators raise the vacuum wall bonus
    game.evaluate("window.__state.floors.at(-1)[0][0] = { t: 'cooler', cond: 100 }")
    game.wait_for_timeout(1200)
    base = game.evaluate("window.__state.totalCooling")
    game.evaluate("window.__state.tech.radiators = 2")
    game.wait_for_timeout(1200)
    boosted = game.evaluate("window.__state.totalCooling")
    assert boosted > base * 1.3  # 1.5 -> 2.0
    # recyclers extend the life-support field
    game.evaluate("""(() => {
      const g = window.__state.floors.at(-1);
      g[5][5] = { t: 'life', cond: 100 };
      g[5][9] = { t: 'human', cond: 100, skill: 80 };  // distance 4 — out of base range
    })()""")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.lifeMap[5][9]") is False
    game.evaluate("window.__state.tech.recyclers = 2")  # range 2 -> 4
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.lifeMap[5][9]") is True
    # panels raise orbital solar
    game.evaluate("window.__state.floors.at(-1)[0][13] = { t: 'solar', cond: 100 }")
    game.wait_for_timeout(1200)
    p_base = game.evaluate("window.__state.totalPower")
    game.evaluate("window.__state.tech.panels = 2")
    game.wait_for_timeout(1200)
    p_boosted = game.evaluate("window.__state.totalPower")
    assert p_boosted > p_base * 1.2  # ×1.3 -> ×1.7


def test_shielding_slows_space_wear(game):
    launch_station(game)
    game.evaluate("window.__god.entropyMult = 0")
    game.evaluate("window.__state.floors.at(-1)[7][7] = { t: 'cpu', cond: 100 }")
    game.wait_for_timeout(2500)
    base_loss = game.evaluate("100 - window.__state.floors.at(-1)[7][7].cond")
    game.evaluate("window.__state.tech.shielding = 2; window.__state.floors.at(-1)[7][7].cond = 100")
    game.wait_for_timeout(2500)
    shielded_loss = game.evaluate("100 - window.__state.floors.at(-1)[7][7].cond")
    assert shielded_loss < base_loss * 0.85  # ×0.8² = 0.64 expected


def test_floor_overhaul_refunds_and_clears(game, place):
    game.evaluate("window.__god.freeBuild = true")
    place("2", 0, 0)   # $80 plant
    place("5", 1, 0)   # $120 gpu
    game.evaluate("window.confirm = () => true")
    cash_before = game.evaluate("window.__state.cash")
    game.click("#btn-overhaul")
    assert game.evaluate("window.__state.grid.flat().every(c => c === null)") is True
    assert game.evaluate("window.__state.cash") - cash_before >= 100  # 50% of $200
    # only the active floor is touched — verified via a second floor
    game.click("[data-buy-floor]")
    game.wait_for_timeout(300)
    game.evaluate("window.__state.floors[1][2][2] = { t: 'cooler', cond: 100 }")
    game.click('[data-floor="0"]')
    game.click("#btn-overhaul")  # F1 is already empty; F2 must be untouched
    assert game.evaluate("window.__state.floors[1][2][2].t") == "cooler"


def test_space_blocks_disabled_in_palette(game):
    launch_station(game)
    assert game.evaluate("document.querySelector('.tool[data-tool=\"fan\"]').classList.contains('disabled')") is True
    assert game.evaluate("document.querySelector('.tool[data-tool=\"power\"]').classList.contains('disabled')") is True
    # clicking a blocked tool does not select it
    game.click('.tool[data-tool="fan"]', force=True)
    assert game.evaluate("window.__state.selectedTool") != "fan"
    # back on Earth they re-enable
    game.click('[data-floor="0"]')
    assert game.evaluate("document.querySelector('.tool[data-tool=\"fan\"]').classList.contains('disabled')") is False


def test_worst_case_palette_still_fits(game):
    game.evaluate("""(() => {
      window.__god.freeBuild = true;
      window.__state.goalUnlocked = true;
      window.__state.rp = 50;
      window.__state.debt = 500;
      window.__state.selfImprove = 0.2;
      window.__state.alloc.ubi = 0.1;
      window.__state.alloc.maintain = 0.1;
      window.__state.maintainPool = 20;
    })()""")
    game.wait_for_timeout(1500)
    overflow = game.evaluate(
        "const p = document.getElementById('palette'); p.scrollHeight - p.clientHeight"
    )
    assert overflow <= 0, f"late-game overflow {overflow}px"


def test_ux_overhaul_no_console_errors(game, errors):
    game.evaluate("window.__state.rp = 100; window.__state.goalUnlocked = true")
    game.click("#btn-research")
    game.click("#research-close")
    game.wait_for_timeout(1200)
    assert errors == [], f"errors: {errors[:3]}"
