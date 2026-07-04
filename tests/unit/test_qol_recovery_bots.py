"""#12 Recovery research + #34 Bot Bay buff/upgrade path."""


def test_recovery_research_raises_refunds(game, place):
    game.evaluate("window.__god.freeBuild = true")
    place("2", 5, 5)  # $80 plant
    cash0 = game.evaluate("window.__state.cash")
    game.keyboard.press("=")
    place("=", 5, 5) if False else None
    game.evaluate("window.__state.selectedTool = 'bull'")
    game.evaluate("""(() => {
      const t = window.__state.topo, c = t.center(5, 5), b = t.boardSize();
      const cv = document.getElementById('game');
      const ox = Math.floor((cv.clientWidth - b.w) / 2), oy = Math.floor((cv.clientHeight - b.h) / 2);
      const r = cv.getBoundingClientRect();
      cv.dispatchEvent(new MouseEvent('click', { clientX: r.left + ox + c.cx, clientY: r.top + oy + c.cy, bubbles: true }));
    })()""")
    base_refund = game.evaluate("window.__state.cash") - cash0
    assert abs(base_refund - 40) < 2  # 50% of $80 (upkeep may tick between reads)
    # with Recovery II the same teardown salvages 75%
    game.evaluate("window.__state.tech.recovery = 2")
    place("2", 6, 6)
    cash1 = game.evaluate("window.__state.cash")
    game.evaluate("window.__state.selectedTool = 'bull'")
    game.evaluate("""(() => {
      const t = window.__state.topo, c = t.center(6, 6), b = t.boardSize();
      const cv = document.getElementById('game');
      const ox = Math.floor((cv.clientWidth - b.w) / 2), oy = Math.floor((cv.clientHeight - b.h) / 2);
      const r = cv.getBoundingClientRect();
      cv.dispatchEvent(new MouseEvent('click', { clientX: r.left + ox + c.cx, clientY: r.top + oy + c.cy, bubbles: true }));
    })()""")
    assert abs(game.evaluate("window.__state.cash") - cash1 - 60) < 2  # 75% of $80


def test_bots_visit_every_three_seconds_and_scale_with_robotics(game):
    game.evaluate("window.__god.freeBuild = true; window.__god.noWear = true; window.__god.entropyMult = 0")
    game.evaluate("""(() => {
      const g = window.__state.grid;
      g[0][0] = { t: 'power', cond: 100 };
      g[2][2] = { t: 'botbay', cond: 100 };
      g[5][5] = { t: 'cpu', cond: 40 };
      g[6][6] = { t: 'cpu', cond: 40 };
      window.__state.unlocks.ops = true;
      window.__state.cash = 10000;
    })()""")
    game.wait_for_timeout(3600)  # at least one 3s visit
    healed_one = game.evaluate("window.__state.grid[5][5].cond")
    assert healed_one >= 55  # base heal 15+
    # Robotics II: two tiles per pass, bigger heals
    game.evaluate("""(() => {
      window.__state.tech.robotics = 2;
      window.__state.grid[5][5].cond = 40;
      window.__state.grid[6][6].cond = 40;
    })()""")
    game.wait_for_timeout(3600)
    a = game.evaluate("window.__state.grid[5][5].cond")
    b = game.evaluate("window.__state.grid[6][6].cond")
    assert a > 40 and b > 40  # both serviced in the same window


def test_qol_no_console_errors(game, errors):
    game.evaluate("window.__god.freeBuild = true")
    game.evaluate("window.__state.tech.recovery = 1; window.__state.tech.robotics = 1")
    game.wait_for_timeout(1500)
    assert errors == [], f"errors: {errors[:3]}"
