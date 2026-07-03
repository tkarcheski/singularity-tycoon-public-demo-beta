# Cooling Tiles + Neighbor Synergy + OSI Layers (design spec)

Second slice of #37 (cooling variants) + first step of #17/#15 (universal tile
synergy) + the OSI-layer theme from #37's vision. Stacked on the Compute Tiles
V2 branch (PR #38). Approved direction 2026-07-02: "start on the cooling tiles,
focus on the neighbor bonus effects, layout more thought out with OSI layers."

## Problem

Playtest verdict on Compute Tiles V2: TPU (the hot tile) was the most
interesting to build around — heat placement tension is the fun. But cooling
has only two tools (fan, coolant loop), neighbor effects are hardcoded
one-offs (GPU cluster, cooler-wear halving), and the palette is a flat list
with no structure teaching the player how the datacenter layers compose.

## 1. New cooling tiles (all Layer 1 · PHYSICAL)

| id | name | cost | power | cooling supply | heat drain (by dist) | upkeep | wear | gate |
|---|---|---|---|---|---|---|---|---|
| `exch` | Heat Exchanger | 150 | −2 | +18 kW | [6, 4.5, 3, 1.5] (range 3) | 0.9 | 0.22 | — |
| `immersion` | Immersion Bath | 260 | −3 | +14 kW | [12, 8] (range 1) | 1.2 | 0.18 | cash ≥ $3,000 |
| `cryo` | Cryo Plant | 1200 | −8 | +40 kW | [8, 5, 2.5] | 5.0 | 0.30 | RP ≥ 60 |

Niches:
- **Heat Exchanger** — wide-area workhorse: reaches distance 3 with a gentle
  falloff, the tile you place mid-farm. Supersedes fan walls mid-game.
- **Immersion Bath** — intense but intimate: the strongest per-tile drain in
  the game but only touching itself + orthogonal neighbors. Also carries a
  **wear-guard aura** (see §2). The TPU's best friend.
- **Cryo Plant** — the quantum enabler: 40 kW of supply for the Annealer's
  30 kW draw, gated behind 60 RP so it lands right before quantum's 120.

**Declarative heat drain**: `COOLER_DRAIN`/`FAN_DRAIN` constants and their
hardcoded branches in `computeHeatMap()` are replaced by a `drain: [...]`
array on `TILE_TYPES` (cooler `[8,5,2.5]`, fan `[4,2]`, plus the three new
tiles). Cooling-class tiles' power draw also generalizes (any tile with
`cooling > 0 && power < 0` draws after compute, like the cooler's 1 MW today).

## 2. Neighbor synergy v1 — declarative auras (#17 first step)

A per-tile `aura` descriptor, computed each tick into two grids (same field
pattern as `computeHeatMap`):

- `aura: { boost: f, range: r }` — multiplies the **output** of compute tiles
  within range (excluding tiles of the same type, so auras don't self-farm).
- `aura: { wearGuard: f, range: r }` — multiplies the **wear rate** of tiles
  within range by `f` (< 1 = protection).

Initial carriers:
- **CPU Rack** gains `{ boost: 0.06, range: 1 }` — orchestration flavor (nod
  to parked #23): a CPU next to GPUs/TPUs feeds them, +6% output each,
  total boost per tile capped at +25%.
- **Immersion Bath** carries `{ wearGuard: 0.7, range: 1 }` — submerged
  neighbors wear 30% slower. Stacks multiplicatively, floored at ×0.5
  (same ceiling as the existing GPU-next-to-cooler rule, which stays as-is).

Cell tooltips show the live synergy (`Synergy +12%` / `Wear ×0.7`). GPU
cluster bonus/heat is untouched — it remains the GPU family identity.

This gives #18 (Network Switch) and #19 (Desk rework) the field they need to
plug into later, without touching their scope now.

## 3. OSI layers — palette structure + tile classification

Every tile gets a `layer`; the palette renders grouped sections with headers
(a loose OSI homage, teaching the stack bottom-up):

- **L1 · PHYSICAL** — solar, power, fan, cooler, exch, immersion, cryo
- **L2 · COMPUTE** — gpu1, gpu2, cpu, tpu, quantum
- **L7 · PEOPLE & OPS** — desk, retrain, human, botbay
- **TOOLS** — repair, bulldoze (separate header; softens #35 until the
  real tools-tray rework)

L3 · NETWORK is reserved for #18/#20/#21 (switches, floors, topology).
Tooltips show the tile's layer badge. Tool buttons compact to a single row
(icon | name | cost) so 18 tools + headers still fit without scrolling.

New hotkeys: `r` (exch), `t` (immersion), `y` (cryo) — appended, existing
keys stable.

## Out of scope

Power tile variants (windmill, polluter #27, battery #24), network switch
(#18), desk rework (#19), floors (#20), topology (#21), futures depth (#36).

## Verification

- New pytest module `test_cooling_and_synergy.py`: exchanger drains heat at
  distance 3; immersion neighbors wear slower; cryo powers a quantum tile;
  CPU aura raises adjacent GPU output; gates enforce; save roundtrip.
- Update tool-count tests 15 → 18; palette-fit test must still pass.
- Robot smoke count update; manual LAN playtest.
