"""Surface the pytest unit suite inside the Robot Framework report.

The GitHub pipeline already builds one `log.html` / `report.html` from the Robot
integration run (`.github/workflows/playtest.yml`). This bridge folds the pytest
*unit* suite into that same report so there's a single place to see every test.

Two integration points, matching the requested design (`@keyword` + a template):

* ``PytestBridge`` — a Robot library whose ``Run Unit Test`` keyword executes a
  single pytest test by node id and fails (with the captured pytest output
  attached to the log) if it does not pass.
* ``inject_unit_tests`` — a Robot *pre-run modifier* (a ``SuiteVisitor``) that
  collects every test under ``tests/unit`` and adds one templated Robot test per
  node id into the ``Unit Bridge`` suite. Each becomes its own row in the report.

Wiring (see the workflow / README):

    PYTHONPATH=tests/integration robot \
      --listener tests/integration/listeners/screenshot_listener.py \
      --prerunmodifier pytest_bridge.inject_unit_tests \
      --outputdir results/robot tests/integration
"""
import os
import subprocess
import sys
from pathlib import Path

from robot.api import SuiteVisitor, logger
from robot.api.deco import keyword, library

# tests/integration/pytest_bridge.py -> repo root is two levels up.
ROOT = Path(__file__).resolve().parent.parent.parent
UNIT_DIR = ROOT / "tests" / "unit"


def _clean_env():
    """Environment for the pytest subprocess.

    The Robot Browser library (robotframework-browser) points
    PLAYWRIGHT_BROWSERS_PATH at its own bundled node Playwright when it loads.
    Our unit tests use the *python* Playwright (pytest-playwright), whose browser
    lives in the default cache — so we drop that var to let it resolve normally.
    """
    env = dict(os.environ)
    env.pop("PLAYWRIGHT_BROWSERS_PATH", None)
    return env

# The suite name Robot derives from `unit_bridge.robot`. The modifier only
# rewrites this suite, leaving the hand-written smoke suite untouched.
BRIDGE_SUITE = "Unit Bridge"


def collect_unit_tests():
    """Return flat pytest node ids under tests/unit.

    `-o addopts=` clears the project's `-v` (which would force tree output) so
    `-q` gives one `path::test[param]` per line.
    """
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", str(UNIT_DIR),
         "--collect-only", "-q", "-o", "addopts="],
        capture_output=True, text=True, cwd=ROOT, env=_clean_env(),
    )
    ids = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if "::" in line:
            ids.append(line)
    if not ids:
        # Surface collection failures instead of silently producing an empty suite.
        logger.warn(f"No unit tests collected:\n{proc.stdout}\n{proc.stderr}")
    return ids


@library(scope="GLOBAL")
class PytestBridge:
    """Robot library: run individual pytest unit tests as Robot keywords."""

    @keyword("Run Unit Test")
    def run_unit_test(self, nodeid):
        """Execute one pytest node id; fail the keyword if pytest does not pass.

        Runs with the project's default pytest config (pytest.ini already adds
        `--browser chromium`), so the unit test boots the game exactly as it
        does in the standalone `pytest` run.
        """
        proc = subprocess.run(
            [sys.executable, "-m", "pytest", nodeid, "--no-header"],
            capture_output=True, text=True, cwd=ROOT, env=_clean_env(),
        )
        output = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
        logger.info(output)
        if proc.returncode != 0:
            raise AssertionError(f"pytest failed for {nodeid} (exit {proc.returncode})")


class inject_unit_tests(SuiteVisitor):
    """Pre-run modifier: populate the Unit Bridge suite with one test per pytest test."""

    def start_suite(self, suite):
        if suite.name != BRIDGE_SUITE:
            return
        suite.tests.clear()  # drop the placeholder shipped in the .robot file
        for nodeid in collect_unit_tests():
            file_part, _, test_part = nodeid.partition("::")
            module = Path(file_part).stem
            test = suite.tests.create(name=f"{test_part}  ({module})")
            test.body.create_keyword(name="Run Unit Test", args=[nodeid])

    def visit_test(self, test):
        # Nothing to do per-test; the work happens in start_suite.
        pass
