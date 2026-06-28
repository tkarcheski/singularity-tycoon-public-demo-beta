"""Robot Framework v3 listener that embeds a screenshot after every
test-level keyword — no manual Snapshot calls required in the .robot files.

How it decides what to snap:
- Only top-level keywords inside a test case (parent is a TestCase). Setup
  and teardown keywords are included so we capture the initial page state.
- Nested library keywords are skipped, so the log doesn't explode with one
  screenshot per `Evaluate JavaScript` or `Click`.
- Browser-control keywords (`New Browser`, `New Context`, `Close Browser`,
  `Close Game`) are skipped — either no page exists yet or the page is gone.
- The listener guards against re-entry: taking a screenshot is itself a
  keyword call, so without the flag we'd recurse infinitely.

Wiring: `robot --listener tests/integration/listeners/screenshot_listener.py`.
"""
from robot.libraries.BuiltIn import BuiltIn
from robot.running.model import TestCase


SKIP_KEYWORDS = {
    "Take Screenshot",
    "Snapshot",
    "New Browser",
    "New Context",
    "New Page",
    "Close Browser",
    "Close Context",
    "Close Page",
    "Close Game",
    "Open Game",  # snap happens on its first body keyword instead
    "Register Keyword To Run On Failure",
}


class screenshot_listener:
    ROBOT_LISTENER_API_VERSION = 3

    def __init__(self):
        self._taking = False
        self._browser_ready = False

    def end_keyword(self, data, result):
        if self._taking:
            return

        # Track when the browser is up. Open Game registers a New Page; once
        # that or any later keyword finishes, we're safe to screenshot.
        if data.name in ("New Page", "Open Game"):
            self._browser_ready = True
            return
        if data.name in ("Close Game", "Close Browser"):
            self._browser_ready = False
            return

        if not self._browser_ready:
            return
        if not self._is_top_level_test_keyword(data):
            return
        if data.name in SKIP_KEYWORDS:
            return

        self._snap(tag=f"after-{data.name}")

    def end_test(self, data, result):
        # Reset the per-test gate so the next test re-arms after Open Game.
        self._browser_ready = False

    def _is_top_level_test_keyword(self, data):
        parent = getattr(data, "parent", None)
        return isinstance(parent, TestCase)

    def _snap(self, tag):
        self._taking = True
        try:
            BuiltIn().run_keyword(
                "Take Screenshot", "filename=EMBED", "fullPage=True"
            )
            BuiltIn().log(f"Snapshot: {tag}", level="INFO")
        except Exception as exc:
            # Browser may have been torn down mid-test; don't fail the suite.
            BuiltIn().log(f"Snapshot skipped ({tag}): {exc}", level="DEBUG")
        finally:
            self._taking = False
