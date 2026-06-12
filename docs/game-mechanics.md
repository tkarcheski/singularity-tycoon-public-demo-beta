# Game Mechanics

Everything below is read straight from `src/main.js` (v0.1, commit `9b5ab1a`).

## The tick loop

The simulation ticks every **500 ms** (`TICK_MS`). Each tick:

1. **Tally supply** — sum power (MW) and cooling (kW) from all placed tiles; count Engineer Desks.
2. **Allocate to GPUs** — scan the grid top-left to bottom-right; each GPU runs only if the *remaining* pool covers its power **and** cooling draw. Allocation is first-come-first-served by grid position — there is no priority system.
3. **Coolant loops draw power** (1 MW each) *after* GPUs, so coolers never starve GPUs of power.
4. **Apply desk multiplier** — `compute × 1.15^min(desks, 3)` (max ×1.52).
5. **Settle cash** — `cash += (compute × 0.18 − totalUpkeep) × 0.5`.

Upkeep is charged for every placed tile **whether or not it is running**.

## Revenue math

| Constant | Value |
|---|---|
| `REVENUE_PER_TFLOPS` | $0.18/s |
| `TICK_MS` | 500 ms |
| Starting cash | $500 |
| Goal | $1,000,000 |
| Desk multiplier | 1.15 per desk, capped at 3 (×1.5209) |

Per-unit profitability (revenue − own upkeep, before infrastructure):

| Unit | Revenue/s | Upkeep/s | Net (no desks) | Net (3 desks) |
|---|---|---|---|---|
| GPU v1 | $1.08 | $1.20 | **−$0.12** | +$0.44 |
| GPU v2 | $3.96 | $4.00 | **−$0.04** | +$2.02 |

A full GPU v2 cluster (rack + its share of plant + cooler) nets **+$1.12/s with 3 desks** — that is the only profitable configuration in v0.1. See [Known Issues](known-issues.md) for why this makes the $1M goal unreachable from $500.

## Supply ratios

- One **Power Plant** (12 MW) runs one GPU v2 + its cooler (11 MW), or two GPU v1 + cooler (9 MW).
- One **Coolant Loop** (10 kW) cools one GPU v2 (8 kW) or three GPU v1 (9 kW).
- Desks draw 1 MW each but their multiplier applies even if the grid is power-starved (desks are counted unconditionally).

## Other rules

- **Bulldoze** refunds 50% of the build cost, rounded down.
- **Cash can go negative** — there is no floor and no game-over state.
- The GPU v2 tooltip says *"Unlocks at $5k"* but no gate is enforced; it is purchasable whenever you have $400.
- The goal bar tracks `cash / 1,000,000`; hitting it swaps the goal text and fires a celebration particle burst.
