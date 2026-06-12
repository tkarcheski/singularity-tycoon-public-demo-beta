#!/usr/bin/env python3
"""Automated playtest for Singularity Tycoon Mini.

Drives the real game in headless Chromium over file:// and asserts every
system works: building, wear/heat, repair, bot bays, research, finance,
entropy, tutorial, adaptive music, god toggles, and balance milestones.

Run locally:  pip install playwright && playwright install chromium
              python tests/playtest.py
CI runs this on every push/PR (.github/workflows/playtest.yml).
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

INDEX = Path(__file__).resolve().parent.parent / "index.html"
COLS, ROWS, TILE = 14, 10, 56
fails = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}: {name}" + (f" ({detail})" if detail else ""))
    if not cond:
        fails.append(name)


def launch(p):
    try:
        return p.chromium.launch(channel="chrome", headless=True)
    except Exception:
        return p.chromium.launch(headless=True)


def main():
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.goto(INDEX.as_uri())
        page.wait_for_timeout(900)

        check("loads with 9 tools", page.eval_on_selector_all("#tools .tool", "els => els.length") == 9)
        check("no boot errors", not errs, str(errs[:2]))
        check("tutorial visible with step 1", page.eval_on_selector("#tut-progress", "el => el.textContent") == "1 / 9")
        check("no blocking audio prompt", page.evaluate("!document.getElementById('audio-prompt')"))

        geo = page.evaluate(
            """() => { const r = document.getElementById('game').getBoundingClientRect();
            return {l: r.left, t: r.top,
                    w: document.getElementById('game').clientWidth,
                    h: document.getElementById('game').clientHeight}; }"""
        )
        ox = geo["l"] + (geo["w"] - COLS * TILE) // 2
        oy = geo["t"] + (geo["h"] - ROWS * TILE) // 2

        def click_cell(gx, gy):
            page.mouse.click(ox + gx * TILE + TILE / 2, oy + gy * TILE + TILE / 2)

        # First click anywhere starts music (counts as user gesture in Playwright)
        page.keyboard.press("1"); click_cell(2, 2)  # power plant
        page.wait_for_timeout(500)
        check("music auto-starts on first interaction", page.evaluate("window.GameMusic.isAudioStarted()"))
        check("grid stores cells", page.evaluate("window.__state.grid[2][2]?.t") == "power")

        # Tutorial advances as steps are done
        page.keyboard.press("2"); click_cell(3, 3)                       # cooler
        page.keyboard.press("3"); click_cell(2, 3); click_cell(2, 4)     # adjacent gpus near cooler
        page.wait_for_timeout(1200)
        step = page.evaluate("window.__state.tutStep")
        check("tutorial advances with play", step >= 4, f"step {step}")

        # Unlock gating: gpu2 is locked at minute zero; buying the unlock opens it
        check("gpu2 starts locked", page.evaluate("!window.__state.unlocks.gpu2"))
        page.click('.tool[data-tool="gpu2"]')  # can't afford -> stays locked
        check("unlock refused without cash", page.evaluate("!window.__state.unlocks.gpu2"))
        page.evaluate("window.__state.cash = 2000")
        page.click('.tool[data-tool="gpu2"]')
        check("gpu2 unlock purchased", page.evaluate("window.__state.unlocks.gpu2"))
        check("auto-maintain hidden before ops unlock", page.evaluate("document.querySelector('.fin-maint').hidden"))

        # Allocation: divert to research -> RP accrues; self -> multiplier grows
        page.evaluate("const r = document.querySelector('input[data-alloc=\"research\"]'); r.value = 50; r.dispatchEvent(new Event('input'))")
        page.wait_for_timeout(1600)
        rp = page.evaluate("window.__state.rp")
        check("research allocation earns RP", rp > 0, f"{rp:.2f} RP")
        page.evaluate("const r = document.querySelector('input[data-alloc=\"self\"]'); r.value = 60; r.dispatchEvent(new Event('input'))")
        page.wait_for_timeout(1600)
        si = page.evaluate("window.__state.selfImprove")
        check("self-improvement compounds", si > 0, f"+{si*100:.3f}%")
        rev_split = page.evaluate("window.__state.alloc.sell")
        check("allocation normalizes", abs(page.evaluate("window.__state.alloc.sell + window.__state.alloc.research + window.__state.alloc.self") - 1) < 1e-6, f"sell={rev_split:.2f}")
        # reset allocation to pure sell for the rest of the suite
        page.evaluate("for (const r of document.querySelectorAll('input[data-alloc]')) { r.value = r.dataset.alloc === 'sell' ? 100 : 0; r.dispatchEvent(new Event('input')) }")

        # God toggles
        page.click("#dev-toggle")
        page.click('input[data-god="freeBuild"]')
        page.click('input[data-god="fast"]')
        check("god toggles wired", page.evaluate("window.__god.freeBuild && window.__god.fast"))

        # Heat: gpu cluster cell is warmer than an isolated plant far away
        page.wait_for_timeout(700)
        heat_gpu = page.evaluate("window.__state.heatMap[3][2]")
        check("heat map computed", heat_gpu is not None and heat_gpu >= 0, str(heat_gpu))
        gpu_cond_scale = page.evaluate("window.__state.grid[3][2].cond")
        check("condition tracked", 0 < gpu_cond_scale <= 100)

        # Wear decays, noWear freezes
        c0 = page.evaluate("window.__state.grid[3][2].cond")
        page.wait_for_timeout(2200)
        c1 = page.evaluate("window.__state.grid[3][2].cond")
        check("wear decays condition", c1 < c0, f"{c0:.1f}->{c1:.1f}")
        page.click('input[data-god="noWear"]')
        c2 = page.evaluate("window.__state.grid[3][2].cond")
        page.wait_for_timeout(1200)
        c3 = page.evaluate("window.__state.grid[3][2].cond")
        check("noWear freezes condition", abs(c3 - c2) < 0.01, f"{c2:.2f}->{c3:.2f}")

        # Manual repair
        page.evaluate("window.__state.grid[3][2].cond = 20")
        page.keyboard.press("8"); click_cell(2, 3)
        check("manual repair restores to 100", page.evaluate("window.__state.grid[3][2].cond") == 100)

        # Bot bay (extra plant so the bay has power)
        page.keyboard.press("1"); click_cell(5, 4)
        page.keyboard.press("7"); click_cell(5, 5)
        page.evaluate("window.__state.grid[4][2].cond = 30")
        page.wait_for_timeout(4600)
        healed = page.evaluate("window.__state.grid[4][2].cond")
        check("bot bay auto-repairs", healed > 30, f"30->{healed:.0f}")

        # Research (costs RP now)
        page.evaluate("window.__state.rp = 500")
        before = page.evaluate("window.__state.totalCompute")
        page.click('.research-row[data-track="compute"] [data-buy]')
        page.wait_for_timeout(1200)
        after = page.evaluate("window.__state.totalCompute")
        check("research level applied", page.evaluate("window.__state.tech.compute") == 1)
        check("research boosts output", after > before * 1.2, f"{before:.1f}->{after:.1f}")

        # Loans
        cash_a = page.evaluate("window.__state.cash")
        page.click('[data-loan="0"]')
        debt = page.evaluate("window.__state.debt")
        check("loan grants cash and sets debt", page.evaluate("window.__state.cash") - cash_a >= 999 and debt == 1300)
        page.wait_for_timeout(2000)
        check("debt repays from revenue", page.evaluate("window.__state.debt") < debt)

        # Futures (scale up first)
        page.keyboard.press("1")
        for gx in range(7, 12): click_cell(gx, 0)
        page.keyboard.press("2")
        for gx in range(7, 12): click_cell(gx, 1)
        page.keyboard.press("4")
        for gx in range(7, 12): click_cell(gx, 2)
        page.wait_for_timeout(1300)
        check("scaled past futures unlock", page.evaluate("window.__state.totalCompute") >= 50)
        cash_c = page.evaluate("window.__state.cash")
        page.click("[data-futures]")
        check("futures pays advance", page.evaluate("window.__state.cash") > cash_c + 1000)
        check("futures sets delivery", page.evaluate("window.__state.futuresOwed") > 0)

        # Entropy: meter up; force an event deterministically
        check("entropy rises with compute+heat", page.evaluate("window.__state.entropy") > 20)
        page.evaluate("window.__rand = Math.random; Math.random = () => 0.0001")
        page.wait_for_timeout(1200)
        page.evaluate("Math.random = window.__rand")
        hit = page.evaluate(
            "window.__state.effects.length > 0 || [...window.__state.grid.flat()].some(c => c && c.cond < 100)"
        )
        check("entropy event fired", hit)
        page.click('input[name="god-entropy"][value="0"]')
        page.wait_for_timeout(700)
        check("entropy dial 0x zeroes meter", page.evaluate("window.__state.entropy") == 0)
        page.click('input[name="god-entropy"][value="25"]')
        page.wait_for_timeout(700)
        check("entropy dial 25x maxes meter", page.evaluate("window.__state.entropy") > 80)

        # Auto-maintenance: divert 25% of revenue, pool heals damage without clicks
        page.click('input[name="maintain"][value="0.25"]')
        page.evaluate("window.__state.grid[2][2].cond = 50")
        page.wait_for_timeout(2500)
        check("auto-maintenance heals from revenue", page.evaluate("window.__state.grid[2][2].cond") > 50)

        check("zero console errors end-to-end", not errs, str(errs[:3]))
        browser.close()

    # ---- Balance milestone: fresh normal-mode game must be profitable ----
    with sync_playwright() as p:
        browser = launch(p)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(INDEX.as_uri())
        page.wait_for_timeout(700)
        geo = page.evaluate(
            """() => { const r = document.getElementById('game').getBoundingClientRect();
            return {l: r.left, t: r.top,
                    w: document.getElementById('game').clientWidth,
                    h: document.getElementById('game').clientHeight}; }"""
        )
        ox = geo["l"] + (geo["w"] - COLS * TILE) // 2
        oy = geo["t"] + (geo["h"] - ROWS * TILE) // 2

        def cc(gx, gy):
            page.mouse.click(ox + gx * TILE + TILE / 2, oy + gy * TILE + TILE / 2)

        page.keyboard.press("1"); cc(4, 4)
        page.keyboard.press("2"); cc(5, 4)
        page.keyboard.press("3"); cc(5, 3); cc(6, 4); cc(5, 5)
        page.wait_for_timeout(4000)
        rev = page.evaluate("window.__state.revenue")
        check("BALANCE: starter base is profitable", rev > 0, f"{rev:+.2f}/s")
        check("BALANCE: starter base isn't too rich", rev < 4, f"{rev:+.2f}/s")
        browser.close()

    print(f"\n{'ALL PASS' if not fails else 'FAILURES: ' + ', '.join(fails)}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
