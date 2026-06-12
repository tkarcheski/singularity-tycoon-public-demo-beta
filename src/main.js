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
  power:   { name: 'Power Plant',     cost: 80,  power: 12,  cooling: 0,  compute: 0,    upkeep: 0.6,  jobs: 2, wear: 0.18, color: '#3a2b10', accent: '#ffd24a', desc: 'Supplies 12 MW. Adjacent tiles connect automatically.' },
  cooler:  { name: 'Coolant Loop',    cost: 50,  power: -1,  cooling: 10, compute: 0,    upkeep: 0.3,  jobs: 1, wear: 0.25, color: '#10293a', accent: '#6ec5ff', desc: 'Provides 10 kW of cooling. Needs 1 MW. Drains heat from nearby tiles — closer is cooler.' },
  gpu1:    { name: 'GPU Rack v1',     cost: 120, power: -4,  cooling: -3, compute: 6,    upkeep: 1.2,  jobs: 1, wear: 0.42, color: '#102a23', accent: '#4af0c0', desc: 'Generates 6 TFLOPS. Needs 4 MW + 3 kW. Clusters: +10% output but +15% heat per adjacent GPU.' },
  gpu2:    { name: 'GPU Rack v2',     cost: 400, power: -10, cooling: -8, compute: 22,   upkeep: 4.0,  jobs: 2, wear: 0.42, gate: 'gpu2', color: '#0c2e3b', accent: '#7af0d4', desc: 'Generates 22 TFLOPS. Needs 10 MW + 8 kW. Same cluster bonus/heat as v1.' },
  desk:    { name: 'Engineer Desk',   cost: 220, power: -1,  cooling: 0,  compute: 0,    upkeep: 0.5,  jobs: 2, wear: 0.08, multiplier: 1.15, color: '#231a30', accent: '#c89cff', desc: '+15% compute output. Stack up to 3.' },
  retrain: { name: 'Retraining Ctr.', cost: 150, power: -1,  cooling: 0,  compute: 0,    upkeep: 1.0,  jobs: 8, wear: 0.08, color: '#2d2410', accent: '#ffb86b', desc: 'Retrains workers your compute displaced. +8 jobs. Needs 1 MW.' },
  botbay:  { name: 'Bot Bay',         cost: 350, power: -2,  cooling: 0,  compute: 0,    upkeep: 0.8,  jobs: 1, wear: 0.12, gate: 'ops', color: '#1d1d33', accent: '#9aa5ff', desc: 'A repair bot fixes the most-damaged tile every 4s at a 40% discount. Needs 2 MW.' },
  repair:  { name: 'Repair',          cost: 0,   power: 0,   cooling: 0,  compute: 0,    upkeep: 0,    jobs: 0, wear: 0,    color: '#13241c', accent: '#7dffa8', desc: 'Fix a damaged tile for 30% of its build cost, scaled by damage.' },
  bull:    { name: 'Bulldoze',        cost: 0,   power: 0,   cooling: 0,  compute: 0,    upkeep: 0,    jobs: 0, wear: 0,    color: '#2a1414', accent: '#ff4f6d', desc: 'Refund 50% of build cost.' },
};

const REVENUE_PER_TFLOPS = 0.30; // $/sec per TFLOPS

// Wear & repair — equipment degrades; exotic tech degrades faster.
const WORN_AT = 40;              // below: output ×0.6
const REPAIR_COST_FRAC = 0.30;   // of build cost at full damage
const BOT_REPAIR_DISCOUNT = 0.6; // bots pay 60% of the manual rate
const BOT_HEAL = 15;             // condition restored per bot visit
const BOT_PERIOD_TICKS = 8;      // one visit per bay per 4s
const GPU_ADJ_BONUS = 0.10;      // +compute per adjacent working GPU, cap 3
const GPU_ADJ_HEAT = 0.15;       // +cooling need per adjacent working GPU — clusters run hot

// Heat — per-tile temperature. GPUs and plants emit it, coolant loops drain it
// with distance falloff (closer loop = cooler tile). Heat multiplies wear and
// feeds entropy; tiles are tinted by temperature.
const HEAT_SOURCE = { gpu1: 3, gpu2: 8, power: 4 }; // heat emitted by a working tile
const HEAT_SPREAD = 0.5;          // fraction of neighbor source heat that bleeds over
const COOLER_DRAIN = [8, 5, 2.5]; // heat removed at Manhattan distance 0/1/2
const HEAT_CAP = 10;              // net heat that maps to heat01 = 1.0
const HEAT_WEAR_MULT = 1.0;       // wear ×(1 + this × heat01)
const HEAT_ENTROPY = 0.35;        // entropy01 contribution of average source-tile heat

// Research — global tech tracks; each level: output ×1.4, wear ×1.6.
// Costs are RESEARCH POINTS, earned by allocating compute to Research.
const RESEARCH_OUTPUT = 1.4;
const RESEARCH_WEAR = 1.6;
const RESEARCH = {
  power:   { name: 'Power',   costs: [30, 150] },
  cooling: { name: 'Cooling', costs: [25, 125] },
  compute: { name: 'Compute', costs: [40, 200] },
};

// Allocation — where the AI's tokens go. Selling pays now; research earns RP;
// self-improvement compounds output but feeds the singularity (entropy).
const RP_PER_TFLOPS = 0.05;        // RP/s per TFLOPS at 100% research
const SELF_IMPROVE_RATE = 0.00004; // multiplier growth/s per TFLOPS at 100% self
const SELF_IMPROVE_CAP = 1.0;      // self-improvement tops out at ×2 output
const SELF_IMPROVE_ENTROPY = 0.3;  // entropy01 added per unit of self-improvement
const ENTROPY_GRACE_TFLOPS = 30;   // entropy fades in as compute approaches this — gentle start

// Unlocks — everything beyond the minute-zero kit is earned.
const UNLOCKS = {
  gpu2: { name: 'GPU Rack v2',    cash: 1500, blurb: 'license next-gen silicon' },
  ops:  { name: 'Ops Automation', rp: 20,     blurb: 'Bot Bays + auto-maintenance' },
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

const TOOL_ORDER = ['power', 'cooler', 'gpu1', 'gpu2', 'desk', 'retrain', 'botbay', 'repair', 'bull'];

const GOAL = 1_000_000;

// ---------- State ----------
const state = {
  cash: 500,
  // each cell: null (empty) or { t: tileTypeId, cond: 0..100 }
  grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
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

  // v0.5: token allocation, research points, self-improvement, unlocks
  alloc: { sell: 1, research: 0, self: 0 }, // normalized shares of compute
  rp: 0,             // research points
  selfImprove: 0,    // compounding output bonus, 0..SELF_IMPROVE_CAP
  unlocks: { gpu2: false, ops: false },

  // v0.3 systems
  tech: { power: 0, cooling: 0, compute: 0 }, // research levels 0..2
  debt: 0,          // outstanding loan repayment
  futuresOwed: 0,   // compute revenue still to deliver on sold futures
  // Auto-maintenance: divert a slice of revenue into a repair pool. Simple
  // first cut of the planned token-allocation system (sell vs maintain vs research).
  maintainShare: 0,  // 0 | 0.10 | 0.25 of gross revenue
  maintainPool: 0,   // accumulated maintenance budget ($)
  entropy: 0,       // 0..100, derived from compute
  effects: [],      // timed debuffs: { kind, x?, y?, until }

  // god-mode dev toggles (window.__god)
  god: { freeBuild: false, noWear: false, entropyMult: 1, pinSentiment: false, fast: false },

  // tutorial & lifetime stats
  tutStep: 0,
  stats: { manualRepairs: 0 },

  particles: [],
  flashes: new Map(), // "x,y" -> flash strength
  goalUnlocked: false,
};

// Programmatic handles for tests and future agent players
window.__state = state;
window.__god = state.god;

// ---------- Grid helpers ----------
const NEIGHBOR_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

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
  for (const [dx, dy] of NEIGHBOR_DIRS) {
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
function trackOf(t) {
  if (t === 'power') return 'power';
  if (t === 'cooler') return 'cooling';
  if (isGpu(t)) return 'compute';
  return null;
}
function repairPrice(c) {
  return Math.ceil(TILE_TYPES[c.t].cost * REPAIR_COST_FRAC * (1 - c.cond / 100));
}

// Per-tile heat01 map. Sources emit, neighbors catch spillover, coolant loops
// drain with distance falloff — a close loop keeps a GPU cool (low wear).
function computeHeatMap() {
  const src = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  const heat = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = state.grid[y][x];
      if (c && c.cond > 0) src[y][x] = HEAT_SOURCE[c.t] || 0;
    }
  }
  const coolers = cellsOf('cooler').filter((cl) => cl.c.cond > 0);
  const coolMult = techMult('cooling');
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!state.grid[y][x]) continue;
      let h = src[y][x];
      for (const [dx, dy] of NEIGHBOR_DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS) h += src[ny][nx] * HEAT_SPREAD;
      }
      for (const cl of coolers) {
        const d = Math.abs(cl.x - x) + Math.abs(cl.y - y);
        if (d < COOLER_DRAIN.length) h -= COOLER_DRAIN[d] * coolMult;
      }
      heat[y][x] = Math.max(0, Math.min(1, h / HEAT_CAP));
    }
  }
  return heat;
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

// ---------- Init ----------
function buildToolbar() {
  toolsEl.innerHTML = '';
  for (const id of TOOL_ORDER) {
    const t = TILE_TYPES[id];
    const locked = t.gate && !state.unlocks[t.gate] && !state.god.freeBuild;
    const btn = document.createElement('button');
    btn.className = 'tool' + (id === state.selectedTool ? ' selected' : '') + (locked ? ' locked' : '');
    btn.dataset.tool = id;
    const u = t.gate && UNLOCKS[t.gate];
    const costLabel = locked
      ? `🔒 ${u.cash != null ? '$' + u.cash.toLocaleString() : u.rp + ' RP'}`
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
      if (t.gate && !state.unlocks[t.gate] && !state.god.freeBuild) {
        tryUnlock(t.gate);
        return;
      }
      state.selectedTool = id;
      buildToolbar();
    });
    btn.addEventListener('mouseenter', (e) => showTooltip(e, t.name, t.desc, t));
    btn.addEventListener('mousemove', moveTooltip);
    btn.addEventListener('mouseleave', hideTooltip);
    toolsEl.appendChild(btn);
  }
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
  if (id === 'power') return `+${t.power} MW`;
  if (id === 'cooler') return `+${t.cooling} kW`;
  if (id === 'gpu1' || id === 'gpu2') return `+${t.compute} TFLOPS`;
  if (id === 'desk') return `+15% compute`;
  if (id === 'retrain') return `+${t.jobs} jobs`;
  if (id === 'botbay') return `auto-repairs`;
  if (id === 'repair') return `fix damage`;
  if (id === 'bull') return `refund 50%`;
  return '';
}

function iconSvg(id) {
  const c = TILE_TYPES[id].accent || '#888';
  if (id === 'power')   return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" stroke-linejoin="round"/></svg>`;
  if (id === 'cooler')  return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><path d="M12 3v18M3 12h18M5 5l14 14M19 5L5 19" stroke-linecap="round"/></svg>`;
  if (id === 'gpu1')    return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/></svg>`;
  if (id === 'gpu2')    return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><circle cx="8" cy="7.5" r="1.4"/><circle cx="16" cy="7.5" r="1.4"/><circle cx="8" cy="16.5" r="1.4"/><circle cx="16" cy="16.5" r="1.4"/></svg>`;
  if (id === 'desk')    return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><circle cx="12" cy="7" r="3"/><path d="M5 21v-2a4 4 0 014-4h6a4 4 0 014 4v2" stroke-linecap="round"/></svg>`;
  if (id === 'retrain') return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><path d="M12 4L2 9l10 5 10-5-10-5z" stroke-linejoin="round"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" stroke-linecap="round"/></svg>`;
  if (id === 'botbay')  return `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.6"><rect x="6" y="8" width="12" height="10" rx="2"/><circle cx="10" cy="12" r="1.2"/><circle cx="14" cy="12" r="1.2"/><path d="M12 8V5M9 5h6M9 18v2M15 18v2" stroke-linecap="round"/></svg>`;
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
  return {
    x: Math.floor((w - COLS * TILE) / 2),
    y: Math.floor((h - ROWS * TILE) / 2),
  };
}

function pickTile(mx, my) {
  const o = gridOrigin();
  const gx = Math.floor((mx - o.x) / TILE);
  const gy = Math.floor((my - o.y) / TILE);
  if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return null;
  return { x: gx, y: gy };
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
  const keys = ['1','2','3','4','5','6','7','8','9'];
  const idx = keys.indexOf(e.key);
  if (idx >= 0) {
    state.selectedTool = TOOL_ORDER[idx];
    buildToolbar();
  }
  if (e.key.toLowerCase() === 'm') { handleMute(); }
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
  if (existing) {
    pushTicker(`Cell occupied — bulldoze first (press 9)`, 'bad');
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
  state.grid[y][x] = { t: id, cond: 100 };
  flashCell(x, y, 1.2);
  emitParticles(x, y, 8, def.accent || '#4af0c0');
}

function flashCell(x, y, strength) {
  state.flashes.set(`${x},${y}`, strength);
}

function emitParticles(gx, gy, count, color) {
  const o = gridOrigin();
  const cx = o.x + gx * TILE + TILE / 2;
  const cy = o.y + gy * TILE + TILE / 2;
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
  const dtS = (TICK_MS / 1000) * (state.god.fast ? 5 : 1);
  const now = performance.now();

  // Expire timed entropy effects
  state.effects = state.effects.filter((ef) => ef.until > now);
  const offline = new Set(
    state.effects.filter((ef) => ef.kind === 'crash' || ef.kind === 'botGlitch').map((ef) => `${ef.x},${ef.y}`),
  );
  const brownout = state.effects.some((ef) => ef.kind === 'brownout');

  // Tally power, cooling, upkeep, jobs — research and condition scale supply;
  // broken tiles supply nothing but still bleed half upkeep
  let power = 0, cooling = 0, deskCount = 0, upkeep = 0, jobsCreated = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = state.grid[y][x];
      if (!c) continue;
      const t = TILE_TYPES[c.t];
      const broken = c.cond <= 0;
      upkeep += (t.upkeep || 0) * (broken ? 0.5 : 1);
      jobsCreated += t.jobs || 0;
      if (broken) continue;
      const s = condScale(c);
      if (t.power > 0) power += t.power * techMult('power') * s;
      if (t.cooling > 0) cooling += t.cooling * techMult('cooling') * s;
      if (c.t === 'desk') deskCount++;
    }
  }

  // Each working GPU draws from the global pools; output scales with research,
  // condition, and the adjacency cluster bonus
  let powerUsed = 0, coolingUsed = 0, gpuTflops = 0;
  const computeCells = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = state.grid[y][x];
      if (!c || !isGpu(c.t) || c.cond <= 0 || offline.has(`${x},${y}`)) continue;
      const t = TILE_TYPES[c.t];
      // Clusters: +output per adjacent working GPU, but packed silicon runs hot
      const adjGpus = Math.min(3, neighborCells(x, y).filter((n) => isGpu(n.c.t) && n.c.cond > 0).length);
      const needP = Math.abs(t.power); // negative => draw
      const needC = Math.abs(t.cooling) * (1 + GPU_ADJ_HEAT * adjGpus);
      if (power - powerUsed >= needP && cooling - coolingUsed >= needC) {
        powerUsed += needP;
        coolingUsed += needC;
        let out = t.compute * techMult('compute') * gpuCondScale(c) * (1 + GPU_ADJ_BONUS * adjGpus);
        if (brownout) out *= 0.8;
        gpuTflops += out;
        computeCells.push({ x, y });
      }
    }
  }
  // Coolant loops and bot bays draw power after GPUs (never starve compute)
  const poweredBays = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = state.grid[y][x];
      if (!c || c.cond <= 0) continue;
      if (c.t === 'cooler' && power - powerUsed >= 1) powerUsed += 1;
      if (c.t === 'botbay' && !offline.has(`${x},${y}`) && power - powerUsed >= 2) {
        powerUsed += 2;
        poweredBays.push({ x, y });
      }
    }
  }

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

  // Research allocation earns research points
  state.rp += computeAdj * RP_PER_TFLOPS * state.alloc.research * dtS;

  // Jobs ledger: selling compute displaces outside jobs; tiles create them
  const jobsDisplaced = computeAdj * JOBS_DISPLACED_PER_TFLOPS;
  const netJobs = jobsCreated - jobsDisplaced;

  // Sentiment drifts toward a target set by the jobs balance
  if (state.god.pinSentiment) {
    state.sentiment = 75;
  } else {
    const target = Math.max(0, Math.min(100, 50 + netJobs));
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

  // Heat map: hot silicon wears faster, and a hot floor feeds entropy
  const heatMap = computeHeatMap();
  state.heatMap = heatMap;
  let heatSum = 0, heatN = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = state.grid[y][x];
      if (c && HEAT_SOURCE[c.t]) { heatSum += heatMap[y][x]; heatN++; }
    }
  }
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
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = state.grid[y][x];
        if (!c || c.cond <= 0) continue;
        const track = trackOf(c.t);
        const rate = TILE_TYPES[c.t].wear
          * (track ? Math.pow(RESEARCH_WEAR, state.tech[track]) : 1)
          * (1 + ENTROPY_WEAR_MULT * entropy01)
          * (1 + HEAT_WEAR_MULT * heatMap[y][x]);
        const before = c.cond;
        c.cond = Math.max(0, c.cond - rate * dtS);
        if (before > 0 && c.cond <= 0) {
          pushTicker(`${TILE_TYPES[c.t].name} BROKE DOWN — repair it (press 8)`, 'bad');
          flashCell(x, y, 1.2);
          emitParticles(x, y, 8, '#ff4f6d');
          playStinger('breakdown');
        }
      }
    }
  }

  // Bot bays: each powered bay repairs the most-damaged other tile every 4s
  if (poweredBays.length && state.tick % BOT_PERIOD_TICKS === 0) {
    for (const bay of poweredBays) {
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
  }

  // Revenue (only the SOLD share of compute), then finance settlement
  const revPerSec = computeAdj * REVENUE_PER_TFLOPS * state.alloc.sell;
  const gross = revPerSec * dtS;
  let income = gross;
  if (state.futuresOwed > 0) {
    const withheld = Math.min(state.futuresOwed, gross * FUTURES_REVENUE_SHARE);
    state.futuresOwed -= withheld;
    income -= withheld;
    if (state.futuresOwed <= 0) {
      state.futuresOwed = 0;
      pushTicker('Compute futures delivered — full revenue restored', 'good');
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
  // Auto-maintenance: diverted revenue accumulates into a repair pool…
  if (state.maintainShare > 0) {
    const diverted = gross * state.maintainShare;
    state.maintainPool += diverted;
    income -= diverted;
  }
  const upkeepThisTick = upkeepAdj * dtS;
  state.cash += income - upkeepThisTick;

  // …and the pool continuously heals the most-damaged tile it can afford
  // (manual repair rate ×0.8 — bays at ×0.6 stay the better deal).
  if (state.maintainPool > 0) {
    let target = null;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = state.grid[y][x];
        if (c && c.cond < 100 && (!target || c.cond < target.c.cond)) target = { x, y, c };
      }
    }
    if (target) {
      const perPoint = TILE_TYPES[target.c.t].cost * REPAIR_COST_FRAC * 0.01 * 0.8;
      const points = Math.min(100 - target.c.cond, state.maintainPool / perPoint);
      if (points > 0.1) {
        target.c.cond += points;
        state.maintainPool -= points * perPoint;
        if (state.tick % 8 === 0) {
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
  }

  updateHUD();
  updateTutorial();
}

// Entropy events — the menu of failure modes grows with what you own
function maybeEntropyEvent(entropy01, now) {
  if (Math.random() >= EVENT_CHANCE * Math.pow(entropy01, 1.5)) return;
  const plants = cellsOf('power');
  const coolers = cellsOf('cooler');
  const gpus = cellsOf('gpu1', 'gpu2').filter((g) => g.c.cond > 0);
  const bays = cellsOf('botbay');

  const pool = [];
  if (plants.length >= 2) pool.push('surge');
  if (coolers.length >= 1) pool.push('leak');
  if (gpus.length >= 1 && (state.tech.compute >= 1 || gpus.some((g) => g.c.t === 'gpu2'))) pool.push('crash');
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
      if (isGpu(n.c.t)) damageCell(n.x, n.y, 10);
    }
    pushTicker('💧 Coolant leak — loop and adjacent GPUs damaged', 'bad');
  } else if (kind === 'crash') {
    const g = pick(gpus);
    state.effects.push({ kind: 'crash', x: g.x, y: g.y, until: now + 8000 });
    flashCell(g.x, g.y, 1);
    pushTicker('🖥 Driver crash — a GPU rack is offline for 8s', 'warn');
  } else if (kind === 'brownout') {
    state.effects.push({ kind: 'brownout', until: now + 10000 });
    pushTicker('🌆 Grid brownout — all GPU output −20% for 10s', 'warn');
  } else if (kind === 'botGlitch') {
    const b = pick(bays);
    state.effects.push({ kind: 'botGlitch', x: b.x, y: b.y, until: now + 10000 });
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

function updateHUD() {
  hudCash.textContent = `$${Math.floor(state.cash).toLocaleString()}`;
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
  ctx.fillStyle = 'rgba(20, 28, 50, 0.5)';
  ctx.fillRect(o.x - 8, o.y - 8, COLS * TILE + 16, ROWS * TILE + 16);
  ctx.strokeStyle = 'rgba(74, 240, 192, 0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(o.x - 8 + 0.5, o.y - 8 + 0.5, COLS * TILE + 16, ROWS * TILE + 16);

  // Tiles
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cell = state.grid[y][x];
      const px = o.x + x * TILE;
      const py = o.y + y * TILE;
      drawCell(px, py, cell, x, y);
    }
  }

  // Hover ghost
  if (state.hover.x >= 0) {
    const id = state.selectedTool;
    const def = TILE_TYPES[id];
    const px = o.x + state.hover.x * TILE;
    const py = o.y + state.hover.y * TILE;
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
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.restore();
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

function drawCell(px, py, cell, gx, gy) {
  const id = cell ? cell.t : 'empty';
  const def = TILE_TYPES[id];
  const broken = cell && cell.cond <= 0;
  // Base
  ctx.fillStyle = !cell ? '#0c1124' : def.color;
  ctx.fillRect(px, py, TILE, TILE);
  // Subtle inner panel
  if (cell) {
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
  }
  // Grid lines
  ctx.strokeStyle = 'rgba(74, 240, 192, 0.06)';
  ctx.strokeRect(px + 0.5, py + 0.5, TILE, TILE);

  // Pulse from flash
  const flash = state.flashes.get(`${gx},${gy}`) || 0;
  if (flash > 0 && def.accent) {
    ctx.save();
    ctx.globalAlpha = flash;
    ctx.fillStyle = def.accent;
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.restore();
  }

  // Glyph
  if (cell && def.accent) {
    ctx.save();
    if (broken) ctx.globalAlpha = 0.35;
    drawGlyph(ctx, px + TILE / 2, py + TILE / 2, id, def.accent);
    ctx.restore();
  }

  if (!cell) return;

  // Temperature tint — hot tiles glow red-orange (heat map updated each tick)
  const heat = state.heatMap ? state.heatMap[gy][gx] : 0;
  if (heat > 0.05) {
    ctx.save();
    ctx.globalAlpha = heat * 0.30;
    ctx.fillStyle = '#ff5a28';
    ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
    ctx.restore();
  }

  // Condition bar (only once it matters)
  if (cell.cond < 100) {
    const bw = TILE - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px + 5, py + TILE - 8, bw, 3);
    ctx.fillStyle = cell.cond >= 70 ? '#4af0c0' : cell.cond >= WORN_AT ? '#ffd24a' : '#ff4f6d';
    ctx.fillRect(px + 5, py + TILE - 8, bw * Math.max(0, cell.cond) / 100, 3);
  }

  // Broken: dark veil + red cross
  if (broken) {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 18, 0.55)';
    ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
    ctx.strokeStyle = '#ff4f6d';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(state.tick * 0.4 + gx + gy);
    ctx.beginPath();
    ctx.moveTo(px + 18, py + 18); ctx.lineTo(px + TILE - 18, py + TILE - 18);
    ctx.moveTo(px + TILE - 18, py + 18); ctx.lineTo(px + 18, py + TILE - 18);
    ctx.stroke();
    ctx.restore();
  }

  // Offline (driver crash / bot glitch): pause bars top-right
  if (state.effects.some((ef) => ef.x === gx && ef.y === gy && (ef.kind === 'crash' || ef.kind === 'botGlitch'))) {
    ctx.save();
    ctx.fillStyle = '#6ec5ff';
    ctx.globalAlpha = 0.9;
    ctx.fillRect(px + TILE - 16, py + 6, 3, 9);
    ctx.fillRect(px + TILE - 10, py + 6, 3, 9);
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
  } else if (id === 'desk') {
    ctx.beginPath();
    ctx.arc(cx, cy - 4, 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + s - 1);
    ctx.quadraticCurveTo(cx, cy - 1, cx + s, cy + s - 1);
    ctx.stroke();
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
  const hLabel = h < 0.15 ? 'cool' : h < 0.4 ? 'warm' : h < 0.7 ? 'HOT' : 'OVERHEATING';
  rows += `<div class="tip-row"><span>Heat</span><span class="v">${Math.round(h * 100)}% · ${hLabel} (wear +${Math.round(h * 100)}%)</span></div>`;
  if (isGpu(cell.t)) {
    const adjGpus = Math.min(3, neighborCells(x, y).filter((n) => isGpu(n.c.t) && n.c.cond > 0).length);
    if (adjGpus) rows += `<div class="tip-row"><span>Cluster</span><span class="v">+${adjGpus * 10}% out · +${Math.round(adjGpus * GPU_ADJ_HEAT * 100)}% cooling need</span></div>`;
  }
  tooltipEl.innerHTML = `<div class="tip-title">${def.name}</div><div style="color:var(--text-muted);font-size:11px;margin-top:4px;">${def.desc}</div>${rows}`;
  moveTooltip(e);
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
// Three sliders, normalized to shares: where the AI's tokens go.
const allocEl = document.getElementById('allocation');
const ALLOC_LABELS = { sell: 'Sell tokens', research: 'Research', self: 'Self-improve' };

function buildAllocation() {
  allocEl.innerHTML = Object.keys(ALLOC_LABELS).map((k) => `
    <div class="alloc-row">
      <span class="alloc-name">${ALLOC_LABELS[k]}</span>
      <input type="range" min="0" max="100" value="${k === 'sell' ? 100 : 0}" data-alloc="${k}" />
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
  note.hidden = state.selfImprove <= 0;
  if (state.selfImprove > 0) {
    note.textContent = `Self-improvement: output ×${(1 + state.selfImprove).toFixed(2)}${state.selfImprove >= SELF_IMPROVE_CAP ? ' (MAX)' : ''}`;
  }
}

// ---------- Research UI ----------
const researchEl = document.getElementById('research');

function buildResearch() {
  researchEl.innerHTML = '<div class="fin-status" id="rp-line">Research points: 0</div>';
  for (const key of Object.keys(RESEARCH)) {
    const row = document.createElement('div');
    row.className = 'research-row';
    row.dataset.track = key;
    row.innerHTML = `
      <span class="research-name">${RESEARCH[key].name}</span>
      <span class="research-pips" data-pips></span>
      <button class="research-btn" data-buy></button>
    `;
    row.querySelector('[data-buy]').addEventListener('click', () => buyResearch(key));
    researchEl.appendChild(row);
  }
  updateResearch();
}

function buyResearch(key) {
  const lvl = state.tech[key];
  if (lvl >= RESEARCH[key].costs.length) return;
  const cost = RESEARCH[key].costs[lvl];
  if (!state.god.freeBuild && state.rp < cost) {
    pushTicker(`Need ${cost} RP for ${RESEARCH[key].name} ${['II', 'III'][lvl]} — allocate compute to Research`, 'bad');
    return;
  }
  if (!state.god.freeBuild) state.rp -= cost;
  state.tech[key]++;
  pushTicker(`★ ${RESEARCH[key].name} ${['II', 'III'][lvl]} researched — output ×1.4, wear ×1.6`, 'good');
  playStinger('research');
  updateResearch();
}

function updateResearch() {
  const rpLine = document.getElementById('rp-line');
  if (rpLine) rpLine.textContent = `Research points: ${state.rp.toFixed(1)}`;
  for (const row of researchEl.querySelectorAll('.research-row')) {
    const key = row.dataset.track;
    const lvl = state.tech[key];
    const pips = row.querySelector('[data-pips]');
    pips.textContent = ['I', 'II', 'III'].map((r, i) => (i <= lvl ? '●' : '○')).join(' ');
    const btn = row.querySelector('[data-buy]');
    if (lvl >= RESEARCH[key].costs.length) {
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
    <button class="fin-btn" data-futures>
      <span>Sell compute futures</span>
      <span class="fin-sub" data-futures-sub></span>
    </button>
    <div class="fin-status" data-owed hidden></div>
    <div class="fin-maint">
      <span class="fin-maint-label" title="Divert revenue into an automatic repair pool">Auto-maintain</span>
      <label><input type="radio" name="maintain" value="0" checked /> off</label>
      <label><input type="radio" name="maintain" value="0.10" /> 10%</label>
      <label><input type="radio" name="maintain" value="0.25" /> 25%</label>
    </div>
  `;
  for (const radio of financeEl.querySelectorAll('input[name="maintain"]')) {
    radio.addEventListener('change', () => {
      state.maintainShare = parseFloat(radio.value);
      pushTicker(
        state.maintainShare > 0
          ? `Auto-maintenance: ${Math.round(state.maintainShare * 100)}% of revenue diverted to repairs`
          : 'Auto-maintenance off',
        'warn',
      );
    });
  }
  const loansEl = financeEl.querySelector('.fin-loans');
  LOANS.forEach((loan, i) => {
    const btn = document.createElement('button');
    btn.className = 'fin-btn';
    btn.dataset.loan = i;
    btn.innerHTML = `<span>Borrow $${loan.amount.toLocaleString()}</span><span class="fin-sub">repay $${loan.repay.toLocaleString()}</span>`;
    btn.addEventListener('click', () => takeLoan(i));
    loansEl.appendChild(btn);
  });
  financeEl.querySelector('[data-futures]').addEventListener('click', sellFutures);
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

function sellFutures() {
  if (state.futuresOwed > 0) { pushTicker('Existing futures contract still delivering', 'warn'); return; }
  const revPerSec = state.totalCompute * REVENUE_PER_TFLOPS;
  if (state.totalCompute < FUTURES_UNLOCK_TFLOPS) {
    pushTicker(`Futures desk opens at ${FUTURES_UNLOCK_TFLOPS} TFLOPS`, 'warn');
    return;
  }
  const advance = Math.floor((1 - FUTURES_DISCOUNT) * revPerSec * FUTURES_WINDOW_S);
  state.cash += advance;
  state.futuresOwed = revPerSec * FUTURES_WINDOW_S;
  pushTicker(`Sold ${FUTURES_WINDOW_S}s of compute forward for $${advance.toLocaleString()} — half of revenue withheld until delivered`, 'warn');
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
  const revPerSec = state.totalCompute * REVENUE_PER_TFLOPS;
  const advance = Math.floor((1 - FUTURES_DISCOUNT) * revPerSec * FUTURES_WINDOW_S);
  const locked = state.totalCompute < FUTURES_UNLOCK_TFLOPS;
  futBtn.disabled = locked || state.futuresOwed > 0;
  futSub.textContent = locked
    ? `unlocks at ${FUTURES_UNLOCK_TFLOPS} TFLOPS`
    : `+$${advance.toLocaleString()} now`;
  owedEl.hidden = state.futuresOwed <= 0;
  if (state.futuresOwed > 0) owedEl.textContent = `Delivering: $${Math.ceil(state.futuresOwed).toLocaleString()} left`;
  // Auto-maintenance is part of the Ops Automation unlock
  const maint = financeEl.querySelector('.fin-maint');
  if (maint) maint.hidden = !state.unlocks.ops && !state.god.freeBuild;
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
  { text: 'Build a Power Plant (1) — everything needs MW.', done: () => has('power') },
  { text: 'Add a Coolant Loop (2) — heat is the enemy here.', done: () => has('cooler') },
  { text: 'Place a GPU Rack (3) close to the loop — cooler tiles wear slower.', done: () => has('gpu1', 'gpu2') },
  { text: 'Cluster a second GPU against the first: +10% output, but watch the heat glow.', done: () => cellsOf('gpu1', 'gpu2').some((g) => neighborCells(g.x, g.y).some((n) => isGpu(n.c.t))) },
  { text: 'Cash trickles early. Take the $1,000 loan (Finance panel) and expand.', done: () => state.debt > 0 },
  { text: 'Watch Jobs & Public in the HUD — a Retraining Ctr. (6) keeps the city on your side.', done: () => has('retrain') || state.sentiment >= GOODWILL_AT },
  { text: 'Equipment wears out — repair damaged tiles by hand (8).', done: () => state.stats.manualRepairs > 0 },
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
    <li><strong>Jobs &amp; Public mood:</strong> selling compute displaces jobs in the city; your buildings (especially <strong>Retraining Centers</strong>) create them. Keep the public happy for a tax rebate — let it slide and you'll face surcharges, halved output, and permit delays.</li>
    <li><strong>Heat:</strong> GPUs and Power Plants run hot (tiles glow red); heat accelerates wear and feeds entropy. Coolant Loops drain heat with distance falloff — the closer the loop, the cooler the silicon.</li>
    <li><strong>Wear &amp; repair:</strong> everything degrades — GPU output fades with condition, broken tiles stop. Repair by hand (press <kbd>8</kbd>) or place <strong>Bot Bays</strong> to automate it. GPU clusters compute up to 30% more but need more cooling.</li>
    <li><strong>Research:</strong> upgrade Power, Cooling, or Compute — each level boosts output ×1.4 but the exotic tech wears ×1.6 faster.</li>
    <li><strong>Allocation:</strong> decide where your AI's tokens go — <em>Sell</em> for cash, <em>Research</em> for research points (buys tech and unlocks), or <em>Self-improve</em> for compounding output that feeds entropy. The singularity dial is yours.</li>
    <li><strong>Unlocks:</strong> anything marked 🔒 in the Build panel is earned — hardware costs cash, capabilities cost research points. Ops Automation opens Bot Bays and auto-maintenance.</li>
    <li><strong>Finance:</strong> take a loan (repaid from revenue, with interest) or sell compute futures once you're big enough. Leverage is how you escape the early grind.</li>
    <li><strong>Entropy:</strong> the more compute you run, the faster things wear and the weirder the failures get. The machine pushes back.</li>
    <li>Press <kbd>1</kbd>–<kbd>9</kbd> to pick tools. <kbd>M</kbd> to mute. Use the Music panel to swap vibes.</li>
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

// ---------- Boot ----------
resizeCanvas();
buildToolbar();
buildAllocation();
buildResearch();
buildFinance();
updateHUD();
updateTutorial();
requestAnimationFrame(loop);
pushTicker('Welcome to Singularity Tycoon — Mini', 'good');
pushTicker('Place a Power Plant, a Coolant Loop, and a GPU Rack to start', '');
