# Overhaul first playtest acceptance contract

Date: 2026-07-17

This is the first coherent playable gate for the new architecture at
`overhaul.html`. It is deliberately narrower than the complete game. The gate
proves that a seeded physical opening can become a connected computer, route
real FLOPS into a sale through Floor 1 fiber, and expose a truthful, responsive
UI. It also pins the semantic actor and economy hooks needed for the next
playtest rather than accepting a visual-only mockup.

## Player journey under test

1. Start a run from a named seed and receive a deterministic, viable selection
   of starting tile unlocks.
2. Read the owned connected footprint and purchase one cell from its frontier.
3. Select a visible blueprint and legal owned cell, then use the visible Place
   action to build through the same UI flow as a player.
4. Build an explicit power path, cooling path, and data path to a computer.
5. Watch that computer move through **off → booting → loaded**, then report
   positive raw FLOPS.
6. Attempt to sell without Floor 1 fiber and receive a visible, semantic block.
7. Connect Floor 1 fiber, route FLOPS to Sell, and receive saleable output.
8. Confirm every raw FLOP is routed, idle, reserved, or explicitly lost; none
   appears twice or disappears without telemetry.
9. Exercise the first text-business loop when available: train text → build a
   harness → create an agent → complete a job → issue an invoice → receive
   cash → hire a human.

## Stable acceptance bridge

`overhaul.html` exposes `window.__overhaulAcceptance`. This is a narrow
automation and diagnostics surface, not permission for tests to mutate private
state directly.

```js
window.__overhaulAcceptance = {
  ready: true,
  reset({ seed }),
  snapshot(),
  command({ type, ...payload }),
  runScenario(name),
}
```

Methods may be synchronous or return a Promise. Commands must use the same
validation and state transitions as player UI actions.

### Snapshot contract

`snapshot()` returns JSON-compatible data with these semantic fields:

- `seed`: the canonical run seed.
- `unlocks[]`: `{id, kind}`, where the starting set contains viable
  `floor`, `power-source`, `power-link`, `cooling-source`, `cooling-link`,
  `computer`, and `data-link` capabilities. Additional kinds are allowed.
- `footprint.owned[]` and `footprint.frontier[]`: cells shaped as
  `{key, floor, x, y}`; frontier cells also expose their numeric `cost`. Owned
  cells form one four-neighbor component. Frontier cells are unowned and
  laterally adjacent to at least one owned cell.
- `actors[]`: `{id, kind, state}` for semantic human, robot, and computer
  actors.
- `networks.power`, `networks.cooling`, and `networks.data`: each includes
  `paths[]`. A path identifies its source, target, connected status, capacity,
  and delivered amount. A resource is never delivered through an unconnected
  path.
- `computers[]`: `{id, state, powerDelivered, coolingDelivered,
  dataConnected, rawFlops}`.
- `flops`: non-negative `raw`, `sell`, `training`, `jobs`, `reserved`, `idle`,
  and `loss` values. `raw` equals the sum of every destination bucket.
- `sell`: `{requested, blocked, reason, fiberFloor, routedFlops}`. `requested`
  may be a boolean request flag or the numeric requested FLOPS; truthiness
  means the player requested Sell.
- `economy`: `{cash, invoicesPaid, humansHired}`.
- `ticks`: `{raw, completed}`.

`reset({seed})` clears prior run state, uses the supplied seed, and returns the
new snapshot. The same seed must create the same unlock IDs and initial owned
footprint in the same order. A different seed must vary at least one randomized
unlock across the contract's comparison seeds without ever removing a viable
capability.

`command()` returns `{ok, reason?, ...details}`. In the first gate it supports
`{type: "purchase-frontier", cellKey}`; rejection uses reason `not-frontier`
and does not mutate cash or the footprint. Success also echoes the purchased
`cellKey` and charged `cost` when the public bridge exposes command details;
the subsequent snapshot remains authoritative.

### Scenario contract

The first test suite uses named scenarios to avoid canvas-coordinate and
private-constructor coupling:

Every scenario except the business ledger returns `{snapshots: [...]}`. The
array contains a snapshot after each committed semantic transition and its last
item matches the subsequent `snapshot()` result.

- `computer-path-disconnected`: a computer exists without delivered power,
  cooling, or data. It is `off` and produces zero FLOPS.
- `computer-path-connected`: performs legal player-equivalent construction of
  power, cooling, and data paths. It exposes an observable `booting` transition
  before settling at `loaded` with positive raw FLOPS.
- `sell-without-f1-fiber`: requests Sell routing while no connected fiber
  endpoint exists on Floor 1. Sell is blocked with reason `missing-f1-fiber`,
  routed Sell FLOPS are zero, and cash does not increase from a sale.
- `sell-with-f1-fiber`: legally connects Floor 1 fiber and routes positive
  FLOPS to Sell.
- `flops-routing`: creates simultaneous routing destinations so conservation
  and duplicate-routing failures are observable.
- `text-business-loop`: returns the ordered event ledger described below.

`runScenario()` is allowed only to perform actions a player could perform or
advance deterministic simulation time. It must not inject final outputs.

## Detailed acceptance

### Seeded, viable starts

- The seed is shown in visible text.
- Same seed means identical unlock IDs and initial footprint.
- Different comparison seeds vary at least one randomized unlock.
- Every tested start contains all seven capability kinds required to reach a
  loaded computer. This checks capability, not hard-coded tile names.

### Footprint and frontier

- Initial owned cells are unique and four-neighbor connected on their floor.
- Frontier cells are unique, unowned, and adjacent to the owned component.
- Purchasing a frontier cell deducts exactly the quoted cost, adds that cell to
  owned, and recomputes a still-connected footprint and legal frontier.
- Purchasing a non-frontier cell is rejected without changing cash or owned
  cells.

### Manual construction UI

- A player can click a visible unlocked blueprint and place it with one click
  on a visible legal owned empty cell, without using the acceptance bridge's
  placement command. The inspector Place action remains an accessible alternate
  but is not required for the primary flow.
- The committed snapshot gains exactly one matching structure, cash falls by
  the visible blueprint price, the target cell renders that structure, and the
  browser emits no page or console error.
- Facility, power, cooling, and data structures can be placed on the same cell
  through repeated visible blueprint and owned-cell clicks. The facility stays
  as the single central `.structure`; power, cooling, and data each render one
  separate slim `[data-cell-utility="..."]` indicator rather than replacing the
  facility or drawing a cable/pipe as another full-tile central icon.
- A route-only data cable on another legal owned cell renders exactly one slim
  `[data-cell-utility="data"]` indicator and no central `.structure`.

### Explicit infrastructure and computer states

- Power, cooling, and data are three distinct paths.
- Disconnected paths deliver zero, even when a source exists elsewhere.
- A computer cannot leave `off` without sufficient connected power and
  cooling plus connected data.
- Connection produces an observable `booting` state; it does not jump directly
  from `off` to productive.
- A `loaded` computer reports positive raw FLOPS and the HUD agrees.

### Floor 1 fiber and FLOPS routing

- A Sell request without connected Floor 1 fiber is blocked with the exact
  semantic reason `missing-f1-fiber` and visible guidance.
- Fiber on another floor does not satisfy the contract.
- Connecting Floor 1 fiber enables positive Sell routing.
- FLOPS conservation uses a small floating-point tolerance:

  `raw = sell + training + jobs + reserved + idle + loss`

- Every bucket is non-negative, Sell cannot exceed raw FLOPS, and routed Sell
  FLOPS agree across state and visible HUD.

### Text-business loop

`text-business-loop` returns `events[]` with these ordered `type` values:

1. `text-trained`
2. `harness-built`
3. `agent-created`
4. `job-completed`
5. `invoice-issued`
6. `cash-received`
7. `human-hired`

The ledger carries stable IDs through the chain: the trained text feeds the
harness, the harness produces the agent, the agent completes the job, and that
job owns the invoice. Cash increases only at `cash-received`; human count and
payroll increase only at `human-hired`. The scenario contract and manual
Venture controls are active assertions in the coherent playtest gate.

The event payloads use `entityId` for the thing created or completed and carry
their causal reference: `textId`, `harnessId`, `agentId`, `jobId`, or
`invoiceId`. Invoice and cash events expose `amount`; `cash-received` exposes
`cashBefore` and `cashAfter`; `human-hired` exposes `humansBefore`,
`humansAfter`, `payrollBefore`, and `payrollAfter`.

### Semantic actors and animation hooks

After the connected-computer scenario, the first gate includes at least one
human, robot, and computer. Their allowed states are:

- human: `idle`, `moving`, `working`, `training`, `hired`, `blocked`
- robot: `idle`, `moving`, `building`, `repairing`, `charging`, `blocked`
- computer: `off`, `booting`, `loaded`, `working`, `throttled`, `blocked`

Each visible actor uses:

```html
data-actor-id="..."
data-actor-kind="human|robot|computer"
data-actor-state="..."
data-animation-hook="kind:state"
```

DOM state must match the snapshot. Reduced-motion mode keeps every actor and
state readable while suppressing nonessential animation and transition.

### Liveness, text, layout, and errors

- `ticks.raw`, `ticks.completed`, and `<html data-ui-tick>` advance and agree
  after a completed render.
- Visible FLOPS and cash text agree with the committed snapshot.
- `[data-flops-raw]` and `[data-cash]` expose their unformatted numeric value
  through `data-value`; formatting remains free to change.
- Required player text is rendered, unclipped, and inside the viewport at
  1440×900 and 1100×700.
- Major panels opt into collision checks with `data-ui-region`; visible regions
  may overlap only when one explicitly declares `data-allow-overlap`.
- The page registers no `pageerror`, `console.error`, or unhandled rejection.
- With `prefers-reduced-motion: reduce`, actor state remains visible and actor
  animation/transition duration resolves to zero.

## Opt-in soak

`RUN_OVERHAUL_SOAK=1` enables a live-server soak. Its default duration is 30
seconds and may be overridden with `OVERHAUL_SOAK_SECONDS`. At least once per
second it verifies animation frames, raw/completed/DOM tick agreement, current
HUD values, and browser errors while performing safe acceptance commands. A
single frame gap may not exceed three seconds.

## Expected-red policy

- Missing `overhaul.html`, the acceptance bridge, or a core field is a normal
  red failure with an exact diagnostic; tests must not silently fall back to
  the legacy game.
- The text-business loop and its manual Venture controls are active assertions;
  there are no expected-red gameplay mechanics in this gate.
- The soak is skipped unless explicitly enabled.
