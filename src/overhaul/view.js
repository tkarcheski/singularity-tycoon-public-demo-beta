/* Singularity Tycoon overhaul presentation adapter.
 *
 * Integration contract:
 *   const view = createOverhaulView(game, { root });
 *   game.state               optional current state
 *   game.snapshot()          preferred JSON-compatible snapshot
 *   game.command(action)     validated player command (dispatch also accepted)
 *   game.subscribe(listener) emits a semantic event; the view re-reads state
 *
 * The renderer only consumes snapshots and emits actions. It never reaches
 * into simulation internals. A deterministic mock is used only when the page
 * is opened without an injected game/acceptance bridge.
 */
(function installOverhaulView(global) {
  'use strict';

  const WIDTH = 12;
  const HEIGHT = 8;
  const CAPABILITIES = [
    ['floor_claim', 'floor'], ['generator', 'power-source'], ['power_line', 'power-link'],
    ['power_pole', 'power-link'], ['cooling_pump', 'cooling-source'],
    ['cooling_pipe', 'cooling-link'], ['data_cable', 'data-link'],
    ['data_switch', 'data-link'], ['fiber_gateway', 'external-link'],
  ];
  const BLUEPRINTS = [
    { id: 'generator', layer: 'physical', name: 'Compact Generator', detail: '+24 power generation', cost: 220, state: 'unlocked', icon: 'power', kind: 'power' },
    { id: 'power_line', layer: 'physical', name: 'Power Line', detail: '12 capacity route', cost: 6, state: 'unlocked', icon: 'link', kind: 'power' },
    { id: 'power_pole', layer: 'physical', name: 'Power Pole', detail: '30 capacity route', cost: 18, state: 'unlocked', icon: 'link', kind: 'power' },
    { id: 'cooling_pump', layer: 'physical', name: 'Cooling Pump', detail: '+12 cooling generation', cost: 140, state: 'unlocked', icon: 'cooling', kind: 'cooling' },
    { id: 'cooling_pipe', layer: 'physical', name: 'Cooling Pipe', detail: '12 capacity route', cost: 5, state: 'unlocked', icon: 'pipe', kind: 'cooling' },
    { id: 'data_cable', layer: 'network', name: 'Data Cable', detail: '16 capacity route', cost: 5, state: 'unlocked', icon: 'network', kind: 'network' },
    { id: 'data_switch', layer: 'network', name: 'Internal Switch', detail: '48 capacity route', cost: 70, state: 'unlocked', icon: 'network', kind: 'network' },
    { id: 'fiber_gateway', layer: 'network', name: 'F1 Underground Fiber', detail: 'south-edge sell uplink', cost: 180, state: 'unlocked', icon: 'network', kind: 'network' },
    { id: 'computer_lean', layer: 'compute', name: 'Lean Compute Node', detail: '8 raw FLOPS', cost: 260, state: 'revealed', icon: 'computer', kind: 'computer' },
    { id: 'computer_steady', layer: 'compute', name: 'Steady Compute Node', detail: '11 raw FLOPS', cost: 320, state: 'revealed', icon: 'computer', kind: 'computer' },
    { id: 'computer_burst', layer: 'compute', name: 'Burst Compute Node', detail: '15 raw FLOPS', cost: 390, state: 'revealed', icon: 'computer', kind: 'computer' },
    { id: 'ai_controller', layer: 'ai', name: 'AI Controller', detail: 'opt-in utility control core', cost: 260, state: 'revealed', icon: 'ai', kind: 'ai' },
    { id: 'ai_bus', layer: 'ai', name: 'AI Bus', detail: 'self-improvement control route', cost: 8, state: 'revealed', icon: 'ai', kind: 'ai' },
  ];
  const BLUEPRINT_BY_ID = new Map(BLUEPRINTS.map((blueprint) => [blueprint.id, blueprint]));
  const ROUTE_PRESETS = [
    { id:'balanced', label:'Balanced', detail:'25% each', routes:{sell:.25,research:.25,train:.25,inference:.25} },
    { id:'sell', label:'Sell', detail:'100% revenue', routes:{sell:1,research:0,train:0,inference:0} },
    { id:'train', label:'Train / Text', detail:'80% training', routes:{sell:0,research:.1,train:.8,inference:.1} },
    { id:'jobs', label:'Jobs', detail:'80% inference', routes:{sell:.1,research:.1,train:0,inference:.8} },
    { id:'ai-train', label:'AI Train', detail:'100% research', routes:{sell:0,research:1,train:0,inference:0} },
  ];
  const BUSINESS_BALANCE = {
    textTrainingRequired:20,
    harnessBuildCost:80,
    agentCreationCost:30,
    humanHireCost:2500,
  };

  const ICONS = {
    power: '<path d="M13 2 5 13h6l-1 9 9-13h-6V2Z"/>',
    link: '<path d="M4 12h16M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
    cooling: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><circle cx="12" cy="12" r="3"/>',
    pipe: '<path d="M4 4v7a3 3 0 0 0 3 3h10a3 3 0 0 1 3 3v3M2 4h4M18 20h4"/>',
    computer: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M7 8h7M7 11h10"/>',
    network: '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="m7 11 10-4M7 13l10 4"/>',
    ai: '<path d="M8 5a4 4 0 0 1 7-1 4 4 0 0 1 3 6 4 4 0 0 1-1 7 4 4 0 0 1-6 2 4 4 0 0 1-6-3 4 4 0 0 1 0-7 4 4 0 0 1 3-4Z"/><path d="M9 8c2 1 3 3 2 5m5-6c-2 1-3 3-2 5m-6 3c2-1 4 0 5 2"/>',
    robot: '<rect x="6" y="7" width="12" height="10" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M8 20h8"/><circle cx="12" cy="3" r="1"/>',
    human: '<circle cx="12" cy="6" r="3"/><path d="M12 9v7M7 13l5-3 5 3M9 22l3-6 3 6"/>',
    floor: '<path d="M4 8 12 3l8 5-8 5-8-5Zm0 5 8 5 8-5M4 17l8 5 8-5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  };

  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.floor}</svg>`;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
  function round(value, digits = 1) { const p = 10 ** digits; return Math.round((Number(value) || 0) * p) / p; }
  function cellKey(floor, x, y) { return `f${floor}:${x},${y}`; }
  function hashSeed(seed) {
    let hash = 2166136261;
    for (const char of String(seed)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function connectedFootprint(seed) {
    const offset = hashSeed(seed) % 2;
    const owned = [];
    for (let y = 2; y <= 5; y++) for (let x = 2 + offset; x <= 6 + offset; x++) {
      owned.push({ key: cellKey(0, x, y), floor: 0, x, y });
    }
    return owned;
  }

  function frontierFor(owned, cash = 0) {
    const occupied = new Set(owned.map((cell) => cell.key));
    const frontier = new Map();
    for (const cell of owned) {
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const x = cell.x + dx, y = cell.y + dy;
        const key = cellKey(cell.floor, x, y);
        if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || occupied.has(key)) continue;
        frontier.set(key, { key, floor: cell.floor, x, y, cost: 70 + (x + y) * 5 + Math.floor(cash / 10000) * 5 });
      }
    }
    return [...frontier.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  }

  function initialMockSnapshot(seed) {
    const owned = connectedFootprint(seed);
    const bonus = hashSeed(seed) % 3;
    const unlocks = CAPABILITIES.map(([id, kind]) => ({ id, kind }));
    unlocks.push({ id: ['computer_lean', 'computer_steady', 'computer_burst'][bonus], kind: 'computer' });
    const actors = [
      { id: 'computer-alpha', kind: 'computer', state: 'loaded', floor: 0, x: 6, y: 3, label: 'NODE A-17' },
      { id: 'computer-beta', kind: 'computer', state: 'booting', floor: 0, x: 5, y: 4, label: 'NODE B-04' },
      { id: 'robot-mica', kind: 'robot', state: 'repairing', floor: 0, x: 3, y: 4, label: 'MICA-2' },
      { id: 'human-aya', kind: 'human', state: 'working', floor: 0, x: 4, y: 3, label: 'AYA' },
      { id: 'human-ivo', kind: 'human', state: 'training', floor: 0, x: 7, y: 5, label: 'IVO' },
    ];
    const paths = {
      power: [
        { id: 'p-1', source: 'solar-1', target: 'computer-alpha', from: {x:2,y:3}, to: {x:6,y:3}, connected: true, capacity: 12, delivered: 8.4, status: 'active' },
        { id: 'p-2', source: 'solar-1', target: 'computer-beta', from: {x:2,y:3}, to: {x:5,y:4}, connected: true, capacity: 8, delivered: 8, status: 'saturated' },
      ],
      cooling: [
        { id: 'c-1', source: 'cooler-1', target: 'computer-alpha', from: {x:3,y:5}, to: {x:6,y:3}, connected: true, capacity: 10, delivered: 6.2, status: 'active' },
        { id: 'c-2', source: 'cooler-1', target: 'computer-beta', from: {x:3,y:5}, to: {x:5,y:4}, connected: true, capacity: 6, delivered: 4.8, status: 'active' },
      ],
      data: [
        { id: 'd-1', source: 'switch-1', target: 'computer-alpha', from: {x:4,y:2}, to: {x:6,y:3}, connected: true, capacity: 20, delivered: 12.6, status: 'active' },
        { id: 'd-2', source: 'switch-1', target: 'fiber-f1', from: {x:4,y:2}, to: {x:7,y:2}, connected: false, capacity: 20, delivered: 0, status: 'blocked' },
      ],
    };
    const structures = [
      { id:'solar-1', kind:'power', floor:0, x:2, y:3, label:'Solar Spine' },
      { id:'cooler-1', kind:'cooling', floor:0, x:3, y:5, label:'Coolant Pump' },
      { id:'switch-1', kind:'network', floor:0, x:4, y:2, label:'Fiber Router' },
      { id:'fiber-f1', kind:'network', floor:0, x:7, y:2, label:'F1 Fiber' },
    ];
    return {
      seed: String(seed), unlocks,
      footprint: { owned, frontier: frontierFor(owned, 2450) },
      actors, structures,
      networks: {
        power: { paths: paths.power }, cooling: { paths: paths.cooling }, data: { paths: paths.data },
      },
      computers: [
        { id:'computer-alpha', state:'loaded', powerDelivered:8.4, coolingDelivered:6.2, dataConnected:true, rawFlops:12.6 },
        { id:'computer-beta', state:'booting', powerDelivered:8, coolingDelivered:4.8, dataConnected:true, rawFlops:0 },
      ],
      flops: { raw:12.6, sell:0, training:3.2, jobs:4.8, reserved:1.6, idle:3, loss:0 },
      sell: { requested:false, blocked:true, reason:'missing-f1-fiber', fiberFloor:null, routedFlops:0 },
      economy: { cash:2450, invoicesPaid:3, humansHired:2, payroll:34 },
      ticks: { raw:1842, completed:1842 },
      floors: [{ id:0, name:'Floor 1', status:'online' }, { id:1, name:'Floor 2', status:'blueprint' }],
      progression: { current:3, total:7, label:'Physical opening' },
      quest: { index:'03', title:'Complete the uplink', body:'Your compute is live. Connect Fiber on Floor 1 before routing FLOPS to Sell.', action:'Select Fiber Trunk', hotkey:'N' },
      jobs: [
        { id:'job-13', label:'Safety classifier', status:'running', detail:'4.8 FLOPS · 62%' },
        { id:'job-12', label:'Invoice reconciliation', status:'queued', detail:'Agent ALPHA' },
      ],
      stability: 96,
    };
  }

  function createMockGame(seed = 'AURORA-17') {
    let state = initialMockSnapshot(seed);
    const listeners = new Set();
    const notify = () => listeners.forEach((listener) => listener(clone(state)));
    const commit = () => {
      state.ticks.raw++;
      state.ticks.completed = state.ticks.raw;
      notify();
    };
    const game = {
      get state() { return state; },
      snapshot() { return clone(state); },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      dispatch(action) {
        if (action?.type === 'purchase-frontier') {
          const frontier = state.footprint.frontier.find((cell) => cell.key === action.cellKey);
          if (!frontier) return { ok:false, reason:'not-frontier' };
          if (state.economy.cash < frontier.cost) return { ok:false, reason:'insufficient-cash' };
          state.economy.cash -= frontier.cost;
          state.footprint.owned.push({ key:frontier.key, floor:frontier.floor, x:frontier.x, y:frontier.y });
          state.footprint.frontier = frontierFor(state.footprint.owned, state.economy.cash);
          commit();
          return { ok:true };
        }
        commit();
        return { ok:true };
      },
      command(action) { return game.dispatch(action); },
      reset(options = {}) { state = initialMockSnapshot(options.seed || 'AURORA-17'); notify(); return clone(state); },
      runScenario(name) {
        const snapshots = [];
        const push = () => snapshots.push(clone(state));
        if (name === 'computer-path-disconnected') {
          state.networks.power.paths.forEach((path) => { path.connected = false; path.delivered = 0; path.status = 'blocked'; });
          state.networks.cooling.paths.forEach((path) => { path.connected = false; path.delivered = 0; path.status = 'blocked'; });
          state.networks.data.paths.forEach((path) => { path.connected = false; path.delivered = 0; path.status = 'blocked'; });
          state.computers[0] = {...state.computers[0], state:'off', powerDelivered:0, coolingDelivered:0, dataConnected:false, rawFlops:0};
          state.actors.find((actor) => actor.id === 'computer-alpha').state = 'off';
          state.flops = {raw:0,sell:0,training:0,jobs:0,reserved:0,idle:0,loss:0};
          commit(); push();
        } else if (name === 'computer-path-connected') {
          state.computers[0].state = 'off'; state.computers[0].rawFlops = 0;
          state.actors.find((actor) => actor.id === 'computer-alpha').state = 'off'; commit(); push();
          for (const network of Object.values(state.networks)) network.paths.forEach((path) => { if (path.target === 'computer-alpha') { path.connected = true; path.delivered = Math.min(path.capacity, 8); path.status = 'active'; } });
          state.computers[0] = {...state.computers[0], state:'booting', powerDelivered:8, coolingDelivered:6, dataConnected:true, rawFlops:0};
          state.actors.find((actor) => actor.id === 'computer-alpha').state = 'booting'; commit(); push();
          state.computers[0].state = 'loaded'; state.computers[0].rawFlops = 12.6;
          state.actors.find((actor) => actor.id === 'computer-alpha').state = 'loaded';
          state.flops = {raw:12.6,sell:0,training:3.2,jobs:4.8,reserved:1.6,idle:3,loss:0}; commit(); push();
        } else if (name === 'sell-without-f1-fiber') {
          state.sell = {requested:true,blocked:true,reason:'missing-f1-fiber',fiberFloor:null,routedFlops:0}; state.flops.sell = 0; commit(); push();
        } else if (name === 'sell-with-f1-fiber') {
          const fiber = state.networks.data.paths.find((path) => path.target === 'fiber-f1');
          if (fiber) { fiber.connected = true; fiber.delivered = 7.4; fiber.status = 'active'; }
          state.sell = {requested:true,blocked:false,reason:null,fiberFloor:1,routedFlops:7.4};
          state.flops = {raw:12.6,sell:7.4,training:2.2,jobs:1.5,reserved:.5,idle:1,loss:0}; commit(); push();
        } else if (name === 'flops-routing') {
          state.flops = {raw:12.6,sell:4.1,training:2.7,jobs:3.2,reserved:1.1,idle:1.2,loss:.3}; commit(); push();
        } else if (name === 'text-business-loop') {
          const cashBefore = state.economy.cash;
          const events = [
            {type:'text-trained',entityId:'text-1'},
            {type:'harness-built',entityId:'harness-1',textId:'text-1'},
            {type:'agent-created',entityId:'agent-1',harnessId:'harness-1'},
            {type:'job-completed',entityId:'job-1',agentId:'agent-1'},
            {type:'invoice-issued',entityId:'invoice-1',jobId:'job-1',amount:540},
            {type:'cash-received',entityId:'cash-1',invoiceId:'invoice-1',amount:540,cashBefore,cashAfter:cashBefore+540},
            {type:'human-hired',entityId:'human-new',humansBefore:2,humansAfter:3,payrollBefore:34,payrollAfter:52},
          ];
          state.economy.cash += 540; state.economy.invoicesPaid++; state.economy.humansHired++; state.economy.payroll = 52; commit();
          return { events };
        } else throw new Error(`Unknown overhaul scenario: ${name}`);
        return { snapshots };
      },
      destroy() { clearInterval(timer); listeners.clear(); },
    };
    const timer = setInterval(() => {
      const robot = state.actors.find((actor) => actor.kind === 'robot');
      const human = state.actors.find((actor) => actor.id === 'human-ivo');
      const computer = state.actors.find((actor) => actor.id === 'computer-beta');
      const phase = state.ticks.raw % 8;
      if (robot) robot.state = ['idle','moving','moving','repairing','repairing','charging','idle','blocked'][phase];
      if (human) human.state = ['idle','moving','working','training','training','hired','blocked','working'][phase];
      if (computer) computer.state = ['off','booting','booting','loaded','working','throttled','blocked','booting'][phase];
      commit();
    }, 1000);
    return game;
  }

  function actorArtActivity(kind, state) {
    const maps = {
      human: {moving:'travel',travel:'travel',working:'work',work:'work',training:'creative',creative:'creative',hired:'idle',repairing:'repair',repair:'repair',rest:'rest',blocked:'blocked',idle:'idle'},
      robot: {moving:'move',move:'move',building:'repair',repairing:'repair',repair:'repair',charging:'charge',charge:'charge',blocked:'fault',fault:'fault',idle:'idle'},
      computer: {booting:'boot',boot:'boot',loaded:'load',working:'load',load:'load',throttled:'throttle',throttle:'throttle',blocked:'fault',fault:'fault',recovering:'recover',recover:'recover',off:'off',idle:'idle'},
    };
    return maps[kind]?.[state] || 'idle';
  }

  function actorMarkup(actor) {
    const kind = ['human','robot','computer'].includes(actor.kind) ? actor.kind : 'computer';
    const state = actor.state || 'idle';
    const activity = actorArtActivity(kind, state);
    const attrs = `class="entity ${kind}" data-actor-id="${escapeHtml(actor.id)}" data-actor-kind="${kind}" data-actor-state="${escapeHtml(state)}" data-animation-hook="${kind}:${escapeHtml(state)}" data-activity="${activity}" aria-hidden="true"`;
    if (kind === 'computer') return `<div ${attrs}><span class="machine-case"></span><span class="machine-screen"></span><span class="machine-fan"></span><span class="machine-led"></span><span class="entity-status-mark">${state === 'throttled' ? '△' : state === 'blocked' ? '×' : ''}</span></div>`;
    if (kind === 'robot') return `<div ${attrs}><span class="robot-shadow"></span><span class="robot-body"></span><span class="robot-eye"></span><span class="robot-arm"></span><span class="robot-wheel"></span><span class="robot-tool">✦</span><span class="entity-status-mark">${state === 'blocked' ? '!' : ''}</span></div>`;
    return `<div ${attrs}><span class="human-head"></span><span class="human-body"></span><span class="human-arm left"></span><span class="human-arm right"></span><span class="human-leg left"></span><span class="human-leg right"></span><span class="human-prop"></span><span class="entity-status-mark">${state === 'blocked' ? '!' : ''}</span></div>`;
  }

  function aggregateNetwork(network) {
    const paths = network?.paths || [];
    return {
      paths,
      capacity: paths.reduce((sum, path) => sum + Math.max(0, Number(path.capacity) || 0), 0),
      delivered: paths.reduce((sum, path) => sum + (path.connected ? Math.max(0, Number(path.delivered) || 0) : 0), 0),
      blocked: paths.filter((path) => !path.connected || path.status === 'blocked').length,
    };
  }

  function uiFloor(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function normalizeCell(cell, fallbackFloor = 0) {
    const floor = uiFloor(cell?.uiFloor, uiFloor(cell?.floor, fallbackFloor));
    const x = clamp(cell?.x, 0, WIDTH - 1);
    const y = clamp(cell?.y, 0, HEIGHT - 1);
    const sourceKey = cell?.sourceKey || cell?.key || cellKey(floor, x, y);
    return {
      ...cell,
      floor,
      x,
      y,
      sourceKey,
      commandKey: cell?.commandKey || sourceKey,
      key: cell?.uiKey || (/^f\d+:\d+,\d+$/.test(sourceKey) ? sourceKey : cellKey(floor, x, y)),
    };
  }

  function structureKind(kind) {
    if (kind === 'computer') return 'computer';
    if (String(kind).startsWith('ai')) return 'ai';
    if (String(kind).startsWith('power')) return 'power';
    if (String(kind).startsWith('cooling')) return 'cooling';
    if (String(kind).includes('data') || kind === 'external-link') return 'network';
    return 'floor';
  }

  function optionalNumber(value) {
    const numeric = Number(value);
    return value === null || value === undefined || !Number.isFinite(numeric) ? null : numeric;
  }

  function normalizeAi(rawAi) {
    if (!rawAi || typeof rawAi !== 'object') {
      return {available:false,level:null,xp:null,nextLevelXp:null,bonusPercent:null,efficiencyMultiplier:null,mistakeChance:null,enabledCount:0,connectedCount:0,activeFaults:0};
    }
    const activeFaults = Array.isArray(rawAi.activeFaults)
      ? rawAi.activeFaults
      : [];
    return {
      ...rawAi,
      available:true,
      level:optionalNumber(rawAi.level),
      xp:optionalNumber(rawAi.xp),
      nextLevelXp:optionalNumber(rawAi.nextLevelXp),
      bonusPercent:optionalNumber(rawAi.bonusPercent),
      efficiencyMultiplier:optionalNumber(rawAi.efficiencyMultiplier),
      mistakeChance:optionalNumber(rawAi.mistakeChance),
      enabledCount:Number(rawAi.enabledCount) || 0,
      connectedCount:Number(rawAi.connectedCount) || 0,
      faults:activeFaults,
      activeFaults:Array.isArray(rawAi.activeFaults) ? rawAi.activeFaults.length : Number(rawAi.activeFaults) || 0,
    };
  }

  function percentText(value, fraction = false) {
    if (value === null || value === undefined) return '—';
    const numeric = Number(value);
    const percent = fraction && Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
    return round(percent,1).toLocaleString();
  }

  function aiGlobalState(ai) {
    if (!ai?.available || ai.enabledCount <= 0) return 'manual';
    if (ai.activeFaults > 0 || ai.state === 'fault') return 'fault';
    if (ai.state === 'recovering' || ai.connectedCount < ai.enabledCount) return 'recovering';
    return 'connected';
  }

  function structureAiState(structure) {
    if (structure?.aiFault) return 'fault';
    if (!structure?.aiEnabled) return 'manual';
    if (structure?.aiConnected) return 'connected';
    return 'recovering';
  }

  function persistedStructures(snapshot) {
    if (snapshot.structures?.length) return snapshot.structures;
    const floor = snapshot.persistence?.floor;
    if (!Array.isArray(floor?.cells)) return [];
    const structures = [];
    for (const row of floor.cells) for (const cell of row || []) {
      for (const [layer, entity] of Object.entries(cell?.layers || {})) {
        if (!entity) continue;
        const blueprint = BLUEPRINT_BY_ID.get(entity.blueprintId);
        structures.push({
          id: entity.entityId,
          blueprintId: entity.blueprintId,
          kind: blueprint?.kind || layer,
          layer,
          label: blueprint?.name || entity.blueprintId,
          floor: 0,
          floorKey: floor.id || cell.floor,
          x: cell.x,
          y: cell.y,
          condition: entity.condition,
        });
      }
    }
    return structures;
  }

  function contextualQuest(snapshot, structures) {
    if (snapshot.quest) return snapshot.quest;
    const hasGenerator = structures.some((item) => item.blueprintId === 'generator');
    const hasComputer = structures.some((item) => item.kind === 'computer');
    if (!hasGenerator) return {index:'01',title:'Energize the footprint',body:'Generator selected — click any owned tile to place it.',action:'Click owned tile',hotkey:'↵'};
    if (!hasComputer) return {index:'02',title:'Assemble the stack',body:'Add Power, Cooling, Data, and your seeded Compute Node.',action:'Build support routes',hotkey:'C'};
    if ((snapshot.flops?.raw || 0) <= 0) return {index:'03',title:'Bring compute online',body:'Trace all three overlays and repair any blocked delivery path.',action:'Inspect routes',hotkey:'N'};
    if (snapshot.sell?.blocked) return {index:'04',title:'Complete the uplink',body:'Place F1 Underground Fiber on the south edge and connect its Data route.',action:'Select fiber',hotkey:'N'};
    return {index:'05',title:'Route and grow',body:'Your physical loop is live. Balance FLOPS destinations and expand the frontier.',action:'Choose frontier',hotkey:'B'};
  }

  function nextBusinessAction(snapshot) {
    const business = snapshot.business;
    const issuedInvoice = business.invoices.find((item) => item.status === 'issued');
    if (issuedInvoice) {
      const ready = snapshot.sell.fiberFloor === 1;
      return {
        command:{type:'receive-invoice',invoiceId:issuedInvoice.id},
        label:`Receive $${Number(issuedInvoice.amount || 0).toLocaleString()} invoice`,
        detail:ready ? `Collect ${issuedInvoice.id} through live F1 Fiber.` : 'Blocked: reconnect F1 Underground Fiber before collection.',
        ready,
      };
    }
    if (snapshot.economy.invoicesPaid > snapshot.economy.humansHired) {
      const ready = snapshot.economy.cash >= BUSINESS_BALANCE.humanHireCost;
      return {
        command:{type:'hire-human'},
        label:'Hire text operator',
        detail:ready ? `$${BUSINESS_BALANCE.humanHireCost.toLocaleString()} hire · adds real payroll.` : `Need $${Math.ceil(BUSINESS_BALANCE.humanHireCost - snapshot.economy.cash).toLocaleString()} more cash.`,
        ready,
      };
    }
    if (business.pendingHarness) {
      return {
        command:null,
        label:'Robot building harness',
        detail:`${business.pendingHarness.remainingTicks} simulation tick${business.pendingHarness.remainingTicks === 1 ? '' : 's'} remaining · ${business.pendingHarness.robotId}.`,
        ready:false,
      };
    }
    const runningJob = business.jobs.find((item) => item.status === 'running');
    if (runningJob) {
      const remaining = Math.max(0, Number(runningJob.requiredFlops || 0) - Number(runningJob.completedFlops || 0));
      const routeReady = Number(snapshot.routes.inference) > 0 && snapshot.sell.fiberFloor === 1;
      return {
        command:null,
        label:'Contract running',
        detail:routeReady ? `${round(remaining,1)} inference FLOPS remain.` : 'Waiting for a Jobs route and live F1 Fiber.',
        ready:false,
      };
    }
    const text = business.textModels.find((item) => !business.harnesses.some((harness) => harness.textId === item.id));
    if (text) {
      const idleRobot = snapshot.actors.find((actor) => actor.kind === 'robot' && actor.state === 'idle');
      const cashReady = snapshot.economy.cash >= BUSINESS_BALANCE.harnessBuildCost;
      const ready = Boolean(idleRobot) && cashReady;
      return {
        command:{type:'build-harness',textId:text.id},
        label:'Build text harness',
        detail:!cashReady ? `Need $${Math.ceil(BUSINESS_BALANCE.harnessBuildCost - snapshot.economy.cash)} more cash.` : !idleRobot ? 'Waiting for an idle robot.' : `$${BUSINESS_BALANCE.harnessBuildCost} · robot builds for two ticks.`,
        ready,
      };
    }
    const harness = business.harnesses.find((item) => !business.agents.some((agent) => agent.harnessId === item.id));
    if (harness) {
      const ready = snapshot.economy.cash >= BUSINESS_BALANCE.agentCreationCost;
      return {
        command:{type:'create-agent',harnessId:harness.id},
        label:'Create text agent',
        detail:ready ? `$${BUSINESS_BALANCE.agentCreationCost} · bind ${harness.id}.` : `Need $${Math.ceil(BUSINESS_BALANCE.agentCreationCost - snapshot.economy.cash)} more cash.`,
        ready,
      };
    }
    const idleAgent = business.agents.find((item) => item.state === 'idle');
    if (idleAgent) {
      return {
        command:{type:'start-job',agentId:idleAgent.id},
        label:'Start text contract',
        detail:snapshot.sell.fiberFloor === 1 ? `Assign ${idleAgent.id}; route FLOPS to Jobs.` : `Assign ${idleAgent.id}; job waits until F1 Fiber is live.`,
        ready:true,
      };
    }
    const trainingAvailable = Math.max(0, Number(snapshot.progress.training || 0) - Number(business.trainingSpent || 0));
    const ready = trainingAvailable >= BUSINESS_BALANCE.textTrainingRequired;
    return {
      command:{type:'complete-text-training'},
      label:'Complete text training',
      detail:ready ? `Spend ${BUSINESS_BALANCE.textTrainingRequired} accumulated training FLOPS.` : `${round(trainingAvailable,1)} / ${BUSINESS_BALANCE.textTrainingRequired} training FLOPS · choose Train / Text routing.`,
      ready,
      progress:trainingAvailable,
    };
  }

  function normalizeSnapshot(raw) {
    const snapshot = raw?.presentation || raw || {};
    const economy = snapshot.economy || {};
    const ticks = snapshot.ticks || {raw:snapshot.tick || 0, completed:snapshot.completedTick ?? snapshot.tick ?? 0};
    const footprint = snapshot.footprint || {owned:[],frontier:[]};
    const owned = (footprint.owned || []).map((cell) => normalizeCell(cell));
    const frontier = (footprint.frontier || []).map((cell) => normalizeCell(cell));
    const structures = persistedStructures(snapshot).map((item, index) => {
      const blueprint = BLUEPRINT_BY_ID.get(item.blueprintId);
      return {
        ...item,
        id: item.id || item.entityId || `structure-${index}`,
        label: item.label || blueprint?.name || item.blueprintId || `Structure ${index + 1}`,
        floor: uiFloor(item.uiFloor, uiFloor(item.floor, 0)),
        x: clamp(item.x, 0, WIDTH - 1),
        y: clamp(item.y, 0, HEIGHT - 1),
        icon: structureKind(item.kind || blueprint?.kind),
        baseMetrics:item.baseMetrics || item.base || {},
        effectiveMetrics:item.effectiveMetrics || item.effective || item.baseMetrics || item.base || {},
      };
    });
    const entityPositions = new Map(structures.map((item) => [item.id, {floor:item.floor,x:item.x,y:item.y}]));
    const actors = (snapshot.actors || []).map((actor, index) => ({
      id: actor.id || `${actor.kind || 'actor'}-${index}`,
      kind: actor.kind || 'computer', state: actor.state || actor.activity || 'idle', label: actor.label || actor.id || `Actor ${index + 1}`,
      floor: uiFloor(actor.uiFloor, uiFloor(actor.floor, entityPositions.get(actor.id)?.floor || 0)),
      x: clamp(actor.x ?? entityPositions.get(actor.id)?.x ?? owned[index % Math.max(1, owned.length)]?.x, 0, WIDTH - 1),
      y: clamp(actor.y ?? entityPositions.get(actor.id)?.y ?? owned[index % Math.max(1, owned.length)]?.y, 0, HEIGHT - 1),
    }));
    const networks = snapshot.networks || {};
    const normalizeNetwork = (network, networkName) => ({
      ...(network || {}),
      paths: (network?.paths || []).map((path, index) => {
        const source = entityPositions.get(path.source);
        const target = entityPositions.get(path.target);
        const capacity = Math.max(0, Number(path.capacity) || 0);
        const delivered = Math.max(0, Number(path.delivered) || 0);
        return {
          ...path,
          id: path.id || `${networkName}-${path.source || 'none'}-${path.target || 'none'}-${index}`,
          floor: uiFloor(path.uiFloor, uiFloor(path.floor, source?.floor ?? target?.floor ?? 0)),
          from: path.from || source,
          to: path.to || target,
          status: path.status || (path.connected === false ? 'blocked' : capacity > 0 && delivered >= capacity ? 'saturated' : 'active'),
        };
      }),
    });
    const progressValues = Object.values(snapshot.progress || {}).map(Number).filter(Number.isFinite);
    const activeProgress = progressValues.filter((value) => value > 0).length;
    const progression = snapshot.progression || {
      current: Math.min(7, Math.max(1, 1 + structures.length + activeProgress)),
      total: 7,
      label: snapshot.starterKitId ? `${String(snapshot.starterKitId).replaceAll('-', ' ')} · physical opening` : 'Physical opening',
    };
    const sourceBusiness = snapshot.business || {};
    const business = {
      trainingSpent:Number(sourceBusiness.trainingSpent) || 0,
      textModels:sourceBusiness.textModels || [],
      harnesses:sourceBusiness.harnesses || [],
      agents:sourceBusiness.agents || [],
      jobs:sourceBusiness.jobs || snapshot.jobs || [],
      invoices:sourceBusiness.invoices || [],
      pendingHarness:sourceBusiness.pendingHarness || null,
      events:sourceBusiness.events || [],
    };
    const normalized = {
      ...snapshot,
      seed: String(snapshot.seed || 'UNSEEDED'),
      unlocks: snapshot.unlocks || [],
      footprint: {owned, frontier},
      actors,
      structures,
      networks: {
        power:normalizeNetwork(networks.power, 'power'),
        cooling:normalizeNetwork(networks.cooling, 'cooling'),
        data:normalizeNetwork(networks.data || networks.network, 'data'),
        ai:normalizeNetwork(networks.ai, 'ai'),
      },
      ai:normalizeAi(snapshot.ai),
      computers: snapshot.computers || [],
      flops: {raw:0,sell:0,training:0,jobs:0,reserved:0,idle:0,loss:0,...(snapshot.flops || {})},
      sell: snapshot.sell || {requested:false,blocked:false,reason:null,fiberFloor:null,routedFlops:0},
      routes: {sell:0,research:.25,train:.25,inference:.25,...(snapshot.routes || {})},
      progress: {research:0,training:0,inference:0,rawFlopsSold:0,...(snapshot.progress || {})},
      business,
      economy: {cash:Number(economy.cash ?? snapshot.cash ?? 0),invoicesPaid:0,humansHired:0,payroll:0,...economy},
      ticks: {raw:Number(ticks.raw)||0,completed:Number(ticks.completed)||0},
      floors: snapshot.floors || [{id:0,sourceId:snapshot.persistence?.floor?.id || 'F1',name:'Floor 1',status:'online'}],
      progression,
      quest: contextualQuest(snapshot, structures),
      jobs: business.jobs,
      stability: Number(snapshot.stability ?? 100),
    };
    return normalized;
  }

  function shellTemplate() {
    return `
      <div class="overhaul-app">
        <header class="topbar" data-ui-region="top-resource-heartbeat">
          <div class="brand-lockup">
            <span class="brand-mark" aria-hidden="true"></span>
            <span class="brand-copy"><span class="brand-title">Singularity Tycoon</span><span class="brand-subtitle">overhaul · physical opening</span></span>
          </div>
          <div class="resource-ribbon" data-resource-ribbon></div>
          <div class="heartbeat" title="Simulation, committed state, and DOM heartbeat">
            <span class="heartbeat-light" aria-hidden="true"></span><span class="heartbeat-label">UI linked</span><span class="heartbeat-value" data-heartbeat>tick 0 · 0ms</span>
          </div>
        </header>
        <main class="workspace">
          <aside class="panel left-rail" data-ui-region="blueprint-progression-palette" aria-label="Seeded blueprint progression">
            <div class="panel-heading"><div><span class="eyebrow">Seeded start</span><h1 class="panel-title">Blueprints</h1></div><span class="state-chip good">viable</span></div>
            <div class="left-scroll">
              <section class="seed-card" aria-label="Run seed and progression"><div class="seed-line"><span class="panel-note">Run seed</span><strong class="seed-value" data-seed></strong></div><div class="progress-track"><div class="progress-fill" data-progress-fill></div></div><div class="progress-copy" data-progress-copy></div></section>
              <div class="section-label">Layer focus</div><div class="layer-filter" data-layer-filters></div>
              <div class="section-label">Available construction</div><div class="blueprint-list" data-blueprints></div>
            </div>
          </aside>
          <section class="panel stage-shell" data-ui-region="world-stage" aria-label="Twelve by eight simulation floor">
            <div class="stage-toolbar">
              <div class="stage-title"><strong data-floor-name>Floor 1 · Seeded footprint</strong><span data-floor-status>owned network online</span></div>
              <div class="toolbar-group" data-overlay-controls></div>
              <div class="toolbar-group" data-floor-controls></div>
            </div>
            <div class="stage-viewport">
              <div class="board-frame">
                <div class="world-grid" role="grid" aria-label="Floor grid, 12 columns by 8 rows" data-world-grid></div>
                <svg class="connection-layer" viewBox="0 0 1200 800" preserveAspectRatio="none" aria-hidden="true" data-connections></svg>
              </div>
            </div>
            <aside class="quest-dock" data-ui-region="contextual-quest" aria-label="Contextual quest" data-quest></aside>
          </section>
          <aside class="panel right-rail" data-ui-region="inspector-router-actors" aria-label="Inspector, routing, jobs, and actors">
            <div class="panel-heading"><div><span class="eyebrow">Live operations</span><h2 class="panel-title">Inspector</h2></div><span class="state-chip" data-inspector-coord>F1 · 0,0</span></div>
            <div class="right-scroll">
              <section class="module" data-inspector></section>
              <section class="module" data-router></section>
              <section class="module"><div class="tabs" role="tablist" aria-label="Operations details" data-tabs></div><div data-tab-panel></div></section>
            </div>
          </aside>
        </main>
        <div class="tooltip" role="tooltip" data-tooltip hidden></div>
        <div class="sr-only" aria-live="polite" aria-atomic="true" data-live-status></div>
      </div>`;
  }

  function createOverhaulView(game, options = {}) {
    const root = typeof options.root === 'string' ? document.querySelector(options.root) : options.root || document.getElementById('overhaul-root');
    if (!root) throw new Error('createOverhaulView requires a root element');
    if (!game) throw new Error('createOverhaulView requires a game adapter');
    root.innerHTML = shellTemplate();

    const refs = Object.fromEntries([
      'resourceRibbon','heartbeat','seed','progressFill','progressCopy','layerFilters','blueprints','floorName','floorStatus',
      'overlayControls','floorControls','worldGrid','connections','quest','inspectorCoord','inspector','router','tabs','tabPanel','tooltip','liveStatus',
    ].map((name) => [name, root.querySelector(`[data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}]`)]));
    const ui = {
      selectedCell:null,
      selectedBlueprint:'generator',
      layer:'all',
      floor:0,
      overlays:new Set(['power','cooling','network','ai']),
      tab:'actors',
      lastTick:-1,
      feedback:{message:'Generator selected — click an owned tile to place it.',tone:'ready'},
    };
    let snapshot = normalizeSnapshot(typeof game.snapshot === 'function' ? game.snapshot() : game.state);
    let paletteSignature = '';
    let unsubscribe = null;

    function territoryMaps() {
      const owned = new Map(snapshot.footprint.owned.filter((cell) => cell.floor === ui.floor).map((cell) => [cell.key || cellKey(ui.floor,cell.x,cell.y),cell]));
      const frontier = new Map(snapshot.footprint.frontier.filter((cell) => cell.floor === ui.floor).map((cell) => [cell.key || cellKey(ui.floor,cell.x,cell.y),cell]));
      return {owned,frontier};
    }

    function actorAt(x, y) { return snapshot.actors.find((actor) => actor.floor === ui.floor && actor.x === x && actor.y === y); }
    function structuresAt(x, y) {
      return snapshot.structures.filter((item) => Number(item.floor || 0) === ui.floor
        && Number(item.x) === x && Number(item.y) === y);
    }
    function structureAt(x, y) {
      const structures = structuresAt(x, y);
      return structures.find((item) => item.layer === 'facility') || structures[0];
    }

    function renderResources() {
      const power = aggregateNetwork(snapshot.networks.power), cooling = aggregateNetwork(snapshot.networks.cooling), network = aggregateNetwork(snapshot.networks.data);
      const ai = snapshot.ai;
      const aiState = aiGlobalState(ai);
      const aiQuality = ai.level === null ? '—' : `L${ai.level}`;
      const aiBonus = percentText(ai.bonusPercent);
      const aiRisk = percentText(ai.mistakeChance,true);
      const resources = [
        ['Cash', `$${Math.floor(snapshot.economy.cash).toLocaleString()}`, snapshot.economy.cash < 200 ? 'bad' : 'good', 'cash'],
        ['Raw FLOPS', `${round(snapshot.flops.raw,1).toFixed(1)}`, snapshot.flops.raw > 0 ? 'good' : 'warn', 'flops'],
        ['Power', `${round(power.delivered,1)} / ${round(power.capacity,1)} MW`, power.blocked ? 'warn' : 'good', 'power'],
        ['Cooling', `${round(cooling.delivered,1)} / ${round(cooling.capacity,1)} kW`, cooling.blocked ? 'warn' : 'good', 'cooling'],
        ['Data routes', `${network.paths.length - network.blocked} / ${network.paths.length} linked`, network.blocked ? 'warn' : 'good', 'data'],
        [`AI · ${aiState}`, `${aiQuality} · +${aiBonus}% · R${aiRisk}%`, aiState === 'fault' ? 'bad' : aiState === 'recovering' ? 'warn' : aiState === 'connected' ? 'good' : 'warn', 'ai'],
      ];
      refs.resourceRibbon.innerHTML = resources.map(([name,value,tone,key]) => `<div class="resource" data-tone="${tone}"${key === 'cash' ? ` data-cash data-value="${snapshot.economy.cash}"` : ''}${key === 'flops' ? ` data-flops-raw data-value="${snapshot.flops.raw}"` : ''}${key === 'ai' ? ` data-ai-hud data-ai-state="${aiState}" data-ai-quality="${ai.level ?? ''}" data-ai-bonus="${ai.bonusPercent ?? ''}" data-ai-risk="${ai.mistakeChance ?? ''}"` : ''}><span class="resource-name">${escapeHtml(name)}</span><strong class="resource-value">${escapeHtml(value)}</strong></div>`).join('');
      refs.heartbeat.textContent = `tick ${snapshot.ticks.completed} · raw ${snapshot.ticks.raw}`;
      document.documentElement.dataset.uiTick = String(snapshot.ticks.completed);
      refs.seed.textContent = snapshot.seed;
      const progress = clamp(snapshot.progression.current / Math.max(1,snapshot.progression.total) * 100,0,100);
      refs.progressFill.style.setProperty('--progress', `${progress}%`);
      refs.progressCopy.innerHTML = `<span>${escapeHtml(snapshot.progression.label)}</span><span>${snapshot.progression.current} / ${snapshot.progression.total}</span>`;
    }

    function renderPalette() {
      const signature = `${ui.layer}|${ui.selectedBlueprint}|${snapshot.unlocks.map((item) => item.id).join(',')}`;
      if (signature === paletteSignature) return;
      paletteSignature = signature;
      const layers = ['all','physical','compute','network','ai','operations','business'];
      refs.layerFilters.innerHTML = layers.map((layer) => `<button class="filter-button" type="button" data-layer="${layer}" aria-pressed="${ui.layer === layer}">${layer === 'all' ? 'All' : layer.slice(0,4)}</button>`).join('');
      const unlocked = new Set(snapshot.unlocks.map((item) => item.id));
      refs.blueprints.innerHTML = BLUEPRINTS.filter((item) => ui.layer === 'all' || item.layer === ui.layer).map((item) => {
        const state = unlocked.has(item.id) ? 'unlocked' : item.state;
        const stateLabel = state === 'unlocked' ? `$${item.cost}` : state;
        return `<button class="blueprint" type="button" data-blueprint="${item.id}" data-state="${state}" aria-pressed="${ui.selectedBlueprint === item.id}" aria-disabled="${state !== 'unlocked'}" data-tooltip-title="${escapeHtml(item.name)}" data-tooltip-copy="${escapeHtml(state === 'locked' ? `Locked. ${item.detail}` : item.detail)}"><span class="blueprint-icon">${icon(item.icon)}</span><span><span class="blueprint-name">${escapeHtml(item.name)}</span><span class="blueprint-detail">${escapeHtml(item.detail)}</span></span><span class="state-chip ${state === 'revealed' ? 'warn' : state === 'locked' ? 'bad' : 'good'}">${escapeHtml(stateLabel)}</span></button>`;
      }).join('');
    }

    function renderToolbar() {
      const currentFloor = snapshot.floors.find((floor) => Number(floor.id) === ui.floor) || snapshot.floors[0];
      refs.floorName.textContent = `${currentFloor?.name || `Floor ${ui.floor + 1}`} · Seeded footprint`;
      refs.floorStatus.textContent = currentFloor?.status === 'online' ? 'owned network online' : currentFloor?.status || 'frontier blueprint';
      refs.overlayControls.innerHTML = ['power','cooling','network','ai'].map((name) => `<button class="overlay-toggle" type="button" data-overlay="${name}" aria-pressed="${ui.overlays.has(name)}">${name === 'power' ? '↯' : name === 'cooling' ? '❄' : name === 'ai' ? '◉' : '◇'} ${name}</button>`).join('');
      refs.floorControls.innerHTML = snapshot.floors.map((floor) => `<button class="floor-button" type="button" data-floor="${floor.id}" aria-pressed="${Number(floor.id) === ui.floor}">${Number(floor.id) + 1}F</button>`).join('');
    }

    function renderGrid() {
      if (refs.worldGrid.children.length !== WIDTH * HEIGHT) {
        refs.worldGrid.innerHTML = Array.from({length:WIDTH * HEIGHT}, (_, index) => {
          const x = index % WIDTH, y = Math.floor(index / WIDTH);
          return `<button class="cell" type="button" role="gridcell" data-x="${x}" data-y="${y}" tabindex="${index === 0 ? '0' : '-1'}"><span class="cell-coord">${x+1}.${y+1}</span><span class="cell-content"></span><span class="cell-status"></span></button>`;
        }).join('');
      }
      const {owned,frontier} = territoryMaps();
      for (const cell of refs.worldGrid.children) {
        const x = Number(cell.dataset.x), y = Number(cell.dataset.y), key = cellKey(ui.floor,x,y);
        const territory = owned.has(key) ? 'owned' : frontier.has(key) ? 'frontier' : 'locked';
        const actor = actorAt(x,y), structures = structuresAt(x,y), frontierCell = frontier.get(key);
        const primary = structures.find((item) => item.layer === 'facility' || item.blueprintId === 'ai_controller');
        const utilityItems = ['power','cooling','data','ai'].map((layer) => ({
          layer,
          structure:structures.find((item) => item.layer === layer),
          overlay:layer === 'data' ? 'network' : layer,
        })).filter((item) => item.structure);
        const utilities = utilityItems.map((item) => item.layer);
        const utilityCopy = utilities.length ? `; ${utilities.join(', ')} connected` : '';
        const label = actor ? `${actor.label}, ${actor.kind}, ${actor.state}${utilityCopy}` : primary ? `${primary.label}, ${primary.kind}${utilityCopy}` : utilities.length ? `${utilities.join(', ')} utility routes` : territory === 'frontier' ? `Frontier cell ${x+1}, ${y+1}, costs $${frontierCell.cost}` : `${territory} cell ${x+1}, ${y+1}`;
        const selectedBlueprint = BLUEPRINT_BY_ID.get(ui.selectedBlueprint);
        const blueprintUnlocked = snapshot.unlocks.some((item) => item.id === ui.selectedBlueprint);
        cell.dataset.territory = territory;
        cell.dataset.buildTarget = String(territory === 'owned' && Boolean(selectedBlueprint) && blueprintUnlocked);
        cell.dataset.utilityLayers = utilities.join(' ');
        cell.dataset.cellKey = key;
        cell.setAttribute('aria-label', label);
        cell.setAttribute('aria-pressed', String(ui.selectedCell === key));
        cell.setAttribute('aria-disabled', String(territory === 'locked'));
        cell.dataset.tooltipTitle = actor?.label || primary?.label || (utilities.length ? `${utilities.join(' + ')} routes` : `${territory[0].toUpperCase()+territory.slice(1)} cell ${x+1}.${y+1}`);
        cell.dataset.tooltipCopy = actor ? `${actor.kind} · ${actor.state}. Simulation actor ${actor.id}.${utilityCopy}` : primary ? `${primary.kind} infrastructure · ${primary.id}.${utilityCopy}` : utilities.length ? `Slim utility traces: ${utilities.join(', ')}.` : territory === 'frontier' ? `Connected frontier · purchase for $${frontierCell.cost}.` : territory === 'owned' ? 'Owned connected footprint. Select a blueprint to build.' : 'Expand the connected frontier to reveal this cell.';
        const content = cell.querySelector('.cell-content');
        const primaryMarkup = actor ? actorMarkup(actor) : primary ? `<span class="structure structure-${escapeHtml(primary.icon)}" data-primary-layer="${escapeHtml(primary.layer || 'facility')}" data-primary-entity-id="${escapeHtml(primary.id)}" data-primary-blueprint-id="${escapeHtml(primary.blueprintId)}" aria-hidden="true">${icon(primary.icon)}</span>` : territory === 'frontier' ? '<span class="frontier-plus" aria-hidden="true">+</span>' : territory === 'locked' ? `<span class="locked-mark" aria-hidden="true">${icon('lock')}</span>` : '';
        const utilityMarkup = utilityItems.map(({layer,structure,overlay}) => `<span class="cell-utility utility-${layer}" data-cell-utility="${layer}" data-route-layer="${layer}" data-layer-entity-id="${escapeHtml(structure.id)}" data-layer-blueprint-id="${escapeHtml(structure.blueprintId)}" data-overlay-visible="${ui.overlays.has(overlay)}" aria-hidden="true"></span>`).join('');
        content.innerHTML = `${primaryMarkup}${utilityMarkup}`;
        cell.querySelector('.cell-status').textContent = actor?.state || primary?.kind || (utilities.length ? utilities.map((layer) => layer[0].toUpperCase()).join('·') : territory === 'frontier' ? `$${frontierCell.cost}` : '');
      }
    }

    function renderConnections() {
      const chunks = [];
      for (const [kind, networkName] of [['power','power'],['cooling','cooling'],['network','data'],['ai','ai']]) {
        if (!ui.overlays.has(kind)) continue;
        for (const path of snapshot.networks[networkName]?.paths || []) {
          if ((path.floor != null && Number(path.floor) !== ui.floor) || !path.from || !path.to) continue;
          const x1 = clamp(path.from.x,0,WIDTH-1)*100+50, y1 = clamp(path.from.y,0,HEIGHT-1)*100+50;
          const x2 = clamp(path.to.x,0,WIDTH-1)*100+50, y2 = clamp(path.to.y,0,HEIGHT-1)*100+50;
          const bend = Math.max(26, Math.abs(x2-x1)*.22);
          const curve = `M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}`;
          const status = path.connected === false ? 'blocked' : path.status || 'active';
          chunks.push(`<path class="connection connection-underlay" d="${curve}"/><path class="connection ${kind}" data-network-path="${kind}" data-path-id="${escapeHtml(path.id)}" ${kind === 'ai' ? `data-ai-path-id="${escapeHtml(path.id)}" data-ai-path-state="${escapeHtml(status)}"` : ''} data-status="${status}" d="${curve}"/><circle class="connection-node ${kind}" cx="${x1}" cy="${y1}" r="8"/><circle class="connection-node ${kind}" cx="${x2}" cy="${y2}" r="8"/>`);
        }
      }
      refs.connections.innerHTML = chunks.join('');
    }

    function selectedContext() {
      const fallback = snapshot.footprint.owned.find((cell) => cell.floor === ui.floor) || {x:0,y:0,key:cellKey(ui.floor,0,0)};
      const key = ui.selectedCell || fallback.key || cellKey(ui.floor,fallback.x,fallback.y);
      const match = /^[^:]+:(\d+),(\d+)$/.exec(key);
      const x = match ? Number(match[1]) : Number(fallback.x)||0, y = match ? Number(match[2]) : Number(fallback.y)||0;
      const {owned,frontier} = territoryMaps();
      return {key,x,y,territory:owned.has(key)?'owned':frontier.has(key)?'frontier':'locked',frontier:frontier.get(key),actor:actorAt(x,y),structure:structureAt(x,y),structures:structuresAt(x,y)};
    }

    function renderAiInspector(selected) {
      const ai = snapshot.ai;
      const globalState = aiGlobalState(ai);
      const hasController = snapshot.structures.some((item) => item.blueprintId === 'ai_controller');
      const hasBus = snapshot.structures.some((item) => item.blueprintId === 'ai_bus');
      const eligible = selected.structures.filter((item) => Object.values(item.baseMetrics || {}).some((value) => Number(value) > 0));
      const prerequisites = !hasController ? 'Place an AI Controller.' : !hasBus ? 'Connect at least one AI Bus.' : null;
      const rows = eligible.length ? eligible.map((item) => {
        const state = structureAiState(item);
        const nextEnabled = !item.aiEnabled;
        const canToggle = !nextEnabled || !prerequisites;
        const fault = item.aiFault ? (typeof item.aiFault === 'string' ? item.aiFault : item.aiFault.reason || item.aiFault.type || 'control fault') : null;
        const multiplier = optionalNumber(item.aiEfficiencyMultiplier);
        const detail = state === 'fault' ? fault : state === 'connected' ? `${multiplier === null ? 'AI linked' : `${round(multiplier,2)}× effective`} · ${item.layer}` : state === 'recovering' ? 'Opted in · awaiting AI path' : `Manual control · ${item.layer}`;
        return `<div class="ai-target" data-ai-target="${escapeHtml(item.id)}" data-ai-state="${state}" data-ai-enabled="${Boolean(item.aiEnabled)}" data-ai-connected="${Boolean(item.aiConnected)}"><span class="ai-target-copy"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(detail)}</span></span><span class="state-chip ${state === 'fault' ? 'bad' : state === 'connected' ? 'good' : state === 'recovering' ? 'warn' : ''}">${state}</span><span class="ai-target-actions"><button type="button" class="ai-action" data-ai-toggle="${escapeHtml(item.id)}" data-ai-next-enabled="${nextEnabled}" ${canToggle ? '' : 'disabled aria-disabled="true"'}>${nextEnabled ? 'Opt in' : 'Opt out'}</button>${fault ? `<button type="button" class="ai-action repair" data-ai-repair="${escapeHtml(item.id)}">Repair</button>` : ''}</span></div>`;
      }).join('') : '<p class="ai-empty">Select a facility or Power, Cooling, or Data route to manage AI control for that entity.</p>';
      return `<section class="ai-control" data-ai-panel data-ai-control data-ai-state="${globalState}" data-ai-model-id="${escapeHtml(ai.modelId || '')}"><div class="module-head"><span class="module-title">AI Network</span><span class="state-chip ${globalState === 'fault' ? 'bad' : globalState === 'connected' ? 'good' : globalState === 'recovering' ? 'warn' : ''}">${globalState}</span></div><div class="ai-summary"><span><strong>${ai.level === null ? 'Manual' : `Level ${ai.level}`}</strong><small>Training level · ${ai.xp === null ? 'no controller' : `${round(ai.xp,1)} / ${round(ai.nextLevelXp,1)} XP`}</small></span><span><strong>+${percentText(ai.bonusPercent)}%</strong><small>Efficiency bonus</small></span><span><strong>${percentText(ai.mistakeChance,true)}%</strong><small>Mistake chance</small></span></div><p class="ai-guidance">Opt in per structure. Fault monitoring: ${ai.activeFaults} active. Repair appears on faulted targets.</p>${prerequisites ? `<p class="ai-precondition">${escapeHtml(prerequisites)}</p>` : ''}<div class="ai-targets">${rows}</div></section>`;
    }

    function renderInspector() {
      const selected = selectedContext();
      refs.inspectorCoord.textContent = `F${ui.floor+1} · ${selected.x+1},${selected.y+1}`;
      const actor = selected.actor, structure = selected.structure;
      const title = actor?.label || structure?.label || `${selected.territory} cell`;
      const description = actor ? `${actor.kind} actor is ${actor.state}. Its visible pose and status are driven by the committed simulation snapshot.` : structure ? `${structure.kind} infrastructure endpoint. Select its overlay to trace actual delivery.` : selected.territory === 'frontier' ? 'Connected frontier. Purchasing this cell grows the legal footprint and recomputes its edge.' : selected.territory === 'owned' ? 'Connected owned ground. Click this tile with a blueprint selected to build immediately, or use the action below.' : 'Locked territory. Expand from an adjacent frontier cell.';
      const selectedBlueprint = BLUEPRINT_BY_ID.get(ui.selectedBlueprint);
      const action = selected.territory === 'frontier'
        ? `<button class="blueprint inspector-action" type="button" data-purchase-frontier="${escapeHtml(selected.frontier.commandKey)}"><span class="blueprint-icon">${icon('floor')}</span><span><span class="blueprint-name">Purchase frontier</span><span class="blueprint-detail">Grow connected footprint</span></span><span class="state-chip warn">$${selected.frontier.cost}</span></button>`
        : selected.territory === 'owned' && selectedBlueprint
          ? `<button class="blueprint inspector-action" type="button" data-place-selected="${escapeHtml(selectedBlueprint.id)}" data-place-x="${selected.x}" data-place-y="${selected.y}"><span class="blueprint-icon">${icon(selectedBlueprint.icon)}</span><span><span class="blueprint-name">Place ${escapeHtml(selectedBlueprint.name)}</span><span class="blueprint-detail">Build at ${selected.x + 1},${selected.y + 1}</span></span><span class="state-chip good">$${selectedBlueprint.cost}</span></button>`
          : '';
      refs.inspector.innerHTML = `<div class="module-head"><span class="module-title">Selection</span><span class="state-chip ${selected.territory === 'owned' ? 'good' : selected.territory === 'frontier' ? 'warn' : ''}">${selected.territory}</span></div><h3 class="inspector-name">${escapeHtml(title)}</h3><p class="inspector-copy">${escapeHtml(description)}</p><div class="data-grid"><div class="datum"><span>Blueprint</span><strong>${escapeHtml(ui.selectedBlueprint)}</strong></div><div class="datum"><span>Actor state</span><strong>${escapeHtml(actor?.state || '—')}</strong></div><div class="datum"><span>Floor</span><strong>${ui.floor + 1}</strong></div><div class="datum"><span>Cell key</span><strong>${escapeHtml(selected.key)}</strong></div></div>${action}<div class="command-feedback" data-tone="${escapeHtml(ui.feedback.tone)}">${escapeHtml(ui.feedback.message)}</div>${renderAiInspector(selected)}`;
    }

    function revealInspectorAction() {
      const target = refs.inspector.querySelector('.inspector-action') || refs.inspector;
      target.scrollIntoView({block:'nearest',inline:'nearest'});
    }

    function setFeedback(message, tone = 'info', reveal = false) {
      ui.feedback = {message,tone};
      refs.liveStatus.textContent = message;
      renderInspector();
      if (reveal) revealInspectorAction();
    }

    function placementFailure(blueprint, reason) {
      const details = {
        'insufficient-cash':'not enough cash',
        'layer-occupied':'that infrastructure layer is already occupied',
        'requires-south-edge':'F1 Fiber must be placed on the bottom row',
        'wrong-floor':'that structure cannot be built on this floor',
        'unowned-cell':'buy this frontier tile first',
        'locked-blueprint':'that blueprint is still locked',
      };
      return `Can’t place ${blueprint?.name || 'structure'}: ${details[reason] || String(reason || 'invalid location')}.`;
    }

    function renderRouter() {
      const names = [['power','Power'],['cooling','Cooling'],['data','Data']];
      const activePreset = ROUTE_PRESETS.find((preset) => Object.entries(preset.routes).every(([key,value]) => Math.abs((Number(snapshot.routes[key]) || 0) - value) < .000001));
      refs.router.innerHTML = `<div class="module-head"><span class="module-title">Resource router</span><span class="state-chip ${snapshot.sell.blocked ? 'warn':'good'}">${snapshot.sell.blocked ? 'sell blocked':activePreset?.label || 'custom'}</span></div><div class="route-list">${names.map(([name,label]) => {
        const aggregate = aggregateNetwork(snapshot.networks[name]);
        const percent = aggregate.capacity ? clamp(aggregate.delivered/aggregate.capacity*100,0,100) : 0;
        return `<div class="route-row"><span class="route-swatch ${name === 'data' ? 'network' : name}"></span><span class="row-copy"><strong>${label}</strong><span>${round(aggregate.delivered,1)} / ${round(aggregate.capacity,1)} delivered${aggregate.blocked ? ` · ${aggregate.blocked} blocked` : ''}</span><span class="meter" style="color:${name === 'power'?'var(--yellow)':name === 'cooling'?'var(--cyan)':'var(--violet)'}"><span style="--meter:${percent}%"></span></span></span><span class="state-chip ${aggregate.blocked?'warn':'good'}">${aggregate.blocked?'check':'live'}</span></div>`;
      }).join('')}</div><div class="data-grid router-ledger"><div class="datum"><span>Sell routed</span><strong>${round(snapshot.sell.routedFlops,1)} FLOPS</strong></div><div class="datum"><span>Conservation</span><strong>${round(['sell','training','jobs','reserved','idle','loss'].reduce((sum,key)=>sum+(Number(snapshot.flops[key])||0),0),1)} / ${round(snapshot.flops.raw,1)}</strong></div></div><div class="route-preset-label">FLOPS destination preset</div><div class="route-presets" aria-label="FLOPS destination presets">${ROUTE_PRESETS.map((preset) => `<button class="route-preset" type="button" data-route-preset="${preset.id}" aria-pressed="${activePreset?.id === preset.id}"><strong>${escapeHtml(preset.label)}</strong><span>${escapeHtml(preset.detail)}</span></button>`).join('')}</div>${snapshot.sell.blocked ? `<p class="inspector-copy route-warning">Connect Fiber on Floor 1 · ${escapeHtml(snapshot.sell.reason || 'route blocked')}</p>` : ''}`;
    }

    function ventureGroup(label, items, describe) {
      return `<section class="venture-group"><div class="venture-group-head"><span>${escapeHtml(label)}</span><span class="state-chip">${items.length}</span></div>${items.length ? items.map((item) => {
        const detail = describe(item);
        return `<div class="venture-item"><span class="venture-item-main"><strong>${escapeHtml(item.id)}</strong><span>${escapeHtml(detail.copy)}</span></span><span class="state-chip ${detail.tone || ''}">${escapeHtml(detail.state)}</span></div>`;
      }).join('') : '<div class="venture-empty">None yet</div>'}</section>`;
    }

    function renderVenture() {
      const business = snapshot.business;
      const next = nextBusinessAction(snapshot);
      const paidInvoices = business.invoices.filter((item) => item.status === 'paid').length;
      const milestones = [
        business.textModels.length > 0,
        business.harnesses.length > 0,
        business.agents.length > 0,
        business.jobs.some((item) => item.status === 'completed'),
        paidInvoices > 0,
        snapshot.economy.humansHired > 0,
      ].filter(Boolean).length;
      const trainingAvailable = Math.max(0, Number(snapshot.progress.training) - business.trainingSpent);
      const pendingHarnesses = business.pendingHarness
        ? [{...business.pendingHarness,state:'building'}]
        : [];
      const harnesses = [...pendingHarnesses, ...business.harnesses];
      const action = next.command
        ? `<button class="venture-action" type="button" data-business-action="${escapeHtml(next.command.type)}" ${next.ready ? '' : 'disabled aria-disabled="true"'}><span>${escapeHtml(next.label)}</span><strong>${next.ready ? 'Run command →' : 'Precondition blocked'}</strong></button>`
        : `<div class="venture-wait"><span class="venture-wait-light" aria-hidden="true"></span><strong>${escapeHtml(next.label)}</strong></div>`;
      return `<div class="venture-panel" data-venture-panel><div class="venture-summary"><div><span class="section-kicker">Manual operations chain</span><strong>Text Venture</strong></div><span class="state-chip ${milestones === 6 ? 'good' : 'warn'}">${milestones} / 6</span></div><div class="venture-meter" aria-label="${milestones} of 6 venture milestones complete"><span style="--venture-progress:${milestones / 6 * 100}%"></span></div><div class="venture-training"><span>Available training</span><strong>${round(trainingAvailable,1)} / ${BUSINESS_BALANCE.textTrainingRequired} FLOPS</strong></div><section class="venture-next"><span class="section-kicker">Next operation</span><h3>${escapeHtml(next.label)}</h3><p>${escapeHtml(next.detail)}</p>${action}</section><div class="venture-inventory">${ventureGroup('Models',business.textModels,(item)=>({state:item.state || 'trained',tone:'good',copy:`${round(item.trainingFlops,1)} training FLOPS`}))}${ventureGroup('Harnesses',harnesses,(item)=>({state:item.state || 'ready',tone:item.state === 'building' ? 'warn' : 'good',copy:item.state === 'building' ? `${item.remainingTicks} ticks · ${item.robotId}` : `text ${item.textId}`}))}${ventureGroup('Agents',business.agents,(item)=>({state:item.state || 'idle',tone:item.state === 'working' ? 'warn' : 'good',copy:`harness ${item.harnessId}`}))}${ventureGroup('Jobs',business.jobs,(item)=>({state:item.status || 'queued',tone:item.status === 'completed' ? 'good' : 'warn',copy:`${round(item.completedFlops,1)} / ${round(item.requiredFlops,1)} inference FLOPS`}))}${ventureGroup('Invoices',business.invoices,(item)=>({state:item.status || 'issued',tone:item.status === 'paid' ? 'good' : 'warn',copy:`$${Number(item.amount || 0).toLocaleString()} · job ${item.jobId}`}))}</div></div>`;
    }

    function renderTabs() {
      const tabLabels = {actors:'actors',jobs:'venture',help:'help'};
      refs.tabs.innerHTML = ['actors','jobs','help'].map((tab) => `<button class="tab-button" type="button" role="tab" data-tab="${tab}" aria-selected="${ui.tab === tab}">${tabLabels[tab]}</button>`).join('');
      if (ui.tab === 'actors') {
        refs.tabPanel.innerHTML = `<div class="actor-list">${snapshot.actors.map((actor) => `<button class="actor-row" type="button" data-focus-actor="${escapeHtml(actor.id)}"><span class="state-chip ${['blocked','fault','throttled'].includes(actor.state)?'bad':['booting','charging','training'].includes(actor.state)?'warn':'good'}">${actor.kind.slice(0,3)}</span><span class="row-copy"><strong>${escapeHtml(actor.label)}</strong><span>${escapeHtml(actor.state)} · F${actor.floor+1} ${actor.x+1},${actor.y+1}</span></span><span class="state-chip">${escapeHtml(actor.state)}</span></button>`).join('')}</div>`;
      } else if (ui.tab === 'jobs') {
        refs.tabPanel.innerHTML = renderVenture();
      } else {
        refs.tabPanel.innerHTML = `<div class="context-help"><strong>Read the floor, then route it.</strong><br>Solid cells are owned. Dashed cells are purchasable frontier. Lines report real delivered Power, Cooling, and Data—blocked routes never animate as live.<div class="shortcut-line">Arrow keys · move grid focus<br>P / C / N · toggle overlays<br>1–9 · select floor</div></div>`;
      }
    }

    function renderQuest() {
      refs.quest.innerHTML = `<div class="quest-main"><span class="quest-index">${escapeHtml(snapshot.quest.index)}</span><span class="quest-copy"><strong>${escapeHtml(snapshot.quest.title)}</strong><span>${escapeHtml(snapshot.quest.body)}</span></span></div><span class="quest-action">${escapeHtml(snapshot.quest.action)} <kbd>${escapeHtml(snapshot.quest.hotkey)}</kbd></span>`;
    }

    function render(next) {
      if (next) snapshot = normalizeSnapshot(next);
      else snapshot = normalizeSnapshot(typeof game.snapshot === 'function' ? game.snapshot() : game.state);
      if (snapshot.ticks.completed > snapshot.ticks.raw) snapshot.ticks.completed = snapshot.ticks.raw;
      renderResources(); renderPalette(); renderToolbar(); renderGrid(); renderConnections(); renderInspector(); renderRouter(); renderTabs(); renderQuest();
      ui.lastTick = snapshot.ticks.completed;
    }

    function showTooltip(target, event) {
      const title = target?.dataset.tooltipTitle, copy = target?.dataset.tooltipCopy;
      if (!title && !copy) return;
      refs.tooltip.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span>`;
      refs.tooltip.hidden = false;
      moveTooltip(event || {clientX:target.getBoundingClientRect().right,clientY:target.getBoundingClientRect().top});
    }
    function moveTooltip(event) {
      if (refs.tooltip.hidden) return;
      const gap = 12, edge = 8, rect = refs.tooltip.getBoundingClientRect();
      let x = Number(event.clientX)||edge, y = Number(event.clientY)||edge;
      x = x + gap + rect.width > innerWidth - edge ? x - rect.width - gap : x + gap;
      y = y + gap + rect.height > innerHeight - edge ? y - rect.height - gap : y + gap;
      refs.tooltip.style.left = `${Math.max(edge,Math.min(x,innerWidth-rect.width-edge))}px`;
      refs.tooltip.style.top = `${Math.max(edge,Math.min(y,innerHeight-rect.height-edge))}px`;
    }

    async function send(action) {
      const command = typeof game.command === 'function' ? game.command : game.dispatch;
      if (typeof command !== 'function') return {ok:false,reason:'no-command'};
      const result = await command.call(game, action);
      render();
      return result || {ok:true};
    }

    function onClick(event) {
      const target = event.target.closest('button');
      if (!target || !root.contains(target)) return;
      if (target.dataset.layer) { ui.layer = target.dataset.layer; paletteSignature = ''; renderPalette(); return; }
      if (target.dataset.blueprint) {
        if (target.getAttribute('aria-disabled') === 'true') { setFeedback(`${target.querySelector('.blueprint-name')?.textContent || 'Blueprint'} is locked.`, 'warn', true); return; }
        ui.selectedBlueprint = target.dataset.blueprint;
        ui.feedback = {message:`${target.querySelector('.blueprint-name')?.textContent || 'Blueprint'} selected — click an owned tile to place it.`,tone:'ready'};
        paletteSignature = '';
        renderPalette();
        renderGrid();
        renderInspector();
        return;
      }
      if (target.dataset.overlay) { ui.overlays.has(target.dataset.overlay) ? ui.overlays.delete(target.dataset.overlay) : ui.overlays.add(target.dataset.overlay); renderToolbar(); renderGrid(); renderConnections(); return; }
      if (target.dataset.floor != null) { ui.floor = Number(target.dataset.floor); ui.selectedCell = null; render(); return; }
      if (target.dataset.placeSelected) {
        const blueprint = BLUEPRINT_BY_ID.get(target.dataset.placeSelected);
        send({type:'place',blueprintId:target.dataset.placeSelected,x:Number(target.dataset.placeX),y:Number(target.dataset.placeY)}).then((result) => { setFeedback(result.ok ? `${blueprint?.name || target.dataset.placeSelected} placed successfully.` : placementFailure(blueprint,result.reason), result.ok ? 'good' : 'bad', true); });
        return;
      }
      if (target.dataset.x != null) {
        ui.selectedCell = target.dataset.cellKey;
        const territory = target.dataset.territory;
        const x = Number(target.dataset.x), y = Number(target.dataset.y);
        const blueprint = BLUEPRINT_BY_ID.get(ui.selectedBlueprint);
        const blueprintUnlocked = snapshot.unlocks.some((item) => item.id === ui.selectedBlueprint);
        if (territory === 'owned' && blueprint && blueprintUnlocked) {
          send({type:'place',blueprintId:blueprint.id,x,y}).then((result) => {
            setFeedback(result.ok ? `${blueprint.name} placed at ${x + 1},${y + 1}.` : placementFailure(blueprint,result.reason), result.ok ? 'good' : 'bad', !result.ok);
          });
          return;
        }
        ui.feedback = {message:territory === 'frontier' ? 'Frontier selected. Purchase it below to expand.' : 'Locked cell. Select an adjacent frontier cell.',tone:territory === 'frontier' ? 'warn' : 'info'};
        renderGrid();
        renderInspector();
        refs.liveStatus.textContent = target.getAttribute('aria-label');
        revealInspectorAction();
        return;
      }
      if (target.dataset.purchaseFrontier) { send({type:'purchase-frontier',cellKey:target.dataset.purchaseFrontier}).then((result) => { setFeedback(result.ok ? 'Frontier cell purchased successfully.' : `Purchase blocked: ${result.reason}.`, result.ok ? 'good' : 'bad', true); }); return; }
      if (target.dataset.aiToggle) {
        const enabled = target.dataset.aiNextEnabled === 'true';
        const entityId = target.dataset.aiToggle;
        send({type:'set-ai-enabled',entityId,enabled}).then((result) => { setFeedback(result.ok ? `AI control ${enabled ? 'enabled' : 'disabled'} for ${entityId}.` : `AI control blocked: ${result.reason}.`, result.ok ? 'good' : 'bad'); });
        return;
      }
      if (target.dataset.aiRepair) {
        const entityId = target.dataset.aiRepair;
        send({type:'repair-ai-fault',entityId}).then((result) => { setFeedback(result.ok ? `AI fault repair started for ${entityId}.` : `AI repair blocked: ${result.reason}.`, result.ok ? 'good' : 'bad'); });
        return;
      }
      if (target.dataset.routePreset) {
        const preset = ROUTE_PRESETS.find((item) => item.id === target.dataset.routePreset);
        if (preset) send({type:'set-routes',routes:preset.routes}).then((result) => { refs.liveStatus.textContent = result.ok ? `${preset.label} FLOPS routing applied.` : `Routing blocked: ${result.reason}.`; });
        return;
      }
      if (target.dataset.businessAction) {
        const next = nextBusinessAction(snapshot);
        if (next.ready && next.command?.type === target.dataset.businessAction) {
          send(next.command).then((result) => { refs.liveStatus.textContent = result.ok ? `${next.label} started.` : `${next.label} blocked: ${result.reason}.`; });
        }
        return;
      }
      if (target.dataset.tab) { ui.tab = target.dataset.tab; renderTabs(); return; }
      if (target.dataset.focusActor) {
        const actor = snapshot.actors.find((item) => item.id === target.dataset.focusActor);
        if (actor) { ui.floor = actor.floor; ui.selectedCell = cellKey(actor.floor,actor.x,actor.y); render(); root.querySelector(`[data-cell-key="${CSS.escape(ui.selectedCell)}"]`)?.focus(); }
      }
    }

    function onKeyDown(event) {
      const cell = event.target.closest('.cell');
      if (cell && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        const x = clamp(Number(cell.dataset.x)+dx,0,WIDTH-1), y = clamp(Number(cell.dataset.y)+dy,0,HEIGHT-1);
        const next = refs.worldGrid.querySelector(`[data-x="${x}"][data-y="${y}"]`);
        if (next) { cell.tabIndex = -1; next.tabIndex = 0; next.focus(); }
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const key = event.key.toLowerCase();
        const overlay = {p:'power',c:'cooling',n:'network',a:'ai'}[key];
        if (overlay) { event.preventDefault(); ui.overlays.has(overlay) ? ui.overlays.delete(overlay) : ui.overlays.add(overlay); renderToolbar(); renderGrid(); renderConnections(); }
        if (/^[1-9]$/.test(key)) {
          const floor = Number(key)-1;
          if (snapshot.floors.some((item) => Number(item.id) === floor)) { event.preventDefault(); ui.floor=floor; ui.selectedCell=null; render(); }
        }
      }
    }

    const onPointerOver = (event) => { const target = event.target.closest('[data-tooltip-title]'); if (target) showTooltip(target,event); };
    const onPointerOut = (event) => { if (event.target.closest('[data-tooltip-title]')) refs.tooltip.hidden = true; };
    const onFocusIn = (event) => { const target = event.target.closest('[data-tooltip-title]'); if (target) showTooltip(target); };
    const onFocusOut = () => { refs.tooltip.hidden = true; };
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('pointerover', onPointerOver);
    root.addEventListener('pointermove', moveTooltip);
    root.addEventListener('pointerout', onPointerOut);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);

    if (typeof game.subscribe === 'function') unsubscribe = game.subscribe(() => render());
    render(snapshot);
    return {
      render,
      snapshot: () => snapshot,
      destroy() {
        if (typeof unsubscribe === 'function') unsubscribe();
        root.removeEventListener('click', onClick);
        root.removeEventListener('keydown', onKeyDown);
        root.removeEventListener('pointerover', onPointerOver);
        root.removeEventListener('pointermove', moveTooltip);
        root.removeEventListener('pointerout', onPointerOut);
        root.removeEventListener('focusin', onFocusIn);
        root.removeEventListener('focusout', onFocusOut);
        root.innerHTML = '';
      },
    };
  }

  function acceptanceAdapter(acceptance) {
    return {
      snapshot: () => acceptance.snapshot(),
      command: (action) => acceptance.command(action),
      subscribe: typeof acceptance.subscribe === 'function' ? (listener) => acceptance.subscribe(listener) : undefined,
    };
  }

  function autoMount() {
    const root = document.getElementById('overhaul-root');
    if (!root || global.__overhaulView) return;
    const productionMain = document.querySelector('script[type="module"][src$="src/overhaul/main.js"]');
    if (productionMain) return;
    let game = global.__overhaulGame || global.overhaulGame;
    if (!game && global.__overhaulAcceptance?.snapshot && global.__overhaulAcceptance?.command) game = acceptanceAdapter(global.__overhaulAcceptance);
    let ownsMock = false;
    if (!game) {
      game = createMockGame();
      ownsMock = true;
      if (!global.__overhaulAcceptance) {
        global.__overhaulAcceptance = {
          ready: true,
          reset: (options) => game.reset(options),
          snapshot: () => game.snapshot(),
          command: (action) => game.dispatch(action),
          runScenario: (name) => game.runScenario(name),
        };
      }
    }
    global.__overhaulView = createOverhaulView(game, {root});
    if (ownsMock) global.__overhaulMockGame = game;
  }

  global.createOverhaulView = createOverhaulView;
  global.createOverhaulMockGame = createMockGame;
  if (typeof module !== 'undefined' && module.exports) module.exports = {createOverhaulView,createOverhaulMockGame:createMockGame};
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount, {once:true}); else autoMount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
