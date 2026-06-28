"""UI invariants: palette must not scroll, dev toggles wire to __god."""


def test_palette_fits_without_scrolling(game):
    overflow = game.evaluate(
        "const p = document.getElementById('palette'); p.scrollHeight - p.clientHeight"
    )
    assert overflow <= 0, f"overflow {overflow}px"


def test_dev_toggles_set_god_flags(game):
    game.click("#dev-toggle")
    game.click('input[data-god="freeBuild"]')
    game.click('input[data-god="fast"]')
    assert game.evaluate("window.__god.freeBuild && window.__god.fast") is True
