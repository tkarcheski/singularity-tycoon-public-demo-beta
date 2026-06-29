# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Working style — keep me in the design loop

- **Always question and involve me in design decisions.** Before committing to an
  approach on anything non-trivial, surface the forks and ask. Use `AskUserQuestion`
  for genuine decisions rather than picking a default and running with it.
- **Brainstorm first, build second.** For features, mechanics, and balance, resolve
  the design *with me* into a fully detailed plan before writing code. Don't jump to
  implementation while the design is still open.
- **Vision dumps are starting points, not specs.** Issues like #37 are me thinking out
  loud. Decompose them, separate what's new from what's already filed, and bring the
  structure back to me to confirm scope.
- Once the discussion has resolved into a detailed, agreed plan, proceed with the work.

## Workflow

- Resolve issues one at a time; human playtests each major feature before merge.
- Tile defs live in `TILE_TYPES`, research in `RESEARCH`, sim in `tick()` — all in
  `src/main.js`. Design specs go in `docs/specs/` (see the v0.3 spec for format).
- Design tenets: everything beyond the minute-zero kit is **earned** (unlock economy);
  the early game stays gentle; complexity scales with the player's ambition.

## Testing & agents

This project has automated tests that run in CI — keep them green, and update them
when behavior changes on purpose.

- **Unit suite (pytest + Playwright):** `tests/unit/test_*.py`, config in `pytest.ini`.
  Boots `index.html` over `file://` in headless Chromium and drives the real game.
  Run: `pytest` (after `pip install -r tests/requirements.txt && playwright install
  --with-deps chromium`).
- **Integration suite (Robot Framework + Browser):** `tests/integration/smoke.robot`
  with `keywords.resource`; a listener auto-captures screenshots into `results/robot/`.
  Run: `robot --listener tests/integration/listeners/screenshot_listener.py
  --outputdir results/robot tests/integration`.
- **CI:** `.github/workflows/playtest.yml` runs both suites on every push and PR.
  Treat a red suite as a blocker.
- **Agent/test hooks:** the game exposes `window.__state`, `window.__god`, and
  `window.__research` for tests and for automated ("agent") players to drive and
  inspect the sim. Preserve these handles; tests and any play-agents depend on them.
- **Heads-up when adding tiles/tools:** tests assert exact counts that WILL change —
  e.g. the smoke test expects 12 build tools and tutorial `1 / 9`. Update the affected
  assertions (and add coverage for new tiles) as part of the same change.
