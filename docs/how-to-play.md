# How to Play

You run a tiny AI data center on a 14×10 grid. Build the right tiles to turn power and cooling into compute, which auto-sells as cash. **Goal: reach $1,000,000.**

![Fresh boot](images/01-boot.png)

## First steps

1. Click **"♪ Click to enable music"** — this dismisses the overlay (you can mute afterwards; clicks don't reach the grid until it's gone).
2. Place a **Power Plant**, a **Coolant Loop**, and a **GPU Rack** next to each other (adjacency is cosmetic — pools are global).
3. Watch the HUD: GPUs only run when there's enough free power **and** cooling.

![A working base with live tooltip](images/03-tooltip.png)

## Controls

| Input | Action |
|---|---|
| `1`–`6` | Select tool (Power, Cooler, GPU v1, GPU v2, Desk, Bulldoze) |
| Click grid | Place selected tile / bulldoze |
| Hover | Ghost preview (red = can't afford or occupied) and tile tooltips |
| `M` | Mute music |
| Music panel | Swap vibe: Hopeful · Dark · Cinematic · Lo-fi |

## Tiles

| Tile | Cost | Effect | Upkeep |
|---|---|---|---|
| ⚡ Power Plant | $80 | +12 MW | $0.60/s |
| ❄ Coolant Loop | $50 | +10 kW cooling, draws 1 MW | $0.30/s |
| 🖥 GPU Rack v1 | $120 | +6 TFLOPS, needs 4 MW + 3 kW | $1.20/s |
| 🖥 GPU Rack v2 | $400 | +22 TFLOPS, needs 10 MW + 8 kW | $4.00/s |
| 👤 Engineer Desk | $220 | +15% compute output (stacks ×3 max), draws 1 MW | $0.50/s |
| 🗑 Bulldoze | — | Refunds 50% of build cost | — |

Compute sells automatically at **$0.18/s per TFLOPS**.

![How to play modal](images/04-help.png)

> ⚠️ **Balance caveat:** in v0.1 the economy is brutally tight — a lone GPU v1 costs more in upkeep than it earns. See [Known Issues](known-issues.md) before you rage-bulldoze.
