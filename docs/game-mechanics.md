# Game Mechanics

Everything below is read straight from `src/main.js` (v0.3).

## The tick loop

The simulation ticks every **500 ms** (`TICK_MS`). Each tick:

1. **Expire timed effects** (driver crashes, brownouts, bot glitches).
2. **Tally supply** — power and cooling, each scaled by research (×1.4^level) and tile condition; broken tiles supply nothing but bleed half upkeep; sum jobs created.
3. **Allocate to GPUs** — scan top-left to bottom-right; each working GPU runs if the *remaining* pool covers its draw. Output scales with research, condition, and the cluster bonus (+10% per adjacent working GPU, max +30%); brownouts apply ×0.8.
4. **Coolant loops (1 MW) and Bot Bays (2 MW) draw power** *after* GPUs, so they never starve compute.
5. **Apply desk multiplier** — `compute × 1.15^min(desks, 3)` (max ×1.52).
6. **Jobs ledger** — `displaced = compute × 0.25`; `netJobs = created − displaced`.
7. **Sentiment drift** — toward `clamp(50 + netJobs, 0, 100)` at 1.5 points/s; **mood effects** may scale upkeep and halve compute.
8. **Entropy** — `100 × (1 − e^(−compute/150))`; rolls a failure event with probability `0.06 × entropy01^1.5`.
9. **Wear** — each tile loses `baseWear × 1.6^techLevel × (1 + 2 × entropy01)` condition/s; GPUs next to a working cooler wear ×0.5.
10. **Bot bays** — every 8 ticks, each powered bay repairs the most-damaged other tile +15 condition, auto-paying 60% of the manual rate.
11. **Settle cash** — gross revenue (`compute × 0.30`), minus futures withholding (50% of gross until delivered), minus debt service (`max(10% of gross, $0.5/s)`), minus adjusted upkeep.

Upkeep is charged for every placed tile **whether or not it is running** (half, if broken).

## Wear & repair (v0.3)

| Tile | Base wear/s | Full half-life* |
|---|---|---|
| GPU racks | 0.42 | ~4 min (~8 min cooled) |
| Coolant Loop | 0.25 | ~7 min |
| Power Plant | 0.18 | ~9 min |
| Bot Bay | 0.12 | ~14 min |
| Desk / Retraining | 0.08 | ~21 min |

*time from 100→0 at zero entropy, tech I.

Condition < 40: output ×0.6 (worn). Condition 0: broken — inert until repaired. Manual repair (`8`): `30% × build cost × damage`. Bot bays pay 60% of that rate.

## Token market (v0.5)

`tokenPrice = 0.30 × demand × market` where `demand = 0.6 + 0.008 × sentiment`
(×1.0 at sentiment 50, ×1.4 at 100, ×0.6 at 0) and `market` is a mean-reverting
random walk clamped to 0.85–1.15. A happy city buys more tokens — jobs are the
engine of demand. Futures advances also price at the live token price.

## Heat (v0.4)

Per-tile temperature, recomputed each tick. Working GPUs emit 3/8 (v1/v2) and
plants 4; half of a neighbor's emission bleeds over. Coolant Loops drain 8/5/2.5
at Manhattan distance 0/1/2 (scaled by Cooling research) — **the closer the
loop, the cooler the tile**. Net heat caps at 10 → `heat01`.

Effects: wear ×(1 + heat01); average source-tile heat adds `0.35 × avgHeat` to
entropy01; tiles are tinted red-orange by temperature. GPU clusters also need
+15% cooling per adjacent GPU. GPU token output scales continuously with
condition (`0.4 + 0.6 × cond/100`); supply tiles keep stepped output.

## Research (v0.3)

| Track | Level II | Level III | Effect per level |
|---|---|---|---|
| Power | $600 | $3,000 | plant output ×1.4 · plant wear ×1.6 |
| Cooling | $500 | $2,500 | loop output ×1.4 · loop wear ×1.6 |
| Compute | $800 | $4,000 | GPU output ×1.4 · GPU wear ×1.6 |

## Finance (v0.3)

- **Loans** (one at a time): $1,000→repay $1,300 · $5,000→$6,750 · $25,000→$35,000. Serviced automatically from `max(10% of gross revenue, $0.5/s)`.
- **Compute futures** (unlock at 50 TFLOPS, one at a time): advance = `75% × revenue/s × 120s`; afterwards 50% of gross revenue is withheld until the full undiscounted amount is delivered.

## Entropy events (v0.3)

Available events depend on what you own — more equipment, more failure modes:

| Event | Requires | Effect |
|---|---|---|
| ⚡ Power surge | ≥2 plants | random plant −30 condition |
| 💧 Coolant leak | ≥1 cooler | cooler −25, adjacent GPUs −10 |
| 🖥 Driver crash | gpu2 or Compute ≥ II | one GPU offline 8 s |
| 🌆 Brownout | entropy > 70 | all GPU output ×0.8 for 10 s |
| 🤖 Bot glitch | ≥1 bay, entropy > 50 | one bay offline 10 s |

Events floor condition at 5 — they never instantly brick a tile.

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
- The goal bar tracks `cash / 1,000,000`; hitting it swaps the goal text and fires a celebration particle burst.
- **Dev god modes** (⚙ DEV panel / `window.__god`): free build, no wear, no entropy, pin sentiment, 5× speed — each an independent toggle for testing.
