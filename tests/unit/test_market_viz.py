"""Token price sparkline + trend (#22)."""


def test_price_history_accumulates_and_caps(game):
    game.wait_for_timeout(2500)
    n = game.evaluate("window.__state.priceHistory.length")
    assert n >= 4
    game.evaluate("window.__state.priceHistory = new Array(130).fill(1.2)")
    game.wait_for_timeout(1200)
    assert game.evaluate("window.__state.priceHistory.length") == 120


def test_sparkline_canvas_draws(game):
    game.wait_for_timeout(2500)
    # canvas exists and has non-transparent pixels after a few ticks
    painted = game.evaluate("""(() => {
      const cv = document.getElementById('token-spark');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    })()""")
    assert painted is True


def test_trend_arrow_in_hud(game):
    game.wait_for_timeout(2500)
    text = game.evaluate("document.getElementById('hud-token').textContent")
    assert any(a in text for a in ("↗", "↘", "→"))


def test_market_viz_no_console_errors(game, errors):
    game.wait_for_timeout(2500)
    assert errors == [], f"errors: {errors[:3]}"
