# Space realism — life support & vacuum power (design spec)

Closes #53. Playtest verdict on the space chapter: 6/10 — the station lacks
simulation coherence. This slice makes vacuum a *rules regime*, not a skin:
people need air, fire needs oxygen, and the only honest power sources in
orbit are the sun and the atom.

## 1. 🫧 Life Support Module (`life`, L7 · People & Ops, key `u`)

$400 · −3 MW · upkeep $1.5/s · wear 0.2. Projects a breathable field,
lattice distance ≤ 2 (`LIFE_RANGE`).

On **space floors only**: people tiles (`human`, `desk`, `retrain`) outside
every working field are **suffocating** — they contribute nothing (no
tokens, no desk multiplier, no jobs, no learning) but still cost upkeep.
Tooltip shows "🫧 NO AIR"; the tile gets a red warning veil. Bot bays are
robots and don't care. On Earth the module is placeable but pointless
(the desc says so) — blueprints may carry one up later.

## 2. Combustion dies in vacuum

The standard Power Plant burns fuel: **unplaceable on stations** (ticker:
no oxygen) and **inert if imported** via an old save — same treatment as
fans. Solar already behaves realistically (constant orbital ×1.3).

## 3. ☢️ Fission Core (`fission`, L1 · Physical, key `i`)

$1,500 · **+30 MW** · heat **12** · upkeep $6/s · wear 0.25 · gate 100 RP.
The station's serious power source — and with vacuum heat retention ×2 and
no convection, its 12 heat makes reactor placement the sharpest thermal
puzzle in the game. Works on Earth too (cheap MW, entropy-feeding heat).

## Notes

- Coverage is a per-space-floor boolean map computed each tick (same field
  pattern as auras); `state.lifeMap` exposed for tooltip/rendering.
- Palette grows 15 → 17 tools (count tests update; layout re-verified).

## Verification

pytest: uncovered pod produces 0 tokens / covered produces; desk multiplier
and jobs gated by air; plant blocked + inert in vacuum; fission gate, supply
and heat; save roundtrip; palette fit; zero console errors.
