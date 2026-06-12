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
| `1`–`9` | Select tool (Power, Cooler, GPU v1, GPU v2, Desk, Retraining, Bot Bay, Repair, Bulldoze) |
| Click grid | Place selected tile / repair / bulldoze |
| Hover | Ghost preview (red = can't afford or occupied) and tile tooltips (condition, bonuses) |
| `M` | Mute music |
| Music panel | Swap vibe: Hopeful · Dark · Cinematic · Lo-fi |

## Tiles

| Tile | Cost | Effect | Upkeep | Jobs |
|---|---|---|---|---|
| ⚡ Power Plant | $80 | +12 MW | $0.60/s | +2 |
| ❄ Coolant Loop | $50 | +10 kW cooling, draws 1 MW; adjacent GPUs wear ½ as fast | $0.30/s | +1 |
| 🖥 GPU Rack v1 | $120 | +6 TFLOPS, needs 4 MW + 3 kW; +10% per adjacent GPU (max +30%) | $1.20/s | +1 |
| 🖥 GPU Rack v2 | $400 | +22 TFLOPS, needs 10 MW + 8 kW; same cluster bonus | $4.00/s | +2 |
| 👤 Engineer Desk | $220 | +15% compute output (stacks ×3 max), draws 1 MW | $0.50/s | +2 |
| 🎓 Retraining Ctr. | $150 | +8 jobs, draws 1 MW | $1.00/s | +8 |
| 🤖 Bot Bay | $350 | Auto-repairs the most-damaged tile every 4 s at a 40% discount, draws 2 MW | $0.80/s | +1 |
| 🔧 Repair | — | Fix a tile for 30% of build cost × damage | — | — |
| 🗑 Bulldoze | — | Refunds 50% of build cost | — | — |

Compute sells automatically at **$0.30/s per TFLOPS**.

## Wear, research, finance & entropy (new in v0.3)

- **Everything wears out.** Condition bars appear under damaged tiles; below 40% a tile is *worn* (output ×0.6), at 0% it's *broken* (dead until repaired, still bleeding half upkeep). Repair by hand (`8`) or automate with **Bot Bays**.
- **Research** (left panel): Power, Cooling, and Compute tracks, two levels each. Every level multiplies that class's output ×1.4 — and its wear ×1.6. Exotic tech is fragile.
- **Finance** (left panel): borrow **$1k/$5k/$25k** (repaid automatically from 10% of revenue, with interest — one loan at a time), or once you run ≥50 TFLOPS, **sell compute futures**: ~2 minutes of revenue upfront at a 25% haircut, then half your revenue is withheld until delivered. Leverage is how you escape the early +$1/s grind.
- **Entropy** (HUD meter) rises with total compute. It accelerates wear and rolls random events — power surges, coolant leaks, driver crashes, brownouts, bot glitches. The more you build, the more ways it can go wrong.

## Dev panel (god mode)

The **⚙ DEV** button (bottom-left) opens testing toggles, each independent: free build, no wear, no entropy, pin sentiment at 75, 5× speed, and a +$10k button. `window.__state` and `window.__god` expose the full sim for scripted testing.

## Jobs & public mood (new in v0.2)

Every TFLOPS you sell **displaces 0.25 jobs** in the city; your buildings create jobs. The net balance drives **Public** sentiment (the HUD meter):

| Sentiment | Mood | Effect |
|---|---|---|
| ≥ 70% | Goodwill | Utility rebate: **−15% upkeep** |
| 40–69% | Neutral | — |
| < 40% | Unrest | Power surcharge: **+25% upkeep** |
| < 25% | Protests | **Output halved** + building permits delayed 4s |

When compute scales up, displacement outpaces the jobs your tiles create — build **Retraining Centers** (or eat the penalties) to keep the city on your side. That's the trade: every dollar spent on the public is a dollar not spent on GPUs.

![How to play modal](images/04-help.png)
