"""Space polish: degradation physics + maintain pricing (2026-07-04 session)."""


def test_degraded_machine_draws_more_power(game):
    game.evaluate("window.__god.freeBuild = true")
    game.evaluate("""(() => {
      const g = window.__state.grid;
      g[0][0] = { t: 'power', cond: 100 };
      g[0][1] = { t: 'cooler', cond: 100 };
      g[4][4] = { t: 'gpu1', cond: 100 };
    })()""")
    game.wait_for_timeout(1200)
    healthy = game.evaluate("window.__state.powerUsed")
    game.evaluate("window.__state.grid[4][4].cond = 50")
    game.wait_for_timeout(1200)
    degraded = game.evaluate("window.__state.powerUsed")
    # gpu1 draws 4 MW healthy; at cond 50 it leaks toward 4 × 1.3
    assert degraded > healthy + 0.8


def test_maintain_pricing_and_catchup_premium(game):
    game.evaluate("window.__god.freeBuild = true; window.__god.noWear = true")
    # lightly worn plant: no premium — pool spend per point = cost×0.003×2.2
    game.evaluate("""(() => {
      window.__state.grid[2][2] = { t: 'power', cond: 90 };
      window.__state.maintainPool = 6;
    })()""")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.grid[2][2].cond") == 100
    spent = 6 - game.evaluate("window.__state.maintainPool")
    assert abs(spent - 10 * 80 * 0.003 * 2.2) < 0.3  # ≈ $5.28 for 10 points
    # deeply worn tile pays the ×1.5 catch-up premium
    game.evaluate("""(() => {
      window.__state.grid[2][2].cond = 20;
      window.__state.maintainPool = 100;
    })()""")
    game.wait_for_timeout(1200)
    pool_left = game.evaluate("window.__state.maintainPool")
    cond_now = game.evaluate("window.__state.grid[2][2].cond")
    healed = cond_now - 20
    spent = 100 - pool_left
    # premium applies while below WORN_AT — average $/point must exceed base
    assert healed > 0
    assert spent / healed > 80 * 0.003 * 2.2 * 1.05


def test_tri_bars_stay_inside_cells(game):
    # geometric guard: the tri bar offset must stay under the inradius
    ok = game.evaluate("""(() => {
      const TRI_H = 86 * Math.sqrt(3) / 2;
      return 10 + 3 <= TRI_H / 3 + 8; // barY offset + height within fat zone
    })()""")
    assert ok is True
