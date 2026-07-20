# Project Agent Notes

- The human playtester connects remotely. Give them `http://ai1:8765`, never a
  `localhost` URL.
- Use the repository's locked uv environment for Python work: `uv run --locked
  --group test ...`.
- The live no-cache development server runs with `uv run --locked python
  tools/serve.py 8765` and must remain threaded so a stalled browser request
  cannot block other remote requests.
- UI liveness is an end-of-tick contract. `state.tick`, `state.completedTick`,
  and `<html data-ui-tick>` must advance together, and visible HUD values must
  match state.
- Before reopening human playtesting after simulation-loop changes, run the
  short Worker Pod regression and the opt-in browser soak in
  `tests/unit/test_browser_soak.py`. CI runs the soak for 300 seconds.
- ALWAYS take the time to add complete details and keep the result clean. For
  every UI/UX change, design the information hierarchy and spacing before
  adding copy, use progressive disclosure instead of stacking text, visually
  review the rendered interface at the supported playtest viewport, and run
  clipping/readability checks. A feature is not complete merely because its
  text or control exists; it must be formatted, legible, polished, and easy to
  understand in the surrounding interface.
