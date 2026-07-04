"""Boot the packaged desktop binary headless and verify the game runs.

Usage: python smoke.py [path-to-binary]  (defaults to dist/linux-unpacked/)
Exits non-zero if the game fails to boot, tick, or render its palette.
"""
import glob
import json
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

binary = sys.argv[1] if len(sys.argv) > 1 else "dist/linux-unpacked/singularity-tycoon-desktop"
if not os.path.exists(binary):
    sys.exit(f"binary not found: {binary} (cwd: {os.getcwd()}, {glob.glob('dist/*')})")

proc = subprocess.Popen(
    ["xvfb-run", "-a", binary, "--no-sandbox", "--remote-debugging-port=9223"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    time.sleep(10)
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9223")
        page = browser.contexts[0].pages[0]
        page.wait_for_timeout(2500)
        state = page.evaluate(
            "JSON.stringify({tick: window.__state.tick, cash: window.__state.cash,"
            " tools: document.querySelectorAll('.tool').length,"
            " desktop: window.__desktop?.shell || null})"
        )
        s = json.loads(state)
        print("packaged-app state:", s)
        assert s["tick"] > 2, "sim is not ticking"
        assert s["tools"] >= 20, "palette did not render"
        assert s["desktop"] == "electron", "preload bridge missing"
        print("SMOKE OK")
finally:
    proc.terminate()
