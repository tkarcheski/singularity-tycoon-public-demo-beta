# Second Floor — purchasable datacenter expansion (design spec)

First slice of #20 (floor milestones / multi-layer Network). Tyler's ask
2026-07-02: "purchase a new data center floor, for 150k I can get a second
floor." Stacked on PR #39's branch.

## Problem

The 14×10 grid is the hard ceiling on ambition: once the board is full the
only progression left is research and waiting. #20's vision is floors as
mid-game expansion beats; this slice ships the first one as a *purchase*
(not an automatic milestone) so it's a decision — $150k that could have been
compute.

## Mechanics

- **Buy Floor 2** — a Finance-panel button, `FLOOR2_COST = $150,000`, one
  purchase (v1 caps at 2 floors; the $250k/+2 ladder is a later slice).
- `state.grid` (single grid) becomes `state.floors[]` + `state.floor`
  (active index); `state.grid` stays as an alias to the active floor so
  rendering, input, tooltips, and tutorial code are untouched.
- **Shared across floors**: cash, power and cooling pools, research, desk
  multiplier (cap 3 still global), sentiment/jobs, entropy, market.
- **Per floor**: heat map, synergy auras, GPU clusters, wear, bot bays
  (repair their own floor), human learning (tutored by same-floor compute).
- **Entropy events** target the active floor only (v1) — you see what
  breaks; effects are floor-tagged so an offline GPU on F1 stays offline
  when you're viewing F2.
- Sim runs **all floors every tick** in phases: supply tally per floor →
  compute draw from the shared pools per floor → global economy once.
- Visual effects (flashes/particles) only emit for the floor being viewed.

## UI

- Floor tabs (🏢 F1 / F2) float over the board once Floor 2 is owned;
  hidden before that. `PageUp`/`PageDown` also switch.
- The Finance button shows 🔒 $150,000 until affordable, then buys
  instantly; ticker announces the expansion.

## Save

`SAVE_KEYS`: `grid` → `floors` + `floor`. Loader migrates old saves
(`snap.grid` → `floors = [snap.grid]`) so nothing breaks.

## Out of scope

$250k/+2-floor ladder and the $1M rocket-factory chapter (#20), cross-floor
synergy / network switches (#18), topology changes (#21).

## Verification

pytest `test_floors.py`: buy button gated by cash; purchase creates an empty
second floor and tabs; switching floors shows independent grids; both floors
produce simultaneously (revenue from F1 while viewing F2); old-format save
migrates; new save roundtrips floors; zero console errors.

## Revision 2026-07-03 — the full ladder

Tyler's follow-up: floors 3–5 join the ladder. `FLOOR_COSTS = [150k,
300k, 500k, 750k]`, `MAX_FLOORS = 5`. One Finance button always offers
the *next* floor at its price and hides when the tower is complete; tabs
and the multi-floor sim already generalized.
