// Singularity Tycoon — Mini · vibes test
// Place tiles on a grid. Power + cooling → compute → cash → bigger compute.

const { startAudio, swapVibe, setMusicVolume, toggleMute, isAudioStarted } = window.GameMusic;

// ---------- Constants ----------
const COLS = 14;
const ROWS = 10;
const TILE = 56; // px, base tile size
const TICK_MS = 500; // sim tick

const TILE_TYPES = {
  empty:   { name: 'Empty',         cost: 0,   power: 0,   cooling: 0,  compute: 0,    upkeep: 0,    color: '#0e1320', desc: '' },
  power:   { name: 'Power Plant',   cost: 80,  power: 12,  cooling: 0,  compute: 0,    upkeep: 0.6,  color: '#3a2b10', accent: '#ffd24a', desc: 'Supplies 12 MW. Adjacent tiles connect automatically.' },
  cooler:  { name: 'Coolant Loop',  cost: 50,  power: -1,  cooling: 10, compute: 0,    upkeep: 0.3,  color: '#10293a', accent: '#6ec5ff', desc: 'Provides 10 kW of cooling. Needs 1 MW.' },
  gpu1:    { name: 'GPU Rack v1',   cost: 120, power: -4,  cooling: -3, compute: 6,    upkeep: 1.2,  color: '#102a23', accent: '#4af0c0', desc: 'Generates 6 TFLOPS. Needs 4 MW power + 3 kW cooling.' },
  gpu2:    { name: 'GPU Rack v2',   cost: 400, power: -10, cooling: -8, compute: 22,   upkeep: 4.0,  color: '#0c2e3b', accent: '#7af0d4', desc: 'Generates 22 TFLOPS. Needs 10 MW + 8 kW. Unlocks at $5k.' },
  desk:    { name: 'Engineer Desk', cost: 220, power: -1,  cooling: 0,  compute: 0,    upkeep: 0.5,  multiplier: 1.15, color: '#231a30', accent: '#c89cff', desc: '+15% compute output. Stack up to 3.' },
  bull:    { name: 'Bulldoze',      cost: 0,   power: 0,   cooling: 0,  compute: 0,    upkeep: 0,    color: '#2a1414', accent: '#ff4f6d', desc: 'Refund 50% of build cost.' },
};

const REVENUE_PER_TFLOPS = 0.18; // $/sec per TFLOPS

const TOOL_ORDER = ['power', 'cooler', 'gpu1', 'gpu2', 'desk', 'bull'];

const GOAL = 1_000_000;

// ---------- State ----------
const state = {
  cash: 500,
  grid: Array.from({ length: ROWS }, () => Array(COLS).fill('empty')),
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
  particles: [],
  flashes: new Map(), // "x,y" -> flash strength
  goalUnlocked: false,
};

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
    const id = state.grid[t.y][t.x];
    if (id !== 'empty') {
      const def = TILE_TYPES[id];
      showTooltip(e, def.name, def.desc, def);
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
  const keys = ['1','2','3','4','5','6'];
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
    if (existing === 'empty') return;
    const refund = Math.floor(TILE_TYPES[existing].cost * 0.5);
    state.cash += refund;
    state.grid[y][x] = 'empty';
    flashCell(x, y, 1);
    pushTicker(`Bulldozed ${TILE_TYPES[existing].name} (+$${refund})`, 'warn');
    return;
  }

  const def = TILE_TYPES[id];
  if (existing !== 'empty') {
    pushTicker(`Cell occupied — bulldoze first (press 6)`, 'bad');
    return;
  }
  if (state.cash < def.cost) {
    pushTicker(`Need $${def.cost} for ${def.name}`, 'bad');
    return;
  }
  if (id === 'gpu2' && state.cash < 5000 && !state.goalUnlocked) {
    // soft gate: still allow if they have enough cash; visual hint elsewhere
  }
  state.cash -= def.cost;
  state.grid[y][x] = id;
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

  // Tally power, cooling, compute
  let power = 0, cooling = 0, gpuTflops = 0, deskCount = 0, upkeep = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const id = state.grid[y][x];
      if (id === 'empty') continue;
      const t = TILE_TYPES[id];
      if (t.power > 0) power += t.power;
      if (t.cooling > 0) cooling += t.cooling;
      if (id === 'desk') deskCount++;
      upkeep += t.upkeep || 0;
    }
  }

  // Each GPU draws if there's available power AND cooling adjacency (we use global pools for simplicity)
  let powerUsed = 0, coolingUsed = 0;
  const computeCells = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const id = state.grid[y][x];
      const t = TILE_TYPES[id];
      if (!t || (t.compute || 0) === 0) continue;
      const needP = Math.abs(t.power); // negative => draw
      const needC = Math.abs(t.cooling);
      if (power - powerUsed >= needP && cooling - coolingUsed >= needC) {
        powerUsed += needP;
        coolingUsed += needC;
        gpuTflops += t.compute;
        computeCells.push({ x, y });
      }
    }
  }
  // Coolant loop power draw is constant if powered
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (state.grid[y][x] === 'cooler') {
        if (power - powerUsed >= 1) powerUsed += 1;
      }
    }
  }

  // Engineer multiplier (cap at 3 desks)
  const mult = Math.pow(1.15, Math.min(deskCount, 3));
  const computeAdj = gpuTflops * mult;

  // Revenue per tick
  const revPerSec = computeAdj * REVENUE_PER_TFLOPS;
  const revThisTick = revPerSec * (TICK_MS / 1000);
  const upkeepThisTick = upkeep * (TICK_MS / 1000);
  const net = revThisTick - upkeepThisTick;
  state.cash += net;

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
  state.upkeep = upkeep;
  state.revenue = revPerSec - upkeep;

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

function updateHUD() {
  hudCash.textContent = `$${Math.floor(state.cash).toLocaleString()}`;
  hudCompute.textContent = `${state.totalCompute.toFixed(1)} TFLOPS`;
  hudPower.textContent = `${state.powerUsed} / ${state.totalPower} MW`;
  hudCooling.textContent = `${state.coolingUsed} / ${state.totalCooling} kW`;
  const r = state.revenue;
  hudRevenue.textContent = `${r >= 0 ? '+' : ''}$${r.toFixed(1)}/s`;
  hudRevenue.classList.toggle('pos', r >= 0);
  hudRevenue.classList.toggle('neg', r < 0);
  goalBarFill.style.width = Math.min(100, (state.cash / GOAL) * 100) + '%';
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
      const id = state.grid[y][x];
      const px = o.x + x * TILE;
      const py = o.y + y * TILE;
      drawCell(px, py, id, x, y);
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
    const canAfford = state.cash >= def.cost;
    const occupied = state.grid[state.hover.y][state.hover.x] !== 'empty';
    if (id === 'bull') {
      ctx.fillStyle = occupied ? '#ff4f6d' : '#333';
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

function drawCell(px, py, id, gx, gy) {
  const def = TILE_TYPES[id];
  // Base
  ctx.fillStyle = id === 'empty' ? '#0c1124' : def.color;
  ctx.fillRect(px, py, TILE, TILE);
  // Subtle inner panel
  if (id !== 'empty') {
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
  if (id !== 'empty' && def.accent) {
    drawGlyph(ctx, px + TILE / 2, py + TILE / 2, id, def.accent);
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
  tooltipEl.innerHTML = `<div class="tip-title">${title}</div><div style="color:var(--text-muted);font-size:11px;margin-top:4px;">${desc}</div>${rows}`;
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
    <li>Press <kbd>1</kbd>–<kbd>6</kbd> to pick tools. <kbd>M</kbd> to mute. Use the Music panel to swap vibes.</li>
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
updateHUD();
requestAnimationFrame(loop);
pushTicker('Welcome to Singularity Tycoon — Mini', 'good');
pushTicker('Place a Power Plant, a Coolant Loop, and a GPU Rack to start', '');
