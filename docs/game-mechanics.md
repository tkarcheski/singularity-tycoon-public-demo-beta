# Game Mechanics

Everything below is read straight from `src/main.js` (v0.2).

## The tick loop

The simulation ticks every **500 ms** (`TICK_MS`). Each tick:

1. **Tally supply** — sum power (MW) and cooling (kW) from all placed tiles; count Engineer Desks; sum jobs created.
2. **Allocate to GPUs** — scan the grid top-left to bottom-right; each GPU runs only if the *remaining* pool covers its power **and** cooling draw. Allocation is first-come-first-served by grid position — there is no priority system.
3. **Coolant loops draw power** (1 MW each) *after* GPUs, so coolers never starve GPUs of power.
4. **Apply desk multiplier** — `compute × 1.15^min(desks, 3)` (max ×1.52).
5. **Jobs ledger** — `displaced = compute × 0.25`; `netJobs = created − displaced`.
6. **Sentiment drift** — sentiment moves toward `clamp(50 + netJobs, 0, 100)` at 1.5 points/s.
7. **Mood effects** — see table below; may scale upkeep and halve compute.
8. **Settle cash** — `cash += (compute × 0.30 − adjustedUpkeep) × 0.5`.

Upkeep is charged for every placed tile **whether or not it is running**.

## Jobs & public sentiment (v0.2)

| Constant | Value |
|---|---|
| `JOBS_DISPLACED_PER_TFLOPS` | 0.25 |
| `SENTIMENT_DRIFT` | 1.5 points/s |
| Starting sentiment | 60 (neutral) |
| Sentiment target | `clamp(50 + netJobs, 0, 100)` |

Jobs created per tile: Power Plant +2, Coolant Loop +1, GPU v1 +1, GPU v2 +2, Engineer Desk +2, **Retraining Center +8**.

Mood thresholds and consequences:

| Sentiment | Mood | Effect |
|---|---|---|
| ≥ 70 | Goodwill | upkeep ×0.85 |
| 40–69 | Neutral | — |
| < 40 | Unrest | upkeep ×1.25 |
| < 25 | Protest | upkeep ×1.25 **and** compute ×0.5 **and** 4 s permit delay between builds |

Design intent: early game is jobs-positive (a starter cluster nets ≈ +2 jobs → sentiment settles near 52). As compute scales, displacement dominates — around five GPU v2 racks the balance goes negative and the player must start buying Retraining Centers (each +8 jobs for $1.00/s upkeep) or absorb the penalties. The protest state costs far more than the retraining program that prevents it; that asymmetry is the deliberate jobs-vs-profit tradeoff.

## Revenue math

| Constant | Value |
|---|---|
| `REVENUE_PER_TFLOPS` | $0.30/s *(raised from $0.18 in v0.1 — the old value made the game unwinnable; see Known Issues)* |
| `TICK_MS` | 500 ms |
| Starting cash | $500 |
| Goal | $1,000,000 |
| Desk multiplier | 1.15 per desk, capped at 3 (×1.5209) |

Per-unit profitability (revenue − own upkeep, before infrastructure, neutral mood):

| Unit | Revenue/s | Upkeep/s | Net (no desks) | Net (3 desks) |
|---|---|---|---|---|
| GPU v1 | $1.80 | $1.20 | **+$0.60** | +$1.54 |
| GPU v2 | $6.60 | $4.00 | **+$2.60** | +$6.04 |

A starter build (1 plant + 1 cooler + 2× GPU v1, $370 of the $500 starting cash) nets **≈ +$0.30/s**, so the economy now bootstraps from the starting cash.

## Supply ratios

- One **Power Plant** (12 MW) runs one GPU v2 + its cooler (11 MW), or two GPU v1 + cooler (9 MW).
- One **Coolant Loop** (10 kW) cools one GPU v2 (8 kW) or three GPU v1 (9 kW).
- Desks draw 1 MW each but their multiplier applies even if the grid is power-starved (desks are counted unconditionally).

## Other rules

- **Bulldoze** refunds 50% of the build cost, rounded down.
- **Cash can go negative** — there is no floor and no game-over state.
- The GPU v2 tooltip says *"Unlocks at $5k"* but no gate is enforced; it is purchasable whenever you have $400.
- The goal bar tracks `cash / 1,000,000`; hitting it swaps the goal text and fires a celebration particle burst.
