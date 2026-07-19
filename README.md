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
