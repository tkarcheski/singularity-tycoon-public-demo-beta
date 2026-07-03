# Topology interface + hex floors (design spec)

Closes #21's first half; the engineering prerequisite for epic #44 (all five
space geometry tiers). Per docs/ROADMAP.md: extract a `Topology` interface
under the existing square grid and prove it with the square→hex floor unlock.

## Problem

Geometry is hardcoded everywhere: `NEIGHBOR_DIRS`, Manhattan distances in
heat/auras/learning, floor-division picking, axis-aligned rendering. Every
space tier (triangle→Penrose) needs a different lattice; without a seam, V2
becomes five forks of main.js.

## Design

**`TOPOLOGIES`** — each entry answers five questions:
- `dirs(y)` — neighbor deltas (row-parity-aware for hex odd-r offset)
- `dist(ax,ay,bx,by)` — lattice distance (Manhattan / hex cube distance)
- `center(x,y)` / `boardSize()` — pixel geometry relative to the grid origin
- `pick(px,py)` — pixel → cell (floor division / nearest-center scan)
- `trace(ctx,cx,cy,inset)` — the cell outline path (rect / pointy-top hexagon)

**Storage unchanged**: hex uses odd-r offset coordinates in the same
`[ROWS][COLS]` arrays — floors, saves, and `cellsOf` iteration untouched.
Existing drain arrays (`drain: [12, 8]`) index by integer lattice distance,
so they work on hex as-is.

**Per-floor topology**: `state.floorTopos[]` parallel to `state.floors[]`;
`state.topo` aliases the current floor's topology exactly like `state.grid`
aliases its grid (including inside `forEachFloor`). Existing floors and old
saves default to square.

**Unlock**: `UNLOCKS.hex` — 80 RP, "⬡ Hexagonal Lattice" button in the
Finance panel. Once unlocked, newly purchased floors are hex (6 neighbors:
denser synergy, denser heat — the tradeoff previews space tier 3). Tabs show
⬡ for hex floors.

**Known tuning note**: the GPU cluster cap (3) and aura caps are unchanged —
hex floors reach caps easier and spread heat wider. That asymmetry is the
point (see ROADMAP tier notes); per-tier cap retuning is tier-3 work, not
this PR.

## Verification

- Existing 86-test suite pins square behavior (no regressions).
- New unit tests: hex neighbor sets for even/odd rows (6 interior), cube
  distance symmetry/triangle-equality, pick(center(x,y)) roundtrip, board
  size; sim on a hex floor (place via state, assert compute + 6-neighbor
  aura/heat behavior); unlock gating; floorTopos save roundtrip + old-save
  default; zero console errors.
- Screenshot: hex floor rendering with tiles, hover, heat tint.
