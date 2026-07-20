# Singularity Tycoon Public Demo

Run an AI data center, turn **power + cooling** into **compute**, and sell compute for cash — while balancing the **jobs your automation displaces** against the public mood. Reach **$1,000,000** to unlock the Dyson Sphere blueprint — the prologue to the full *Singularity, Inc.* game.

![Gameplay demo](docs/images/gameplay.gif)

*Live demo recorded from the actual game: building a power plant, coolant loop, and GPU racks, bulldozing, and swapping music vibes.*

# Latest Release

[Download Assets](https://github.com/tkarcheski/singularity-tycoon-public-demo-beta/releases/tag/desktop-latest)

# Development

The game itself has no build step. Start the threaded, no-cache development
server through the locked uv environment:

```bash
uv run --locked python tools/serve.py 8765
```

Open `index.html` for the legacy demo or `overhaul.html` for the connected,
tile-by-tile overhaul playtest. Remote playtesters on the development host use
`http://ai1:8765/overhaul.html`.

The overhaul opens inside a deterministic inherited datacenter. Seeded
failures turn the first minutes into a recovery job, while new blueprints stay
offline as visible worksites until the human-and-robot crew travels to the
tile, assembles it, performs final inspection and maintenance, and commissions
the structure.

That opening now continues through a persistent ten-turn campaign: recover the
inheritance, wake compute, expand the floor, reach external markets, train a
text model, fabricate its harness, activate an agent, finish a contract,
collect the invoice, and close the human-plus-AI control loop. Each turn is
completed by authoritative game state rather than a narrative Next button, and
the campaign tracker survives save and reload.

Python browser tooling is locked and managed with [uv](https://docs.astral.sh/uv/):

```bash
uv sync --locked --group test
uv run --locked --group test playwright install chromium
uv run --locked --group test pytest
```

Run the Robot Framework playtest with:

```bash
uv run --locked --group test rfbrowser init chromium
uv run --locked --group test robot --listener tests/integration/listeners/screenshot_listener.py --outputdir results/robot tests/integration
```

Run only the goal-driven local-agent playtest (observe → decide → click →
screenshot) with:

```bash
uv run --locked --group test robot \
  --listener tests/integration/listeners/screenshot_listener.py \
  --outputdir results/robot-playtest \
  tests/integration/overhaul_playtest.robot
```

Open `results/robot-playtest/report.html` for the summary or
`results/robot-playtest/log.html` for every AI decision and embedded full-page
checkpoint. Standalone PNGs are retained under
`results/robot-playtest/browser/screenshot/` and uploaded with the Robot CI
artifact.
