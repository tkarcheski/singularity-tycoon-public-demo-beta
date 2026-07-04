# Singularity Tycoon — Full Game Roadmap

Decided with Tyler 2026-07-03 (design session + four-lens design panel review).
This is the durable version of that conversation: every locked decision, every
proposal awaiting playtest, and the production track. The one-line arc:

> **Demo:** build an AI datacenter empire on Earth until the Dyson Sphere
> blueprint. **Full game:** rebuild civilization's compute in space — new
> geometry every tier, materials you must mine and launch, and an economy
> where sharing makes everyone grow faster.

## Locked decisions

| Decision | Answer |
|---|---|
| Demo cut line | **The current build (v0.6-era) IS the demo.** Everything from here forward is the paid full game. |
| Pricing | **$0.99 base + $0.99 DLC packs** — a pocket-money ladder. Revisit once (and only once) when wishlist data exists; price can never move down gracefully. |
| Prestige carry-over | **Research + blueprint**: research unlocks persist into space; the player exports one earned "blueprint module" from their best ground floor. Keep mastery, lose stuff. |
| Old stations on tier-up | **Player's choice: sell or keep** — keeping means managing the growing empire (upkeep, wear, events across all owned stations). |
| Space tier geometry | Five tiers: **triangle → square → hex → octagon-square (semiregular) → Penrose (aperiodic)**. |
| Materials chain | **Fully abstract for the prototype phase** (refinery/fab tiles convert stockpiles); deepen toward spatial routes as playtests demand. |
| Minigame style | **Decide by playtest** — build both a dispatch loop (drone missions resolve over sim ticks) and a small shooter prototype; ship whichever feels right, keep the other optional. |
| Session shape | **Decide by playtest** (active-only vs offline accrual vs idle-first) — blocks logistics timer tuning, nothing else. |
| Multiplayer | **Phased pillar, open-source themed**: Workshop blueprint sharing → shared research commons ("open-sourcing" compute grows the game for everyone) → live co-op only if earlier phases prove out. |

## The five space tiers

Panel rule adopted: **every tier ships one new verb and one new constraint,
stated in a single sentence, before any code.** Proposed sentences (each is a
playtest hypothesis, not gospel):

1. **T1 · Triangle (3 neighbors)** — *Vacuum kills convection*: fans are dead,
   radiators only work with a vacuum-exposed edge → perimeter-to-area becomes
   the signature stat. Triangle = cooling-rich, synergy-sparse.
2. **T2 · Square (4)** — *Orientation matters*: solar flux has a facing;
   orbital day/night swings are harsher than Earth's sun cycle.
3. **T3 · Hex (6)** — *Density cuts both ways*: synergy-dense but heat
   spillover dominates; adjacency caps re-tuned per tier so packing stays a
   puzzle instead of saturating.
4. **T4 · Octagon-square (mixed 4/8)** — *Two cell classes*: large octagon
   cells host heavy machinery, small squares host infrastructure —
   heterogeneous adjacency planning.
5. **T5 · Penrose (aperiodic)** — *No repeating layouts*: every station is
   site-specific; no blueprint stamps — the endgame mastery test. Exotic
   endgame materials live here.

Engineering prerequisite: extract a `Topology` interface
(`cells / neighbors / dist / cellToPixel / pickCell`) under the existing
square grid first, and prove it with the already-backlogged square→hex unlock
(#21) before any space content. Triangle tier may ship as a hand-authored
board (precomputed neighbor lists) rather than a general tri-lattice engine.

## Space economy

- **Three currencies, three sinks**: cash pays for launches (Earth remains the
  revenue engine forever), **exotic materials** build space tiles, **RP**
  unlocks geometry tiers. Materials are a parallel constraint, not a
  replacement currency — the token market, sentiment, and UBI stay load-bearing.
- **Logistics v1 is exactly three things**: Launch Pad tile, Receiver Dock
  tile, upgradable route capacity (tons/day). No conveyor engine.
- **Asteroid mining**: dispatch missions (target + drone loadout, risk/yield,
  resolves over sim ticks, failures feed the entropy event system) and/or the
  shooter — per playtest decision above.
- Chain: raw → refined → chips, abstract converters first.

## Content & DLC map (fits the $0.99 ladder)

- **Base game ($0.99)**: ground game + space T1–T2, dispatch mining, abstract chain.
- **Pack: The Network** — T3 hex + universal synergy (#17), network switch (#18), desk rework (#19), cross-floor/station links (fills L3 · NETWORK).
- **Pack: Heavy Industry** — T4, deeper material chains, power variants (polluter #27, battery #24, windmill), research eras (#32).
- **Pack: The Lattice** — T5 Penrose, Dyson endgame, rocket-factory chapter (#20 finale).
- **Free updates**: minigames, lore pass (#33), QoL (tools tray #35, bot bay buff #34, sparkline #22 + futures depth #36, fail state #28 — fail state should land in the demo too).

## Production track (the work nobody files issues for)

1. **Save v2 + migration** — `_v:2`, read v1 forever. Also fix TODAY's landmine:
   a version-mismatched save is silently discarded and then overwritten by the
   5s autosave. Paid product = refund bait.
2. **Steam wrapper spike** (Tauri/Electron) — one achievement + one cloud-save
   roundtrip with the current demo, months before submission; audio engine is
   the likeliest webview divergence.
3. **Module split** — the one-file zero-build style has served the prototype;
   V2's scope (6–10k lines) needs a scene stack (~20 lines) and per-feature
   classic-script files under a namespace. file:// playability stays.
4. **Funnel** — itch.io web demo now (zero cost, the file:// build is a
   marketing weapon); Steam page + wishlist CTA at the demo's Dyson-blueprint
   end screen; **Next Fest is once per title ever** — spend the slot only after
   the space-tier teaser exists.
5. **Positioning** — "Dyson Sphere Program meets Mini Metro," with the
   sentiment/UBI/entropy satire foregrounded so the AI theme reads as
   commentary. The satire is the moat.

## Open questions (parked until playtest data exists)

- Per-tier rule sentences above: validate each with the god-panel fast-forward
  before building the next.
- Session shape (drives logistics timers and offline accrual).
- Minigame: dispatch vs shooter vs both.
- Economy behavior during minigames (pause / normal / reduced tick).
- Multiplayer phase 2+ scope (shared research commons design).
- Price revisit checkpoint: after first 5,000 wishlists or Next Fest, whichever first.

## Revision 2026-07-04 — the full OSI ladder (Tyler's design session)

The layer plan is now explicit, replacing the loose L1/L2/L7 homage:

| Layer | Theme | Status |
|---|---|---|
| L1 · PHYSICAL | power, cooling, walls, floors, vacuum | shipped, deepening (#61: per-floor power + Power Transfer blocks, distance-based transmission loss) |
| L2 · COMPUTE | silicon families, degradation physics | shipped; degraded machines now lose FLOPS **and draw more power** |
| L3 · NETWORKING | machines talk: CPUs link GPU groups, linked-cluster size bonuses; station comms isolated | #62 (absorbs #18/#23/#19) |
| L4 · DATA | agents: self-improvement beyond ×2 must be SAVED into deployed data blocks; local agents join clusters like human workers | #63 |
| L5 · ROBOTICS | physical robots repair and cut maintenance | #64 (evolves #34) |
| L6 · APPLICATION | what the compute runs | #65 (placeholder) |
| L7 · BUSINESS | markets, contracts, competition | #65 (placeholder) |

Balance directive: maintenance must cost — ≥7.5% Maintain allocation to
hold steady, more to catch up (shipped); robots (L5) are how you buy that
number back down.
