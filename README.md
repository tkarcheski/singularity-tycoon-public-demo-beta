# Singularity Tycoon — Mini

A tiny browser tycoon game: run an AI data center, turn **power + cooling** into **compute**, and sell compute for cash. Reach **$1,000,000** to unlock the Dyson Sphere blueprint — the prologue to the full *Singularity, Inc.* game.

![Gameplay demo](docs/images/gameplay.gif)

*Live demo recorded from the actual game: building a power plant, coolant loop, and GPU racks, bulldozing, and swapping music vibes.*

## Play it

The game is a zero-dependency static site (vanilla JS + ES modules). No build step, no install:

```bash
git clone git@github.com:tkarcheski/singularity-tycoon-mini.git
cd singularity-tycoon-mini
python3 -m http.server 8000
# open http://localhost:8000
```

> ES modules don't load from `file://` — any static HTTP server works (`npx serve`, `php -S`, etc.).

## Documentation

| Page | What's there |
|---|---|
| [How to Play](docs/how-to-play.md) | Controls, tiles, and the goal |
| [Game Mechanics](docs/game-mechanics.md) | The economy: tick loop, formulas, and balance tables |
| [Architecture](docs/architecture.md) | Code map — rendering, state, input |
| [Audio System](docs/audio-system.md) | The procedural Web Audio music engine |
| [Known Issues](docs/known-issues.md) | Audit findings and balance caveats |

## At a glance

- **Stack:** vanilla JavaScript (ES modules), Canvas 2D, Web Audio — zero dependencies, zero build step
- **Size:** ~21 KB game logic + ~12 KB procedural audio
- **Music:** four player-selectable generative vibes synthesized at runtime (no audio files)
- **Status:** playable prototype / vibes test (`v0.1`)
