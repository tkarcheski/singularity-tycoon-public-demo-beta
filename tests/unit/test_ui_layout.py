"""UI invariants: palette must not scroll, dev toggles wire to __god."""


def test_palette_shows_all_tools_without_clipping(game):
    # All 16 build tools render, grouped into 5 labeled categories…
    tools = game.query_selector_all("#tools .tool")
    assert len(tools) == 16, f"expected 16 tools, got {len(tools)}"
    groups = game.eval_on_selector_all("#tools .tool-group-title", "els => els.map(e => e.textContent)")
    assert groups == ["Power", "Cooling", "Compute", "Crew", "Ops"], groups

    # …the palette scrolls rather than clipping when the window is short, so no
    # tile is ever hidden (regression guard for the v0.7 16-tile palette).
    overflow_y = game.evaluate("getComputedStyle(document.getElementById('palette')).overflowY")
    assert overflow_y in ("auto", "scroll"), f"palette overflowY={overflow_y} (would clip)"


def test_every_tool_button_is_actually_visible(game):
    """Each of the 16 build buttons must render with a real, on-screen box —
    catches the regression where compaction made the tile row invisible."""
    every = game.evaluate(
        """() => {
            const out = {};
            for (const el of document.querySelectorAll('#tools .tool')) {
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                out[el.dataset.tool] = (
                    r.width > 20 && r.height > 12 &&            // has a real box
                    r.bottom > 0 && r.right > 0 &&              // on screen
                    cs.display !== 'none' && cs.visibility !== 'hidden' &&
                    parseFloat(cs.opacity) > 0.3 &&             // not faded out
                    el.querySelector('.name').textContent.length > 0
                );
            }
            return out;
        }"""
    )
    hidden = [t for t, ok in every.items() if not ok]
    assert not hidden, f"tool buttons not visible: {hidden}"
    # The compute archetypes specifically must be present and visible.
    for tool in ("cpu", "gpu1", "apu", "tpu", "quantum"):
        assert every.get(tool) is True, f"{tool} button is not visible"


def test_palette_fits_without_a_scrollbar(game):
    """The whole left panel fits inside the viewport at common window heights —
    no scrollbar needed to reach any control (Build through New Game)."""
    for height in (900, 850, 820):
        game.set_viewport_size({"width": 1280, "height": height})
        game.wait_for_timeout(120)
        over = game.evaluate(
            "const p = document.getElementById('palette'); p.scrollHeight - p.clientHeight"
        )
        assert over <= 0, f"palette overflows by {over}px at window height {height} (would show a scrollbar)"
    # every control, top tile to the New Game button, is on-screen at the default size
    reachable = game.evaluate(
        """() => {
            const pal = document.getElementById('palette').getBoundingClientRect();
            const solar = document.querySelector('.tool[data-tool="solar"]').getBoundingClientRect();
            const newg = document.getElementById('btn-new-game').getBoundingClientRect();
            return solar.top >= pal.top - 1 && newg.bottom <= pal.bottom + 1;
        }"""
    )
    assert reachable is True, "first tile or New Game button is outside the palette viewport"


def test_dev_toggles_set_god_flags(game):
    game.click("#dev-toggle")
    game.click('input[data-god="freeBuild"]')
    game.click('input[data-god="fast"]')
    assert game.evaluate("window.__god.freeBuild && window.__god.fast") is True
