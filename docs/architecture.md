# Architecture

A deliberately tiny, zero-dependency prototype: no framework, no bundler, no package.json. Four source files.

```
index.html              # layout: toolbar, canvas stage, HUD, music panel, modal
src/
  main.js     (~600 ln) # game: state, sim tick, canvas renderer, input, UI
  style.css   (~480 ln) # dark sci-fi theme, CSS custom properties
  audio/
    index.js            # audio bootstrap — vibe registry + small API for the game
    audio-engine.js     # GameAudio: reusable adaptive-layer Web Audio engine
    synth-recipes.js    # four procedural music generators
audio/
  BRIEF.md              # audio design brief (docs only — no audio assets exist)
  BRIEF_TEMPLATE.md
```

## main.js layout

One script, organized in commented sections:

| Section | What it does |
|---|---|
| Constants | `TILE_TYPES` table (cost/power/cooling/compute/upkeep per tile), grid size 14×10, `TICK_MS` 500 |
| State | Single `state` object: cash, `grid[row][col]` of tile-type ids, hover, particles, flashes |
| Toolbar | DOM-built tool buttons from `TOOL_ORDER`; re-rendered on selection |
| Input | Canvas mouse → grid cell picking; keys `1`–`6` and `M` |
| Sim | `tick()` on a 500 ms `setInterval` — see [Game Mechanics](game-mechanics.md) |
| Render | `requestAnimationFrame` loop, dt-clamped: starfield, tiles, hover ghost, particles, flash decay |
| UI | Tooltip, ticker toasts (5.2 s lifetime), help modal, HUD updates |

Two clocks run independently: the **sim** (fixed 500 ms interval) and the **renderer** (rAF with `dt` clamped to 50 ms). Visual effects (particles, flashes) live in `state` but are advanced by the render clock.

## Rendering notes

- Canvas is resized to `devicePixelRatio` on load/resize; all drawing uses CSS-pixel coordinates via `setTransform`.
- The grid is centered with `gridOrigin()`; tiles are flat-color rects + hand-drawn vector glyphs (`drawGlyph`), no sprite assets.
- Tile placement feedback: accent-colored flash (decays at 2.4/s) + radial particle burst.

## What there isn't (by design, v0.1)

- No save/load or persistence of any kind
- No pause, speed controls, or game-over state
- No adjacency mechanics — power/cooling are global pools despite the "adjacent tiles connect" flavor text
