# Compute Tiles V2 — CPU / TPU / Quantum (design spec)

First slice of issue #37 ("compute tiles V2"). Approved plan 2026-07-02.
Scope: compute tiles only — cooling/power/networking variants from #37 come later.

## Problem

There is exactly one way to make compute: GPUs. Every base converges on the same
gpu1 → gpu2 farm; there is no strategic choice in *what kind* of compute to build.
#37 asks for a wider compute family where each silicon type has different power /
cooling / heat / wear needs, so board layout and infrastructure become decisions.

## New tiles

| id | name | cost | power | cooling | compute | upkeep | wear | heat | gate |
|---|---|---|---|---|---|---|---|---|---|
| `cpu` | CPU Rack | 60 | −2 MW | −1 kW | 3 TF | 0.5 | 0.25 | 1 | — |
| `tpu` | TPU Pod | 700 | −12 MW | −14 kW | 40 TF | 6.0 | 0.38 | 6 | cash ≥ $8,000 |
| `quantum` | Quantum Annealer | 2500 | −20 MW | −30 kW | 90 TF | 12.0 | 0.60 | 2 | RP ≥ 120 |

Niches (why each earns its slot — not reskinned GPUs):

- **CPU Rack** — the safe, boring tile. Same TF-per-$ as gpu1 but half the wear,
  a quarter of the heat, minimal infra draw, and **no cluster heat**. Early-game
  filler and low-entropy ballast. No cluster bonus either — steady, not scalable.
- **TPU Pod** — efficiency at scale: best compute-per-MW in the game (0.30 MW/TF
  vs gpu2's 0.45). No cluster mechanics at all. Runs hot (heat 6), so placement
  near coolant matters more than adjacency to its own kind.
- **Quantum Annealer** — exotic endgame density: 90 TF in one cell when board
  space is the binding constraint. Cryogenic: tiny heat *emission* (2) but a
  monstrous **30 kW cooling draw** — it starves the shared cooling pool rather
  than heating neighbors. Highest wear in the game (0.60): fragile, feeds the
  repair/Bot Bay economy. Gated behind 120 RP so research allocation earns it.

**APU: skipped.** No niche distinct from CPU at this tile count; park until the
cooling/power slices of #37 give hybrids something to trade against.

GPUs keep the cluster bonus/heat as their unique identity (`GPU_ADJ_*` unchanged,
still gpu1/gpu2 only).

## Mechanics changes

- **Generalize the compute loop** (`tick()`, and `computeType()`): replace the
  `isGpu(t)` gate with `isCompute(t)` = `TILE_TYPES[t].compute > 0`. All compute
  tiles draw power/cooling, apply research (`compute` track) and condition, and
  contribute TFLOPS. Cluster bonus/heat remain inside an `isGpu` check.
- **Heat**: add `cpu: 1, tpu: 6, quantum: 2` to `HEAT_SOURCE`.
- **Unlocks**: add `tpu: { cash: 8000 }`, `quantum: { rp: 120 }` to `UNLOCKS`;
  tiles carry `gate:` keys. Existing `tryUnlock()`/palette handle the rest.
- **Palette**: add to `TOOL_ORDER` after `gpu2`; extend `TOOL_KEYS` with
  `q`, `w`, `e` (12 → 15 tools). Add `toolStat()` and `iconSvg()` branches.
- **Events**: "Driver crash" precondition widens from gpu2 to any gated compute
  tile owned (unchanged otherwise).
- **Saves**: additive tile ids — old `stm-save-v1` saves load unchanged. New
  unlock keys are undefined-guarded on load already.

## Out of scope (rest of #37, parked for later slices)

Cooling variants (heat exchangers, liquid loops), power variants (windmill,
plant-scale footprints), networking/floors, training-vs-inference split,
human/robot proximity effects, OSI-layer theming.

## Verification

- pytest unit suite: update `test_boot.py` tool count 12 → 15; re-check
  `test_ui_layout.py` palette fit; new `test_compute_tiles.py` — place each new
  tile (via extended hotkeys), assert TFLOPS rises, power/cooling pools drop,
  unlock gates enforce, save/load roundtrips a grid containing new tiles.
- Robot smoke + manual playtest over the LAN server; god panel (free build,
  5× speed) to fast-forward balance feel.
