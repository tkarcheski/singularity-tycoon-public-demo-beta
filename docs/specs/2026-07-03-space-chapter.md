# Space Chapter foundations — walls, vertical effects, the first station (design spec)

Tyler's session ask 2026-07-03: cross-floor neighbor bonuses (tile-dependent,
networking tiles later; immersion cooling now), wall/perimeter integration for
cooling tiles, and reaching space datacenters this session. First playable
slice of epic #44.

## 1. Wall integration — perimeter cooling bonus

Cooling tiles placed on the board edge exchange heat through the building
envelope: **cooling supply ×1.25 on the perimeter** (`PERIMETER_COOL_BONUS`).
On space floors the wall is a vacuum-exposed radiator: **×1.5**
(`VACUUM_WALL_BONUS`). Tooltip shows the live "Wall-mounted" row. Same
edge test for every topology (offset storage shares the rectangular hull).

## 2. Cross-floor vertical effects

Floors stack physically: cell (x,y) on floor f is vertically adjacent to
(x,y) on f±1. The capability is **per-tile**, the seam networking tiles
(#18/#45) will use later for cross-floor compute orchestration:

- `aura: { ..., vertical: true }` — the aura also applies to the two
  vertically adjacent cells (treated as distance 1).
- `vDrain: true` — a cooling tile also drains the vertically adjacent
  cells at `drain[1]` strength (one step away through the floor plate).
- **Immersion Bath** gets both — a chilled column through the building.
  CPU orchestration stays same-floor until networking tiles exist.

Implementation: aura and heat computation move from per-floor passes to
all-floors passes (`computeAllAuraMaps` / `computeAllHeatMaps`) so vertical
projection can reach f±1; per-floor results land in the same by-floor arrays
tick() already consumes.

## 3. 🛰️ Space Station — tier 1

- **Purchase**: Finance button, `SPACE_STATION_COST = $250,000`, requires the
  Dyson blueprint (`goalUnlocked`) — the demo's cliffhanger becomes a door.
  One station in this slice.
- **Triangle lattice** (`tri` topology): up/down triangles in the same
  [ROWS][COLS] storage — up when `(x+y)` is even. 3 neighbors (left, right,
  and base-sharing row above/below). Distance = memoized BFS (provably
  correct; ~small table). Picking = per-band point-in-triangle. Tier-1's
  constraint per ROADMAP: connectivity-poor, perimeter-rich.
- **Vacuum rules** (`floorSpace[f]`):
  - **Fan walls can't be placed** (no air) — ticker explains.
  - **No convective heat spread** between neighbors (`HEAT_SPREAD → 0`).
  - **Solar: constant ×1.3** — no day/night ebb in orbit.
  - **Radiation wear ×1.25** on everything.
  - Perimeter cooling ×1.5 (radiators, above).
- Tabs show 🛰️; station floor topos save as `tri` + `floorSpace` array
  (additive; old saves default false/square).

## Out of scope (next slices of #44/#45)

Blueprint carry-over UI, exotic materials/launch costs, dispatch mining,
networking tiles, tiers 2+.

## Verification

pytest per feature: perimeter supply delta + tooltip; vertical wearGuard/
drain reach f±1 while CPU boost doesn't; tri lattice unit tests (3 neighbors,
parity, BFS-dist metric + adjacency=1, pick↔center roundtrip); station gating
(goalUnlocked + cash); vacuum rules (fan blocked, flat solar, no spread);
save roundtrip with tri/space; zero console errors. Screenshots of the
station. Adversarial multi-lens review before PR.
