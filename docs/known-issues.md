# Known Issues

Findings from a code + runtime audit of v0.1 (commit `9b5ab1a`, 2026-06-12). The game loads and plays with **zero console errors** — these are design/balance issues, not crashes.

## 1. ~~The economy is unwinnable~~ (fixed in v0.2)

**Fixed:** `REVENUE_PER_TFLOPS` raised from 0.18 to **0.30** — a starter cluster (1 plant + 1 cooler + 2× GPU v1) now nets ≈ +$0.30/s from the $500 starting cash. Original finding kept below for the record.

### Original finding (v0.1)

Every configuration reachable from the $500 starting cash has **negative net revenue**:

- GPU v1 earns $1.08/s but costs $1.20/s upkeep — net-negative *by itself*, before paying for its power plant and cooler.
- GPU v2 alone is also negative ($3.96 vs $4.00). It only turns profitable with 3 Engineer Desks (+52% output).
- The cheapest profitable build (2× GPU v2 + 2 plants + 2 coolers + 3 desks) costs **~$1,720** — but cash only ever declines on the way there, so it can never be afforded.

**Result:** the $1,000,000 goal is mathematically unreachable. Suggested fixes (pick one):

- Raise `REVENUE_PER_TFLOPS` (`src/main.js:22`) from 0.18 to ~0.25–0.30, or
- Cut GPU v1 upkeep below $1.08/s, or
- Raise starting cash above ~$1,800.

## 2. Cash can go negative with no fail state

`state.cash += net` has no floor. Once negative, you can't build, can't recover, and nothing tells you the run is dead. Needs either a cash floor, a bankruptcy/game-over screen, or a restart button.

## 3. GPU v2's "$5k unlock" is not enforced

The tooltip says *"Unlocks at $5k"* but the gate in `attemptPlace()` (`src/main.js:200`) is an empty `if` block. Either enforce it or drop the claim from the tooltip.

## 4. Music overlay blocks the grid

The "Click to enable music" scrim sits over the canvas; clicks on the grid are silently swallowed until it's dismissed. Players who don't want audio still have to click it. Consider a "play without music" dismiss or `pointer-events: none` on the scrim background.

## 5. No persistence

Refreshing the page loses all progress. A ~10-line `localStorage` save (grid + cash) would cover it. *(Note: the audio engine was written to be sandbox-safe and avoids localStorage by design — the save would live in the game module.)*

## Minor / cosmetic

- Flavor text says *"Adjacent tiles connect automatically"* but adjacency does nothing — pools are global.
- The starfield drifts on the sim tick (2 px/s) and is effectively static.
- Repo hygiene: no LICENSE; `.gitignore` covers only `node_modules/`.
