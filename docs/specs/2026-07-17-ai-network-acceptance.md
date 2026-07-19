# Fourth AI network acceptance contract

Date: 2026-07-17

The AI network is a fourth physical network beside power, cooling, and data.
It is not a global percentage toggle. A facility receives AI assistance only
when it opts in and has an explicit connected path through AI Link structures
to an AI Controller. Disconnected and opted-out facilities keep their base
behavior and cannot receive AI-origin faults.

This contract is an active part of the overhaul playtest gate. The public
schema, deterministic scenarios, persistence, and real UI satisfy every
assertion below without expected-red markers.

## Public schema

The existing overhaul snapshot adds:

```text
ai:
  level: number >= 0
  xp: number >= 0
  nextLevelXp: number > xp
  bonusPercent: number >= 0
  efficiencyMultiplier: number >= 1
  mistakeChance: number in [0, 1]
  enabledCount: number >= 0
  connectedCount: number >= 0
  totalFaults: number >= 0
  lastFaultTick: number | null
  activeFaults[]:
    faultId, entityId, kind="ai-mistake", raisedTick, repairRemaining

structures[]:
  aiEnabled: boolean
  aiConnected: boolean
  aiEfficiencyMultiplier: number >= 1
  aiFault: string | null
  baseMetrics: object
  effectiveMetrics: object

networks.ai.paths[]:
  id, source, target, from, to, cells, connected, enabled, capacity,
  delivered, status
```

Controller and link structures use blueprint IDs `ai_controller` and `ai_bus`
on the `ai` layer. The core supports these validated player-equivalent
commands:

- `{type: "set-ai-enabled", entityId, enabled}`
- `{type: "repair-ai-fault", entityId}`

The named scenarios are `ai-opted-out-manual` and `ai-risk-reward`.
`ai-opted-out-manual` builds a connected physical system but leaves AI disabled.
`ai-risk-reward` uses only player-equivalent actions and deterministic ticks to
show the disconnected baseline, explicit AI path and opt-in, bonus, seeded
fault, repair/recovery, and training-improved risk. Scenario output includes
`snapshots[]` and may include `events[]`; its last snapshot is authoritative.

## Physical topology and participation

- A connected path names one real controller as `source`, one opted-in target
  as `target`, and the ordered cells traversed by explicit AI Bus structures.
- An opted-out target on an otherwise complete physical controller/bus route
  retains its source, cells, and capacity telemetry but reports
  physical `connected=true`, `enabled=false`, `status="disabled"`, and zero
  delivery. The target's applied `aiConnected` remains false until opt-in.
- A controller elsewhere on the floor grants no connectivity by proximity.
- Each structure opts in or out independently. Opting out does not disable a
  neighboring structure.
- Disconnected or opted-out structures have `aiEfficiencyMultiplier == 1`, no
  effective-vs-base increase, and `aiFault == null`.

## Truthful effects and faults

- Connected opted-in power, cooling, data, and compute structures each report
  `aiEfficiencyMultiplier == ai.efficiencyMultiplier > 1`; their effective
  power generation, cooling generation, data capacity, or raw compute metric
  is strictly higher than the opted-out baseline. Data raises the real path
  bottleneck and compute raises real raw FLOPS; fixed demand or downstream link
  capacity may cap delivered power/cooling without falsifying source telemetry.
- AI changes must not create FLOPS: raw FLOPS still equal Sell + training +
  jobs + reserved + idle + loss with non-negative buckets.
- A named seed produces the same early `ai.activeFaults[]` kind, target, and raised tick on
  replay. Different comparison seeds may vary, but a fault never targets a
  disconnected or opted-out structure.
- Repair is a real transition: `repairRemaining` counts down, the fault leaves
  `activeFaults`, the target clears `aiFault`, and connected assistance becomes
  productive again.
- Training strictly increases level and bonus while strictly reducing mistake
  chance. All three values survive snapshot restore exactly.

## Persistence and determinism

`createOverhaulGame({snapshot})` validates and restores the same public state
used by a normal reload. Snapshot -> new core -> snapshot is deeply equal for topology,
opt-ins, training, active/repaired faults, route telemetry, economy, and FLOPS.
No duplicate path, fault, or efficiency application appears after restore.

## Semantic UI

At 1100x700 the page exposes a visible AI Controller, AI Link construction,
AI network status, per-structure opt-in control/state, training level, bonus,
mistake chance, fault/repair state, and efficiency text without clipping.

AI topology uses semantic path hooks and a distinct cell trace:

```html
<path data-ai-path-id="..." data-ai-path-state="connected|blocked|idle">
<span data-cell-utility="ai"></span>
<section data-ai-panel data-ai-state="..."></section>
<div data-ai-target="entityId" data-ai-enabled="..." data-ai-connected="..."></div>
<div data-ai-hud data-ai-quality="..." data-ai-bonus="..." data-ai-risk="..."></div>
```

The cell AI trace is a thin line on the left edge. It never replaces the
central facility actor/structure and is visually distinct from the power,
cooling, and data utility traces. Reduced semantic state remains available
when animation is disabled.

Committed raw/completed/DOM ticks continue to agree while the AI UI is live.
The browser emits no page error, `console.error`, or unhandled rejection.

## Active gate policy

- Missing AI schema, scenarios, commands, restore behavior, or DOM hooks are
  normal red failures; there are no expected-red AI mechanics.
- Comparisons remain causal and semantic; visual-only placeholders do not
  satisfy this contract.
- The fourth network runs in the normal non-soak overhaul gate.
