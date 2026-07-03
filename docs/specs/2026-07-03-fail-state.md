# Fail state — insolvency & bankruptcy (design spec)

Closes #28 (carried from the v0.1 audit). Demo-critical per docs/ROADMAP.md:
a loss condition makes every other system consequential, and the demo is the
funnel for the paid game.

## Problem

`state.cash += net` has no floor. A dead economy silently bleeds forever —
the player can't tell the run is over and has no way to end it.

## Design

A loss should be legible and *escapable until it isn't*:

1. **Insolvent** — the moment `cash < 0`: a persistent warning banner over
   the board: "⚠ INSOLVENT — sell tiles or take a loan · bankruptcy in Ns",
   counting down `BANKRUPT_AFTER_S = 60` seconds of sim time (scales with
   the 5× god dial like everything else). Ticker announces it once.
   Recovery: cash back to ≥ 0 (bulldoze refunds 50%, loans still work if
   available) clears the state and resets the timer.
2. **Bankrupt** — countdown reaches zero: full-screen overlay (reuses the
   modal styling): "💀 BANKRUPTCY", run stats (peak cash, TFLOPS, floors,
   ticks survived), and one button — **Start over** — which clears the save
   and reloads. No dismissing it; the run is dead.
3. **Suspensions**: god.freeBuild suspends the countdown (dev testing).
   Loans already count as cash, so a loan legitimately buys time — that's
   the finance system working, not a loophole.

## Implementation notes

- `state.insolvencyS` accumulates `dtS` while `cash < 0`, resets at ≥ 0;
  bankruptcy at `>= BANKRUPT_AFTER_S`. Persisted in SAVE_KEYS so reloading
  mid-crisis doesn't reset the clock.
- Banner: absolute div over the stage (like floor tabs); updates each HUD
  refresh; hidden while solvent.
- Overlay: new `#gameover` div, `hidden` by default; shown once,
  `state.bankrupt = true` stops further sim damage-dealing (tick keeps
  running for the background glow but building/economy input is moot).
- Track `state.stats.peakCash`, reuse existing stats object.

## Verification

pytest: banner appears when cash forced negative and disappears on recovery;
insolvencyS accumulates and persists across reload; overlay fires after the
countdown (accelerated via god 5×/direct state); Start over resets to $500
fresh state; freeBuild suspends; zero console errors.
