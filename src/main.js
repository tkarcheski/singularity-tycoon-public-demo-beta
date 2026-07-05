// Singularity Tycoon — Mini · vibes test
// Place tiles on a grid. Power + cooling → compute → cash → bigger compute.

const { startAudio, swapVibe, setMusicVolume, toggleMute, isAudioStarted, setTension, playStinger } = window.GameMusic;

// ---------- Constants ----------
const COLS = 14;
const ROWS = 10;
const TILE = 56; // px, base tile size
const TICK_MS = 500; // sim tick

const TILE_TYPES = {
  empty:   { name: 'Empty',           cost: 0,   power: 0,   cooling: 0,  compute: 0,    upkeep: 0,    jobs: 0, wear: 0,    color: '#0e1320', desc: '' },
  solar:   { name: 'Solar Array',     cost: 40,  power: 4,   cooling: 0,  compute: 0,    upkeep: 0.1,  jobs: 1, wear: 0.06, color: '#2e2a0e', accent: '#ffe98a', desc: 'Up to 4 MW that ebbs with the sky. Cheap and low-maintenance, but big footprint per MW.' },
  power:   { name: 'Power Plant',     cost: 80,  power: 12,  cooling: 0,  compute: 0,    upkeep: 0.6,  jobs: 2, wear: 0.18, color: '#3a2b10', accent: '#ffd24a', desc: 'Supplies 12 MW. Adjacent tiles connect automatically.' },
  fan:     { name: 'Fan Wall',        cost: 25,  power: 0,   cooling: 4,  compute: 0,    upkeep: 0.15, jobs: 0, wear: 0.35, drain: [4, 2], color: '#15202b', accent: '#9adcff', desc: 'Air cooling: 4 kW, but only drains heat up close (range 1). Cheap, wears fast.' },
  cooler:  { name: 'Coolant Loop',    cost: 50,  power: -1,  cooling: 10, compute: 0,    upkeep: 0.3,  jobs: 1, wear: 0.25, drain: [8, 5, 2.5], color: '#10293a', accent: '#6ec5ff', desc: 'Provides 10 kW of cooling. Needs 1 MW. Drains heat from nearby tiles — closer is cooler.' },
  exch:    { name: 'Heat Exchanger',  cost: 150, power: -2,  cooling: 18, compute: 0,    upkeep: 0.9,  jobs: 1, wear: 0.22, drain: [6, 4.5, 3, 1.5], color: '#0f3230', accent: '#63e0cf', desc: 'Provides 18 kW and pulls heat from up to 3 tiles away — the wide-area workhorse of a serious farm. Needs 2 MW.' },
  immersion: { name: 'Immersion Bath', cost: 260, power: -3, cooling: 14, compute: 0,   upkeep: 1.2,  jobs: 1, wear: 0.18, gate: 'immersion', drain: [12, 8], vDrain: true, aura: { wearGuard: 0.7, range: 1, vertical: true }, color: '#0b2b45', accent: '#4fb7ff', desc: 'Dielectric liquid bath: the strongest drain in the game, touching its neighbors — and the same spot on the floors above and below. Submerged tiles wear 30% slower. Needs 3 MW.' },
  cryo:    { name: 'Cryo Plant',      cost: 1200, power: -8, cooling: 40, compute: 0,   upkeep: 5.0,  jobs: 2, wear: 0.30, gate: 'cryo', drain: [8, 5, 2.5], color: '#1a2340', accent: '#9db8ff', desc: 'Industrial cryogenics: 40 kW of supply — enough to feed a Quantum Annealer. Needs 8 MW.' },
  gpu1:    { name: 'GPU Rack v1',     cost: 120, power: -4,  cooling: -3, compute: 6,    upkeep: 1.2,  jobs: 1, wear: 0.42, color: '#102a23', accent: '#4af0c0', desc: 'Generates 6 TFLOPS. Needs 4 MW + 3 kW. Clusters: +10% output but +15% heat per adjacent GPU.' },
  gpu2:    { name: 'GPU Rack v2',     cost: 400, power: -10, cooling: -8, compute: 22,   upkeep: 4.0,  jobs: 2, wear: 0.42, gate: 'gpu2', color: '#0c2e3b', accent: '#7af0d4', desc: 'Generates 22 TFLOPS. Needs 10 MW + 8 kW. Same cluster bonus/heat as v1.' },
  cpu:     { name: 'CPU Rack',        cost: 60,  power: -2,  cooling: -1, compute: 3,    upkeep: 0.5,  jobs: 1, wear: 0.25, aura: { boost: 0.06, range: 1 }, color: '#1b2433', accent: '#8fb8ff', desc: 'Generates 3 TFLOPS. Needs 2 MW + 1 kW. Runs cool, wears slowly — and orchestrates: adjacent GPUs/TPUs/quantum get +6% output each.' },
  tpu:     { name: 'TPU Pod',         cost: 700, power: -12, cooling: -14, compute: 40,  upkeep: 6.0,  jobs: 2, wear: 0.38, gate: 'tpu', color: '#2b1a10', accent: '#ffb35c', desc: 'Generates 40 TFLOPS. Needs 12 MW + 14 kW. Best compute-per-MW in the game, but runs hot — keep coolant close.' },
  quantum: { name: 'Quantum Annealer', cost: 2500, power: -20, cooling: -30, compute: 90, upkeep: 12.0, jobs: 3, wear: 0.60, gate: 'quantum', color: '#241536', accent: '#d18aff', desc: 'Generates 90 TFLOPS in one cell. Cryogenic: emits little heat but drinks 30 kW of cooling. Exotic silicon — wears fastest of all.' },
  desk:    { name: 'Engineer Desk',   cost: 220, power: -1,  cooling: 0,  compute: 0,    upkeep: 0.5,  jobs: 2, wear: 0.08, multiplier: 1.15, color: '#231a30', accent: '#c89cff', desc: '+15% compute output. Stack up to 3.' },
  retrain: { name: 'Retraining Ctr.', cost: 150, power: -1,  cooling: 0,  compute: 0,    upkeep: 1.0,  jobs: 8, wear: 0.08, color: '#2d2410', accent: '#ffb86b', desc: 'Retrains workers your compute displaced. +8 jobs. Needs 1 MW.' },
  human:   { name: 'Worker Pod',      cost: 100, power: -1,  cooling: 0,  compute: 0,    upkeep: 0.8,  jobs: 4, wear: 0,    color: '#2e1b26', accent: '#ff9ecf', desc: 'Humans output tokens as they learn — up to 3 TFLOPS at full skill. The AI trains them (sit near GPUs); they also teach each other. Cannot be upgraded — or broken.' },
  botbay:  { name: 'Bot Bay',         cost: 350, power: -2,  cooling: 0,  compute: 0,    upkeep: 0.8,  jobs: 1, wear: 0.12, gate: 'ops', color: '#1d1d33', accent: '#9aa5ff', desc: 'A repair bot fixes the most-damaged tile every 4s at a 40% discount. Needs 2 MW. Robots don\'t breathe.' },
  life:    { name: 'Life Support',    cost: 400, power: -3,  cooling: 0,  compute: 0,    upkeep: 1.5,  jobs: 0, wear: 0.2,  color: '#0e2a33', accent: '#7ee7ff', desc: 'Air, water, warmth — a breathable bubble reaching 2 tiles. In space, people tiles outside a field suffocate and produce nothing. On Earth, the sky does this for free.' },
  fission: { name: 'Fission Core',    cost: 1500, power: 30, cooling: 0,  compute: 0,    upkeep: 6.0,  jobs: 2, wear: 0.25, gate: 'fission', color: '#2e1a10', accent: '#ffd24a', desc: 'Supplies 30 MW anywhere — the atom doesn\'t need air. Emits serious heat (12): in vacuum, with nowhere for heat to go, reactor placement is the puzzle.' },
  repair:  { name: 'Repair',          cost: 0,   power: 0,   cooling: 0,  compute: 0,    upkeep: 0,    jobs: 0, wear: 0,    color: '#13241c', accent: '#7dffa8', desc: 'Fix a damaged tile for 30% of its build cost, scaled by damage.' },
  bull:    { name: 'Bulldoze',        cost: 0,   power: 0,   cooling: 0,  compute: 0,    upkeep: 0,    jobs: 0, wear: 0,    color: '#2a1414', accent: '#ff4f6d', desc: 'Refund 50% of build cost.' },
};

const REVENUE_PER_TFLOPS = 1.20; // base $/sec per TFLOPS at neutral demand (4× the v0.2
                                 // rate — playtest verdict: faster progress is more fun)

// Human workers — they learn instead of wearing out, and can't be upgraded.
const HUMAN_MAX_TFLOPS = 3;          // token output at skill 100
const HUMAN_LEARN_GPU = [0, 0.8, 0.4]; // skill/s from a working GPU at distance 0/1/2
const HUMAN_LEARN_CAP = 2.0;         // max skill/s from AI tutoring
const HUMAN_PEER_RATE = 0.005;       // skill/s per point of gap to a smarter neighbor pod

// Token market — a happy city wants more tokens. Demand scales the token
// price with sentiment (the carrot to the mood penalties' stick), plus a
// gentle mean-reverting market wobble for short-term fluctuation.
const DEMAND_BASE = 0.6;          // price multiplier at sentiment 0
const DEMAND_PER_SENTIMENT = 0.008; // +0.008× per sentiment point (×1.0 at 50, ×1.4 at 100)
const MARKET_WOBBLE = 0.012;      // random walk step per tick
const MARKET_REVERT = 0.01;       // pull toward 1.0 per tick
const MARKET_MIN = 0.85, MARKET_MAX = 1.15;
const PRICE_HISTORY_LEN = 120; // ~60s of sparkline at the 500ms tick

// Wear & repair — equipment degrades; exotic tech degrades faster.
const WORN_AT = 40;              // below: output ×0.6
const REPAIR_COST_FRAC = 0.30;   // of build cost at full damage
const BOT_REPAIR_DISCOUNT = 0.6; // bots pay 60% of the manual rate
const BOT_HEAL = 15;             // condition restored per bot visit
const BOT_PERIOD_TICKS = 8;      // one visit per bay per 4s
// Maintain allocation pricing (rebalanced 2026-07-04: 1% was too easy —
// holding steady should demand ≥7.5% of compute, catching up costs extra;
// L5 robots are the future way to buy this back down)
const MAINTAIN_RATE = 2.2;       // pool pays 2.2× the manual per-point rate
const CATCHUP_PREMIUM = 1.5;     // tiles already worn (< WORN_AT) cost extra
// Degradation physics: damaged silicon leaks — output falls (gpuCondScale)
// AND power draw rises toward +60% as condition approaches zero
const DEGRADE_POWER_RISE = 0.6;
const GPU_ADJ_BONUS = 0.10;      // +compute per adjacent working GPU, cap 3
const GPU_ADJ_HEAT = 0.15;       // +cooling need per adjacent working GPU — clusters run hot

// Heat — per-tile temperature. GPUs and plants emit it, coolant loops drain it
// with distance falloff (closer loop = cooler tile). Heat multiplies wear and
// feeds entropy; tiles are tinted by temperature.
const HEAT_SOURCE = { gpu1: 3, gpu2: 8, power: 4, cpu: 1, tpu: 6, quantum: 2, fission: 12 }; // heat emitted by a working tile

// Life support (#53): people tiles on space floors need a breathable field
const LIFE_RANGE = 2;
const PEOPLE_TILES = ['human', 'desk', 'retrain'];
const HEAT_SPREAD = 0.5;          // fraction of neighbor source heat that bleeds over
// Heat drain profiles live on TILE_TYPES as `drain: [d0, d1, ...]` — heat
// removed at Manhattan distance 0/1/2/... per cooling tile.
// Synergy auras live on TILE_TYPES as `aura: { boost|wearGuard, range }`.
const AURA_BOOST_CAP = 0.25;   // max total output boost a tile can receive
const AURA_WEAR_FLOOR = 0.5;   // wear-guard stacking never protects past ×0.5
const HEAT_CAP = 10;              // net heat that maps to heat01 = 1.0
const HEAT_WEAR_MULT = 1.0;       // wear ×(1 + this × heat01)
const HEAT_ENTROPY = 0.35;        // entropy01 contribution of average source-tile heat

// Research — global tech tracks; each level: output ×1.4, wear ×1.6.
// Costs are RESEARCH POINTS, earned by allocating compute to Research.
const RESEARCH_OUTPUT = 1.4;
const RESEARCH_WEAR = 1.6;
const RESEARCH = {
  power:   { name: '⚡ Power',   costs: [30, 150], desc: 'Turbine and array output ×1.4 per level — but hotter machines wear ×1.6.' },
  cooling: { name: '❄️ Cooling', costs: [25, 125], desc: 'Loop, exchanger and fan supply ×1.4 per level — pushed harder, they wear ×1.6.' },
  compute: { name: '🧮 Compute', costs: [40, 200], desc: 'All silicon outputs ×1.4 per level — overclocked chips wear ×1.6.' },
  durability: { name: '🔧 Durability', costs: [35, 175], desc: 'Better materials everywhere: all wear ×0.75 per level.' },
  contracts: { name: '📜 Contracts', costs: [60, 300], desc: 'A deeper futures desk: +2 simultaneous contracts per level (1 → 3 → 5).' },
  // 🛰 SPACE branch — locked until the Dyson blueprint
  shielding: { name: '🛡 Rad-hard Shielding', costs: [120, 400], space: true, desc: 'Radiation-hardened everything: space wear ×0.8 per level.' },
  radiators: { name: '♨ Radiator Alloys',    costs: [100, 350], space: true, desc: 'Better emissivity: vacuum wall-cooling bonus +0.25 per level.' },
  recyclers: { name: '🫧 Closed-loop Recyclers', costs: [90, 300], space: true, desc: 'Air and water go further: life-support range +1 per level.' },
  panels:    { name: '☀ Orbital Panels',     costs: [80, 280], space: true, desc: 'Thin-film arrays: orbital solar multiplier +0.2 per level.' },
};
// Durability research: everything wears ×0.75 per level — the counterweight
// to the output tracks' wear penalty (×1.6/level). First step toward the
// full "everything researchable" tree (#32/#37).
const DURABILITY_WEAR_MULT = 0.75;

// Allocation — where the AI's tokens go. Selling pays now; research earns RP;
// self-improvement compounds output but feeds the singularity (entropy);
// public compute (UBC) buys goodwill instead of cash.
const UBC_SENT_PER_TFLOPS = 0.5; // sentiment pts per donated TFLOPS
const UBC_SENT_CAP = 30;
const UBI_JOBS_PER_DOLLAR = 0.6; // jobs funded per $/s of public dividend
const RP_PER_TFLOPS = 0.05;        // RP/s per TFLOPS at 100% research
const SELF_IMPROVE_RATE = 0.00004; // multiplier growth/s per TFLOPS at 100% self
const SELF_IMPROVE_CAP = 1.0;      // self-improvement tops out at ×2 output
const SELF_IMPROVE_ENTROPY = 0.3;  // entropy01 added per unit of self-improvement
const ENTROPY_GRACE_TFLOPS = 30;   // entropy fades in as compute approaches this — gentle start

// Unlocks — everything beyond the minute-zero kit is earned.
const UNLOCKS = {
  gpu2: { name: 'GPU Rack v2',    cash: 1500, blurb: 'license next-gen silicon' },
  ops:  { name: 'Ops Automation', rp: 20,     blurb: 'repair Bot Bays' },
  tpu:  { name: 'TPU Pod',        cash: 8000, blurb: 'custom tensor silicon' },
  quantum: { name: 'Quantum Annealer', rp: 120, blurb: 'cryogenic qubit lab' },
  immersion: { name: 'Immersion Bath', cash: 3000, blurb: 'dielectric liquid cooling' },
  cryo: { name: 'Cryo Plant',     rp: 60,     blurb: 'industrial cryogenics' },
  hex:  { name: 'Hexagonal Lattice', rp: 80,  blurb: 'six-way adjacency — new floors build on hex' },
  fission: { name: 'Fission Core',   rp: 100, blurb: 'power that works anywhere — even vacuum' },
};

// Finance — leverage to escape the mid-game stall.
const LOANS = [
  { amount: 1000,  repay: 1300 },
  { amount: 5000,  repay: 6750 },
  { amount: 25000, repay: 35000 },
];
const LOAN_REVENUE_SHARE = 0.10; // of gross revenue goes to debt service
const LOAN_MIN_PAY = 0.5;        // $/s floor so debt clears even when idle
const FUTURES_UNLOCK_TFLOPS = 50;
const FUTURES_WINDOW_S = 120;    // sell this many seconds of compute revenue
const FUTURES_DISCOUNT = 0.25;   // haircut on the advance
const FUTURES_REVENUE_SHARE = 0.5;

// Entropy — the more compute, the harder the world pushes back.
const ENTROPY_SCALE = 150;       // TFLOPS for ~63% entropy
const ENTROPY_WEAR_MULT = 2;     // wear ×(1 + this × entropy01)
const EVENT_CHANCE = 0.06;       // per tick at entropy 1.0 (×entropy^1.5)
const EVENT_COND_FLOOR = 5;      // events never instantly brick a tile

// Jobs & public sentiment — selling compute displaces outside jobs; tiles create them.
const JOBS_DISPLACED_PER_TFLOPS = 0.25; // jobs lost per TFLOPS sold
const SENTIMENT_DRIFT = 1.5;            // points/sec toward target
const GOODWILL_AT = 70;                 // ≥: upkeep −15% (community tax rebate)
const UNREST_AT = 40;                   // <: upkeep +25% (power surcharge)
const PROTEST_AT = 25;                  // <: compute halved + slow building permits
const PERMIT_DELAY_MS = 4000;           // min gap between builds during protests

// New tiles append at the end (keys q/w/e, r/t/y) so existing hotkeys stay
// stable. Display grouping comes from each tile's `layer`, not this order.
const TOOL_ORDER = ['solar', 'power', 'fan', 'cooler', 'gpu1', 'gpu2', 'desk', 'retrain', 'human', 'botbay', 'repair', 'bull', 'cpu', 'tpu', 'quantum', 'exch', 'immersion', 'cryo', 'life', 'fission'];
const TOOL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i'];

// The palette teaches the stack bottom-up — a loose OSI homage. L3 · NETWORK
// is reserved for switches/floors/topology (issues #18/#20/#21).
const LAYERS = [
  { name: '🔌 L1 · Physical',     tiles: ['solar', 'power', 'fission', 'fan', 'cooler', 'exch', 'immersion', 'cryo'] },
  { name: '🧠 L2 · Compute',      tiles: ['gpu1', 'gpu2', 'cpu', 'tpu', 'quantum'] },
  { name: '👥 L7 · People & Ops', tiles: ['desk', 'retrain', 'human', 'botbay', 'life'] },
  { name: '🛠️ Tools',             tiles: ['repair', 'bull'] },
];

// Solar output cycle — the sky has moods (0.2..1.0, ~90s period)
const SOLAR_PERIOD_S = 90;

const GOAL = 1_000_000;
const BANKRUPT_AFTER_S = 60; // sim-seconds of negative cash before the run dies

// Wall integration: cooling tiles on the board edge exchange heat through
// the envelope. In vacuum the wall is a radiator — bigger bonus.
const PERIMETER_COOL_BONUS = 1.25;
const VACUUM_WALL_BONUS = 1.5;

// Space (epic #44, tier 1): vacuum physics for station floors
const SPACE_STATION_COST = 250_000;
const SPACE_SOLAR_MULT = 1.3;   // constant orbital sunlight — no day/night ebb
const RADIATION_WEAR = 1.25;    // everything wears faster off-planet
const VACUUM_HEAT_RETAIN = 2;   // no convection: your OWN heat is harder to shed

// ---------- State ----------
const state = {
  cash: 500,
  // each cell: null (empty) or { t: tileTypeId, cond: 0..100 }
  grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)), // alias of floors[floor]
  floor: 0,
  selectedTool: 'gpu1',
  hover: { x: -1, y: -1 },
  tick: 0,
  // computed each tick
  totalPower: 0,
  totalCooling: 0,
  powerUsed: 0,
  coolingUsed: 0,
  totalCompute: 0,
  upkeep: 0,
  revenue: 0,
  jobsCreated: 0,
  jobsDisplaced: 0,
  netJobs: 0,
  sentiment: 60, // starts neutral, below the goodwill threshold

  mood: 'neutral', // goodwill | neutral | unrest | protest
  permitReadyAt: 0,

  // token market
  market: 1,      // mean-reverting wobble around 1.0
  sun: 1,         // solar output factor, 0.2..1.0 over ~90s
  tokenPrice: REVENUE_PER_TFLOPS, // effective $/TFLOPS after demand × market
  priceHistory: [], // rolling window for the HUD sparkline (#22), not saved

  // v0.5: token allocation, research points, self-improvement, unlocks
  alloc: { sell: 1, research: 0, self: 0, ubc: 0, ubi: 0, maintain: 0 }, // normalized shares of compute
  rp: 0,             // research points
  selfImprove: 0,    // compounding output bonus, 0..SELF_IMPROVE_CAP
  unlocks: { gpu2: false, ops: false, tpu: false, quantum: false, immersion: false, cryo: false, hex: false, fission: false },

  // v0.3 systems
  tech: { power: 0, cooling: 0, compute: 0, durability: 0, shielding: 0, radiators: 0, recyclers: 0, panels: 0, contracts: 0 }, // research levels 0..2
  debt: 0,          // outstanding loan repayment
  futures: [],      // open futures contracts: [{ owed, total }] — FIFO delivery
  futuresRate: 0.5, // player-set share of gross revenue withheld for delivery
  maintainPool: 0,  // accumulated maintenance budget ($), fed by the Maintain allocation
  entropy: 0,       // 0..100, derived from compute
  effects: [],      // timed debuffs: { kind, x?, y?, until }

  // god-mode dev toggles (window.__god)
  god: { freeBuild: false, noWear: false, entropyMult: 1, revenueMult: 1, pinSentiment: false, fast: false },

  // tutorial & lifetime stats
  tutStep: 0,
  stats: { manualRepairs: 0, peakCash: 500 },

  // fail state (#28)
  insolvencyS: 0,  // sim-seconds spent below $0 — bankruptcy at BANKRUPT_AFTER_S
  bankrupt: false,

  particles: [],
  flashes: new Map(), // "x,y" -> flash strength
  goalUnlocked: false,
};

// Floors (#20 v1): state.grid always aliases the active floor's grid so
// rendering/input/tutorial code stays single-grid; the sim ticks every floor.
state.floors = [state.grid];
state.floorTopos = ['square']; // per-floor lattice key, parallel to floors
state.floorSpace = [false];    // per-floor vacuum flag — true for space stations
// Cost of each expansion floor: F2 $150k, F3 $300k, F4 $500k, F5 $750k.
const FLOOR_COSTS = [150_000, 300_000, 500_000, 750_000];
const MAX_FLOORS = 1 + FLOOR_COSTS.length;
// Price of the NEXT floor, or null when the tower is complete. The ladder
// meters GROUND floors only — the station never consumes a rung or F-number.
function groundFloorCount() {
  return state.floors.length - (state.floorSpace || []).filter(Boolean).length;
}
function nextFloorCost() {
  const n = groundFloorCount();
  return n >= MAX_FLOORS ? null : FLOOR_COSTS[n - 1];
}

function newGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function setActiveFloor(i) {
  state.floor = Math.max(0, Math.min(state.floors.length - 1, i));
  state.grid = state.floors[state.floor];
  state.topo = topoOf(state.floor);
  updateFloorTabs();
  buildToolbar(); // palette availability follows the floor (vacuum disables fan/plant)
}

function updateFloorTabs() {
  const tabs = document.getElementById('floor-tabs');
  if (!tabs) return;
  let ground = 0, stations = 0;
  tabs.hidden = false;
  tabs.innerHTML = state.floors.map((_, i) => {
    const icon = isSpaceFloor(i) ? '🛰' : topoOf(i).key === 'hex' ? '⬡' : '🏢';
    const label = isSpaceFloor(i) ? `S${++stations}` : `F${++ground}`;
    return `<button class="floor-tab${i === state.floor ? ' active' : ''}" data-floor="${i}">${icon} ${label}</button>`;
  }).join('') + '<button class="floor-tab floor-overhaul" id="btn-overhaul" title="Bulldoze every tile on this floor for a 50% refund">🏗 Overhaul</button>';
  for (const btn of tabs.querySelectorAll('[data-floor]')) {
    btn.addEventListener('click', () => setActiveFloor(+btn.dataset.floor));
  }
  tabs.querySelector('#btn-overhaul').addEventListener('click', overhaulFloor);
}

// Rebuild from a clean slab: bulldoze every tile on the ACTIVE floor at the
// standard 50% refund. The floor itself (and its topology) stays yours.
function overhaulFloor() {
  const grid = state.grid;
  let refund = 0, count = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (grid[y][x]) { refund += Math.floor(TILE_TYPES[grid[y][x].t].cost * 0.5); count++; }
    }
  }
  if (!count) { pushTicker('This floor is already a clean slab', ''); return; }
  if (!confirm(`Overhaul this floor? All ${count} tiles are bulldozed for a $${refund.toLocaleString()} refund.`)) return;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) grid[y][x] = null;
  state.cash += refund;
  pushTicker(`🏗 FLOOR OVERHAULED — ${count} tiles cleared, +$${refund.toLocaleString()} salvaged`, 'warn');
  playStinger('research');
}

// While the sim visits a non-visible floor, visual effects are muted.
let visualsEnabled = true;
function forEachFloor(fn) {
  for (let f = 0; f < state.floors.length; f++) {
    state.grid = state.floors[f];
    state.topo = topoOf(f);
    visualsEnabled = f === state.floor;
    fn(f);
  }
  state.grid = state.floors[state.floor];
  state.topo = topoOf(state.floor);
  visualsEnabled = true;
}

function buyFloor() {
  const cost = nextFloorCost();
  if (cost == null) return;
  const n = groundFloorCount() + 1;
  if (!state.god.freeBuild && state.cash < cost) {
    pushTicker(`Floor ${n}: need $${cost.toLocaleString()}`, 'bad');
    return;
  }
  if (!state.god.freeBuild) state.cash -= cost;
  state.floors.push(newGrid());
  state.floorTopos.push(state.unlocks.hex ? 'hex' : 'square');
  state.floorSpace.push(false);
  pushTicker(`${state.unlocks.hex ? '⬡' : '🏢'} FLOOR ${n} ONLINE — the datacenter grows upward`, 'good');
  playStinger('research');
  setActiveFloor(state.floors.length - 1);
  updateFinance();
}

// The Dyson blueprint opens the door to orbit: one station in this slice,
// on a triangular lattice, under vacuum rules (epic #44, tier 1).
function buySpaceStation() {
  if ((state.floorSpace || []).some(Boolean)) return;
  if (!state.goalUnlocked) {
    pushTicker('🛰 Space needs the Dyson Sphere blueprint — reach $1,000,000 first', 'bad');
    return;
  }
  if (!state.god.freeBuild && state.cash < SPACE_STATION_COST) {
    pushTicker(`Space Station: need $${SPACE_STATION_COST.toLocaleString()}`, 'bad');
    return;
  }
  if (!state.god.freeBuild) state.cash -= SPACE_STATION_COST;
  state.floors.push(newGrid());
  state.floorTopos.push('tri');
  state.floorSpace.push(true);
  pushTicker('🛰 SPACE STATION ONLINE — no air, endless sun, hard radiation', 'good');
  playStinger('goal');
  setActiveFloor(state.floors.length - 1);
  updateFinance();
}

// Programmatic handles for tests and future agent players
window.__state = state;
window.__god = state.god;
// (set below once TOPOLOGIES is defined)

// ---------- Grid helpers ----------
const NEIGHBOR_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- Topology (#21, epic #44) ----------
// A topology defines the lattice: who neighbors whom, lattice distance, and
// pixel geometry. Grids stay [ROWS][COLS] arrays — hex uses odd-r offset
// coordinates in the same storage, so floors and saves are unchanged.
// Pixel coords in center()/pick()/boardSize() are relative to the grid origin.
const HEX_W = TILE;                // horizontal spacing (pointy-top)
const HEX_R = TILE / Math.sqrt(3); // center-to-vertex radius
const HEX_VSTEP = HEX_R * 1.5;     // vertical row spacing
const HEX_DIRS = [
  [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]], // even rows
  [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]],   // odd rows
];
function hexCube(x, y) {
  return { q: x - (y - (y & 1)) / 2, r: y };
}

const TOPOLOGIES = {
  square: {
    key: 'square',
    dirs() { return NEIGHBOR_DIRS; },
    dist(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); },
    center(x, y) { return { cx: x * TILE + TILE / 2, cy: y * TILE + TILE / 2 }; },
    boardSize() { return { w: COLS * TILE, h: ROWS * TILE }; },
    pick(px, py) {
      const gx = Math.floor(px / TILE), gy = Math.floor(py / TILE);
      return gx >= 0 && gy >= 0 && gx < COLS && gy < ROWS ? { x: gx, y: gy } : null;
    },
    trace(ctx, cx, cy, inset = 0) {
      const h = TILE / 2 - inset;
      ctx.beginPath();
      ctx.rect(cx - h, cy - h, h * 2, h * 2);
    },
  },
  hex: {
    key: 'hex',
    dirs(x, y) { return HEX_DIRS[y & 1]; },
    dist(ax, ay, bx, by) {
      const a = hexCube(ax, ay), b = hexCube(bx, by);
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    },
    center(x, y) {
      return { cx: x * HEX_W + HEX_W / 2 + (y & 1 ? HEX_W / 2 : 0), cy: y * HEX_VSTEP + HEX_R };
    },
    boardSize() { return { w: COLS * HEX_W + HEX_W / 2, h: (ROWS - 1) * HEX_VSTEP + HEX_R * 2 }; },
    pick(px, py) {
      // nearest center in the 3×3 offset neighborhood of the estimate
      const gy = Math.round((py - HEX_R) / HEX_VSTEP);
      let best = null, bestD = Infinity;
      for (let y = gy - 1; y <= gy + 1; y++) {
        if (y < 0 || y >= ROWS) continue;
        const gx = Math.round((px - HEX_W / 2 - (y & 1 ? HEX_W / 2 : 0)) / HEX_W);
        for (let x = gx - 1; x <= gx + 1; x++) {
          if (x < 0 || x >= COLS) continue;
          const c = this.center(x, y);
          const d = (c.cx - px) ** 2 + (c.cy - py) ** 2;
          if (d < bestD) { bestD = d; best = { x, y }; }
        }
      }
      return best && bestD <= HEX_R * HEX_R ? best : null;
    },
    trace(ctx, cx, cy, inset = 0) {
      const r = HEX_R - inset;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3; // pointy-top
        const vx = cx + r * Math.cos(a), vy = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
    },
  },
  tri: {
    // Space tier 1: alternating up/down triangles in the same [ROWS][COLS]
    // storage — up when (x+y) is even. 3 neighbors: connectivity-poor,
    // perimeter-rich, exactly the tier-1 constraint from the roadmap.
    key: 'tri',
    dirs(x, y) {
      return (x + y) % 2 === 0
        ? [[-1, 0], [1, 0], [0, 1]]   // up-triangle: base at the bottom
        : [[-1, 0], [1, 0], [0, -1]]; // down-triangle: base at the top
    },
    dist: triDist,
    center(x, y) {
      const up = (x + y) % 2 === 0;
      return { cx: (x + 1) * TRI_HALFW, cy: y * TRI_H + (up ? (2 * TRI_H) / 3 : TRI_H / 3) };
    },
    boardSize() { return { w: (COLS + 1) * TRI_HALFW, h: ROWS * TRI_H }; },
    pick(px, py) {
      const gy = Math.floor(py / TRI_H);
      if (gy < 0 || gy >= ROWS) return null;
      const approx = Math.floor(px / TRI_HALFW);
      for (let x = approx - 2; x <= approx + 1; x++) {
        if (x < 0 || x >= COLS) continue;
        if (pointInTri(px, py, x, gy)) return { x, y: gy };
      }
      return null;
    },
    trace(ctx, cx, cy, inset = 0) {
      const scale = Math.max(0, 1 - inset / (TRI_H / 3));
      const verts = this._verts(cx, cy);
      ctx.beginPath();
      verts.forEach(([vx, vy], i) => {
        const sx = cx + (vx - cx) * scale, sy = cy + (vy - cy) * scale;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
    },
    // Vertex set for the triangle whose CENTROID is at (cx, cy) — orientation
    // recovered from the centroid's fractional position inside its band.
    _verts(cx, cy) {
      const band = Math.floor(cy / TRI_H);
      const isUp = cy - band * TRI_H > TRI_H / 2; // up centroids sit low in the band
      const top = band * TRI_H, bottom = (band + 1) * TRI_H;
      return isUp
        ? [[cx, top], [cx - TRI_HALFW, bottom], [cx + TRI_HALFW, bottom]]
        : [[cx - TRI_HALFW, top], [cx + TRI_HALFW, top], [cx, bottom]];
    },
  },
};

// Triangle-cell geometry: side TRI_S, band height TRI_H, half-width TRI_HALFW
const TRI_S = 72;
const TRI_H = (TRI_S * Math.sqrt(3)) / 2;
const TRI_HALFW = TRI_S / 2;

function triVertices(x, y) {
  const up = (x + y) % 2 === 0;
  const left = x * TRI_HALFW, right = (x + 2) * TRI_HALFW, mid = (x + 1) * TRI_HALFW;
  const top = y * TRI_H, bottom = (y + 1) * TRI_H;
  return up
    ? [[mid, top], [left, bottom], [right, bottom]]
    : [[left, top], [right, top], [mid, bottom]];
}

function pointInTri(px, py, x, y) {
  const [a, b, c] = triVertices(x, y);
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = sign([px, py], a, b), d2 = sign([px, py], b, c), d3 = sign([px, py], c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// Lattice distance on the triangular grid: memoized BFS over the unbounded
// lattice (translation-invariant up to cell parity, so the memo stays small).
const triDistMemo = new Map();
function triDist(ax, ay, bx, by) {
  const p = (ax + ay) & 1;
  const key = `${bx - ax},${by - ay},${p}`;
  const hit = triDistMemo.get(key);
  if (hit !== undefined) return hit;
  const dx = bx - ax, dy = by - ay;
  const R = Math.abs(dx) + Math.abs(dy) + 2;
  const seen = new Set(['0,0']);
  let frontier = [[0, 0]], d = 0;
  while (frontier.length) {
    const next = [];
    for (const [qx, qy] of frontier) {
      if (qx === dx && qy === dy) { triDistMemo.set(key, d); return d; }
      const up = ((qx + qy + p) & 1) === 0;
      const dirs = up ? [[-1, 0], [1, 0], [0, 1]] : [[-1, 0], [1, 0], [0, -1]];
      for (const [mx, my] of dirs) {
        const nx = qx + mx, ny = qy + my;
        if (Math.abs(nx) > R || Math.abs(ny) > R) continue;
        const k = `${nx},${ny}`;
        if (!seen.has(k)) { seen.add(k); next.push([nx, ny]); }
      }
    }
    frontier = next;
    d++;
  }
  triDistMemo.set(key, Infinity);
  return Infinity;
}

function topoOf(f) {
  return TOPOLOGIES[(state.floorTopos || [])[f]] || TOPOLOGIES.square;
}
state.topo = TOPOLOGIES.square; // alias of the active floor's topology, like state.grid

function isPerimeter(x, y) {
  return x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
}
function isSpaceFloor(f) {
  return !!(state.floorSpace || [])[f];
}
// 🛰 Space research dials (all default to the base constants at level 0)
const SHIELD_WEAR_MULT = 0.8;   // per Rad-hard Shielding level
const RADIATOR_STEP = 0.25;     // vacuum wall bonus per Radiator Alloys level
const PANEL_STEP = 0.2;         // orbital solar per Orbital Panels level
function radiationWear() { return RADIATION_WEAR * Math.pow(SHIELD_WEAR_MULT, state.tech.shielding || 0); }
function vacuumWallBonus() { return VACUUM_WALL_BONUS + RADIATOR_STEP * (state.tech.radiators || 0); }
function lifeRange() { return LIFE_RANGE + (state.tech.recyclers || 0); }
function spaceSolarMult() { return SPACE_SOLAR_MULT + PANEL_STEP * (state.tech.panels || 0); }
// Wall bonus for a cooling tile at (x,y) on floor f — the envelope radiates
function wallBonus(f, x, y) {
  if (!isPerimeter(x, y)) return 1;
  return isSpaceFloor(f) ? vacuumWallBonus() : PERIMETER_COOL_BONUS;
}
window.__topo = TOPOLOGIES; // test handle for lattice math

function cellsOf(...types) {
  const out = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = state.grid[y][x];
      if (c && types.includes(c.t)) out.push({ x, y, c });
    }
  }
  return out;
}

function neighborCells(x, y) {
  const out = [];
  for (const [dx, dy] of state.topo.dirs(x, y)) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && state.grid[ny][nx]) {
      out.push({ x: nx, y: ny, c: state.grid[ny][nx] });
    }
  }
  return out;
}

// Supply (power/cooling) holds rated output until visibly worn, then drops —
// stepped so the MW/kW budget math stays predictable for the player.
function condScale(c) { return c.cond <= 0 ? 0 : c.cond < WORN_AT ? 0.6 : 1; }
// GPU token output degrades continuously: pristine = 1.0 fading toward 0.4,
// dead = 0. Worn silicon produces fewer tokens, not a sudden cliff.
function gpuCondScale(c) { return c.cond <= 0 ? 0 : 0.4 + 0.6 * (c.cond / 100); }
function techMult(track) { return Math.pow(RESEARCH_OUTPUT, state.tech[track]); }
function isGpu(t) { return t === 'gpu1' || t === 'gpu2'; }
// Any tile that produces TFLOPS (GPUs, CPU, TPU, quantum). GPUs additionally
// keep their cluster bonus/heat as the family's identity.
function isCompute(t) { return (TILE_TYPES[t]?.compute || 0) > 0; }
const COMPUTE_IDS = Object.keys(TILE_TYPES).filter((t) => TILE_TYPES[t].compute > 0);
function trackOf(t) {
  if (t === 'power' || t === 'solar') return 'power';
  if (t === 'cooler' || t === 'fan') return 'cooling';
  if (isCompute(t)) return 'compute';
  return null;
}
function repairPrice(c) {
  return Math.ceil(TILE_TYPES[c.t].cost * REPAIR_COST_FRAC * (1 - c.cond / 100));
}

// Per-tile heat01 map. Sources emit, neighbors catch spillover, coolant loops
// drain with distance falloff — a close loop keeps a GPU cool (low wear).
// Heat, all floors at once so vertical drains (vDrain tiles, e.g. immersion)
// can reach the same cell one floor up/down at drain[d+1] strength. Vacuum
// floors get no convective spread — neighbors don't heat each other in space.
function computeAllHeatMaps() {
  const nF = state.floors.length;
  const coolMult = techMult('cooling');
  // Per-floor heat sources and drain lists (fans are dead in vacuum)
  const srcByFloor = [], drainsByFloor = [];
  for (let f = 0; f < nF; f++) {
    const grid = state.floors[f];
    const space = isSpaceFloor(f);
    const src = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    const drains = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = grid[y][x];
        if (!c || c.cond <= 0) continue;
        src[y][x] = HEAT_SOURCE[c.t] || 0;
        const def = TILE_TYPES[c.t];
        if (def.drain && !(space && c.t === 'fan')) {
          drains.push({ x, y, drain: def.drain, vertical: !!def.vDrain });
        }
      }
    }
    srcByFloor.push(src);
    drainsByFloor.push(drains);
  }
  const maps = [];
  for (let f = 0; f < nF; f++) {
    const grid = state.floors[f];
    const topo = topoOf(f);
    const space = isSpaceFloor(f);
    const spread = space ? 0 : HEAT_SPREAD;
    const src = srcByFloor[f];
    const heat = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    // this floor's drains, plus vertical drains reaching from f±1 (one step
    // further). The building↔orbit seam is not a floor plate: vertical
    // effects never cross between ground and space.
    const reach = drainsByFloor[f].map((dr) => ({ ...dr, extra: 0 }));
    for (const vf of [f - 1, f + 1]) {
      if (vf < 0 || vf >= nF || isSpaceFloor(vf) !== isSpaceFloor(f)) continue;
      for (const dr of drainsByFloor[vf]) if (dr.vertical) reach.push({ ...dr, extra: 1 });
    }
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!grid[y][x]) continue;
        // Vacuum cuts both ways: neighbors can't heat you (spread 0), but your
        // own heat has nowhere to go without a radiator (retention ×2)
        let h = src[y][x] * (space ? VACUUM_HEAT_RETAIN : 1);
        for (const [dx, dy] of topo.dirs(x, y)) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS) h += src[ny][nx] * spread;
        }
        for (const dr of reach) {
          const d = topo.dist(dr.x, dr.y, x, y) + dr.extra;
          if (d < dr.drain.length) h -= dr.drain[d] * coolMult;
        }
        heat[y][x] = Math.max(0, Math.min(1, h / HEAT_CAP));
      }
    }
    maps.push(heat);
  }
  return maps;
}

// Synergy auras (issue #17 v1): tiles with an `aura` descriptor influence
// their neighborhood. Returns { boost, wear } grids — boost multiplies
// compute output (capped), wearGuard multiplies wear rate (floored).
// Auras, all floors at once. A tile with `aura.vertical` also projects onto
// the vertically adjacent cell (same x,y) one floor up/down — the seam the
// future networking tiles (#18/#45) will widen into cross-floor orchestration.
// Life support (#53): per-space-floor boolean coverage. Earth floors return
// null — the sky is a free life-support field.
function computeLifeSupportMaps() {
  return state.floors.map((grid, f) => {
    if (!isSpaceFloor(f)) return null;
    const topo = topoOf(f);
    const sources = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = grid[y][x];
        if (c && c.t === 'life' && c.cond > 0) sources.push({ x, y });
      }
    }
    const map = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    if (sources.length) {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          map[y][x] = sources.some((s) => topo.dist(s.x, s.y, x, y) <= lifeRange());
        }
      }
    }
    return map;
  });
}
function hasAir(lifeMaps, f, x, y) {
  const m = lifeMaps[f];
  return !m || m[y][x];
}

function computeAllAuraMaps() {
  const nF = state.floors.length;
  const maps = state.floors.map(() => ({
    boost: Array.from({ length: ROWS }, () => Array(COLS).fill(0)),
    wear: Array.from({ length: ROWS }, () => Array(COLS).fill(1)),
  }));
  const apply = (tf, tx, ty, srcType, aura) => {
    const target = state.floors[tf][ty][tx];
    if (!target || target.t === srcType) return; // auras don't self-farm
    const m = maps[tf];
    if (aura.boost && isCompute(target.t)) m.boost[ty][tx] = Math.min(AURA_BOOST_CAP, m.boost[ty][tx] + aura.boost);
    if (aura.wearGuard) m.wear[ty][tx] = Math.max(AURA_WEAR_FLOOR, m.wear[ty][tx] * aura.wearGuard);
  };
  for (let f = 0; f < nF; f++) {
    const grid = state.floors[f];
    const topo = topoOf(f);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = grid[y][x];
        if (!c || c.cond <= 0) continue;
        const aura = TILE_TYPES[c.t].aura;
        if (!aura) continue;
        for (let ty = 0; ty < ROWS; ty++) {
          for (let tx = 0; tx < COLS; tx++) {
            const d = topo.dist(tx, ty, x, y);
            if (d === 0 || d > aura.range) continue;
            apply(f, tx, ty, c.t, aura);
          }
        }
        if (aura.vertical) {
          for (const vf of [f - 1, f + 1]) {
            // straight up/down = distance 1; never across the building↔orbit seam
            if (vf >= 0 && vf < nF && isSpaceFloor(vf) === isSpaceFloor(f)) apply(vf, x, y, c.t, aura);
          }
        }
      }
    }
  }
  return maps;
}
function damageCell(x, y, amount) {
  const c = state.grid[y][x];
  if (!c) return;
  c.cond = Math.max(EVENT_COND_FLOOR, c.cond - amount);
  flashCell(x, y, 1);
  emitParticles(x, y, 5, '#ff4f6d');
}

// ---------- DOM refs ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const toolsEl = document.getElementById('tools');
const tooltipEl = document.getElementById('tooltip');
const tickerEl = document.getElementById('ticker');
const goalBarFill = document.getElementById('goal-bar-fill');
const goalText = document.getElementById('goal-text');

const hudCash = document.getElementById('hud-cash');
const hudCompute = document.getElementById('hud-compute');
const hudPower = document.getElementById('hud-power');
const hudCooling = document.getElementById('hud-cooling');
const hudRevenue = document.getElementById('hud-revenue');
const hudJobs = document.getElementById('hud-jobs');
const hudSentiment = document.getElementById('hud-sentiment');
const hudDebt = document.getElementById('hud-debt');
const hudEntropy = document.getElementById('hud-entropy');
const hudToken = document.getElementById('hud-token');

// ---------- Init ----------
function buildToolbar() {
  toolsEl.innerHTML = '';
  for (const layer of LAYERS) {
    const head = document.createElement('div');
    head.className = 'tool-layer';
    head.textContent = layer.name;
    toolsEl.appendChild(head);
    for (const id of layer.tiles) addToolButton(id);
  }
}

// Tiles physics forbids on space floors — visibly disabled in the palette
const SPACE_BLOCKED = { fan: 'no air to move', power: 'no oxygen to burn' };

function addToolButton(id) {
  const t = TILE_TYPES[id];
  const locked = t.gate && !state.unlocks[t.gate] && !state.god.freeBuild;
  const blocked = SPACE_BLOCKED[id] && isSpaceFloor(state.floor);
  const btn = document.createElement('button');
  btn.className = 'tool' + (id === state.selectedTool ? ' selected' : '') + (locked ? ' locked' : '') + (blocked ? ' disabled' : '');
  btn.dataset.tool = id;
  const u = t.gate && UNLOCKS[t.gate];
  const costLabel = blocked ? '🚫'
    : locked ? `🔒 ${u.cash != null ? '$' + u.cash.toLocaleString() : u.rp + ' RP'}`
    : id === 'bull' ? '↶' : '$' + t.cost;
  btn.innerHTML = `
    <span class="icon">${iconSvg(id)}</span>
    <span class="meta">
      <span class="name">${t.name}</span>
      <span class="sub">${locked ? `unlock: ${u.blurb}` : toolStat(id)}</span>
    </span>
    <span class="cost">${costLabel}</span>
  `;
  btn.addEventListener('click', () => {
    if (blocked) {
      pushTicker(`🛰 ${t.name}: ${SPACE_BLOCKED[id]} in vacuum`, 'bad');
      return;
    }
    if (t.gate && !state.unlocks[t.gate] && !state.god.freeBuild) {
      tryUnlock(t.gate);
      return;
    }
    state.selectedTool = id;
    buildToolbar();
  });
  btn.addEventListener('mouseenter', (e) => showTooltip(e, t.name + layerBadge(id), blocked ? `🚫 ${SPACE_BLOCKED[id]} in vacuum. ${t.desc}` : t.desc, t));
  btn.addEventListener('mousemove', moveTooltip);
  btn.addEventListener('mouseleave', hideTooltip);
  toolsEl.appendChild(btn);
}

// Everything beyond the minute-zero kit is earned — hardware costs cash,
// capabilities cost research points.
function tryUnlock(key) {
  const u = UNLOCKS[key];
  if (state.unlocks[key]) return;
  if (u.cash != null) {
    if (state.cash < u.cash) { pushTicker(`Unlock ${u.name}: need $${u.cash.toLocaleString()}`, 'bad'); return; }
    state.cash -= u.cash;
  } else {
    if (state.rp < u.rp) { pushTicker(`Unlock ${u.name}: need ${u.rp} RP — allocate compute to Research`, 'bad'); return; }
    state.rp -= u.rp;
  }
  state.unlocks[key] = true;
  pushTicker(`★ UNLOCKED: ${u.name}`, 'good');
  playStinger('research');
  buildToolbar();
  updateFinance();
}

function toolStat(id) {
  const t = TILE_TYPES[id];
  if (id === 'solar') return `≤${t.power} MW ☀`;
  if (id === 'power') return `+${t.power} MW`;
  if (id === 'fan') return `+${t.cooling} kW air`;
  if (t.cooling > 0) return `+${t.cooling} kW`;
  if (t.compute > 0) return `+${t.compute} TFLOPS`;
  if (id === 'desk') return `+15% compute`;
  if (id === 'retrain') return `+${t.jobs} jobs`;
  if (id === 'human') return `learns · ≤${HUMAN_MAX_TFLOPS} TFLOPS`;
  if (id === 'botbay') return `auto-repairs`;
  if (id === 'life') return `air · range ${LIFE_RANGE}`;
  if (t.power > 0) return `+${t.power} MW`;
  if (id === 'repair') return `fix damage`;
  if (id === 'bull') return `refund 50%`;
  return '';
}

function iconSvg(id) {
  const c = TILE_TYPES[id].accent || '#888';
  if (id === 'solar')   return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke-linecap="round"/></svg>`;
  if (id === 'power')   return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" stroke-linejoin="round"/></svg>`;
  if (id === 'fan')     return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 -1.5-6 -4-6 0 3 1.5 5 4 6zM14 12c4 0 6-1.5 6-4-3 0-5 1.5-6 4zM12 14c0 4 1.5 6 4 6 0-3-1.5-5-4-6zM10 12c-4 0-6 1.5-6 4 3 0 5-1.5 6-4z" stroke-linejoin="round"/></svg>`;
  if (id === 'cooler')  return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><path d="M12 3v18M3 12h18M5 5l14 14M19 5L5 19" stroke-linecap="round"/></svg>`;
  if (id === 'gpu1')    return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/></svg>`;
  if (id === 'gpu2')    return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><circle cx="8" cy="7.5" r="1.4"/><circle cx="16" cy="7.5" r="1.4"/><circle cx="8" cy="16.5" r="1.4"/><circle cx="16" cy="16.5" r="1.4"/></svg>`;
  if (id === 'cpu')     return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 6V3M15 6V3M9 21v-3M15 21v-3M6 9H3M6 15H3M21 9h-3M21 15h-3" stroke-linecap="round"/></svg>`;
  if (id === 'tpu')     return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/></svg>`;
  if (id === 'quantum') return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><circle cx="12" cy="12" r="1.8"/><ellipse cx="12" cy="12" rx="9" ry="3.8"/><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(120 12 12)"/></svg>`;
  if (id === 'exch')    return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><path d="M4 7h13l-3-3M20 17H7l3 3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12h16" stroke-dasharray="2 2"/></svg>`;
  if (id === 'immersion') return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><path d="M4 9c2-2 4 2 6 0s4 2 6 0 3 1 4 0" stroke-linecap="round"/><path d="M5 9v9a2 2 0 002 2h10a2 2 0 002-2V9" stroke-linecap="round"/><rect x="9" y="12" width="6" height="5" rx="0.8"/></svg>`;
  if (id === 'cryo')    return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><path d="M12 2v20M12 12l8-4.6M12 12L4 7.4M12 12l8 4.6M12 12L4 16.6M9.5 3.8l2.5 1.7 2.5-1.7M9.5 20.2l2.5-1.7 2.5 1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (id === 'desk')    return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><circle cx="12" cy="7" r="3"/><path d="M5 21v-2a4 4 0 014-4h6a4 4 0 014 4v2" stroke-linecap="round"/></svg>`;
  if (id === 'retrain') return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><path d="M12 4L2 9l10 5 10-5-10-5z" stroke-linejoin="round"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" stroke-linecap="round"/></svg>`;
  if (id === 'human')   return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><circle cx="9" cy="8" r="2.6"/><circle cx="16" cy="9.5" r="2.1"/><path d="M3.5 20v-1.5a4.5 4.5 0 014.5-4.5h2a4.5 4.5 0 014.5 4.5V20M14 14.4a3.8 3.8 0 016.5 2.7V20" stroke-linecap="round"/></svg>`;
  if (id === 'botbay')  return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><rect x="6" y="8" width="12" height="10" rx="2"/><circle cx="10" cy="12" r="1.2"/><circle cx="14" cy="12" r="1.2"/><path d="M12 8V5M9 5h6M9 18v2M15 18v2" stroke-linecap="round"/></svg>`;
  if (id === 'life')    return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><circle cx="10" cy="13" r="6"/><circle cx="17" cy="7" r="2.4"/><circle cx="18.5" cy="14" r="1.4"/></svg>`;
  if (id === 'fission') return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><circle cx="12" cy="12" r="2"/><path d="M12 9.8V4M13.9 13.1l5 2.9M10.1 13.1l-5 2.9" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke-dasharray="3.5 2.5"/></svg>`;
  if (id === 'repair')  return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><path d="M14.5 6.5a4 4 0 105.4 5.4L13 18.8a2.1 2.1 0 11-3-3l6.9-6.9a4 4 0 01-2.4-2.4z" stroke-linejoin="round" transform="rotate(90 12 12)"/></svg>`;
  if (id === 'bull')    return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><path d="M4 7l16 0M7 7v12a2 2 0 002 2h6a2 2 0 002-2V7M10 11v6M14 11v6M9 7l1-3h4l1 3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return '';
}

// ---------- Canvas sizing ----------
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);

function gridOrigin() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const b = state.topo.boardSize();
  return {
    x: Math.floor((w - b.w) / 2),
    y: Math.floor((h - b.h) / 2),
  };
}

function pickTile(mx, my) {
  const o = gridOrigin();
  return state.topo.pick(mx - o.x, my - o.y);
}

// ---------- Input ----------
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const t = pickTile(mx, my);
  state.hover = t ?? { x: -1, y: -1 };
  if (t) {
    const cell = state.grid[t.y][t.x];
    if (cell) {
      showCellTooltip(e, t.x, t.y, cell);
    } else {
      hideTooltip();
    }
  } else {
    hideTooltip();
  }
});
canvas.addEventListener('mouseleave', () => { state.hover = { x: -1, y: -1 }; hideTooltip(); });

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const t = pickTile(mx, my);
  if (!t) return;
  attemptPlace(t.x, t.y);
});

window.addEventListener('keydown', (e) => {
  const idx = TOOL_KEYS.indexOf(e.key);
  if (idx >= 0) {
    state.selectedTool = TOOL_ORDER[idx];
    buildToolbar();
  }
  if (e.key.toLowerCase() === 'm') { handleMute(); }
  if (e.key === 'PageUp') { setActiveFloor(state.floor + 1); e.preventDefault(); }
  if (e.key === 'PageDown') { setActiveFloor(state.floor - 1); e.preventDefault(); }
});

function attemptPlace(x, y) {
  const id = state.selectedTool;
  const existing = state.grid[y][x];

  if (id === 'bull') {
    if (!existing) return;
    const refund = Math.floor(TILE_TYPES[existing.t].cost * 0.5);
    state.cash += refund;
    state.grid[y][x] = null;
    flashCell(x, y, 1);
    pushTicker(`Bulldozed ${TILE_TYPES[existing.t].name} (+$${refund})`, 'warn');
    return;
  }

  if (id === 'repair') {
    if (!existing) return;
    if (existing.cond >= 100) { pushTicker(`${TILE_TYPES[existing.t].name} is in perfect condition`, ''); return; }
    const price = repairPrice(existing);
    if (!state.god.freeBuild && state.cash < price) {
      pushTicker(`Need $${price} to repair ${TILE_TYPES[existing.t].name}`, 'bad');
      return;
    }
    if (!state.god.freeBuild) state.cash -= price;
    existing.cond = 100;
    state.stats.manualRepairs++;
    flashCell(x, y, 1.2);
    emitParticles(x, y, 6, '#7dffa8');
    pushTicker(`Repaired ${TILE_TYPES[existing.t].name} (−$${price})`, 'good');
    playStinger('repair');
    return;
  }

  const def = TILE_TYPES[id];
  if (def.gate && !state.unlocks[def.gate] && !state.god.freeBuild) {
    pushTicker(`${def.name} is locked — unlock it in the Build panel`, 'bad');
    return;
  }
  if (id === 'fan' && isSpaceFloor(state.floor)) {
    pushTicker("🛰 No air in vacuum — fan walls don't work in space. Use liquid cooling on the walls.", 'bad');
    return;
  }
  if (id === 'power' && isSpaceFloor(state.floor)) {
    pushTicker('🛰 No oxygen in vacuum — combustion plants can\'t burn. Use solar or a Fission Core.', 'bad');
    return;
  }
  if (existing) {
    pushTicker(`Cell occupied — bulldoze first (press =)`, 'bad');
    return;
  }
  if (!state.god.freeBuild && state.cash < def.cost) {
    pushTicker(`Need $${def.cost} for ${def.name}`, 'bad');
    return;
  }
  if (state.mood === 'protest' && !state.god.freeBuild) {
    const now = performance.now();
    if (now < state.permitReadyAt) {
      const wait = Math.ceil((state.permitReadyAt - now) / 1000);
      pushTicker(`Permit office is slow-walking you — protests outside (${wait}s)`, 'bad');
      return;
    }
    state.permitReadyAt = now + PERMIT_DELAY_MS;
  }
  if (!state.god.freeBuild) state.cash -= def.cost;
  state.grid[y][x] = id === 'human' ? { t: id, cond: 100, skill: 0 } : { t: id, cond: 100 };
  flashCell(x, y, 1.2);
  emitParticles(x, y, 8, def.accent || '#4af0c0');
}

function flashCell(x, y, strength) {
  if (!visualsEnabled) return; // sim is visiting a floor the player isn't viewing
  state.flashes.set(`${x},${y}`, strength);
}

function emitParticles(gx, gy, count, color) {
  if (!visualsEnabled) return;
  const o = gridOrigin();
  const c = state.topo.center(gx, gy);
  const cx = o.x + c.cx;
  const cy = o.y + c.cy;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const sp = 60 + Math.random() * 80;
    state.particles.push({
      x: cx, y: cy,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
      life: 0.7 + Math.random() * 0.4, age: 0, color,
    });
  }
}

// ---------- Sim ----------
function tick() {
  state.tick++;
  // The sky has moods: solar output ebbs on a ~90s cycle
  state.sun = 0.6 + 0.4 * Math.sin((state.tick * TICK_MS / 1000) * 2 * Math.PI / SOLAR_PERIOD_S);
  const dtS = (TICK_MS / 1000) * (state.god.fast ? 5 : 1);
  const now = performance.now();

  // Expire timed entropy effects (effects are floor-tagged)
  state.effects = state.effects.filter((ef) => ef.until > now);
  const offline = new Set(
    state.effects.filter((ef) => ef.kind === 'crash' || ef.kind === 'botGlitch').map((ef) => `${ef.f || 0}:${ef.x},${ef.y}`),
  );
  const brownout = state.effects.some((ef) => ef.kind === 'brownout');

  // Tally power, cooling, upkeep, jobs across ALL floors — research and
  // condition scale supply; broken tiles supply nothing but bleed half upkeep
  let power = 0, cooling = 0, deskCount = 0, upkeep = 0, jobsCreated = 0;
  const lifeByFloor = computeLifeSupportMaps();
  state.lifeMap = lifeByFloor[state.floor];
  forEachFloor((f) => {
    const space = isSpaceFloor(f);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = state.grid[y][x];
        if (!c) continue;
        const t = TILE_TYPES[c.t];
        const broken = c.cond <= 0;
        upkeep += (t.upkeep || 0) * (broken ? 0.5 : 1);
        // Suffocating people tiles cost upkeep but contribute nothing
        const suffocating = PEOPLE_TILES.includes(c.t) && !hasAir(lifeByFloor, f, x, y);
        if (!suffocating) jobsCreated += t.jobs || 0;
        if (broken) continue;
        if (space && (c.t === 'fan' || c.t === 'power')) continue; // no air to move — or to burn
        const s = condScale(c);
        // Orbit gets constant, stronger sunlight; the ground gets the sky's moods
        if (c.t === 'solar') power += t.power * techMult('power') * s * (space ? spaceSolarMult() : state.sun);
        else if (t.power > 0) power += t.power * techMult('power') * s;
        // Wall-mounted cooling radiates through the envelope (vacuum doubles down)
        if (t.cooling > 0) cooling += t.cooling * techMult('cooling') * s * wallBonus(f, x, y);
        if (c.t === 'desk' && !suffocating) deskCount++;
      }
    }
  });

  // Each working compute tile draws from the SHARED pools; output scales with
  // research, condition, synergy auras, and the GPU adjacency cluster bonus
  const aurasByFloor = computeAllAuraMaps();
  const cellsByFloor = [];
  let powerUsed = 0, coolingUsed = 0, gpuTflops = 0;
  forEachFloor((f) => {
    const auras = aurasByFloor[f];
    cellsByFloor[f] = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = state.grid[y][x];
        if (!c || !isCompute(c.t) || c.cond <= 0 || offline.has(`${f}:${x},${y}`)) continue;
        const t = TILE_TYPES[c.t];
        // Clusters (GPUs only): +output per adjacent working GPU, but packed silicon runs hot
        const adjGpus = isGpu(c.t)
          ? Math.min(3, neighborCells(x, y).filter((n) => isGpu(n.c.t) && n.c.cond > 0).length)
          : 0;
        // Damaged silicon leaks: draw rises toward +60% as condition falls
        const needP = Math.abs(t.power) * (1 + DEGRADE_POWER_RISE * (1 - c.cond / 100));
        const needC = Math.abs(t.cooling) * (1 + GPU_ADJ_HEAT * adjGpus);
        if (power - powerUsed >= needP && cooling - coolingUsed >= needC) {
          powerUsed += needP;
          coolingUsed += needC;
          let out = t.compute * techMult('compute') * gpuCondScale(c) * (1 + GPU_ADJ_BONUS * adjGpus) * (1 + auras.boost[y][x]);
          if (brownout) out *= 0.8;
          gpuTflops += out;
          cellsByFloor[f].push({ x, y });
        }
      }
    }
  });
  state.auraMaps = aurasByFloor[state.floor];
  const computeCells = cellsByFloor[state.floor];
  // Cooling tiles and bot bays draw power after compute (never starve compute)
  const poweredBays = [];
  forEachFloor((f) => {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = state.grid[y][x];
        if (!c || c.cond <= 0) continue;
        const t = TILE_TYPES[c.t];
        const coolDraw = t.cooling > 0 ? Math.abs(Math.min(0, t.power)) : 0;
        if (coolDraw && power - powerUsed >= coolDraw) powerUsed += coolDraw;
        if (c.t === 'botbay' && !offline.has(`${f}:${x},${y}`) && power - powerUsed >= 2) {
          powerUsed += 2;
          poweredBays.push({ f, x, y });
        }
      }
    }
  });

  // Engineer multiplier (cap at 3 desks)
  const mult = Math.pow(TILE_TYPES.desk.multiplier, Math.min(deskCount, 3));
  let computeAdj = gpuTflops * mult;

  // Self-improvement: compute allocated to the AI improving itself compounds
  // output for ALL allocations — and feeds entropy below. The singularity dial.
  if (state.alloc.self > 0 && state.selfImprove < SELF_IMPROVE_CAP) {
    state.selfImprove = Math.min(
      SELF_IMPROVE_CAP,
      state.selfImprove + computeAdj * SELF_IMPROVE_RATE * state.alloc.self * dtS,
    );
  }
  computeAdj *= 1 + state.selfImprove;

  // Human tokens: skill-scaled and deliberately OUTSIDE every multiplier —
  // humans can't be upgraded by tech, desks, or a self-improving AI.
  // Suffocating pods (space, no life support) produce nothing.
  forEachFloor((f) => {
    for (const pod of cellsOf('human')) {
      if (!hasAir(lifeByFloor, f, pod.x, pod.y)) continue;
      computeAdj += HUMAN_MAX_TFLOPS * (pod.c.skill || 0) / 100;
    }
  });

  // Research allocation earns research points
  state.rp += computeAdj * RP_PER_TFLOPS * state.alloc.research * dtS;

  // Jobs ledger: selling compute displaces outside jobs; tiles create them.
  // Donated (UBC) compute doesn't displace, and the UBI dividend funds jobs
  // (previous tick's spend — steady-state correct).
  const ubcShare = state.alloc.ubc || 0;
  const jobsDisplaced = computeAdj * (1 - ubcShare) * JOBS_DISPLACED_PER_TFLOPS;
  const jobsFunded = (state.ubiSpend || 0) * UBI_JOBS_PER_DOLLAR;
  const netJobs = jobsCreated + jobsFunded - jobsDisplaced;

  // Sentiment drifts toward a target set by the jobs balance, plus the
  // goodwill from donated public compute (free AI for schools and clinics)
  const ubcSent = Math.min(UBC_SENT_CAP, computeAdj * ubcShare * UBC_SENT_PER_TFLOPS);
  if (state.god.pinSentiment) {
    state.sentiment = 75;
  } else {
    const target = Math.max(0, Math.min(100, 50 + netJobs + ubcSent));
    const drift = SENTIMENT_DRIFT * dtS;
    if (state.sentiment < target) state.sentiment = Math.min(target, state.sentiment + drift);
    else if (state.sentiment > target) state.sentiment = Math.max(target, state.sentiment - drift);
  }

  // Mood thresholds and their consequences
  const mood =
    state.sentiment >= GOODWILL_AT ? 'goodwill' :
    state.sentiment < PROTEST_AT ? 'protest' :
    state.sentiment < UNREST_AT ? 'unrest' : 'neutral';
  if (mood !== state.mood) announceMood(mood);
  state.mood = mood;

  let upkeepAdj = upkeep;
  if (mood === 'goodwill') upkeepAdj *= 0.85;
  if (mood === 'unrest' || mood === 'protest') upkeepAdj *= 1.25;
  if (mood === 'protest') computeAdj *= 0.5;

  // Heat maps: hot silicon wears faster, and hot floors feed entropy
  const heatByFloor = computeAllHeatMaps();
  let heatSum = 0, heatN = 0;
  forEachFloor((f) => {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = state.grid[y][x];
        if (c && HEAT_SOURCE[c.t]) { heatSum += heatByFloor[f][y][x]; heatN++; }
      }
    }
  });
  state.heatMap = heatByFloor[state.floor];
  const avgHeat = heatN ? heatSum / heatN : 0;

  // Entropy rises with compute, floor temperature, and self-improvement; it
  // accelerates wear and rolls events. Fades in gently below ~30 TFLOPS so the
  // early game stays fun. The dev dial (0×..25×) scales it for playtesting.
  const grace = Math.min(1, computeAdj / ENTROPY_GRACE_TFLOPS);
  const entropy01 = Math.min(
    1,
    ((1 - Math.exp(-computeAdj / ENTROPY_SCALE)) * grace
      + HEAT_ENTROPY * avgHeat * grace
      + SELF_IMPROVE_ENTROPY * state.selfImprove) * state.god.entropyMult,
  );
  state.entropy = entropy01 * 100;
  if (entropy01 > 0) maybeEntropyEvent(entropy01, now);

  // Music reacts: tension follows entropy and spikes when the city turns on you
  setTension(Math.max(entropy01, mood === 'protest' ? 0.85 : mood === 'unrest' ? 0.45 : 0));

  // Wear — exotic tech and entropy accelerate it; coolers shelter neighbors
  if (!state.god.noWear) {
    forEachFloor((f) => {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const c = state.grid[y][x];
          if (!c || c.cond <= 0) continue;
          const track = trackOf(c.t);
          const rate = TILE_TYPES[c.t].wear
            * (track ? Math.pow(RESEARCH_WEAR, state.tech[track]) : 1)
            * Math.pow(DURABILITY_WEAR_MULT, state.tech.durability || 0)
            * (1 + ENTROPY_WEAR_MULT * entropy01)
            * (1 + HEAT_WEAR_MULT * heatByFloor[f][y][x])
            * aurasByFloor[f].wear[y][x]
            * (isSpaceFloor(f) ? radiationWear() : 1);
          const before = c.cond;
          c.cond = Math.max(0, c.cond - rate * dtS);
          if (before > 0 && c.cond <= 0) {
            pushTicker(`${TILE_TYPES[c.t].name} BROKE DOWN — repair it (press -)`, 'bad');
            flashCell(x, y, 1.2);
            emitParticles(x, y, 8, '#ff4f6d');
            playStinger('breakdown');
          }
        }
      }
    });
  }

  // Humans learn: the AI tutors pods near working same-floor GPUs (distance
  // falloff), and pods teach each other across shared edges. Skill only grows.
  forEachFloor((f) => {
    for (const pod of cellsOf('human')) {
      if (!hasAir(lifeByFloor, f, pod.x, pod.y)) continue; // can't learn while suffocating
      let gain = 0;
      for (const g of cellsByFloor[f]) {
        const d = state.topo.dist(g.x, g.y, pod.x, pod.y);
        if (d < HUMAN_LEARN_GPU.length) gain += HUMAN_LEARN_GPU[d];
      }
      gain = Math.min(HUMAN_LEARN_CAP, gain);
      for (const n of neighborCells(pod.x, pod.y)) {
        if (n.c.t === 'human' && (n.c.skill || 0) > (pod.c.skill || 0)) {
          gain += (n.c.skill - pod.c.skill) * HUMAN_PEER_RATE;
        }
      }
      if (gain > 0) pod.c.skill = Math.min(100, (pod.c.skill || 0) + gain * dtS);
    }
  });

  // Bot bays: each powered bay repairs the most-damaged other tile on ITS
  // floor every 4s
  if (poweredBays.length && state.tick % BOT_PERIOD_TICKS === 0) {
    forEachFloor((f) => {
      for (const bay of poweredBays) {
        if (bay.f !== f) continue;
        let target = null;
        for (let y = 0; y < ROWS; y++) {
          for (let x = 0; x < COLS; x++) {
            const c = state.grid[y][x];
            if (!c || c.cond >= 100 || (x === bay.x && y === bay.y)) continue;
            if (!target || c.cond < target.c.cond) target = { x, y, c };
          }
        }
        if (!target) continue;
        const heal = Math.min(BOT_HEAL, 100 - target.c.cond);
        const price = Math.ceil(TILE_TYPES[target.c.t].cost * REPAIR_COST_FRAC * (heal / 100) * BOT_REPAIR_DISCOUNT);
        if (!state.god.freeBuild && state.cash < price) continue;
        if (!state.god.freeBuild) state.cash -= price;
        target.c.cond += heal;
        emitParticles(target.x, target.y, 3, '#9aa5ff');
        flashCell(target.x, target.y, 0.6);
      }
    });
  }

  // Token market: a happy city buys more tokens. Demand follows sentiment;
  // the market itself wobbles a little, mean-reverting to 1.0.
  state.market = Math.max(MARKET_MIN, Math.min(MARKET_MAX,
    state.market + (Math.random() - 0.5) * MARKET_WOBBLE + (1 - state.market) * MARKET_REVERT));
  const demand = DEMAND_BASE + DEMAND_PER_SENTIMENT * state.sentiment;
  state.tokenPrice = REVENUE_PER_TFLOPS * demand * state.market * state.god.revenueMult;
  state.priceHistory.push(state.tokenPrice);
  if (state.priceHistory.length > PRICE_HISTORY_LEN) {
    state.priceHistory.splice(0, state.priceHistory.length - PRICE_HISTORY_LEN);
  }

  // Revenue (only the SOLD share of compute, at the live token price)
  const revPerSec = computeAdj * state.tokenPrice * state.alloc.sell;
  const gross = revPerSec * dtS;
  let income = gross;
  // Universal Basic Income: the UBI allocation share is sold too, but the
  // proceeds are paid straight out as a public dividend (funds jobs above)
  state.ubiSpend = computeAdj * state.tokenPrice * (state.alloc.ubi || 0);
  // Futures delivery: the player chooses how hard to service contracts —
  // pay back early at 100% withholding or take their time at 10%. FIFO.
  if (state.futures.length > 0) {
    let budget = gross * state.futuresRate;
    while (budget > 0 && state.futures.length > 0) {
      const c = state.futures[0];
      const pay = Math.min(c.owed, budget);
      c.owed -= pay;
      budget -= pay;
      income -= pay;
      if (c.owed <= 0.001) {
        state.futures.shift();
        pushTicker(`📜 Futures contract delivered${state.futures.length ? ` — ${state.futures.length} still open` : ' — full revenue restored'}`, 'good');
      } else {
        break;
      }
    }
  }
  if (state.debt > 0) {
    const pay = Math.min(state.debt, Math.max(gross * LOAN_REVENUE_SHARE, LOAN_MIN_PAY * dtS));
    state.debt -= pay;
    income -= pay;
    if (state.debt <= 0) {
      state.debt = 0;
      pushTicker('Loan repaid in full — the bank sends a fruit basket', 'good');
    }
  }
  // Maintain allocation (moved from the old Finance radios): that slice of
  // compute is sold and the proceeds accumulate into the repair pool…
  state.maintainPool += computeAdj * state.tokenPrice * (state.alloc.maintain || 0) * dtS;
  const upkeepThisTick = upkeepAdj * dtS;
  state.cash += income - upkeepThisTick;
  if (state.cash > (state.stats.peakCash || 0)) state.stats.peakCash = state.cash;

  // Insolvency (#28): below $0 a countdown runs; recover (bulldoze refunds,
  // a loan) and it clears. Sustained insolvency ends the run. freeBuild suspends.
  if (state.cash < 0 && !state.god.freeBuild && !state.bankrupt) {
    if (state.insolvencyS === 0) {
      pushTicker(`⚠ INSOLVENT — sell tiles or take a loan. Bankruptcy in ${BANKRUPT_AFTER_S}s`, 'bad');
      playStinger('alarm');
    }
    state.insolvencyS += dtS;
    if (state.insolvencyS >= BANKRUPT_AFTER_S) declareBankruptcy();
  } else if (state.cash >= 0 && state.insolvencyS > 0) {
    state.insolvencyS = 0;
    pushTicker('Back in the black — creditors stand down', 'good');
  }

  // …and the pool continuously heals the most-damaged tile it can afford.
  // Outsourced upkeep is pricey (MAINTAIN_RATE × manual), and tiles that
  // were let slip below WORN_AT pay a catch-up premium — bays (×0.6) and
  // future L5 robots are how you make maintenance cheap again.
  if (state.maintainPool > 0) {
    let target = null;
    forEachFloor((f) => {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const c = state.grid[y][x];
          if (c && c.cond < 100 && (!target || c.cond < target.c.cond)) target = { f, x, y, c };
        }
      }
    });
    if (target) {
      const premium = target.c.cond < WORN_AT ? CATCHUP_PREMIUM : 1;
      const perPoint = TILE_TYPES[target.c.t].cost * REPAIR_COST_FRAC * 0.01 * MAINTAIN_RATE * premium;
      const points = Math.min(100 - target.c.cond, state.maintainPool / perPoint);
      if (points > 0.1) {
        target.c.cond += points;
        state.maintainPool -= points * perPoint;
        if (target.f === state.floor && state.tick % 8 === 0) {
          emitParticles(target.x, target.y, 2, '#7dffa8');
        }
      }
    }
  }

  // Particles on producing GPUs (small chance each tick)
  if (computeCells.length > 0 && Math.random() < 0.4) {
    const cell = computeCells[Math.floor(Math.random() * computeCells.length)];
    emitParticles(cell.x, cell.y, 1, '#4af0c0');
    flashCell(cell.x, cell.y, 0.5);
  }

  state.totalPower = power;
  state.totalCooling = cooling;
  state.powerUsed = powerUsed;
  state.coolingUsed = coolingUsed;
  state.totalCompute = computeAdj;
  state.upkeep = upkeepAdj;
  state.revenue = revPerSec - upkeepAdj;
  state.jobsCreated = jobsCreated;
  state.jobsDisplaced = jobsDisplaced;
  state.netJobs = netJobs;

  if (!state.goalUnlocked && state.cash >= GOAL) {
    state.goalUnlocked = true;
    goalText.textContent = 'Dyson Sphere blueprint unlocked. The full game begins.';
    pushTicker('★ GOAL UNLOCKED — Dyson Sphere blueprint acquired', 'good');
    playStinger('goal');
    // celebratory particle burst
    for (let i = 0; i < 60; i++) {
      const gx = Math.floor(Math.random() * COLS);
      const gy = Math.floor(Math.random() * ROWS);
      emitParticles(gx, gy, 3, '#4af0c0');
    }
    showDemoEnd();
  }

  updateHUD();
  updateTutorial();
}

// Entropy events — the menu of failure modes grows with what you own
function maybeEntropyEvent(entropy01, now) {
  if (Math.random() >= EVENT_CHANCE * Math.pow(entropy01, 1.5)) return;
  const plants = cellsOf('power');
  const coolers = cellsOf('cooler');
  const gpus = cellsOf(...COMPUTE_IDS).filter((g) => g.c.cond > 0);
  const bays = cellsOf('botbay');

  const pool = [];
  if (plants.length >= 2) pool.push('surge');
  if (coolers.length >= 1) pool.push('leak');
  if (gpus.length >= 1 && (state.tech.compute >= 1 || gpus.some((g) => TILE_TYPES[g.c.t].gate))) pool.push('crash');
  if (state.entropy > 70 && gpus.length >= 1) pool.push('brownout');
  if (state.entropy > 50 && bays.length >= 1) pool.push('botGlitch');
  if (!pool.length) return;

  const kind = pool[Math.floor(Math.random() * pool.length)];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  playStinger('alarm');

  if (kind === 'surge') {
    const p = pick(plants);
    damageCell(p.x, p.y, 30);
    pushTicker('⚡ Power surge — a plant took 30 damage', 'bad');
  } else if (kind === 'leak') {
    const cl = pick(coolers);
    damageCell(cl.x, cl.y, 25);
    for (const n of neighborCells(cl.x, cl.y)) {
      if (isCompute(n.c.t)) damageCell(n.x, n.y, 10);
    }
    pushTicker('💧 Coolant leak — loop and adjacent silicon damaged', 'bad');
  } else if (kind === 'crash') {
    const g = pick(gpus);
    state.effects.push({ kind: 'crash', f: state.floor, x: g.x, y: g.y, until: now + 8000 });
    flashCell(g.x, g.y, 1);
    pushTicker('🖥 Driver crash — a GPU rack is offline for 8s', 'warn');
  } else if (kind === 'brownout') {
    state.effects.push({ kind: 'brownout', until: now + 10000 });
    pushTicker('🌆 Grid brownout — all GPU output −20% for 10s', 'warn');
  } else if (kind === 'botGlitch') {
    const b = pick(bays);
    state.effects.push({ kind: 'botGlitch', f: state.floor, x: b.x, y: b.y, until: now + 10000 });
    flashCell(b.x, b.y, 1);
    pushTicker('🤖 Bot glitch — a repair bay is rebooting for 10s', 'warn');
  }
}

function announceMood(mood) {
  if (mood === 'goodwill') pushTicker('Community praises your jobs program — utility rebate granted (−15% upkeep)', 'good');
  if (mood === 'neutral') pushTicker('Public mood is neutral — the city is watching', '');
  if (mood === 'unrest') pushTicker('Layoff headlines spread — power surcharge imposed (+25% upkeep)', 'warn');
  if (mood === 'protest') pushTicker('PROTESTS outside the datacenter — output halved, permits delayed', 'bad');
}

// Where the paid game will live. Empty until the Steam page exists — the
// end-of-demo button reads "coming soon" until this is set.
const STEAM_STORE_URL = '';

function showDemoEnd() {
  const el = document.getElementById('demo-end');
  if (!el) return;
  document.getElementById('demo-end-stats').innerHTML = `
    <div class="tip-row"><span>Final compute</span><span class="v">${state.totalCompute.toFixed(1)} TFLOPS</span></div>
    <div class="tip-row"><span>Floors built</span><span class="v">${state.floors.length}</span></div>
    <div class="tip-row"><span>Public opinion</span><span class="v">${Math.round(state.sentiment)}%</span></div>
    <div class="tip-row"><span>Run length</span><span class="v">${Math.round(state.tick * TICK_MS / 1000 / 60)} min</span></div>`;
  const wl = document.getElementById('btn-wishlist');
  if (STEAM_STORE_URL) {
    wl.textContent = '⭐ Wishlist the full game on Steam';
    wl.addEventListener('click', () => window.open(STEAM_STORE_URL, '_blank'));
  } else {
    wl.textContent = '⭐ Full game coming to Steam';
    wl.disabled = true;
  }
  el.hidden = false;
}

function declareBankruptcy() {
  if (state.bankrupt) return;
  state.bankrupt = true;
  playStinger('breakdown');
  const el = document.getElementById('gameover');
  if (!el) return;
  let floors = state.floors.length;
  document.getElementById('gameover-stats').innerHTML = `
    <div class="tip-row"><span>Peak cash</span><span class="v">$${Math.floor(state.stats.peakCash || 0).toLocaleString()}</span></div>
    <div class="tip-row"><span>Peak compute</span><span class="v">${state.totalCompute.toFixed(1)} TFLOPS</span></div>
    <div class="tip-row"><span>Floors built</span><span class="v">${floors}</span></div>
    <div class="tip-row"><span>Run length</span><span class="v">${Math.round(state.tick * TICK_MS / 1000 / 60)} min</span></div>`;
  el.hidden = false;
}

function updateInsolvencyBanner() {
  const el = document.getElementById('insolvency');
  if (!el) return;
  const active = state.insolvencyS > 0 && !state.bankrupt;
  el.hidden = !active;
  if (active) {
    const left = Math.max(0, Math.ceil(BANKRUPT_AFTER_S - state.insolvencyS));
    el.textContent = `⚠ INSOLVENT — sell tiles (=) or take a loan · bankruptcy in ${left}s`;
  }
}

// Token price sparkline (#22): ride the demand curve instead of reading one
// number. Dashed line = base price; the curve colors by where you are now.
function drawSparkline() {
  const cv = document.getElementById('token-spark');
  if (!cv) return;
  const c2 = cv.getContext('2d');
  const hist = state.priceHistory;
  c2.clearRect(0, 0, cv.width, cv.height);
  if (hist.length < 2) return;
  const lo = Math.min(...hist, REVENUE_PER_TFLOPS) * 0.98;
  const hi = Math.max(...hist, REVENUE_PER_TFLOPS) * 1.02;
  const yOf = (v) => cv.height - 1 - ((v - lo) / (hi - lo)) * (cv.height - 2);
  // base price line
  c2.strokeStyle = 'rgba(255,255,255,0.25)';
  c2.setLineDash([2, 2]);
  c2.beginPath();
  c2.moveTo(0, yOf(REVENUE_PER_TFLOPS));
  c2.lineTo(cv.width, yOf(REVENUE_PER_TFLOPS));
  c2.stroke();
  c2.setLineDash([]);
  // the curve
  c2.strokeStyle = state.tokenPrice >= REVENUE_PER_TFLOPS ? '#4af0c0' : '#ff4f6d';
  c2.lineWidth = 1.2;
  c2.beginPath();
  hist.forEach((v, i) => {
    const x = (i / (PRICE_HISTORY_LEN - 1)) * cv.width;
    if (i === 0) c2.moveTo(x, yOf(v)); else c2.lineTo(x, yOf(v));
  });
  c2.stroke();
}

function updateHUD() {
  hudCash.textContent = `$${Math.floor(state.cash).toLocaleString()}`;
  hudCash.classList.toggle('neg', state.cash < 0);
  updateInsolvencyBanner();
  hudCompute.textContent = `${state.totalCompute.toFixed(1)} TFLOPS`;
  hudPower.textContent = `${Math.round(state.powerUsed)} / ${Math.round(state.totalPower)} MW`;
  hudCooling.textContent = `${Math.round(state.coolingUsed)} / ${Math.round(state.totalCooling)} kW`;
  const r = state.revenue;
  hudRevenue.textContent = `${r >= 0 ? '+' : ''}$${r.toFixed(1)}/s`;
  hudRevenue.classList.toggle('pos', r >= 0);
  hudRevenue.classList.toggle('neg', r < 0);
  const nj = state.netJobs;
  hudJobs.textContent = `${nj >= 0 ? '+' : ''}${Math.round(nj)}`;
  hudJobs.classList.toggle('pos', nj >= 0);
  hudJobs.classList.toggle('neg', nj < 0);
  hudSentiment.textContent = `${Math.round(state.sentiment)}%`;
  hudSentiment.classList.toggle('pos', state.sentiment >= GOODWILL_AT);
  hudSentiment.classList.toggle('neg', state.sentiment < UNREST_AT);
  hudDebt.textContent = state.debt > 0 ? `$${Math.ceil(state.debt).toLocaleString()}` : '—';
  hudDebt.classList.toggle('neg', state.debt > 0);
  hudEntropy.textContent = `${Math.round(state.entropy)}%`;
  hudEntropy.classList.toggle('neg', state.entropy > 70);
  const hist = state.priceHistory;
  const mean = hist.length > 10 ? hist.reduce((a, b) => a + b, 0) / hist.length : state.tokenPrice;
  const trend = state.tokenPrice > mean * 1.02 ? ' ↗' : state.tokenPrice < mean * 0.98 ? ' ↘' : ' →';
  hudToken.textContent = `$${state.tokenPrice.toFixed(2)}${trend}`;
  hudToken.classList.toggle('pos', state.tokenPrice >= REVENUE_PER_TFLOPS * 1.1);
  hudToken.classList.toggle('neg', state.tokenPrice < REVENUE_PER_TFLOPS * 0.9);
  drawSparkline();
  goalBarFill.style.width = Math.min(100, (state.cash / GOAL) * 100) + '%';
  updateResearch();
  updateFinance();
  updateAllocation();
}

setInterval(tick, TICK_MS);

// ---------- Render ----------
function render(dt) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  // Subtle starfield
  ctx.save();
  ctx.globalAlpha = 0.4;
  for (let i = 0; i < 80; i++) {
    const sx = (i * 73 + state.tick * 0.04) % w;
    const sy = (i * 131 + state.tick * 0.02) % h;
    ctx.fillStyle = i % 5 === 0 ? '#4af0c0' : '#3a4768';
    ctx.fillRect(sx, sy, 1, 1);
  }
  ctx.restore();

  const o = gridOrigin();

  // Grid background panel
  const board = state.topo.boardSize();
  ctx.fillStyle = 'rgba(20, 28, 50, 0.5)';
  ctx.fillRect(o.x - 8, o.y - 8, board.w + 16, board.h + 16);
  ctx.strokeStyle = 'rgba(74, 240, 192, 0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(o.x - 8 + 0.5, o.y - 8 + 0.5, board.w + 16, board.h + 16);

  // Tiles
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cell = state.grid[y][x];
      const c = state.topo.center(x, y);
      drawCell(o.x + c.cx, o.y + c.cy, cell, x, y);
    }
  }

  // Hover ghost
  if (state.hover.x >= 0) {
    const id = state.selectedTool;
    const def = TILE_TYPES[id];
    const c = state.topo.center(state.hover.x, state.hover.y);
    ctx.save();
    ctx.globalAlpha = 0.4;
    const canAfford = state.god.freeBuild || state.cash >= def.cost;
    const occupied = !!state.grid[state.hover.y][state.hover.x];
    if (id === 'bull') {
      ctx.fillStyle = occupied ? '#ff4f6d' : '#333';
    } else if (id === 'repair') {
      ctx.fillStyle = occupied ? '#7dffa8' : '#333';
    } else if (!canAfford || occupied) {
      ctx.fillStyle = '#ff4f6d';
    } else {
      ctx.fillStyle = def.accent || '#4af0c0';
    }
    state.topo.trace(ctx, o.x + c.cx, o.y + c.cy, 2);
    ctx.fill();
    ctx.restore();
    drawInfluenceOverlay(o);
  }

  // Particles
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.age += dt;
    if (p.age >= p.life) { state.particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 80 * dt;
    const t = p.age / p.life;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = p.color;
    const sz = 3 * (1 - t * 0.7);
    ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    ctx.restore();
  }

  // Decay flashes
  for (const [k, v] of state.flashes) {
    const nv = v - dt * 2.4;
    if (nv <= 0) state.flashes.delete(k);
    else state.flashes.set(k, nv);
  }
}

// ---------- Influence visualization ----------
// What would this tile touch? Pure geometry — returns [{x, y, kind, strength}]
// for the hovered tool/tile so the renderer (and tests) can show the
// neighborhood a placement decision actually affects.
// kinds: boost (aura), guard (wearGuard), drain (cooling), air (life support),
//        cluster (GPU partners), heat (cluster cooling cost)
function influencedCells(def, x, y) {
  const out = [];
  const push = (tx, ty, kind, strength) => {
    if (tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && !(tx === x && ty === y)) {
      out.push({ x: tx, y: ty, kind, strength });
    }
  };
  if (def.aura) {
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        const d = state.topo.dist(tx, ty, x, y);
        if (d === 0 || d > def.aura.range) continue;
        if (def.aura.boost) push(tx, ty, 'boost', 1);
        if (def.aura.wearGuard) push(tx, ty, 'guard', 1);
      }
    }
  }
  if (def.drain) {
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        const d = state.topo.dist(tx, ty, x, y);
        if (d === 0 || d >= def.drain.length) continue;
        push(tx, ty, 'drain', def.drain[d] / def.drain[0]);
      }
    }
  }
  if (def === TILE_TYPES.life) {
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        const d = state.topo.dist(tx, ty, x, y);
        if (d > 0 && d <= lifeRange()) push(tx, ty, 'air', 1);
      }
    }
  }
  if (def.compute > 0 && (def === TILE_TYPES.gpu1 || def === TILE_TYPES.gpu2)) {
    for (const [dx, dy] of state.topo.dirs(x, y)) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const n = state.grid[ny][nx];
      if (n && isGpu(n.t)) push(nx, ny, 'cluster', 1);
    }
  }
  return out;
}
window.__influence = influencedCells; // test handles
window.__tileDef = (id) => TILE_TYPES[id];

const INFLUENCE_STYLE = {
  boost: { stroke: '#4af0c0', fill: 'rgba(74, 240, 192, 0.10)' },
  guard: { stroke: '#4fb7ff', fill: 'rgba(79, 183, 255, 0.10)' },
  drain: { stroke: '#6ec5ff', fill: 'rgba(110, 197, 255, 0.12)' },
  air: { stroke: '#7ee7ff', fill: 'rgba(126, 231, 255, 0.10)' },
  cluster: { stroke: '#4af0c0', fill: 'rgba(74, 240, 192, 0.14)' },
};

// Dashed outlines + soft fills over every cell the hovered tool/tile touches.
function drawInfluenceOverlay(o) {
  const hx = state.hover.x, hy = state.hover.y;
  if (hx < 0) return;
  const existing = state.grid[hy][hx];
  const toolDef = TILE_TYPES[state.selectedTool];
  // Hovering a placed tile shows ITS reach; otherwise preview the selected tool
  const def = existing ? TILE_TYPES[existing.t]
    : (state.selectedTool === 'bull' || state.selectedTool === 'repair') ? null : toolDef;
  if (!def) return;
  const cells = influencedCells(def, hx, hy);
  if (!cells.length) return;
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.4;
  for (const cell of cells) {
    const style = INFLUENCE_STYLE[cell.kind];
    if (!style) continue;
    const c = state.topo.center(cell.x, cell.y);
    ctx.globalAlpha = 0.5 + 0.5 * (cell.strength || 1);
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    state.topo.trace(ctx, o.x + c.cx, o.y + c.cy, 3);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// (cx, cy) is the cell CENTER in canvas pixels — the topology traces the
// outline, so square and hex floors share this entire function.
function drawCell(cx, cy, cell, gx, gy) {
  const id = cell ? cell.t : 'empty';
  const def = TILE_TYPES[id];
  const broken = cell && cell.cond <= 0;
  const tri = state.topo.key === 'tri';
  // Base — non-square lattices get a visible seam between cells so dense
  // builds don't blend into one mass (playtest: "overlapping, hard to see")
  const seam = state.topo.key === 'square' ? 0 : 1.2;
  ctx.fillStyle = !cell ? '#0c1124' : def.color;
  state.topo.trace(ctx, cx, cy, seam);
  ctx.fill();
  // Subtle inner panel
  if (cell) {
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    state.topo.trace(ctx, cx, cy, seam + 3);
    ctx.fill();
  }
  // Grid lines — brighter off-square, where orientation carries information
  ctx.strokeStyle = state.topo.key === 'square' ? 'rgba(74, 240, 192, 0.06)' : 'rgba(74, 240, 192, 0.16)';
  state.topo.trace(ctx, cx, cy, seam);
  ctx.stroke();

  // Pulse from flash
  const flash = state.flashes.get(`${gx},${gy}`) || 0;
  if (flash > 0 && def.accent) {
    ctx.save();
    ctx.globalAlpha = flash;
    ctx.fillStyle = def.accent;
    state.topo.trace(ctx, cx, cy, 2);
    ctx.fill();
    ctx.restore();
  }

  // Glyph — scaled down on triangles, whose inradius is smaller than a
  // square's half-width; anchored slightly toward the shape's fat side
  if (cell && def.accent) {
    ctx.save();
    if (broken) ctx.globalAlpha = 0.35;
    if (tri) {
      ctx.translate(cx, cy);
      ctx.scale(0.72, 0.72);
      ctx.translate(-cx, -cy);
    }
    drawGlyph(ctx, cx, cy, id, def.accent);
    ctx.restore();
  }

  if (!cell) return;

  // Temperature tint — hot tiles glow red-orange (heat map updated each tick)
  const heat = state.heatMap ? state.heatMap[gy][gx] : 0;
  if (heat > 0.05) {
    ctx.save();
    ctx.globalAlpha = heat * 0.30;
    ctx.fillStyle = '#ff5a28';
    state.topo.trace(ctx, cx, cy, 1);
    ctx.fill();
    ctx.restore();
  }

  // Suffocation warning — people without air in space pulse a cold blue veil
  if (PEOPLE_TILES.includes(cell.t) && state.lifeMap && !state.lifeMap[gy][gx]) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.2 * Math.sin(state.tick * 0.5);
    ctx.fillStyle = '#3a7bd5';
    state.topo.trace(ctx, cx, cy, 1);
    ctx.fill();
    ctx.restore();
  }

  // Skill bar for humans — fills up as they learn (the inverse of wear).
  // Bars must stay INSIDE the cell: triangles are shorter below the centroid
  // than squares, so their bar hugs the glyph instead of the cell edge.
  const barY = tri ? cy + 10 : cy + TILE / 2 - 8;
  const bw = tri ? TILE - 36 : TILE - 24;
  if (cell.t === 'human') {
    const skill = cell.skill || 0;
    if (skill < 100) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(cx - bw / 2, barY, bw, 3);
      ctx.fillStyle = '#ff9ecf';
      ctx.fillRect(cx - bw / 2, barY, bw * skill / 100, 3);
    }
    return; // humans don't wear, break, or overheat-tint their own bar
  }

  // Condition bar (only once it matters)
  if (cell.cond < 100) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(cx - bw / 2, barY, bw, 3);
    ctx.fillStyle = cell.cond >= 70 ? '#4af0c0' : cell.cond >= WORN_AT ? '#ffd24a' : '#ff4f6d';
    ctx.fillRect(cx - bw / 2, barY, bw * Math.max(0, cell.cond) / 100, 3);
  }

  // Broken: dark veil + red cross
  if (broken) {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 18, 0.55)';
    state.topo.trace(ctx, cx, cy, 1);
    ctx.fill();
    ctx.strokeStyle = '#ff4f6d';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(state.tick * 0.4 + gx + gy);
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy - 10); ctx.lineTo(cx + 10, cy + 10);
    ctx.moveTo(cx + 10, cy - 10); ctx.lineTo(cx - 10, cy + 10);
    ctx.stroke();
    ctx.restore();
  }

  // Offline (driver crash / bot glitch): pause bars (inside the cell on tri)
  if (state.effects.some((ef) => (ef.f || 0) === state.floor && ef.x === gx && ef.y === gy && (ef.kind === 'crash' || ef.kind === 'botGlitch'))) {
    ctx.save();
    ctx.fillStyle = '#6ec5ff';
    ctx.globalAlpha = 0.9;
    const obX = tri ? cx + 6 : cx + TILE / 2 - 16;
    const obY = tri ? cy - 8 : cy - TILE / 2 + 6;
    ctx.fillRect(obX, obY, 3, 9);
    ctx.fillRect(obX + 6, obY, 3, 9);
    ctx.restore();
  }
}

function drawGlyph(ctx, cx, cy, id, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const s = 12;
  if (id === 'power') {
    ctx.beginPath();
    ctx.moveTo(cx - 2, cy - s);
    ctx.lineTo(cx - s, cy + 2);
    ctx.lineTo(cx - 1, cy + 2);
    ctx.lineTo(cx + 2, cy + s);
    ctx.lineTo(cx + s, cy - 2);
    ctx.lineTo(cx + 1, cy - 2);
    ctx.closePath();
    ctx.stroke();
  } else if (id === 'cooler') {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s);
    ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
    ctx.moveTo(cx - s + 3, cy - s + 3); ctx.lineTo(cx + s - 3, cy + s - 3);
    ctx.moveTo(cx + s - 3, cy - s + 3); ctx.lineTo(cx - s + 3, cy + s - 3);
    ctx.stroke();
  } else if (id === 'gpu1' || id === 'gpu2') {
    ctx.strokeRect(cx - s + 1, cy - s + 4, (s - 1) * 2, (s - 4) * 2);
    ctx.beginPath();
    ctx.arc(cx - 5, cy + 1, 2.5, 0, Math.PI * 2);
    ctx.arc(cx + 5, cy + 1, 2.5, 0, Math.PI * 2);
    ctx.stroke();
    if (id === 'gpu2') {
      ctx.beginPath();
      ctx.moveTo(cx - s + 1, cy); ctx.lineTo(cx + s - 1, cy);
      ctx.stroke();
    }
  } else if (id === 'life') {
    // bubbles
    ctx.beginPath(); ctx.arc(cx - 2, cy + 2, 6.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 6, cy - 5, 3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 8, cy + 4, 1.6, 0, Math.PI * 2); ctx.stroke();
  } else if (id === 'fission') {
    // atom core with three spokes and a dashed containment ring
    ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4);
      ctx.lineTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10);
      ctx.stroke();
    }
    ctx.save();
    ctx.setLineDash([3, 2.5]);
    ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  } else if (id === 'exch') {
    // counterflow arrows
    ctx.beginPath();
    ctx.moveTo(cx - s + 1, cy - 5); ctx.lineTo(cx + s - 3, cy - 5); ctx.lineTo(cx + s - 7, cy - 9);
    ctx.moveTo(cx + s - 1, cy + 5); ctx.lineTo(cx - s + 3, cy + 5); ctx.lineTo(cx - s + 7, cy + 9);
    ctx.stroke();
  } else if (id === 'immersion') {
    // tank with wavy surface and a submerged rack
    ctx.beginPath();
    ctx.moveTo(cx - s + 2, cy - 4);
    ctx.quadraticCurveTo(cx - s / 2, cy - 8, cx, cy - 4);
    ctx.quadraticCurveTo(cx + s / 2, cy, cx + s - 2, cy - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s + 3, cy - 4); ctx.lineTo(cx - s + 3, cy + s - 3);
    ctx.lineTo(cx + s - 3, cy + s - 3); ctx.lineTo(cx + s - 3, cy - 4);
    ctx.stroke();
    ctx.strokeRect(cx - 4, cy, 8, 6);
  } else if (id === 'cryo') {
    // snowflake
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
      ctx.moveTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
      ctx.lineTo(cx + Math.cos(a + 0.5) * 10, cy + Math.sin(a + 0.5) * 10);
      ctx.moveTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
      ctx.lineTo(cx + Math.cos(a - 0.5) * 10, cy + Math.sin(a - 0.5) * 10);
      ctx.stroke();
    }
  } else if (id === 'cpu') {
    // chip: die + pins
    ctx.strokeRect(cx - 7, cy - 7, 14, 14);
    ctx.strokeRect(cx - 3, cy - 3, 6, 6);
    ctx.beginPath();
    for (const d of [-4, 0, 4]) {
      ctx.moveTo(cx + d, cy - 7); ctx.lineTo(cx + d, cy - s + 1);
      ctx.moveTo(cx + d, cy + 7); ctx.lineTo(cx + d, cy + s - 1);
      ctx.moveTo(cx - 7, cy + d); ctx.lineTo(cx - s + 1, cy + d);
      ctx.moveTo(cx + 7, cy + d); ctx.lineTo(cx + s - 1, cy + d);
    }
    ctx.stroke();
  } else if (id === 'tpu') {
    // systolic array: square with grid
    ctx.strokeRect(cx - s + 2, cy - s + 2, (s - 2) * 2, (s - 2) * 2);
    ctx.beginPath();
    for (const d of [-3.3, 3.3]) {
      ctx.moveTo(cx - s + 2, cy + d); ctx.lineTo(cx + s - 2, cy + d);
      ctx.moveTo(cx + d, cy - s + 2); ctx.lineTo(cx + d, cy + s - 2);
    }
    ctx.stroke();
  } else if (id === 'quantum') {
    // atom: nucleus + orbits
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.stroke();
    for (const rot of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, s - 1, 4.5, rot, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (id === 'desk') {
    ctx.beginPath();
    ctx.arc(cx, cy - 4, 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + s - 1);
    ctx.quadraticCurveTo(cx, cy - 1, cx + s, cy + s - 1);
    ctx.stroke();
  } else if (id === 'solar') {
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 7.5, cy + Math.sin(a) * 7.5);
      ctx.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
      ctx.stroke();
    }
  } else if (id === 'fan') {
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4);
      ctx.quadraticCurveTo(
        cx + Math.cos(a + 0.5) * s, cy + Math.sin(a + 0.5) * s,
        cx + Math.cos(a + 0.9) * 6, cy + Math.sin(a + 0.9) * 6,
      );
      ctx.stroke();
    }
  } else if (id === 'retrain') {
    // graduation cap: diamond + tassel line
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx - s, cy - 2);
    ctx.lineTo(cx, cy + 3);
    ctx.lineTo(cx + s, cy - 2);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + 1);
    ctx.lineTo(cx - 6, cy + 7);
    ctx.moveTo(cx + 6, cy + 1);
    ctx.lineTo(cx + 6, cy + 7);
    ctx.moveTo(cx - 6, cy + 7);
    ctx.quadraticCurveTo(cx, cy + 10, cx + 6, cy + 7);
    ctx.stroke();
  } else if (id === 'human') {
    // two people: heads + shoulders
    ctx.beginPath();
    ctx.arc(cx - 4, cy - 4, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 5, cy - 2.5, 2.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + s - 2);
    ctx.quadraticCurveTo(cx - 4, cy + 1, cx + 2, cy + s - 2);
    ctx.moveTo(cx + 1, cy + s - 2);
    ctx.quadraticCurveTo(cx + 5, cy + 3, cx + 10, cy + s - 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- Tooltip ----------
function showTooltip(e, title, desc, def) {
  if (!desc) { hideTooltip(); return; }
  tooltipEl.hidden = false;
  let rows = '';
  if (def?.cost) rows += `<div class="tip-row"><span>Cost</span><span class="v">$${def.cost}</span></div>`;
  if (def?.power) rows += `<div class="tip-row"><span>Power</span><span class="v">${def.power > 0 ? '+' : ''}${def.power} MW</span></div>`;
  if (def?.cooling) rows += `<div class="tip-row"><span>Cooling</span><span class="v">${def.cooling > 0 ? '+' : ''}${def.cooling} kW</span></div>`;
  if (def?.cooling > 0) rows += `<div class="tip-row"><span>🧱 On a wall</span><span class="v">×${PERIMETER_COOL_BONUS} supply (×${VACUUM_WALL_BONUS} in space)</span></div>`;
  if (def?.compute) rows += `<div class="tip-row"><span>Compute</span><span class="v">${def.compute} TFLOPS</span></div>`;
  if (def?.upkeep) rows += `<div class="tip-row"><span>Upkeep</span><span class="v">$${def.upkeep.toFixed(2)}/s</span></div>`;
  if (def?.jobs) rows += `<div class="tip-row"><span>Jobs</span><span class="v">+${def.jobs}</span></div>`;
  tooltipEl.innerHTML = `<div class="tip-title">${title}</div><div style="color:var(--text-muted);font-size:11px;margin-top:4px;">${desc}</div>${rows}`;
  moveTooltip(e);
}
function showCellTooltip(e, x, y, cell) {
  const def = TILE_TYPES[cell.t];
  tooltipEl.hidden = false;
  let rows = `<div class="tip-row"><span>Condition</span><span class="v">${Math.round(cell.cond)}%${cell.cond <= 0 ? ' · BROKEN' : cell.cond < WORN_AT ? ' · worn' : ''}</span></div>`;
  if (cell.cond < 100) rows += `<div class="tip-row"><span>Repair</span><span class="v">$${repairPrice(cell)}</span></div>`;
  const h = state.heatMap ? state.heatMap[y][x] : 0;
  if (cell.t === 'solar') {
    rows += `<div class="tip-row"><span>Sun</span><span class="v">${Math.round(state.sun * 100)}% (${(TILE_TYPES.solar.power * state.sun).toFixed(1)} MW now)</span></div>`;
  }
  if (cell.t === 'human') {
    const tutors = cellsOf('gpu1', 'gpu2').filter((g) => g.c.cond > 0
      && state.topo.dist(g.x, g.y, x, y) < HUMAN_LEARN_GPU.length).length;
    const peers = neighborCells(x, y).filter((n) => n.c.t === 'human').length;
    rows = `<div class="tip-row"><span>Skill</span><span class="v">${Math.round(cell.skill || 0)}%</span></div>`
      + `<div class="tip-row"><span>Output</span><span class="v">${(HUMAN_MAX_TFLOPS * (cell.skill || 0) / 100).toFixed(1)} TFLOPS</span></div>`
      + `<div class="tip-row"><span>Learning</span><span class="v">${tutors} GPU${tutors === 1 ? '' : 's'} · ${peers} peer${peers === 1 ? '' : 's'}</span></div>`;
    tooltipEl.innerHTML = `<div class="tip-title">${def.name}</div><div style="color:var(--text-muted);font-size:11px;margin-top:4px;">${def.desc}</div>${rows}`;
    moveTooltip(e);
    return;
  }
  const hLabel = h < 0.15 ? 'cool' : h < 0.4 ? 'warm' : h < 0.7 ? 'HOT' : 'OVERHEATING';
  rows += `<div class="tip-row"><span>Heat</span><span class="v">${Math.round(h * 100)}% · ${hLabel} (wear +${Math.round(h * 100)}%)</span></div>`;
  if (isGpu(cell.t)) {
    const adjGpus = Math.min(3, neighborCells(x, y).filter((n) => isGpu(n.c.t) && n.c.cond > 0).length);
    if (adjGpus) rows += `<div class="tip-row"><span>Cluster</span><span class="v">+${adjGpus * 10}% out · +${Math.round(adjGpus * GPU_ADJ_HEAT * 100)}% cooling need</span></div>`;
  }
  if (state.auraMaps) {
    const b = state.auraMaps.boost[y][x], w = state.auraMaps.wear[y][x];
    if (b > 0) rows += `<div class="tip-row"><span>Synergy</span><span class="v">+${Math.round(b * 100)}% out</span></div>`;
    if (w < 1) rows += `<div class="tip-row"><span>Wear guard</span><span class="v">×${w.toFixed(2)}</span></div>`;
  }
  if (def.cooling > 0 && isPerimeter(x, y)) {
    const wb = wallBonus(state.floor, x, y);
    rows += `<div class="tip-row"><span>${isSpaceFloor(state.floor) ? '🛰 Radiator' : '🧱 Wall-mounted'}</span><span class="v">×${wb.toFixed(2)} supply</span></div>`;
  }
  if (PEOPLE_TILES.includes(cell.t) && state.lifeMap && !state.lifeMap[y][x]) {
    rows += `<div class="tip-row"><span>🫧 NO AIR</span><span class="v">suffocating — build Life Support (u) within ${lifeRange()}</span></div>`;
  }
  tooltipEl.innerHTML = `<div class="tip-title">${def.name}${layerBadge(cell.t)}</div><div style="color:var(--text-muted);font-size:11px;margin-top:4px;">${def.desc}</div>${rows}`;
  moveTooltip(e);
}

function layerBadge(id) {
  const layer = LAYERS.find((l) => l.tiles.includes(id));
  return layer && !layer.name.includes('Tools') ? ` <span class="tip-layer">${layer.name}</span>` : '';
}

function moveTooltip(e) {
  if (tooltipEl.hidden) return;
  const x = Math.min(window.innerWidth - 260, e.clientX + 12);
  const y = Math.min(window.innerHeight - 140, e.clientY + 12);
  tooltipEl.style.left = x + 'px';
  tooltipEl.style.top = y + 'px';
}
function hideTooltip() { tooltipEl.hidden = true; }

// ---------- Ticker ----------
function pushTicker(text, cls = '') {
  const el = document.createElement('div');
  el.className = `ticker-item ${cls}`;
  el.textContent = text;
  tickerEl.appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

// ---------- Allocation UI ----------
// Five sliders, normalized to shares: where the AI's tokens go. UBI is a
// full member of the group — its share is sold and the proceeds paid out
// as a public dividend, so it rebalances against the others with no cap.
const allocEl = document.getElementById('allocation');
const ALLOC_LABELS = { sell: '💰 Sell', research: '🔬 Research', self: '🧠 Improve', ubc: '🎁 Public', ubi: '🤝 UBI', maintain: '🔧 Maintain' };

function buildAllocation() {
  // Seed slider positions from state.alloc so a restored save keeps its mix
  allocEl.innerHTML = Object.keys(ALLOC_LABELS).map((k) => `
    <div class="alloc-row">
      <span class="alloc-name">${ALLOC_LABELS[k]}</span>
      <input type="range" min="0" max="100" value="${Math.round((state.alloc[k] || 0) * 100)}" data-alloc="${k}" />
      <span class="alloc-pct" data-pct="${k}">—</span>
    </div>`).join('') + '<div class="fin-status" id="alloc-note" hidden></div>';
  for (const r of allocEl.querySelectorAll('input[data-alloc]')) {
    r.addEventListener('input', readAllocSliders);
  }
  readAllocSliders();
}

function readAllocSliders() {
  const raw = {};
  let sum = 0;
  for (const r of allocEl.querySelectorAll('input[data-alloc]')) {
    raw[r.dataset.alloc] = +r.value;
    sum += +r.value;
  }
  for (const k of Object.keys(ALLOC_LABELS)) {
    state.alloc[k] = sum > 0 ? raw[k] / sum : (k === 'sell' ? 1 : 0);
  }
  for (const el of allocEl.querySelectorAll('[data-pct]')) {
    el.textContent = `${Math.round(state.alloc[el.dataset.pct] * 100)}%`;
  }
}

function updateAllocation() {
  const note = document.getElementById('alloc-note');
  if (!note) return;
  const lines = [];
  if (state.selfImprove > 0) {
    lines.push(`🧠 Self-improvement: output ×${(1 + state.selfImprove).toFixed(2)}${state.selfImprove >= SELF_IMPROVE_CAP ? ' (MAX)' : ''}`);
  }
  if ((state.ubiSpend || 0) > 0.005) {
    lines.push(`🤝 UBI $${state.ubiSpend.toFixed(2)}/s → +${(state.ubiSpend * UBI_JOBS_PER_DOLLAR).toFixed(1)} jobs`);
  }
  const ubcTf = state.totalCompute * (state.alloc.ubc || 0);
  if (ubcTf > 0.05) {
    lines.push(`🎁 Public compute ${ubcTf.toFixed(1)} TF → +${Math.min(UBC_SENT_CAP, ubcTf * UBC_SENT_PER_TFLOPS).toFixed(0)} mood`);
  }
  if ((state.alloc.maintain || 0) > 0 || state.maintainPool > 1) {
    lines.push(`🔧 Repair pool $${Math.floor(state.maintainPool).toLocaleString()}`);
  }
  note.hidden = lines.length === 0;
  note.textContent = lines.join(' · '); note.title = lines.join('\n');
}

// ---------- Research UI ----------
const researchEl = document.getElementById('research');

function buildResearch() {
  researchEl.innerHTML = '';
  let lastBranch = null;
  for (const key of Object.keys(RESEARCH)) {
    const branch = RESEARCH[key].space ? '🛰 SPACE — beyond the blueprint' : 'CORE';
    if (branch !== lastBranch) {
      const head = document.createElement('div');
      head.className = 'research-branch';
      head.textContent = branch;
      researchEl.appendChild(head);
      lastBranch = branch;
    }
    const row = document.createElement('div');
    row.className = 'research-row';
    row.dataset.track = key;
    row.innerHTML = `
      <div class="research-main">
        <span class="research-name">${RESEARCH[key].name}</span>
        <span class="research-desc">${RESEARCH[key].desc || ''}</span>
      </div>
      <span class="research-pips" data-pips></span>
      <button class="research-btn" data-buy></button>
    `;
    row.querySelector('[data-buy]').addEventListener('click', () => buyResearch(key));
    researchEl.appendChild(row);
  }
  document.getElementById('btn-research').addEventListener('click', () => {
    document.getElementById('research-modal').hidden = false;
    updateResearch();
  });
  document.getElementById('research-close').addEventListener('click', () => {
    document.getElementById('research-modal').hidden = true;
  });
  updateResearch();
}

function buyResearch(key) {
  const lvl = state.tech[key];
  if (lvl >= RESEARCH[key].costs.length) return;
  if (RESEARCH[key].space && !state.goalUnlocked) {
    pushTicker('🛰 Space research needs the Dyson Sphere blueprint first', 'bad');
    return;
  }
  const cost = RESEARCH[key].costs[lvl];
  if (!state.god.freeBuild && state.rp < cost) {
    pushTicker(`Need ${cost} RP for ${RESEARCH[key].name} ${['II', 'III'][lvl]} — allocate compute to Research`, 'bad');
    return;
  }
  if (!state.god.freeBuild) state.rp -= cost;
  state.tech[key]++;
  pushTicker(`★ ${RESEARCH[key].name} ${['II', 'III'][lvl]} researched — ${RESEARCH[key].desc || ''}`, 'good');
  playStinger('research');
  updateResearch();
}

function updateResearch() {
  const openBtn = document.getElementById('btn-research');
  if (openBtn) openBtn.textContent = `🔬 Research · ${state.rp.toFixed(1)} RP`;
  const title = document.getElementById('research-modal-title');
  if (title) title.textContent = `🔬 RESEARCH — ${state.rp.toFixed(1)} RP`;
  for (const row of researchEl.querySelectorAll('.research-row')) {
    const key = row.dataset.track;
    const lvl = state.tech[key];
    const pips = row.querySelector('[data-pips]');
    pips.textContent = ['I', 'II', 'III'].map((r, i) => (i <= lvl ? '●' : '○')).join(' ');
    const btn = row.querySelector('[data-buy]');
    if (RESEARCH[key].space && !state.goalUnlocked) {
      btn.textContent = '🔒';
      btn.disabled = true;
    } else if (lvl >= RESEARCH[key].costs.length) {
      btn.textContent = 'MAX';
      btn.disabled = true;
    } else {
      btn.textContent = `${RESEARCH[key].costs[lvl]} RP`;
      btn.disabled = !state.god.freeBuild && state.rp < RESEARCH[key].costs[lvl];
    }
  }
}

// ---------- Finance UI ----------
const financeEl = document.getElementById('finance');

function buildFinance() {
  financeEl.innerHTML = `
    <div class="fin-loans"></div>
    <div class="fin-status" data-debt hidden></div>
    <div class="fin-row">
      <button class="fin-btn" data-buy-floor>
        <span data-buy-floor-label>🏢 Buy Floor 2</span>
        <span class="fin-sub" data-buy-floor-sub></span>
      </button>
      <button class="fin-btn" data-hex-unlock>
        <span>⬡ Hex Lattice</span>
        <span class="fin-sub">${UNLOCKS.hex.rp} RP — 6-way floors</span>
      </button>
    </div>
    <button class="fin-btn" data-space>
      <span>🛰 Launch Space Station</span>
      <span class="fin-sub">$${SPACE_STATION_COST.toLocaleString()} — triangle lattice, vacuum rules</span>
    </button>
    <button class="fin-btn" data-futures>
      <span>📜 Sell compute futures</span>
      <span class="fin-sub" data-futures-sub></span>
    </button>
    <div class="fin-status" data-owed hidden></div>
    <div class="fin-frate" hidden>
      <span class="fin-frate-label" title="Share of revenue withheld to deliver open contracts">Delivery</span>
      <label><input type="radio" name="frate" value="0.1" /> 10%</label>
      <label><input type="radio" name="frate" value="0.25" /> 25%</label>
      <label><input type="radio" name="frate" value="0.5" checked /> 50%</label>
      <label><input type="radio" name="frate" value="1" /> 100%</label>
    </div>
  `;
  const loansEl = financeEl.querySelector('.fin-loans');
  LOANS.forEach((loan, i) => {
    const btn = document.createElement('button');
    btn.className = 'fin-btn';
    btn.dataset.loan = i;
    btn.innerHTML = `<span>💳 $${loan.amount.toLocaleString()}</span><span class="fin-sub" title="repay $${loan.repay.toLocaleString()}">↩$${loan.repay.toLocaleString()}</span>`;
    btn.addEventListener('click', () => takeLoan(i));
    loansEl.appendChild(btn);
  });
  financeEl.querySelector('[data-futures]').addEventListener('click', sellFutures);
  for (const radio of financeEl.querySelectorAll('input[name="frate"]')) {
    if (parseFloat(radio.value) === state.futuresRate) radio.checked = true;
    radio.addEventListener('change', () => {
      state.futuresRate = parseFloat(radio.value);
      pushTicker(`📜 Delivery rate set to ${Math.round(state.futuresRate * 100)}% of revenue`, '');
    });
  }
  financeEl.querySelector('[data-buy-floor]').addEventListener('click', buyFloor);
  financeEl.querySelector('[data-hex-unlock]').addEventListener('click', () => tryUnlock('hex'));
  financeEl.querySelector('[data-space]').addEventListener('click', buySpaceStation);
  updateFinance();
}

function takeLoan(i) {
  if (state.debt > 0) { pushTicker('The bank wants the current loan repaid first', 'warn'); return; }
  const loan = LOANS[i];
  state.cash += loan.amount;
  state.debt = loan.repay;
  pushTicker(`Borrowed $${loan.amount.toLocaleString()} — ${Math.round(LOAN_REVENUE_SHARE * 100)}% of revenue goes to the bank until $${loan.repay.toLocaleString()} is repaid`, 'warn');
  playStinger('cash');
  updateFinance();
}

// Contract slots grow with the 📜 Contracts research: 1 → 3 → 5.
function maxContracts() {
  return 1 + 2 * (state.tech.contracts || 0);
}
function futuresOwedTotal() {
  return state.futures.reduce((a, c) => a + c.owed, 0);
}

function sellFutures() {
  if (state.futures.length >= maxContracts()) {
    pushTicker(`All ${maxContracts()} contract slots delivering — research 📜 Contracts for more`, 'warn');
    return;
  }
  const revPerSec = state.totalCompute * state.tokenPrice;
  if (state.totalCompute < FUTURES_UNLOCK_TFLOPS) {
    pushTicker(`Futures desk opens at ${FUTURES_UNLOCK_TFLOPS} TFLOPS`, 'warn');
    return;
  }
  const advance = Math.floor((1 - FUTURES_DISCOUNT) * revPerSec * FUTURES_WINDOW_S);
  const owed = revPerSec * FUTURES_WINDOW_S;
  state.cash += advance;
  state.futures.push({ owed, total: owed });
  pushTicker(`Sold ${FUTURES_WINDOW_S}s of compute forward for $${advance.toLocaleString()} (${state.futures.length}/${maxContracts()} contracts) — delivery rate is yours to set`, 'warn');
  playStinger('cash');
  updateFinance();
}

function updateFinance() {
  const debtEl = financeEl.querySelector('[data-debt]');
  const owedEl = financeEl.querySelector('[data-owed]');
  const futBtn = financeEl.querySelector('[data-futures]');
  const futSub = financeEl.querySelector('[data-futures-sub]');
  for (const btn of financeEl.querySelectorAll('[data-loan]')) {
    btn.disabled = state.debt > 0;
  }
  debtEl.hidden = state.debt <= 0;
  if (state.debt > 0) debtEl.textContent = `Repaying: $${Math.ceil(state.debt).toLocaleString()} left`;
  const revPerSec = state.totalCompute * state.tokenPrice;
  const advance = Math.floor((1 - FUTURES_DISCOUNT) * revPerSec * FUTURES_WINDOW_S);
  const locked = state.totalCompute < FUTURES_UNLOCK_TFLOPS;
  futBtn.disabled = locked || state.futures.length >= maxContracts();
  futSub.textContent = locked
    ? `unlocks at ${FUTURES_UNLOCK_TFLOPS} TFLOPS`
    : `+$${advance.toLocaleString()} now`;
  const owedTotal = futuresOwedTotal();
  owedEl.hidden = owedTotal <= 0;
  if (owedTotal > 0) owedEl.textContent = `Delivering ${state.futures.length}/${maxContracts()}: $${Math.ceil(owedTotal).toLocaleString()} left`;
  const rateRow = financeEl.querySelector('.fin-frate');
  if (rateRow) rateRow.hidden = owedTotal <= 0;
  const floorBtn = financeEl.querySelector('[data-buy-floor]');
  if (floorBtn) {
    const cost = nextFloorCost();
    floorBtn.hidden = cost == null;
    if (cost != null) {
      floorBtn.disabled = !state.god.freeBuild && state.cash < cost;
      const hexNext = state.unlocks.hex;
      floorBtn.querySelector('[data-buy-floor-label]').textContent = `${hexNext ? '⬡' : '🏢'} Buy Floor ${groundFloorCount() + 1}`;
      floorBtn.querySelector('[data-buy-floor-sub]').textContent = `$${cost.toLocaleString()} — ${hexNext ? 'hex lattice' : 'grow the tower'}`;
    }
  }
  const hexBtn = financeEl.querySelector('[data-hex-unlock]');
  if (hexBtn) {
    // surfaces once research has begun; gone once unlocked or tower complete
    hexBtn.hidden = state.unlocks.hex || nextFloorCost() == null || (state.rp < 1 && state.tech.compute === 0);
    hexBtn.disabled = !state.god.freeBuild && state.rp < UNLOCKS.hex.rp;
  }
  const spaceBtn = financeEl.querySelector('[data-space]');
  if (spaceBtn) {
    // the demo's cliffhanger becomes a door: appears with the blueprint
    spaceBtn.hidden = !state.goalUnlocked || (state.floorSpace || []).some(Boolean);
    spaceBtn.disabled = !state.god.freeBuild && state.cash < SPACE_STATION_COST;
  }
}

// ---------- God-mode dev panel ----------
const devBody = document.getElementById('dev-body');
document.getElementById('dev-toggle').addEventListener('click', () => {
  devBody.hidden = !devBody.hidden;
});
for (const box of devBody.querySelectorAll('input[data-god]')) {
  box.addEventListener('change', () => {
    state.god[box.dataset.god] = box.checked;
    pushTicker(`DEV: ${box.dataset.god} ${box.checked ? 'ON' : 'OFF'}`, 'warn');
    updateHUD();
  });
}
for (const radio of devBody.querySelectorAll('input[name="god-entropy"]')) {
  radio.addEventListener('change', () => {
    state.god.entropyMult = parseFloat(radio.value);
    if (state.god.entropyMult === 0) { state.effects = []; state.entropy = 0; }
    pushTicker(`DEV: entropy ×${radio.value}`, 'warn');
    updateHUD();
  });
}
for (const radio of devBody.querySelectorAll('input[name="god-revenue"]')) {
  radio.addEventListener('change', () => {
    state.god.revenueMult = parseFloat(radio.value);
    pushTicker(`DEV: revenue ×${radio.value}`, 'warn');
    updateHUD();
  });
}
document.getElementById('dev-cash').addEventListener('click', () => {
  state.cash += 10000;
  pushTicker('DEV: +$10,000', 'warn');
  updateHUD();
});

// ---------- Tutorial ----------
const tutorialEl = document.getElementById('tutorial');
const tutTextEl = document.getElementById('tut-text');
const tutProgressEl = document.getElementById('tut-progress');
const has = (...types) => cellsOf(...types).length > 0;

const TUTORIAL = [
  { text: 'Power first: a cheap Solar Array (1) or a steady Power Plant (2).', done: () => has('power', 'solar') },
  { text: 'Add cooling: a Fan Wall (3) is cheap, a Coolant Loop (4) reaches farther.', done: () => has('cooler', 'fan') },
  { text: 'Place a GPU Rack (5) close to your cooling — cooler tiles wear slower.', done: () => has('gpu1', 'gpu2') },
  { text: 'Cluster a second GPU against the first: +10% output, but watch the heat glow.', done: () => cellsOf('gpu1', 'gpu2').some((g) => neighborCells(g.x, g.y).some((n) => isGpu(n.c.t))) },
  { text: 'Cash trickles early. Take the $1,000 loan (Finance panel) and expand.', done: () => state.debt > 0 },
  { text: 'Watch Jobs & Public in the HUD — a Retraining Ctr. (8) keeps the city on your side, and a happy city pays more per token.', done: () => has('retrain') || state.sentiment >= GOODWILL_AT },
  { text: 'Equipment wears out — repair damaged tiles by hand (-).', done: () => state.stats.manualRepairs > 0 },
  { text: 'Divert tokens: slide some compute into Research (Allocation panel).', done: () => state.alloc.research > 0 },
  { text: 'Spend research points on an upgrade — or save 20 RP to unlock Ops Automation.', done: () => state.tech.power + state.tech.cooling + state.tech.compute > 0 || state.unlocks.ops },
];

function updateTutorial() {
  if (state.tutStep >= TUTORIAL.length) return;
  // Advance through every already-satisfied step (players run ahead of the script)
  let advanced = false;
  while (state.tutStep < TUTORIAL.length && TUTORIAL[state.tutStep].done()) {
    state.tutStep++;
    advanced = true;
  }
  if (advanced) playStinger('repair');
  if (state.tutStep >= TUTORIAL.length) {
    tutorialEl.hidden = true;
    pushTicker('Tutorial complete — now reach $1,000,000', 'good');
    return;
  }
  tutTextEl.textContent = TUTORIAL[state.tutStep].text;
  tutProgressEl.textContent = `${state.tutStep + 1} / ${TUTORIAL.length}`;
}

document.getElementById('tut-skip').addEventListener('click', () => {
  state.tutStep = TUTORIAL.length;
  tutorialEl.hidden = true;
});

// ---------- Audio UI ----------
const muteBtn = document.getElementById('music-mute');
const volumeEl = document.getElementById('music-volume');
const vibesEl = document.getElementById('music-vibes');
let muted = false;

// Music starts on the first interaction anywhere — no blocking prompt
function bootAudioOnce() {
  document.removeEventListener('pointerdown', bootAudioOnce);
  startAudio('hopeful').then(() => {
    setMusicVolume(parseInt(volumeEl.value, 10) / 100);
    pushTicker('♪ Music on — swap vibes in the Music panel, M to mute', '');
  });
}
document.addEventListener('pointerdown', bootAudioOnce);

vibesEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('.music-vibe');
  if (!btn) return;
  const vibe = btn.dataset.vibe;
  if (!isAudioStarted()) {
    pushTicker('Click "enable music" first', 'warn');
    return;
  }
  for (const b of vibesEl.querySelectorAll('.music-vibe')) b.classList.remove('selected');
  btn.classList.add('selected');
  await swapVibe(vibe);
  pushTicker(`Switched to ${btn.textContent}`, '');
});

volumeEl.addEventListener('input', () => {
  setMusicVolume(parseInt(volumeEl.value, 10) / 100);
});

muteBtn.addEventListener('click', handleMute);
function handleMute() {
  if (!isAudioStarted()) return;
  muted = toggleMute();
  muteBtn.classList.toggle('muted', muted);
  muteBtn.textContent = muted ? 'unmute' : 'mute';
}

// ---------- Modal ----------
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modal-body');
const modalClose = document.getElementById('modal-close');
const btnHelp = document.getElementById('btn-help');
modalBody.innerHTML = `
  <p>You run a tiny AI data center. Build the right tiles to turn power and cooling into compute and cash.</p>
  <ul>
    <li><strong>Power Plants</strong> supply MW. Without power, GPUs idle.</li>
    <li><strong>Coolant Loops</strong> supply cooling. GPUs need both.</li>
    <li><strong>GPU Racks</strong> produce TFLOPS, which auto-sell as compute contracts.</li>
    <li><strong>Engineer Desks</strong> boost compute output by 15% each (max 3).</li>
    <li><strong>Jobs &amp; Public mood:</strong> selling compute displaces jobs in the city; your buildings (especially <strong>Retraining Centers</strong>) create them. A happy city <strong>buys more tokens</strong> — the Token \$ price in the HUD rises and falls with sentiment (plus market wobble). Let it slide and you'll face surcharges, halved output, and permit delays.</li>
    <li><strong>Heat:</strong> GPUs and Power Plants run hot (tiles glow red); heat accelerates wear and feeds entropy. Coolant Loops drain heat with distance falloff — the closer the loop, the cooler the silicon.</li>
    <li><strong>Wear &amp; repair:</strong> everything degrades — GPU output fades with condition, broken tiles stop. Repair by hand (press <kbd>8</kbd>) or place <strong>Bot Bays</strong> to automate it. GPU clusters compute up to 30% more but need more cooling.</li>
    <li><strong>Research:</strong> upgrade Power, Cooling, or Compute — each level boosts output ×1.4 but the exotic tech wears ×1.6 faster.</li>
    <li><strong>Allocation:</strong> decide where your AI's tokens go — <em>Sell</em> for cash, <em>Research</em> for research points (buys tech and unlocks), or <em>Self-improve</em> for compounding output that feeds entropy. The singularity dial is yours.</li>
    <li><strong>Unlocks:</strong> anything marked 🔒 in the Build panel is earned — hardware costs cash, capabilities cost research points. Ops Automation opens Bot Bays; the 🔧 Maintain allocation funds automatic repairs.</li>
    <li><strong>Finance:</strong> take a loan (repaid from revenue, with interest) or sell compute futures once you're big enough. Leverage is how you escape the early grind.</li>
    <li><strong>Entropy:</strong> the more compute you run, the faster things wear and the weirder the failures get. The machine pushes back.</li>
    <li><strong>Worker Pods:</strong> humans output tokens as they learn — the AI trains them when they sit near working GPUs, and they teach each other. They can't be upgraded, but they also never break.</li>
    <li>Press <kbd>1</kbd>–<kbd>0</kbd>, <kbd>-</kbd> (repair), <kbd>=</kbd> (bulldoze) to pick tools. <kbd>M</kbd> to mute. Use the Music panel to swap vibes.</li>
  </ul>
  <p>Reach <strong>$1,000,000</strong> to unlock the Dyson Sphere blueprint — the prologue to the full game.</p>
`;
btnHelp.addEventListener('click', () => { modal.hidden = false; });
modalClose.addEventListener('click', () => { modal.hidden = true; });

// ---------- Game loop ----------
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  render(dt);
  requestAnimationFrame(loop);
}

// ---------- Persistence ----------
const SAVE_KEY = 'stm-save-v1';
// Allowlist: stable game state. Skip derived (revenue, totalCompute…), transient
// (hover, particles, flashes, effects with performance.now() deadlines), and dev
// (god). `tick` is kept so the solar/starfield cycles resume in place.
const SAVE_KEYS = [
  'cash', 'floors', 'floor', 'selectedTool', 'tick',
  'sentiment', 'mood', 'market',
  'alloc', 'rp', 'selfImprove', 'unlocks',
  'tech', 'debt', 'futures', 'futuresRate', 'maintainPool', 'floorTopos', 'floorSpace',
  'entropy', 'tutStep', 'stats', 'goalUnlocked', 'insolvencyS', 'bankrupt',
];

function saveState() {
  try {
    const snap = { _v: 1 };
    for (const k of SAVE_KEYS) snap[k] = state[k];
    localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
  } catch (e) { /* quota or sandbox — silently skip */ }
}

function loadState() {
  let raw;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  if (!raw) return false;
  let snap;
  try { snap = JSON.parse(raw); } catch (e) { return false; }
  if (!snap || snap._v !== 1) return false;
  if (snap.grid && !snap.floors) snap.floors = [snap.grid]; // pre-floors save
  if (snap.floors && !snap.floorTopos) snap.floorTopos = snap.floors.map(() => 'square'); // pre-topology save
  // pre-space save (or one round-tripped through an older build): a 'tri'
  // topo IS a station — derive the vacuum flag rather than stamping false
  if (snap.floors && !snap.floorSpace) snap.floorSpace = snap.floorTopos.map((t) => t === 'tri');
  // pre-contracts save: a single pooled futuresOwed becomes one open contract
  if (snap.futuresOwed > 0 && !snap.futures) snap.futures = [{ owed: snap.futuresOwed, total: snap.futuresOwed }];
  for (const k of SAVE_KEYS) {
    if (snap[k] !== undefined) state[k] = snap[k];
  }
  setActiveFloor(state.floor || 0);
  // research tracks added after a save was written default to level 0
  for (const k of Object.keys(RESEARCH)) if (state.tech[k] == null) state.tech[k] = 0;
  return true;
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}

const restored = loadState();

// All autosave paths funnel through this wrapper so New Game can silence
// them with a single flag (reload fires visibilitychange + beforeunload).
let suspendAutoSave = false;
function autoSave() { if (!suspendAutoSave) saveState(); }
setInterval(autoSave, 5000);
window.addEventListener('beforeunload', autoSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) autoSave(); });

document.getElementById('btn-new-game').addEventListener('click', () => {
  if (!confirm('Start a new game? Current progress will be lost.')) return;
  clearSave();
  suspendAutoSave = true;
  location.reload();
});

// Bankruptcy is final — Start over wipes the save without a confirm dialog
document.getElementById('btn-start-over').addEventListener('click', () => {
  clearSave();
  suspendAutoSave = true;
  location.reload();
});
document.getElementById('btn-keep-playing').addEventListener('click', () => {
  document.getElementById('demo-end').hidden = true;
});
// A save that went bankrupt before the tab closed re-shows the overlay on boot
if (state.bankrupt) {
  state.bankrupt = false;
  declareBankruptcy();
}

// ---------- Boot ----------
resizeCanvas();
buildToolbar();
buildAllocation();
buildResearch();
buildFinance();
updateFloorTabs();
updateHUD();
updateTutorial();
requestAnimationFrame(loop);
pushTicker(restored ? 'Save restored — welcome back' : 'Welcome to Singularity Tycoon — Mini', 'good');
pushTicker('Place a Power Plant, a Coolant Loop, and a GPU Rack to start', '');
