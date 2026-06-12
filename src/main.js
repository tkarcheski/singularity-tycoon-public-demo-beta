// Singularity Tycoon — Mini · vibes test
// Place tiles on a grid. Power + cooling → compute → cash → bigger compute.

const { startAudio, swapVibe, setMusicVolume, toggleMute, isAudioStarted } = window.GameMusic;

// ---------- Constants ----------
const COLS = 14;
const ROWS = 10;
const TILE = 56; // px, base tile size
const TICK_MS = 500; // sim tick

const TILE_TYPES = {
  empty:   { name: 'Empty',           cost: 0,   power: 0,   cooling: 0,  compute: 0,    upkeep: 0,    jobs: 0, wear: 0,    color: '#0e1320', desc: '' },
  power:   { name: 'Power Plant',     cost: 80,  power: 12,  cooling: 0,  compute: 0,    upkeep: 0.6,  jobs: 2, wear: 0.18, color: '#3a2b10', accent: '#ffd24a', desc: 'Supplies 12 MW. Adjacent tiles connect automatically.' },
  cooler:  { name: 'Coolant Loop',    cost: 50,  power: -1,  cooling: 10, compute: 0,    upkeep: 0.3,  jobs: 1, wear: 0.25, color: '#10293a', accent: '#6ec5ff', desc: 'Provides 10 kW of cooling. Needs 1 MW. Adjacent GPUs wear 50% slower.' },
  gpu1:    { name: 'GPU Rack v1',     cost: 120, power: -4,  cooling: -3, compute: 6,    upkeep: 1.2,  jobs: 1, wear: 0.42, color: '#102a23', accent: '#4af0c0', desc: 'Generates 6 TFLOPS. Needs 4 MW power + 3 kW cooling. +10% per adjacent GPU (max +30%).' },
  gpu2:    { name: 'GPU Rack v2',     cost: 400, power: -10, cooling: -8, compute: 22,   upkeep: 4.0,  jobs: 2, wear: 0.42, color: '#0c2e3b', accent: '#7af0d4', desc: 'Generates 22 TFLOPS. Needs 10 MW + 8 kW. Same cluster bonus as v1.' },
  desk:    { name: 'Engineer Desk',   cost: 220, power: -1,  cooling: 0,  compute: 0,    upkeep: 0.5,  jobs: 2, wear: 0.08, multiplier: 1.15, color: '#231a30', accent: '#c89cff', desc: '+15% compute output. Stack up to 3.' },
  retrain: { name: 'Retraining Ctr.', cost: 150, power: -1,  cooling: 0,  compute: 0,    upkeep: 1.0,  jobs: 8, wear: 0.08, color: '#2d2410', accent: '#ffb86b', desc: 'Retrains workers your compute displaced. +8 jobs. Needs 1 MW.' },
  botbay:  { name: 'Bot Bay',         cost: 350, power: -2,  cooling: 0,  compute: 0,    upkeep: 0.8,  jobs: 1, wear: 0.12, color: '#1d1d33', accent: '#9aa5ff', desc: 'A repair bot fixes the most-damaged tile every 4s at a 40% discount. Needs 2 MW.' },
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
const COOLER_ADJ_WEAR = 0.5;     // GPU wear multiplier next to a working cooler
const GPU_ADJ_BONUS = 0.10;      // +compute per adjacent working GPU, cap 3

// Research — global tech tracks; each level: output ×1.4, wear ×1.6.
const RESEARCH_OUTPUT = 1.4;
const RESEARCH_WEAR = 1.6;
const RESEARCH = {
  power:   { name: 'Power',   costs: [600, 3000] },
  cooling: { name: 'Cooling', costs: [500, 2500] },
  compute: { name: 'Compute', costs: [800, 4000] },
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

  // v0.3 systems
  tech: { power: 0, cooling: 0, compute: 0 }, // research levels 0..2
  debt: 0,          // outstanding loan repayment
  futuresOwed: 0,   // compute revenue still to deliver on sold futures
  entropy: 0,       // 0..100, derived from compute
  effects: [],      // timed debuffs: { kind, x?, y?, until }

  // god-mode dev toggles (window.__god)
  god: { freeBuild: false, noWear: false, noEntropy: false, pinSentiment: false, fast: false },

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

function condScale(c) { return c.cond <= 0 ? 0 : c.cond < WORN_AT ? 0.6 : 1; }
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
    const btn = document.createElement('button');
    btn.className = 'tool' + (id === state.selectedTool ? ' selected' : '');
    btn.dataset.tool = id;
    btn.innerHTML = `
      <span class="icon">${iconSvg(id)}</span>
      <span class="meta">
        <span class="name">${t.name}</span>
        <span class="sub">${toolStat(id)}</span>
      </span>
      <span class="cost">${id === 'bull' ? '↶' : '$' + t.cost}</span>
    `;
    btn.addEventListener('click', () => {
      state.selectedTool = id;
      buildToolbar();
    });
    btn.addEventListener('mouseenter', (e) => showTooltip(e, t.name, t.desc, t));
    btn.addEventListener('mousemove', moveTooltip);
    btn.addEventListener('mouseleave', hideTooltip);
    toolsEl.appendChild(btn);
  }
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
    flashCell(x, y, 1.2);
    emitParticles(x, y, 6, '#7dffa8');
    pushTicker(`Repaired ${TILE_TYPES[existing.t].name} (−$${price})`, 'good');
    return;
  }

  const def = TILE_TYPES[id];
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
      const needP = Math.abs(t.power); // negative => draw
      const needC = Math.abs(t.cooling);
      if (power - powerUsed >= needP && cooling - coolingUsed >= needC) {
        powerUsed += needP;
        coolingUsed += needC;
        const adjGpus = neighborCells(x, y).filter((n) => isGpu(n.c.t) && n.c.cond > 0).length;
        let out = t.compute * techMult('compute') * condScale(c) * (1 + GPU_ADJ_BONUS * Math.min(3, adjGpus));
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
  const mult = Math.pow(1.15, Math.min(deskCount, 3));
  let computeAdj = gpuTflops * mult;

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

  // Entropy rises with compute; it accelerates wear and rolls events
  const entropy01 = state.god.noEntropy ? 0 : 1 - Math.exp(-computeAdj / ENTROPY_SCALE);
  state.entropy = entropy01 * 100;
  if (!state.god.noEntropy) maybeEntropyEvent(entropy01, now);

  // Wear — exotic tech and entropy accelerate it; coolers shelter neighbors
  if (!state.god.noWear) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = state.grid[y][x];
        if (!c || c.cond <= 0) continue;
        const track = trackOf(c.t);
        let rate = TILE_TYPES[c.t].wear
          * (track ? Math.pow(RESEARCH_WEAR, state.tech[track]) : 1)
          * (1 + ENTROPY_WEAR_MULT * entropy01);
        if (isGpu(c.t) && neighborCells(x, y).some((n) => n.c.t === 'cooler' && n.c.cond > 0)) {
          rate *= COOLER_ADJ_WEAR;
        }
        const before = c.cond;
        c.cond = Math.max(0, c.cond - rate * dtS);
        if (before > 0 && c.cond <= 0) {
          pushTicker(`${TILE_TYPES[c.t].name} BROKE DOWN — repair it (press 8)`, 'bad');
          flashCell(x, y, 1.2);
          emitParticles(x, y, 8, '#ff4f6d');
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

  // Revenue, then finance settlement: futures withholding, then debt service
  const revPerSec = computeAdj * REVENUE_PER_TFLOPS;
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
  const upkeepThisTick = upkeepAdj * dtS;
  state.cash += income - upkeepThisTick;

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
    // celebratory particle burst
    for (let i = 0; i < 60; i++) {
      const gx = Math.floor(Math.random() * COLS);
      const gy = Math.floor(Math.random() * ROWS);
      emitParticles(gx, gy, 3, '#4af0c0');
    }
  }

  updateHUD();
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
  if (isGpu(cell.t)) {
    const adjGpus = neighborCells(x, y).filter((n) => isGpu(n.c.t) && n.c.cond > 0).length;
    const cooled = neighborCells(x, y).some((n) => n.c.t === 'cooler' && n.c.cond > 0);
    if (adjGpus) rows += `<div class="tip-row"><span>Cluster bonus</span><span class="v">+${Math.min(3, adjGpus) * 10}%</span></div>`;
    rows += `<div class="tip-row"><span>Cooling</span><span class="v">${cooled ? 'sheltered (½ wear)' : 'exposed'}</span></div>`;
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

// ---------- Research UI ----------
const researchEl = document.getElementById('research');

function buildResearch() {
  researchEl.innerHTML = '';
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
  if (!state.god.freeBuild && state.cash < cost) {
    pushTicker(`Need $${cost.toLocaleString()} for ${RESEARCH[key].name} ${['II', 'III'][lvl]}`, 'bad');
    return;
  }
  if (!state.god.freeBuild) state.cash -= cost;
  state.tech[key]++;
  pushTicker(`★ ${RESEARCH[key].name} ${['II', 'III'][lvl]} researched — output ×1.4, wear ×1.6`, 'good');
  updateResearch();
}

function updateResearch() {
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
      btn.textContent = `$${RESEARCH[key].costs[lvl].toLocaleString()}`;
      btn.disabled = !state.god.freeBuild && state.cash < RESEARCH[key].costs[lvl];
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
  `;
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
    if (box.dataset.god === 'noEntropy' && box.checked) {
      state.effects = [];
      state.entropy = 0;
    }
    updateHUD();
  });
}
document.getElementById('dev-cash').addEventListener('click', () => {
  state.cash += 10000;
  pushTicker('DEV: +$10,000', 'warn');
  updateHUD();
});

// ---------- Audio UI ----------
const audioPrompt = document.getElementById('audio-prompt');
const audioStartBtn = document.getElementById('audio-start');
const muteBtn = document.getElementById('music-mute');
const volumeEl = document.getElementById('music-volume');
const vibesEl = document.getElementById('music-vibes');
let muted = false;

audioStartBtn.addEventListener('click', async () => {
  await startAudio('hopeful');
  setMusicVolume(parseInt(volumeEl.value, 10) / 100);
  audioPrompt.classList.add('hidden');
  setTimeout(() => audioPrompt.style.display = 'none', 300);
  pushTicker('Audio enabled — Hopeful Ambient', 'good');
});

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
    <li><strong>Wear &amp; repair:</strong> everything degrades — worn tiles lose output, broken ones stop. Repair by hand (press <kbd>8</kbd>) or place <strong>Bot Bays</strong> to automate it. GPUs next to a Coolant Loop wear half as fast; GPUs next to GPUs compute up to 30% more.</li>
    <li><strong>Research:</strong> upgrade Power, Cooling, or Compute — each level boosts output ×1.4 but the exotic tech wears ×1.6 faster.</li>
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
buildResearch();
buildFinance();
updateHUD();
requestAnimationFrame(loop);
pushTicker('Welcome to Singularity Tycoon — Mini', 'good');
pushTicker('Place a Power Plant, a Coolant Loop, and a GPU Rack to start', '');
