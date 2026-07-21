import {
  OVERHAUL_BALANCE,
  OVERHAUL_BLUEPRINTS,
  OVERHAUL_SCHEMA_VERSION,
  OVERHAUL_SCENARIO_LAYOUT,
  OVERHAUL_STARTER_KITS,
  blueprintById,
} from './catalog.js';

const LAYERS = ['facility', 'power', 'cooling', 'data', 'ai'];
const ROUTE_KEYS = ['sell', 'research', 'train', 'inference'];
const EPSILON = OVERHAUL_BALANCE.routes.epsilon;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalSeed(seed) {
  if (seed === undefined || seed === null || seed === '') return '1';
  return String(seed);
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x6d2b79f5;
}

function nextRandom(rng) {
  rng.value = (rng.value + 0x6d2b79f5) >>> 0;
  let value = rng.value;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function emptyLedger() {
  return {
    raw: 0,
    sell: 0,
    training: 0,
    jobs: 0,
    reserved: 0,
    idle: 0,
    loss: 0,
  };
}

function emptyNetworks() {
  return {
    power: { paths: [] },
    cooling: { paths: [] },
    data: { paths: [] },
    ai: { paths: [] },
  };
}

function defaultUtilityState() {
  return {
    segments: 0,
    requiredFlopsPerTick: 0,
    paidFlopsThisTick: 0,
    unpaidFlopsThisTick: 0,
    totalPaidFlops: 0,
    byLayer: Object.fromEntries(LAYERS.filter((layer) => layer !== 'facility')
      .map((layer) => [layer, { segments: 0, maintenanceFlopsPerTick: 0 }])),
  };
}

function defaultAiState() {
  const balance = OVERHAUL_BALANCE.ai;
  return {
    modelId: 'ai-model-1',
    state: 'offline',
    level: 0,
    xp: 0,
    nextLevelXp: balance.baseLevelXp,
    bonusPercent: balance.baseBonusPercent,
    efficiencyMultiplier: 1 + balance.baseBonusPercent / 100,
    mistakeChance: balance.baseMistakeChance,
    faultCheckIntervalTicks: balance.faultCheckIntervalTicks,
    enabledCount: 0,
    connectedCount: 0,
    activeFaults: [],
    totalFaults: 0,
    lastFaultTick: null,
  };
}

function defaultResearchState() {
  return {
    completedIds: [],
    lastUnlock: null,
  };
}

function defaultStoryState() {
  return {
    currentId: OVERHAUL_BALANCE.story.turns[0].id,
    completedIds: [],
    turnStartedTick: 0,
    lastBeat: null,
  };
}

function defaultOpeningState() {
  return { checkpointTicks: {} };
}

function computerRuntime(blueprint) {
  return {
    state: 'off',
    bootRemaining: blueprint.stats.bootTicks,
    powerDelivered: 0,
    coolingDelivered: 0,
    dataConnected: false,
    rawFlops: 0,
    workload: 'idle',
    utilization: 0,
    temperatureC: OVERHAUL_BALANCE.thermal.ambientC,
    throttle: 1,
    fault: null,
  };
}

function computeUpgradeMultiplier(structure) {
  const level = Math.max(0, Number(structure?.computeUpgradeLevel) || 0);
  return 1 + level * OVERHAUL_BALANCE.recovery.computeUpgradeBonusPercent / 100;
}

function isAiEligibleBlueprint(blueprint) {
  const stats = blueprint?.stats || {};
  return (stats.powerGeneration || 0) > 0
    || (stats.coolingGeneration || 0) > 0
    || (blueprint?.layer !== 'ai' && (stats.capacity || 0) > 0)
    || (stats.bandwidth || 0) > 0
    || (stats.rawFlops || 0) > 0;
}

function cellKey(floor, x, y) {
  return `${floor}:${x},${y}`;
}

function parseCellKey(key) {
  if (typeof key !== 'string') return null;
  const uiMatch = /^f(\d+):(\d+),(\d+)$/.exec(key);
  if (uiMatch) {
    return {
      floor: Number(uiMatch[1]) === 0 ? OVERHAUL_BALANCE.floor.id : `F${Number(uiMatch[1]) + 1}`,
      x: Number(uiMatch[2]),
      y: Number(uiMatch[3]),
    };
  }
  const match = /^([^:]+):(\d+),(\d+)$/.exec(key);
  if (!match) return null;
  return { floor: match[1], x: Number(match[2]), y: Number(match[3]) };
}

function neighbors(x, y, width, height) {
  return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
    .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < width && ny < height);
}

function createFloor() {
  const config = OVERHAUL_BALANCE.floor;
  const cells = Array.from({ length: config.height }, (_, y) =>
    Array.from({ length: config.width }, (_, x) => ({
      key: cellKey(config.id, x, y),
      floor: config.id,
      x,
      y,
      owned: x >= config.initialOwned.minX && x <= config.initialOwned.maxX
        && y >= config.initialOwned.minY && y <= config.initialOwned.maxY,
      frontier: false,
      claimCost: null,
      layers: { facility: null, power: null, cooling: null, data: null, ai: null },
    })),
  );
  return {
    id: config.id,
    number: config.number,
    width: config.width,
    height: config.height,
    cells,
  };
}

function allCells(state) {
  return state.floor.cells.flat();
}

function getCell(state, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (y < 0 || y >= state.floor.height || x < 0 || x >= state.floor.width) return null;
  return state.floor.cells[y][x];
}

function claimCost(state, cell) {
  const balance = OVERHAUL_BALANCE.claims;
  const centerX = (state.floor.width - 1) / 2;
  const centerY = (state.floor.height - 1) / 2;
  const distance = Math.abs(cell.x - centerX) + Math.abs(cell.y - centerY);
  const initial = (OVERHAUL_BALANCE.floor.initialOwned.maxX
      - OVERHAUL_BALANCE.floor.initialOwned.minX + 1)
    * (OVERHAUL_BALANCE.floor.initialOwned.maxY
      - OVERHAUL_BALANCE.floor.initialOwned.minY + 1);
  const extraOwned = Math.max(0, allCells(state).filter((item) => item.owned).length - initial);
  return Math.round(balance.baseCost + distance * balance.distanceCost
    + extraOwned * balance.ownedCellCost);
}

function recomputeFrontier(state) {
  for (const cell of allCells(state)) {
    cell.frontier = false;
    cell.claimCost = null;
  }
  for (const cell of allCells(state)) {
    if (cell.owned) continue;
    const adjacentOwned = neighbors(cell.x, cell.y, state.floor.width, state.floor.height)
      .some(([x, y]) => getCell(state, x, y).owned);
    if (!adjacentOwned) continue;
    cell.frontier = true;
    cell.claimCost = claimCost(state, cell);
  }
}

function seedInheritedDatacenter(state, rng, kit) {
  const layout = OVERHAUL_SCENARIO_LAYOUT;
  const inheritedIds = [];
  const place = (blueprintId, x, y) => {
    const blueprint = blueprintById(blueprintId);
    const entityId = `${blueprint.kind}-${state.nextEntityId}`;
    state.nextEntityId += 1;
    const structure = {
      entityId,
      blueprintId,
      condition: 100,
      inherited: true,
      aiEnabled: false,
      aiConnected: false,
      aiFault: null,
    };
    if (blueprint.kind === 'computer') structure.runtime = computerRuntime(blueprint);
    getCell(state, x, y).layers[blueprint.layer] = structure;
    inheritedIds.push(entityId);
    return structure;
  };

  const generator = place('generator', layout.generator.x, layout.generator.y);
  const coolingPump = place('cooling_pump', layout.coolingPump.x, layout.coolingPump.y);
  place(kit.computerBlueprintId, layout.computer.x, layout.computer.y);
  for (const [x, y] of layout.power) {
    place(x === layout.generator.x && y === layout.generator.y
      ? 'power_pole' : 'power_line', x, y);
  }
  for (const [x, y] of layout.cooling) place('cooling_pipe', x, y);
  let dataSwitch = null;
  for (const [x, y] of layout.data) {
    const structure = place(
      x === layout.dataSwitch.x && y === layout.dataSwitch.y ? 'data_switch' : 'data_cable',
      x,
      y,
    );
    if (structure.blueprintId === 'data_switch') dataSwitch = structure;
  }
  const critical = [generator, coolingPump, dataSwitch];

  const variantIndex = Math.floor(nextRandom(rng) * critical.length);
  const repairTargets = [
    critical[variantIndex],
    critical[(variantIndex + 1) % critical.length],
  ];
  for (const structure of repairTargets) structure.condition = 0;
  const siteNames = OVERHAUL_BALANCE.recovery.siteNames;
  const siteName = siteNames[Math.floor(nextRandom(rng) * siteNames.length)];
  state.recovery = {
    siteName,
    variantId: `wreck-${variantIndex + 1}`,
    phase: 'triage',
    inheritedIds,
    repairTargetIds: repairTargets.map((item) => item.entityId),
    completedRepairIds: [],
    activeRepair: null,
    completionBonusPaid: false,
  };
}

function initialState(seed) {
  const canonical = canonicalSeed(seed);
  const rng = { value: hashSeed(canonical) };
  const kitIndex = Math.floor(nextRandom(rng) * OVERHAUL_STARTER_KITS.length);
  const kit = OVERHAUL_STARTER_KITS[kitIndex];
  const state = {
    schemaVersion: OVERHAUL_SCHEMA_VERSION,
    seed: canonical,
    rngState: rng.value,
    starterKitId: kit.id,
    computerBlueprintId: kit.computerBlueprintId,
    unlockIds: [...kit.unlocks],
    floor: createFloor(),
    routes: { ...OVERHAUL_BALANCE.routes.default },
    flops: emptyLedger(),
    sell: {
      requested: false,
      requestedFlops: 0,
      blocked: false,
      reason: null,
      fiberFloor: null,
      routedFlops: 0,
      incomePerTick: 0,
    },
    economy: {
      cash: OVERHAUL_BALANCE.economy.startingCash,
      invoicesPaid: 0,
      humansHired: 0,
      payroll: 0,
    },
    progress: { research: 0, training: 0, inference: 0, rawFlopsSold: 0 },
    business: {
      trainingSpent: 0,
      textModels: [],
      harnesses: [],
      agents: [],
      jobs: [],
      invoices: [],
      pendingHarness: null,
      events: [],
    },
    actors: [
      {
        id: 'human-1', kind: 'human', state: 'idle', role: 'founder',
        label: 'AYA', floor: 0, floorKey: 'F1', x: 4, y: 7, assignment: null,
      },
      {
        id: 'robot-2', kind: 'robot', state: 'idle', assignment: null,
        label: 'MICA-2', floor: 0, floorKey: 'F1', x: 5, y: 7,
      },
    ],
    construction: { jobs: [], completed: 0 },
    networks: emptyNetworks(),
    utilities: defaultUtilityState(),
    ai: defaultAiState(),
    recovery: null,
    research: defaultResearchState(),
    story: defaultStoryState(),
    opening: defaultOpeningState(),
    tick: 0,
    completedTick: 0,
    nextEntityId: 3,
    eventSequence: 0,
  };
  seedInheritedDatacenter(state, rng, kit);
  state.rngState = rng.value;
  recomputeFrontier(state);
  return state;
}

function restoreState(snapshot) {
  const source = snapshot?.persistence || snapshot?.state || snapshot;
  if (!source || source.schemaVersion !== OVERHAUL_SCHEMA_VERSION) {
    throw new Error(`Unsupported overhaul snapshot schema: ${source?.schemaVersion ?? 'missing'}`);
  }
  const restored = clone(source);
  if (restored.floor?.width !== OVERHAUL_BALANCE.floor.width
      || restored.floor?.height !== OVERHAUL_BALANCE.floor.height) {
    throw new Error('Overhaul snapshot has incompatible floor geometry');
  }
  restored.networks = { ...emptyNetworks(), ...(restored.networks || {}) };
  restored.utilities = { ...defaultUtilityState(), ...(restored.utilities || {}) };
  restored.utilities.byLayer = {
    ...defaultUtilityState().byLayer,
    ...(restored.utilities.byLayer || {}),
  };
  restored.ai = { ...defaultAiState(), ...(restored.ai || {}) };
  restored.ai.activeFaults = Array.isArray(restored.ai.activeFaults)
    ? restored.ai.activeFaults : [];
  restored.research = { ...defaultResearchState(), ...(restored.research || {}) };
  restored.research.completedIds = Array.isArray(restored.research.completedIds)
    ? restored.research.completedIds : [];
  restored.story = { ...defaultStoryState(), ...(restored.story || {}) };
  restored.story.completedIds = Array.isArray(restored.story.completedIds)
    ? restored.story.completedIds : [];
  restored.opening = { ...defaultOpeningState(), ...(restored.opening || {}) };
  restored.opening.checkpointTicks = {
    ...defaultOpeningState().checkpointTicks,
    ...(restored.opening.checkpointTicks || {}),
  };
  restored.construction = {
    jobs: [],
    completed: 0,
    ...(restored.construction || {}),
  };
  restored.construction.jobs = Array.isArray(restored.construction.jobs)
    ? restored.construction.jobs : [];
  restored.recovery = restored.recovery || {
    siteName: 'Imported Datacenter',
    variantId: 'legacy-import',
    phase: 'online',
    inheritedIds: [],
    repairTargetIds: [],
    completedRepairIds: [],
    activeRepair: null,
    completionBonusPaid: true,
  };
  for (const cell of restored.floor.cells.flat()) {
    cell.layers = { facility: null, power: null, cooling: null, data: null, ai: null,
      ...(cell.layers || {}) };
    for (const layer of LAYERS) {
      const structure = cell.layers[layer];
      if (!structure) continue;
      const blueprint = blueprintById(structure.blueprintId);
      if (!isAiEligibleBlueprint(blueprint)) continue;
      if (typeof structure.aiEnabled !== 'boolean') structure.aiEnabled = false;
      if (structure.aiConnected === undefined) structure.aiConnected = false;
      if (structure.aiFault === undefined) structure.aiFault = null;
    }
  }
  return restored;
}

function structureEntries(state) {
  const entries = [];
  for (const cell of allCells(state)) {
    for (const layer of LAYERS) {
      const structure = cell.layers[layer];
      if (!structure) continue;
      const blueprint = blueprintById(structure.blueprintId);
      entries.push({ cell, layer, structure, blueprint });
    }
  }
  return entries;
}

function computerEntries(state) {
  return structureEntries(state)
    .filter((entry) => entry.blueprint?.kind === 'computer')
    .sort((a, b) => a.structure.entityId.localeCompare(b.structure.entityId));
}

function utilityBurden(state) {
  const byLayer = Object.fromEntries(LAYERS.filter((layer) => layer !== 'facility')
    .map((layer) => [layer, { segments: 0, maintenanceFlopsPerTick: 0 }]));
  for (const entry of structureEntries(state)) {
    const maintenance = entry.blueprint?.stats?.maintenanceFlopsPerTick || 0;
    if (!maintenance || entry.layer === 'facility' || entry.structure.condition <= 0) continue;
    byLayer[entry.layer].segments += 1;
    byLayer[entry.layer].maintenanceFlopsPerTick += maintenance;
  }
  return {
    segments: Object.values(byLayer).reduce((sum, item) => sum + item.segments, 0),
    requiredFlopsPerTick: Object.values(byLayer)
      .reduce((sum, item) => sum + item.maintenanceFlopsPerTick, 0),
    byLayer,
  };
}

function updateUtilityBurden(state, paidFlops = 0) {
  const burden = utilityBurden(state);
  const paid = Math.min(Math.max(0, paidFlops), burden.requiredFlopsPerTick);
  state.utilities = {
    ...state.utilities,
    ...burden,
    paidFlopsThisTick: paid,
    unpaidFlopsThisTick: Math.max(0, burden.requiredFlopsPerTick - paid),
    totalPaidFlops: (state.utilities?.totalPaidFlops || 0) + paid,
  };
}

function createComponents(state, layer) {
  const occupied = new Set(
    allCells(state).filter((cell) => cell.layers[layer]?.condition > 0)
      .map((cell) => cell.key),
  );
  const byCell = new Map();
  const components = [];
  for (const cell of allCells(state)) {
    if (!occupied.has(cell.key) || byCell.has(cell.key)) continue;
    const component = {
      id: `${layer}-${components.length + 1}`,
      cells: [],
      capacity: Infinity,
    };
    const queue = [cell];
    byCell.set(cell.key, component.id);
    while (queue.length) {
      const current = queue.shift();
      component.cells.push(current.key);
      const structure = current.layers[layer];
      const blueprint = blueprintById(structure.blueprintId);
      component.capacity = Math.min(component.capacity, blueprint?.stats?.capacity ?? Infinity);
      for (const [nx, ny] of neighbors(
        current.x, current.y, state.floor.width, state.floor.height,
      )) {
        const adjacent = getCell(state, nx, ny);
        if (!occupied.has(adjacent.key) || byCell.has(adjacent.key)) continue;
        byCell.set(adjacent.key, component.id);
        queue.push(adjacent);
      }
    }
    if (!Number.isFinite(component.capacity)) component.capacity = 0;
    components.push(component);
  }
  return { byCell, components, componentById: new Map(components.map((c) => [c.id, c])) };
}

function shortestLayerPath(state, layer, startKey, endKey, excluded = new Set()) {
  if (!startKey || !endKey || excluded.has(startKey) || excluded.has(endKey)) return [];
  const start = parseCellKey(startKey);
  const end = parseCellKey(endKey);
  if (!start || !end) return [];
  const healthy = (key) => {
    if (excluded.has(key)) return false;
    const point = parseCellKey(key);
    return Boolean(point && getCell(state, point.x, point.y)?.layers[layer]?.condition > 0);
  };
  if (!healthy(startKey) || !healthy(endKey)) return [];
  const pending = [startKey];
  const previous = new Map([[startKey, null]]);
  while (pending.length) {
    const key = pending.shift();
    if (key === endKey) break;
    const point = parseCellKey(key);
    const adjacent = neighbors(point.x, point.y, state.floor.width, state.floor.height)
      .map(([x, y]) => cellKey(state.floor.id, x, y))
      .filter((candidate) => healthy(candidate) && !previous.has(candidate))
      .sort();
    for (const candidate of adjacent) {
      previous.set(candidate, key);
      pending.push(candidate);
    }
  }
  if (!previous.has(endKey)) return [];
  const path = [];
  for (let key = endKey; key !== null; key = previous.get(key)) path.push(key);
  return path.reverse();
}

function pointFromKey(key) {
  const point = parseCellKey(key);
  return point ? { floor: 0, x: point.x, y: point.y } : null;
}

function linkCapacityAt(state, layer, key) {
  const point = parseCellKey(key);
  const structure = point ? getCell(state, point.x, point.y)?.layers[layer] : null;
  const blueprint = blueprintById(structure?.blueprintId);
  if (!structure || structure.condition <= 0) return 0;
  const entry = { structure, blueprint, layer };
  return (blueprint?.stats?.capacity || 0) * aiMultiplierFor(state, entry);
}

function routeReliability(state, layer, keys) {
  if (!keys.length) return 0;
  return keys.reduce((result, key) => {
    const point = parseCellKey(key);
    const structure = point ? getCell(state, point.x, point.y)?.layers[layer] : null;
    const blueprint = blueprintById(structure?.blueprintId);
    return result * (blueprint?.stats?.reliability ?? 1);
  }, 1);
}

function routeRedundancy(state, layer, keys) {
  if (keys.length < 3) {
    return { singleLinkFaultTolerant: false, alternatePathCount: 0,
      reliabilityPercent: routeReliability(state, layer, keys) * 100 };
  }
  const start = keys[0];
  const end = keys.at(-1);
  const alternatives = keys.slice(1, -1).map((key) =>
    shortestLayerPath(state, layer, start, end, new Set([key])));
  const faultTolerant = alternatives.length > 0 && alternatives.every((path) => path.length > 0);
  const primaryReliability = routeReliability(state, layer, keys);
  const alternate = alternatives.find((path) => path.length > 0) || [];
  const alternateReliability = routeReliability(state, layer, alternate);
  const resilientReliability = faultTolerant
    ? 1 - (1 - primaryReliability) * (1 - alternateReliability) : primaryReliability;
  return {
    singleLinkFaultTolerant: faultTolerant,
    alternatePathCount: faultTolerant ? 1 : 0,
    reliabilityPercent: resilientReliability * 100,
  };
}

function firstEntry(entries) {
  return [...entries].sort(
    (a, b) => a.structure.entityId.localeCompare(b.structure.entityId),
  )[0] || null;
}

function pathPoint(entry) {
  return entry ? { floor: 0, x: entry.cell.x, y: entry.cell.y } : null;
}

function aiMultiplierFor(state, entry) {
  return entry?.structure.aiConnected === true
    && !entry.structure.aiFault
    && entry.structure.condition > 0
    ? state.ai.efficiencyMultiplier : 1;
}

function networkStatusText(status) {
  return {
    active: 'Active — capacity is available and resources are flowing.',
    idle: 'Idle — connected with capacity available, but nothing is flowing.',
    saturated: 'Saturated — the limiting hop has no remaining headroom.',
    starved: 'Starved — connected, but upstream capacity is exhausted.',
    blocked: 'Disconnected — no healthy route reaches a source.',
    broken: 'Broken — a failed link interrupts this route.',
    fault: 'Broken — an AI mistake has stopped this endpoint.',
    disabled: 'Disabled — AI assistance is opted out for this endpoint.',
  }[status] || 'Disconnected — this route is unavailable.';
}

function pathWithTelemetry(state, layer, path, keys, options = {}) {
  const connected = path.connected === true && keys.length > 0;
  const nominalCapacity = Math.max(0, Number(path.capacity) || 0);
  const delivered = Math.max(0, Number(path.delivered) || 0);
  const sharedHeadroom = Math.max(0, Math.min(
    nominalCapacity,
    Number(options.sharedHeadroom ?? nominalCapacity - delivered) || 0,
  ));
  const sharedUsed = Math.max(0, nominalCapacity - sharedHeadroom);
  let status = path.status || (connected ? 'idle' : 'blocked');
  if (!connected && status !== 'fault' && status !== 'disabled') status = 'blocked';
  if (connected && !['fault', 'disabled'].includes(status)) {
    if (sharedHeadroom <= EPSILON && sharedUsed > EPSILON) status = 'saturated';
    else if (delivered > EPSILON) status = 'active';
    else if (sharedHeadroom > EPSILON) status = 'idle';
    else status = 'starved';
  }
  const linkCandidates = keys.map((key) => {
    const point = parseCellKey(key);
    const structure = point ? getCell(state, point.x, point.y)?.layers[layer] : null;
    return {
      kind: 'link',
      entityId: structure?.entityId || null,
      cell: pointFromKey(key),
      capacity: linkCapacityAt(state, layer, key),
      reason: 'link-capacity',
    };
  });
  const sourceCapacity = Number(options.sourceCapacity);
  const candidates = Number.isFinite(sourceCapacity)
    ? [{
      kind: 'source',
      entityId: path.source || null,
      cell: path.from || null,
      capacity: Math.max(0, sourceCapacity),
      reason: 'source-capacity',
    }, ...linkCandidates]
    : linkCandidates;
  const limitingCapacity = candidates.length
    ? Math.min(...candidates.map((item) => item.capacity)) : 0;
  const bottleneck = candidates.find((item) =>
    Math.abs(item.capacity - limitingCapacity) <= EPSILON) || null;
  const firstBottleneck = bottleneck ? {
    ...bottleneck,
    delivered: Math.min(bottleneck.capacity, sharedUsed),
    headroom: Math.max(0, Math.min(bottleneck.capacity, sharedHeadroom)),
  } : {
    kind: 'topology',
    entityId: null,
    cell: path.to || null,
    capacity: 0,
    delivered: 0,
    headroom: 0,
    reason: status === 'fault' ? 'broken' : 'disconnected',
  };
  const utilization = nominalCapacity > EPSILON
    ? Math.min(1, sharedUsed / nominalCapacity) : 0;
  return {
    ...path,
    connected,
    cells: (keys.length === 1 && path.source && path.target ? [keys[0], keys[0]] : keys)
      .map(pointFromKey),
    headroom: sharedHeadroom,
    utilization,
    utilizationPercent: utilization * 100,
    status,
    statusText: networkStatusText(status),
    firstBottleneck,
    redundancy: routeRedundancy(state, layer, keys),
  };
}

function makeNetworkTelemetry(paths, options = {}) {
  const capacity = Math.max(0, Number(options.capacity) || 0);
  const delivered = Math.max(0, Number(options.delivered
    ?? paths.reduce((sum, path) => sum + (Number(path.delivered) || 0), 0)) || 0);
  const headroom = Math.max(0, capacity - delivered);
  const utilization = capacity > EPSILON ? Math.min(1, delivered / capacity) : 0;
  const firstBottleneck = paths.find((path) =>
    ['fault', 'broken', 'starved', 'saturated'].includes(path.status))?.firstBottleneck
    || paths.find((path) => path.connected && path.firstBottleneck)?.firstBottleneck
    || paths.find((path) => path.firstBottleneck)?.firstBottleneck || null;
  const status = paths.some((path) => ['fault', 'broken'].includes(path.status)) ? 'broken'
    : headroom <= EPSILON && delivered > EPSILON ? 'saturated'
      : delivered > EPSILON ? 'active'
        : paths.some((path) => path.connected) && capacity > EPSILON ? 'idle' : 'blocked';
  return {
    capacity,
    delivered,
    headroom,
    utilization,
    utilizationPercent: utilization * 100,
    status,
    statusText: networkStatusText(status),
    segments: Math.max(0, Number(options.segments) || 0),
    maintenancePerTick: Math.max(0, Number(options.maintenancePerTick) || 0),
    firstBottleneck,
  };
}

function computeNetworks(state) {
  const entries = structureEntries(state);
  const computers = computerEntries(state);
  const power = createComponents(state, 'power');
  const cooling = createComponents(state, 'cooling');
  const data = createComponents(state, 'data');
  const ai = createComponents(state, 'ai');

  function componentCapacity(component, layer, useAi = true) {
    if (!component) return 0;
    const capacities = component.cells.map((key) => {
      const point = parseCellKey(key);
      const structure = getCell(state, point.x, point.y)?.layers[layer];
      const blueprint = blueprintById(structure?.blueprintId);
      if (!structure || structure.condition <= 0) return 0;
      const entry = { structure, blueprint, layer };
      return (blueprint?.stats?.capacity || 0) * (useAi ? aiMultiplierFor(state, entry) : 1);
    });
    // A connected utility component is modeled as a shared bus. Branch links
    // establish reach while a trunk/hub raises that bus's transport ceiling;
    // treating the weakest branch as the entire component's rating made every
    // researched trunk a no-op (the inherited power grid could never exceed
    // 16 MW). Endpoint delivery and source supply still cap usable throughput.
    return capacities.length ? Math.max(...capacities) : 0;
  }

  const consumers = entries
    .filter((entry) => (entry.blueprint?.stats?.powerDemand || 0) > 0)
    .sort((a, b) => {
      const priority = (a.blueprint.stats.powerPriority ?? 10)
        - (b.blueprint.stats.powerPriority ?? 10);
      return priority || a.structure.entityId.localeCompare(b.structure.entityId);
    });

  function dispatchPower(useAi) {
    const supply = new Map();
    const initialSupply = new Map();
    const sourcesByComponent = new Map();
    for (const entry of entries.filter(
      (item) => item.blueprint?.stats?.powerGeneration > 0 && item.structure.condition > 0,
    )) {
      const componentId = power.byCell.get(entry.cell.key);
      if (!componentId) continue;
      const multiplier = useAi ? aiMultiplierFor(state, entry) : 1;
      const generated = entry.blueprint.stats.powerGeneration * multiplier;
      supply.set(componentId, (supply.get(componentId) || 0) + generated);
      initialSupply.set(componentId, (initialSupply.get(componentId) || 0) + generated);
      if (!sourcesByComponent.has(componentId)) sourcesByComponent.set(componentId, []);
      sourcesByComponent.get(componentId).push(entry);
    }
    const transportCapacity = new Map(power.components.map((component) => [
      component.id,
      componentCapacity(component, 'power', useAi),
    ]));
    const transportRemaining = new Map(transportCapacity);
    const delivered = new Map();
    const routeKeys = new Map();
    for (const entry of consumers) {
      const componentId = power.byCell.get(entry.cell.key);
      const sources = sourcesByComponent.get(componentId) || [];
      const source = firstEntry(sources);
      const keys = source
        ? shortestLayerPath(state, 'power', source.cell.key, entry.cell.key) : [];
      routeKeys.set(entry.structure.entityId, keys);
      const need = entry.blueprint.stats.powerDemand;
      const available = componentId ? supply.get(componentId) || 0 : 0;
      const transport = componentId ? transportRemaining.get(componentId) || 0 : 0;
      const amount = keys.length && Math.min(available, transport) + EPSILON >= need ? need : 0;
      delivered.set(entry.structure.entityId, amount);
      if (componentId && amount > 0) {
        supply.set(componentId, available - amount);
        transportRemaining.set(componentId, transport - amount);
      }
    }
    return {
      delivered,
      sourcesByComponent,
      initialSupply,
      supplyRemaining: supply,
      transportCapacity,
      transportRemaining,
      routeKeys,
    };
  }

  // Controllers must be viable on base infrastructure. AI can improve a healthy
  // system, but it cannot bootstrap itself from an otherwise unpowered state.
  const basePower = dispatchPower(false);

  const controllersByComponent = new Map();
  for (const entry of entries.filter((item) => item.blueprint?.id === 'ai_controller')) {
    const componentId = ai.byCell.get(entry.cell.key);
    const powered = (basePower.delivered.get(entry.structure.entityId) || 0)
      + EPSILON >= (entry.blueprint.stats.powerDemand || 0);
    if (!componentId || !powered || entry.structure.condition <= 0) continue;
    if (!controllersByComponent.has(componentId)) controllersByComponent.set(componentId, []);
    controllersByComponent.get(componentId).push(entry);
  }

  const aiConnected = new Map();
  let aiPaths = [];
  const aiTransportCapacity = new Map(ai.components.map((component) => [
    component.id,
    componentCapacity(component, 'ai'),
  ]));
  const aiTransportRemaining = new Map(aiTransportCapacity);
  const aiSourceCapacity = new Map();
  for (const [componentId, controllers] of controllersByComponent) {
    aiSourceCapacity.set(componentId, controllers.reduce(
      (sum, controller) => sum + (controller.blueprint.stats.aiCapacity || 0), 0,
    ));
  }
  const aiSourceRemaining = new Map(aiSourceCapacity);
  const eligible = entries.filter((entry) => isAiEligibleBlueprint(entry.blueprint))
    .sort((a, b) => a.structure.entityId.localeCompare(b.structure.entityId));
  for (const entry of eligible) {
    const componentId = ai.byCell.get(entry.cell.key);
    const component = ai.componentById.get(componentId);
    const sources = controllersByComponent.get(componentId) || [];
    const source = firstEntry(sources);
    const enabled = entry.structure.aiEnabled === true;
    const keys = source
      ? shortestLayerPath(state, 'ai', source.cell.key, entry.cell.key) : [];
    const capacity = componentId ? Math.min(
      aiTransportCapacity.get(componentId) || 0,
      aiSourceCapacity.get(componentId) || 0,
    ) : 0;
    const physicalConnected = sources.length > 0 && keys.length > 0 && capacity > 0;
    const faulted = Boolean(entry.structure.aiFault);
    const available = componentId ? Math.min(
      aiTransportRemaining.get(componentId) || 0,
      aiSourceRemaining.get(componentId) || 0,
    ) : 0;
    const delivered = enabled && physicalConnected && !faulted && available + EPSILON >= 1 ? 1 : 0;
    if (delivered > 0) {
      aiTransportRemaining.set(componentId, (aiTransportRemaining.get(componentId) || 0) - delivered);
      aiSourceRemaining.set(componentId, (aiSourceRemaining.get(componentId) || 0) - delivered);
    }
    const assisted = delivered > 0;
    entry.structure.aiConnected = assisted;
    aiConnected.set(entry.structure.entityId, assisted);
    aiPaths.push({
      id: `ai:${source?.structure.entityId || 'none'}:${entry.structure.entityId}`,
      source: source?.structure.entityId || null,
      target: entry.structure.entityId,
      from: pathPoint(source),
      to: pathPoint(entry),
      componentId: componentId || null,
      connected: physicalConnected,
      enabled,
      capacity,
      delivered,
      status: faulted ? 'fault'
        : !enabled ? 'disabled'
          : assisted ? 'active' : physicalConnected ? 'starved' : 'blocked',
      _keys: keys,
    });
  }
  aiPaths = aiPaths.map((path) => {
    const keys = path._keys;
    const result = pathWithTelemetry(state, 'ai', path, keys, {
      sharedHeadroom: Math.min(
        aiTransportRemaining.get(path.componentId) || 0,
        aiSourceRemaining.get(path.componentId) || 0,
      ),
      sourceCapacity: aiSourceCapacity.get(path.componentId) || 0,
    });
    delete result._keys;
    return result;
  });
  state.ai.enabledCount = eligible.filter((entry) => entry.structure.aiEnabled).length;
  state.ai.connectedCount = [...aiConnected.values()].filter(Boolean).length;
  state.ai.state = state.ai.activeFaults.length > 0 ? 'fault'
    : controllersByComponent.size === 0 ? 'offline'
      : state.ai.connectedCount > 0 ? 'online' : 'idle';

  const finalPower = dispatchPower(true);
  const powerDelivered = finalPower.delivered;
  const powerPaths = consumers.map((entry) => {
    const componentId = power.byCell.get(entry.cell.key);
    const component = power.componentById.get(componentId);
    const sources = finalPower.sourcesByComponent.get(componentId) || [];
    const source = firstEntry(sources);
    const keys = finalPower.routeKeys.get(entry.structure.entityId) || [];
    const sourceCapacity = finalPower.initialSupply.get(componentId) || 0;
    const capacity = Math.min(
      finalPower.transportCapacity.get(componentId) || 0,
      sourceCapacity,
    );
    return pathWithTelemetry(state, 'power', {
      id: `power:${source?.structure.entityId || 'none'}:${entry.structure.entityId}`,
      floor: 0,
      source: source?.structure.entityId || null,
      target: entry.structure.entityId,
      from: pathPoint(source),
      to: pathPoint(entry),
      componentId: componentId || null,
      connected: sources.length > 0 && keys.length > 0 && capacity > 0,
      capacity,
      delivered: powerDelivered.get(entry.structure.entityId) || 0,
      status: sources.length === 0 || capacity <= 0 ? 'blocked'
        : (powerDelivered.get(entry.structure.entityId) || 0) > 0 ? 'active' : 'starved',
    }, keys, {
      sharedHeadroom: Math.min(
        finalPower.supplyRemaining.get(componentId) || 0,
        finalPower.transportRemaining.get(componentId) || 0,
      ),
      sourceCapacity,
    });
  });

  const pumpsByComponent = new Map();
  const coolingSupply = new Map();
  const coolingInitialSupply = new Map();
  for (const entry of entries.filter((item) => item.blueprint?.stats?.coolingGeneration > 0)) {
    const componentId = cooling.byCell.get(entry.cell.key);
    const powered = (powerDelivered.get(entry.structure.entityId) || 0)
      + EPSILON >= (entry.blueprint.stats.powerDemand || 0);
    if (!componentId || !powered || entry.structure.condition <= 0) continue;
    const generation = entry.blueprint.stats.coolingGeneration * aiMultiplierFor(state, entry);
    coolingSupply.set(componentId, (coolingSupply.get(componentId) || 0) + generation);
    coolingInitialSupply.set(componentId, (coolingInitialSupply.get(componentId) || 0) + generation);
    if (!pumpsByComponent.has(componentId)) pumpsByComponent.set(componentId, []);
    pumpsByComponent.get(componentId).push(entry);
  }
  const coolingTransportCapacity = new Map(cooling.components.map((component) => [
    component.id,
    componentCapacity(component, 'cooling'),
  ]));
  const coolingTransportRemaining = new Map(coolingTransportCapacity);

  const coolingDelivered = new Map();
  const coolingPaths = [];
  for (const entry of computers) {
    const componentId = cooling.byCell.get(entry.cell.key);
    const component = cooling.componentById.get(componentId);
    const sources = pumpsByComponent.get(componentId) || [];
    const source = firstEntry(sources);
    const keys = source
      ? shortestLayerPath(state, 'cooling', source.cell.key, entry.cell.key) : [];
    const available = componentId ? coolingSupply.get(componentId) || 0 : 0;
    const transport = componentId ? coolingTransportRemaining.get(componentId) || 0 : 0;
    const sourceCapacity = componentId ? coolingInitialSupply.get(componentId) || 0 : 0;
    const capacity = Math.min(
      coolingTransportCapacity.get(componentId) || 0,
      sourceCapacity,
    );
    const need = entry.blueprint.stats.coolingDemand;
    const delivered = keys.length ? Math.min(need, available, transport) : 0;
    coolingDelivered.set(entry.structure.entityId, delivered);
    if (componentId && delivered > 0) {
      coolingSupply.set(componentId, available - delivered);
      coolingTransportRemaining.set(componentId, transport - delivered);
    }
    coolingPaths.push(pathWithTelemetry(state, 'cooling', {
      id: `cooling:${source?.structure.entityId || 'none'}:${entry.structure.entityId}`,
      floor: 0,
      source: source?.structure.entityId || null,
      target: entry.structure.entityId,
      from: pathPoint(source),
      to: pathPoint(entry),
      componentId: componentId || null,
      connected: sources.length > 0 && keys.length > 0 && capacity > 0,
      capacity,
      delivered,
      _keys: keys,
      status: sources.length === 0 || capacity <= 0 ? 'blocked'
        : delivered > 0 ? 'active' : 'starved',
    }, keys, {
      sharedHeadroom: Math.min(
        coolingSupply.get(componentId) || 0,
        coolingTransportRemaining.get(componentId) || 0,
      ),
      sourceCapacity,
    }));
  }
  for (let index = 0; index < coolingPaths.length; index++) {
    const path = coolingPaths[index];
    const result = pathWithTelemetry(state, 'cooling', path, path._keys, {
      sharedHeadroom: Math.min(
        coolingSupply.get(path.componentId) || 0,
        coolingTransportRemaining.get(path.componentId) || 0,
      ),
      sourceCapacity: coolingInitialSupply.get(path.componentId) || 0,
    });
    delete result._keys;
    coolingPaths[index] = result;
  }

  const poweredSwitchesByComponent = new Map();
  for (const entry of entries.filter((item) => item.blueprint?.id === 'data_switch')) {
    const componentId = data.byCell.get(entry.cell.key);
    const powered = (powerDelivered.get(entry.structure.entityId) || 0)
      + EPSILON >= (entry.blueprint.stats.powerDemand || 0);
    if (!componentId || !powered || entry.structure.condition <= 0) continue;
    if (!poweredSwitchesByComponent.has(componentId)) poweredSwitchesByComponent.set(componentId, []);
    poweredSwitchesByComponent.get(componentId).push(entry);
  }

  const onlineFibersByComponent = new Map();
  for (const entry of entries.filter((item) => item.blueprint?.id === 'fiber_gateway')) {
    const componentId = data.byCell.get(entry.cell.key);
    const powered = (powerDelivered.get(entry.structure.entityId) || 0)
      + EPSILON >= (entry.blueprint.stats.powerDemand || 0);
    const validFloor = state.floor.number === 1;
    const validEdge = entry.cell.y === state.floor.height - 1;
    const switched = (poweredSwitchesByComponent.get(componentId) || []).length > 0;
    if (!componentId || !powered || entry.structure.condition <= 0
        || !validFloor || !validEdge || !switched) continue;
    if (!onlineFibersByComponent.has(componentId)) onlineFibersByComponent.set(componentId, []);
    onlineFibersByComponent.get(componentId).push(entry);
  }

  const dataConnected = new Map();
  const externalConnected = new Map();
  const dataPaths = [];
  const dataPathKeys = new Map();
  const dataTransportCapacity = new Map(data.components.map((component) => [
    component.id,
    componentCapacity(component, 'data'),
  ]));
  // Data links are full duplex. Internal and external traffic share capacity
  // with peers in the same direction, but do not double-charge opposite flow.
  const dataTransportRemaining = {
    internal: new Map(dataTransportCapacity),
    external: new Map(dataTransportCapacity),
  };
  for (const entry of computers) {
    const componentId = data.byCell.get(entry.cell.key);
    const component = data.componentById.get(componentId);
    const switches = poweredSwitchesByComponent.get(componentId) || [];
    const fibers = onlineFibersByComponent.get(componentId) || [];
    const dataSwitch = firstEntry(switches);
    const fiber = firstEntry(fibers);
    const internalKeys = dataSwitch
      ? shortestLayerPath(state, 'data', dataSwitch.cell.key, entry.cell.key) : [];
    const externalKeys = fiber
      ? shortestLayerPath(state, 'data', entry.cell.key, fiber.cell.key) : [];
    const capacity = dataTransportCapacity.get(componentId) || 0;
    const externalCapacity = fiber
      ? Math.min(capacity, fiber.blueprint.stats.bandwidth * aiMultiplierFor(state, fiber)) : 0;
    const internal = switches.length > 0 && internalKeys.length > 0 && capacity > 0;
    const external = internal && fibers.length > 0 && externalKeys.length > 0;
    dataConnected.set(entry.structure.entityId, internal);
    externalConnected.set(entry.structure.entityId, external);
    const internalPath = {
      id: `data:${dataSwitch?.structure.entityId || 'none'}:${entry.structure.entityId}`,
      floor: 0,
      source: dataSwitch?.structure.entityId || null,
      target: entry.structure.entityId,
      from: pathPoint(dataSwitch),
      to: pathPoint(entry),
      purpose: 'internal',
      componentId: componentId || null,
      connected: internal,
      capacity,
      delivered: 0,
      status: internal ? 'idle' : 'blocked',
    };
    const externalPath = {
      id: `data:${entry.structure.entityId}:${fiber?.structure.entityId || 'none'}`,
      floor: 0,
      source: entry.structure.entityId,
      target: fiber?.structure.entityId || null,
      from: pathPoint(entry),
      to: pathPoint(fiber),
      purpose: 'external',
      componentId: componentId || null,
      connected: external,
      capacity: externalCapacity,
      delivered: 0,
      status: external ? 'active' : 'blocked',
    };
    dataPathKeys.set(internalPath.id, internalKeys);
    dataPathKeys.set(externalPath.id, externalKeys);
    dataPaths.push(internalPath, externalPath);
  }

  function refreshDataTelemetry() {
    for (let index = 0; index < dataPaths.length; index++) {
      const path = dataPaths[index];
      const keys = dataPathKeys.get(path.id) || [];
      dataPaths[index] = pathWithTelemetry(state, 'data', path, keys, {
        sharedHeadroom: dataTransportRemaining[path.purpose].get(path.componentId) || 0,
      });
    }
  }

  function allocateData(pathId, requested) {
    const path = dataPaths.find((item) => item.id === pathId);
    if (!path?.connected || requested <= EPSILON) return 0;
    const remaining = dataTransportRemaining[path.purpose];
    const available = remaining.get(path.componentId) || 0;
    const delivered = Math.min(Math.max(0, requested), available, path.capacity);
    path.delivered += delivered;
    remaining.set(path.componentId, available - delivered);
    return delivered;
  }

  refreshDataTelemetry();

  const burden = utilityBurden(state);
  const usefulCapacity = (componentIds, sourceCapacity, transportCapacity) =>
    [...componentIds].reduce((sum, componentId) => sum + Math.min(
      sourceCapacity.get(componentId) || 0,
      transportCapacity.get(componentId) || 0,
    ), 0);
  const powerCapacity = usefulCapacity(
    finalPower.sourcesByComponent.keys(), finalPower.initialSupply, finalPower.transportCapacity,
  );
  const coolingCapacity = usefulCapacity(
    pumpsByComponent.keys(), coolingInitialSupply, coolingTransportCapacity,
  );
  const dataCapacity = [...poweredSwitchesByComponent.keys()].reduce(
    (sum, componentId) => sum + (dataTransportCapacity.get(componentId) || 0), 0,
  );
  const aiCapacity = usefulCapacity(
    controllersByComponent.keys(), aiSourceCapacity, aiTransportCapacity,
  );
  const networkSnapshot = {
    power: { paths: powerPaths },
    cooling: { paths: coolingPaths },
    data: { paths: dataPaths },
    ai: { paths: aiPaths },
  };

  function refreshTelemetry() {
    refreshDataTelemetry();
    const definitions = {
      power: { capacity: powerCapacity, paths: powerPaths },
      cooling: { capacity: coolingCapacity, paths: coolingPaths },
      data: { capacity: dataCapacity, paths: dataPaths },
      ai: { capacity: aiCapacity, paths: aiPaths },
    };
    for (const [layer, definition] of Object.entries(definitions)) {
      const delivered = layer === 'data' ? Math.max(
        definition.paths.filter((path) => path.purpose === 'internal')
          .reduce((sum, path) => sum + path.delivered, 0),
        definition.paths.filter((path) => path.purpose === 'external')
          .reduce((sum, path) => sum + path.delivered, 0),
      ) : undefined;
      networkSnapshot[layer].telemetry = makeNetworkTelemetry(definition.paths, {
        capacity: definition.capacity,
        ...(delivered === undefined ? {} : { delivered }),
        segments: burden.byLayer[layer]?.segments || 0,
        maintenancePerTick: burden.byLayer[layer]?.maintenanceFlopsPerTick || 0,
      });
    }
  }
  refreshTelemetry();

  return {
    snapshot: networkSnapshot,
    powerDelivered,
    coolingDelivered,
    dataConnected,
    externalConnected,
    aiConnected,
    allocateData,
    refreshTelemetry,
    onlineControllerCount: [...controllersByComponent.values()].reduce(
      (sum, items) => sum + items.length, 0,
    ),
    onlineFiberCount: [...onlineFibersByComponent.values()].reduce(
      (sum, items) => sum + items.length, 0,
    ),
  };
}

function dominantWorkload(parts) {
  const choices = [
    ['sell', parts.sell],
    ['research', parts.research],
    ['training', parts.training],
    ['inference', parts.jobs],
  ].filter(([, value]) => value > EPSILON);
  if (!choices.length) return 'idle';
  choices.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return choices[0][0];
}

function researchUnlockIds(state, node) {
  return node.unlocks.map((id) => (id === 'computer:starter' ? state.computerBlueprintId : id));
}

function researchSnapshot(state) {
  const completed = new Set(state.research.completedIds);
  const recoveryOnline = state.recovery?.phase === 'online';
  const nodes = OVERHAUL_BALANCE.research.nodes.map((node) => {
    const unlocks = researchUnlockIds(state, node);
    const complete = completed.has(node.id);
    const available = recoveryOnline && state.progress.research + EPSILON >= node.threshold;
    return {
      ...clone(node),
      unlocks,
      state: complete ? 'complete' : available ? 'available' : 'locked',
      progress: Math.min(state.progress.research, node.threshold),
    };
  });
  return {
    completedIds: [...state.research.completedIds],
    lastUnlock: state.research.lastUnlock ? clone(state.research.lastUnlock) : null,
    points: state.progress.research,
    nodes,
    next: nodes.find((node) => node.state !== 'complete') || null,
  };
}

function recoverySnapshot(state) {
  const entries = new Map(structureEntries(state)
    .map((entry) => [entry.structure.entityId, entry]));
  const targets = (state.recovery?.repairTargetIds || []).map((entityId) => {
    const entry = entries.get(entityId);
    return {
      entityId,
      blueprintId: entry?.blueprint?.id || null,
      label: entry?.blueprint?.name || entityId,
      x: entry?.cell?.x ?? null,
      y: entry?.cell?.y ?? null,
      condition: entry?.structure?.condition ?? 0,
      state: state.recovery?.activeRepair?.entityId === entityId
        ? 'repairing' : (entry?.structure?.condition || 0) > 0 ? 'repaired' : 'broken',
    };
  });
  return {
    ...clone(state.recovery),
    targets,
    repaired: targets.filter((target) => target.state === 'repaired').length,
    total: targets.length,
  };
}

function storyRequirement(state, turnId) {
  const entries = structureEntries(state);
  const initialOwned = (OVERHAUL_BALANCE.floor.initialOwned.maxX
      - OVERHAUL_BALANCE.floor.initialOwned.minX + 1)
    * (OVERHAUL_BALANCE.floor.initialOwned.maxY
      - OVERHAUL_BALANCE.floor.initialOwned.minY + 1);
  const extraOwned = Math.max(0, allCells(state).filter((cell) => cell.owned).length - initialOwned);
  const completedBuilds = Math.max(0, Number(state.construction?.completed) || 0);
  const operationalFiber = entries.some((entry) => entry.blueprint.id === 'fiber_gateway'
    && entry.structure.condition > 0);
  const textModels = state.business?.textModels?.length || 0;
  const harnesses = state.business?.harnesses?.length || 0;
  const agents = state.business?.agents?.length || 0;
  const completedJobs = state.business?.jobs?.filter((job) => job.status === 'completed').length || 0;
  const workingHumans = state.actors.filter((actor) => actor.kind === 'human'
    && actor.role === 'text-operator' && actor.state === 'working').length;
  const aiConnected = entries.filter((entry) => entry.structure.aiEnabled
    && entry.structure.aiConnected && !entry.structure.aiFault).length;
  const sold = Math.max(0, Number(state.progress?.rawFlopsSold) || 0);

  const pair = (current, total, label, complete = current >= total) => ({
    current, total, label, complete,
  });
  switch (turnId) {
    case 'the-inheritance':
      return pair(
        state.recovery?.completedRepairIds?.length || 0,
        state.recovery?.repairTargetIds?.length || 2,
        `${state.recovery?.completedRepairIds?.length || 0} / ${state.recovery?.repairTargetIds?.length || 2} critical systems restored`,
        state.recovery?.phase === 'online',
      );
    case 'first-light': {
      const raw = Math.max(0, Number(state.flops?.raw) || 0);
      return pair(raw > EPSILON ? 1 : 0, 1,
        raw > EPSILON ? `${raw.toFixed(1)} raw FLOPS online` : 'Rack booting · waiting for one clean FLOP');
    }
    case 'room-to-breathe': {
      const current = Math.min(1, extraOwned) + Math.min(1, completedBuilds);
      return pair(current, 2,
        `${extraOwned ? 'tile claimed' : 'claim a frontier tile'} · ${completedBuilds ? 'structure commissioned' : 'commission a structure'}`);
    }
    case 'the-outside-line': {
      const researched = state.research.completedIds.includes('external-markets');
      const connected = operationalFiber && state.sell?.fiberFloor === 1;
      const current = Number(researched) + Number(connected) + Number(sold > EPSILON);
      return pair(current, 3,
        `${researched ? 'markets researched' : 'research External Markets'} · ${connected ? 'fiber live' : 'connect F1 Fiber'} · ${sold > EPSILON ? `${sold.toFixed(1)} FLOPS sold` : 'make first sale'}`);
    }
    case 'the-first-mind':
      return pair(Math.min(1, textModels), 1,
        textModels ? `${textModels} text model${textModels === 1 ? '' : 's'} trained` : 'Train / Text model not yet completed');
    case 'hands-for-the-mind':
      return pair(Math.min(1, harnesses), 1,
        harnesses ? `${harnesses} harness${harnesses === 1 ? '' : 'es'} ready` : state.business.pendingHarness
          ? `MICA fabricating · ${state.business.pendingHarness.remainingTicks} ticks remain`
          : 'No completed harness');
    case 'the-night-shift':
      return pair(Math.min(1, agents), 1,
        agents ? `${agents} agent${agents === 1 ? '' : 's'} active` : 'Bind a harness into an agent');
    case 'prove-it': {
      const running = state.business.jobs.find((job) => job.status === 'running');
      return pair(Math.min(1, completedJobs), 1,
        completedJobs ? `${completedJobs} contract${completedJobs === 1 ? '' : 's'} completed`
          : running ? `${Math.min(running.requiredFlops, running.completedFlops).toFixed(1)} / ${running.requiredFlops} inference FLOPS`
            : 'Start the first agent contract');
    }
    case 'make-payroll': {
      const paid = Math.max(0, Number(state.economy?.invoicesPaid) || 0);
      const issued = state.business.invoices.filter((invoice) => invoice.status === 'issued').length;
      return pair(Math.min(1, paid), 1,
        paid ? `${paid} invoice${paid === 1 ? '' : 's'} paid` : issued ? 'Invoice issued · collect through live fiber' : 'Finish a contract to issue an invoice');
    }
    case 'shared-control': {
      const researched = state.research.completedIds.includes('machine-assistance');
      const current = Number(researched) + Number(workingHumans > 0) + Number(aiConnected > 0);
      return pair(current, 3,
        `${researched ? 'machine assistance researched' : 'research Machine Assistance'} · ${workingHumans ? 'human operator online' : 'hire and onboard a human'} · ${aiConnected ? `${aiConnected} AI-connected structure${aiConnected === 1 ? '' : 's'}` : 'connect one structure to AI'}`);
    }
    default:
      return pair(0, 1, 'Unknown campaign requirement', false);
  }
}

function storySnapshot(state) {
  const completed = new Set(state.story?.completedIds || []);
  const turns = OVERHAUL_BALANCE.story.turns.map((turn) => {
    const requirement = storyRequirement(state, turn.id);
    const isCurrent = state.story?.currentId === turn.id;
    return {
      ...clone(turn),
      state: completed.has(turn.id) ? 'complete' : isCurrent ? 'current' : 'locked',
      progress: requirement,
    };
  });
  const current = turns.find((turn) => turn.state === 'current') || null;
  return {
    state: current ? 'active' : 'complete',
    completedIds: [...(state.story?.completedIds || [])],
    completed: completed.size,
    total: turns.length,
    current,
    turns,
    turnStartedTick: state.story?.turnStartedTick ?? 0,
    lastBeat: state.story?.lastBeat ? clone(state.story.lastBeat) : null,
  };
}

function openingCheckpointSnapshot(state) {
  const entries = structureEntries(state);
  const initialOwned = (OVERHAUL_BALANCE.floor.initialOwned.maxX
      - OVERHAUL_BALANCE.floor.initialOwned.minX + 1)
    * (OVERHAUL_BALANCE.floor.initialOwned.maxY
      - OVERHAUL_BALANCE.floor.initialOwned.minY + 1);
  const upgradedComputers = entries.filter((entry) => entry.blueprint?.kind === 'computer'
    && (Number(entry.structure.computeUpgradeLevel) || 0) > 0).length;
  const addedGenerators = entries.filter((entry) => entry.blueprint?.stats?.powerGeneration > 0
    && !entry.structure.inherited && entry.structure.condition > 0).length;
  const addedPumps = entries.filter((entry) => entry.blueprint?.stats?.coolingGeneration > 0
    && !entry.structure.inherited && entry.structure.condition > 0).length;
  const powerExpanded = addedGenerators > 0
    && Number(state.networks?.power?.telemetry?.capacity || 0) > 24 + EPSILON;
  const coolingExpanded = addedPumps > 0
    && Number(state.networks?.cooling?.telemetry?.capacity || 0) > 12 + EPSILON;
  const extraOwned = Math.max(0, allCells(state).filter((cell) => cell.owned).length - initialOwned);
  const unlockedFloors = Math.max(1, Number(state.expansion?.unlockedFloors) || 1);
  const checkpointTicks = state.opening?.checkpointTicks || {};
  const definitions = [
    {
      id: 'recover-and-retrofit', number: 1, title: 'Recover + Retrofit',
      objective: 'Repair the inherited plant, then retrofit its compute node.',
      current: Number(state.recovery?.phase === 'online') + Number(upgradedComputers > 0),
      total: 2,
      recordedComplete: checkpointTicks['recover-and-retrofit'] != null,
      label: `${Number(state.recovery?.phase === 'online') + Number(upgradedComputers > 0)} / 2 · ${upgradedComputers ? 'retrofit complete' : 'retrofit pending'}`,
    },
    {
      id: 'expand-utilities', number: 2, title: 'Expand Power + Cooling',
      objective: 'Raise grid capacity above 24 MW and cooling capacity above 12 kW.',
      current: Number(powerExpanded) + Number(coolingExpanded),
      total: 2,
      recordedComplete: checkpointTicks['expand-utilities'] != null,
      label: `${Number(powerExpanded) + Number(coolingExpanded)} / 2 systems expanded`,
    },
    {
      id: 'research-capability', number: 3, title: 'Research Capability',
      objective: 'Complete a research project beyond basic recovery.',
      current: checkpointTicks['research-capability'] != null ? 1 : 0, total: 1,
      recordedComplete: checkpointTicks['research-capability'] != null,
      label: checkpointTicks['research-capability'] != null ? '1 / 1 project complete' : '0 / 1 project complete',
    },
    {
      id: 'expand-first-floor', number: 4, title: 'Expand Floor 1',
      objective: 'Claim 12 additional connected tiles on Floor 1.',
      current: Math.min(12, extraOwned), total: 12,
      recordedComplete: checkpointTicks['expand-first-floor'] != null,
      label: `${Math.min(12, extraOwned)} / 12 tiles claimed`,
    },
    {
      id: 'unlock-second-floor', number: 5, title: 'Open Floor 2',
      objective: 'Unlock and enter the second physical floor.',
      current: Math.max(0, unlockedFloors - 1), total: 1,
      recordedComplete: checkpointTicks['unlock-second-floor'] != null,
      label: unlockedFloors > 1 ? 'Floor 2 open' : 'Floor 2 locked',
    },
  ];
  let priorComplete = true;
  const checkpoints = definitions.map((definition) => {
    const complete = priorComplete && definition.recordedComplete;
    const stateName = complete ? 'complete' : priorComplete ? 'current' : 'locked';
    priorComplete = complete;
    return {
      ...definition,
      complete,
      state: stateName,
      progress: definition.total > 0 ? definition.current / definition.total : 0,
    };
  });
  const current = checkpoints.find((checkpoint) => checkpoint.state === 'current') || null;
  const completed = checkpoints.filter((checkpoint) => checkpoint.state === 'complete').length;
  return {
    state: current ? 'active' : 'complete',
    completed,
    total: checkpoints.length,
    current,
    checkpoints,
  };
}

function semanticSnapshot(state) {
  const owned = allCells(state).filter((cell) => cell.owned).map((cell) => ({
    key: cell.key, uiKey: `f0:${cell.x},${cell.y}`,
    floor: cell.floor, uiFloor: 0, x: cell.x, y: cell.y,
  }));
  const frontier = allCells(state).filter((cell) => cell.frontier).map((cell) => ({
    key: cell.key, uiKey: `f0:${cell.x},${cell.y}`,
    floor: cell.floor, uiFloor: 0, x: cell.x, y: cell.y, cost: cell.claimCost,
  }));
  const computerSource = computerEntries(state);
  const computers = computerSource.map((entry) => {
    const runtime = entry.structure.runtime;
    return {
      id: entry.structure.entityId,
      floor: 0,
      floorKey: state.floor.id,
      x: entry.cell.x,
      y: entry.cell.y,
      state: runtime.state,
      powerDelivered: runtime.powerDelivered,
      coolingDelivered: runtime.coolingDelivered,
      dataConnected: runtime.dataConnected,
      rawFlops: runtime.rawFlops,
      upgradeLevel: Math.max(0, Number(entry.structure.computeUpgradeLevel) || 0),
      outputMultiplier: computeUpgradeMultiplier(entry.structure),
      workload: runtime.workload,
      utilization: runtime.utilization,
      temperatureC: runtime.temperatureC,
      throttle: runtime.throttle,
      fault: runtime.fault,
      construction: entry.structure.construction ? clone(entry.structure.construction) : null,
    };
  });
  const computerActors = computers.filter((computer) => !computer.construction
      || computer.construction.state === 'complete').map((computer) => ({
    id: computer.id,
    kind: 'computer',
    state: computer.state,
    floor: computer.floor,
    floorKey: computer.floorKey,
    x: computer.x,
    y: computer.y,
  }));
  const structures = structureEntries(state).map((entry) => {
    const stats = entry.blueprint.stats || {};
    const aiEnabled = entry.structure.aiEnabled === true;
    const aiConnected = entry.structure.aiConnected === true;
    const aiEfficiencyMultiplier = aiConnected && !entry.structure.aiFault
      ? state.ai.efficiencyMultiplier : 1;
    const outputMultiplier = entry.blueprint.kind === 'computer'
      ? computeUpgradeMultiplier(entry.structure) : 1;
    const baseMetrics = {
      powerGeneration: stats.powerGeneration || 0,
      powerCapacity: entry.layer === 'power' ? stats.capacity || 0 : 0,
      coolingGeneration: stats.coolingGeneration || 0,
      coolingCapacity: entry.layer === 'cooling' ? stats.capacity || 0 : 0,
      dataCapacity: entry.layer === 'data' ? stats.capacity || 0 : 0,
      externalBandwidth: stats.bandwidth || 0,
      rawFlops: stats.rawFlops || 0,
      maintenanceFlopsPerTick: stats.maintenanceFlopsPerTick || 0,
      reliabilityPercent: (stats.reliability ?? 1) * 100,
    };
    return {
      id: entry.structure.entityId,
      blueprintId: entry.blueprint.id,
      kind: entry.blueprint.kind,
      layer: entry.layer,
      networkRole: entry.blueprint.networkRole || null,
      label: entry.blueprint.name,
      floor: 0,
      floorKey: state.floor.id,
      x: entry.cell.x,
      y: entry.cell.y,
      condition: entry.structure.condition,
      construction: entry.structure.construction ? clone(entry.structure.construction) : null,
      inherited: entry.structure.inherited === true,
      repairable: entry.structure.inherited === true && entry.structure.condition < 100,
      computeUpgradeLevel: Math.max(0, Number(entry.structure.computeUpgradeLevel) || 0),
      outputMultiplier,
      canUpgradeCompute: entry.blueprint.kind === 'computer'
        && state.recovery?.phase === 'online'
        && entry.structure.condition > 0
        && (Number(entry.structure.computeUpgradeLevel) || 0) < 1
        && !state.construction.jobs.some((job) => job.entityId === entry.structure.entityId),
      aiEnabled,
      aiConnected,
      aiEfficiencyMultiplier,
      aiFault: entry.structure.aiFault || null,
      baseMetrics,
      effectiveMetrics: Object.fromEntries(Object.entries(baseMetrics)
        .map(([key, value]) => [key, ['maintenanceFlopsPerTick', 'reliabilityPercent'].includes(key)
          ? value : value * aiEfficiencyMultiplier * (key === 'rawFlops' ? outputMultiplier : 1)])),
    };
  });
  const recovery = recoverySnapshot(state);
  const research = researchSnapshot(state);
  const story = storySnapshot(state);
  const opening = openingCheckpointSnapshot(state);
  const progression = opening.state === 'active' ? {
    current: opening.completed,
    total: opening.total,
    label: 'Opening checkpoints',
  } : {
    current: story.completed,
    total: story.total,
    label: story.current ? `Turn ${story.current.number} · ${story.current.title}` : 'Opening campaign complete',
  };
  const result = {
    schemaVersion: OVERHAUL_SCHEMA_VERSION,
    seed: state.seed,
    starterKitId: state.starterKitId,
    unlocks: state.unlockIds.map((id) => ({ id, kind: OVERHAUL_BLUEPRINTS[id].kind })),
    uiFloor: 0,
    footprint: { owned, frontier },
    actors: [...clone(state.actors), ...computerActors],
    structures,
    networks: clone(state.networks),
    utilities: clone(state.utilities),
    ai: clone(state.ai),
    computers,
    flops: clone(state.flops),
    routeBuckets: {
      sell: state.flops.sell,
      research: state.flops.reserved,
      train: state.flops.training,
      inference: state.flops.jobs,
      idle: state.flops.idle,
    },
    sell: clone(state.sell),
    economy: clone(state.economy),
    ticks: { raw: state.tick, completed: state.completedTick },
    routes: clone(state.routes),
    progress: clone(state.progress),
    recovery,
    research,
    story,
    opening,
    progression,
    business: clone(state.business),
    construction: clone(state.construction),
    jobs: clone(state.business.jobs),
    persistence: clone(state),
  };
  const presentation = clone(result);
  delete presentation.persistence;
  presentation.footprint.owned = presentation.footprint.owned.map((cell) => ({
    ...cell,
    commandKey: cell.key,
    key: cell.uiKey,
    floorKey: cell.floor,
    floor: cell.uiFloor,
  }));
  presentation.footprint.frontier = presentation.footprint.frontier.map((cell) => ({
    ...cell,
    commandKey: cell.key,
    key: cell.uiKey,
    floorKey: cell.floor,
    floor: cell.uiFloor,
  }));
  presentation.floors = [{ id: 0, name: 'Floor 1', status: 'online' }];
  result.presentation = presentation;
  return result;
}

export function createOverhaulGame(options = {}) {
  let state = options.snapshot ? restoreState(options.snapshot) : initialState(options.seed);
  const listeners = new Set();
  if (!options.snapshot) {
    state.networks = computeNetworks(state).snapshot;
    updateUtilityBurden(state);
  }

  function emit(type, payload = {}, entityId = null) {
    state.eventSequence += 1;
    const event = {
      id: `${state.tick}:${state.eventSequence}`,
      tick: state.tick,
      type,
      ...(entityId ? { entityId } : {}),
      ...clone(payload),
    };
    for (const listener of listeners) {
      try { listener(clone(event)); } catch (_) { /* observers cannot break the simulation */ }
    }
    return event;
  }

  function emitBusiness(type, payload = {}, entityId = null) {
    const event = emit(type, payload, entityId);
    state.business.events.push(clone(event));
    return event;
  }

  function reject(reason, details = {}) {
    emit('action.rejected', { reason, ...details });
    return { ok: false, reason };
  }

  function nextEntityId(kind) {
    const id = `${kind}-${state.nextEntityId}`;
    state.nextEntityId += 1;
    return id;
  }

  function transitionActor(actor, nextState, assignment = actor.assignment) {
    if (!actor) return;
    const from = actor.state;
    actor.state = nextState;
    actor.assignment = assignment ? clone(assignment) : null;
    if (from !== nextState) {
      emit(`${actor.kind}.state-changed`, {
        from,
        state: nextState,
        assignment: actor.assignment ? clone(actor.assignment) : null,
      }, actor.id);
    }
  }

  function moveActorToward(actor, target) {
    if (!actor || !target) return false;
    const from = { x: actor.x, y: actor.y };
    if (actor.x !== target.x) actor.x += Math.sign(target.x - actor.x);
    if (actor.y !== target.y) actor.y += Math.sign(target.y - actor.y);
    const arrived = actor.x === target.x && actor.y === target.y;
    if (from.x !== actor.x || from.y !== actor.y) {
      emit(`${actor.kind}.moved`, {
        from,
        to: { x: actor.x, y: actor.y },
        target: clone(target),
        arrived,
      }, actor.id);
    }
    return arrived;
  }

  function availableCrew() {
    const human = state.actors.find((actor) => actor.kind === 'human'
      && actor.state === 'idle' && !actor.assignment);
    const robot = state.actors.find((actor) => actor.kind === 'robot'
      && actor.state === 'idle' && !actor.assignment);
    return human && robot ? { human, robot } : null;
  }

  function assignCrew(kind, entityId, target, extra = {}) {
    const crew = availableCrew();
    if (!crew) return null;
    const assignment = {
      kind,
      entityId,
      target: clone(target),
      phase: 'traveling',
      ...clone(extra),
    };
    transitionActor(crew.human, 'moving', assignment);
    transitionActor(crew.robot, 'moving', assignment);
    return { humanId: crew.human.id, robotId: crew.robot.id };
  }

  function releaseCrew(taskKind, entityId, crew) {
    for (const actorId of [crew?.humanId, crew?.robotId].filter(Boolean)) {
      const actor = state.actors.find((item) => item.id === actorId);
      if (!actor || actor.assignment?.kind !== taskKind
          || actor.assignment?.entityId !== entityId) continue;
      transitionActor(actor, 'idle', null);
    }
  }

  function constructionEntry(entityId) {
    return structureEntries(state).find((entry) => entry.structure.entityId === entityId);
  }

  function syncConstruction(job, structure) {
    structure.construction = {
      kind: job.kind || 'build',
      state: job.phase,
      phase: job.phase,
      totalTicks: job.totalTicks,
      ticksRemaining: job.ticksRemaining,
      progress: Math.max(0, Math.min(1,
        (job.totalTicks - job.ticksRemaining) / Math.max(1, job.totalTicks))),
      humanId: job.humanId || null,
      robotId: job.robotId || null,
      queuedTick: job.queuedTick,
    };
  }

  function assignConstructionCrew(job, entry) {
    const crew = assignCrew('construction', job.entityId, {
      floor: 0,
      floorKey: state.floor.id,
      x: entry.cell.x,
      y: entry.cell.y,
    }, { jobId: job.id });
    if (!crew) return false;
    Object.assign(job, crew, { phase: 'traveling' });
    syncConstruction(job, entry.structure);
    emit('construction.crew-dispatched', {
      jobId: job.id,
      blueprintId: entry.blueprint.id,
      cellKey: entry.cell.key,
      ...crew,
    }, job.entityId);
    return true;
  }

  function completeConstruction(job, entry, reason = 'commissioned') {
    if (job.kind === 'compute-upgrade') {
      entry.structure.computeUpgradeLevel = Math.max(
        0, Number(entry.structure.computeUpgradeLevel) || 0,
      ) + 1;
      entry.structure.lastUpgradeTick = state.tick;
      reason = 'compute-retrofit';
    }
    entry.structure.condition = 100;
    entry.structure.construction = {
      ...entry.structure.construction,
      state: 'complete',
      phase: 'complete',
      ticksRemaining: 0,
      progress: 1,
      completedTick: state.tick,
    };
    state.construction.completed += 1;
    state.construction.jobs = state.construction.jobs.filter((item) => item.id !== job.id);
    releaseCrew('construction', job.entityId, job);
    emit('structure.construction-completed', {
      jobId: job.id,
      blueprintId: entry.blueprint.id,
      cellKey: entry.cell.key,
      humanId: job.humanId,
      robotId: job.robotId,
      reason,
      computeUpgradeLevel: Math.max(0, Number(entry.structure.computeUpgradeLevel) || 0),
    }, job.entityId);
  }

  function processConstruction() {
    for (const job of [...state.construction.jobs]) {
      const entry = constructionEntry(job.entityId);
      if (!entry) {
        releaseCrew('construction', job.entityId, job);
        state.construction.jobs = state.construction.jobs.filter((item) => item.id !== job.id);
        continue;
      }
      if (!job.humanId || !job.robotId) {
        job.phase = 'queued';
        syncConstruction(job, entry.structure);
        if (!assignConstructionCrew(job, entry)) continue;
      }
      const human = state.actors.find((actor) => actor.id === job.humanId);
      const robot = state.actors.find((actor) => actor.id === job.robotId);
      if (!human || !robot) {
        releaseCrew('construction', job.entityId, job);
        Object.assign(job, { humanId: null, robotId: null, phase: 'queued' });
        syncConstruction(job, entry.structure);
        continue;
      }
      const target = { floor: 0, floorKey: state.floor.id, x: entry.cell.x, y: entry.cell.y };
      const humanArrived = moveActorToward(human, target);
      const robotArrived = moveActorToward(robot, target);
      if (!humanArrived || !robotArrived) {
        job.phase = 'traveling';
        human.assignment.phase = 'traveling';
        robot.assignment.phase = 'traveling';
        transitionActor(human, 'moving');
        transitionActor(robot, 'moving');
        syncConstruction(job, entry.structure);
        continue;
      }
      const commissioning = job.ticksRemaining <= OVERHAUL_BALANCE.construction.commissioningTicks;
      job.phase = commissioning ? 'commissioning' : 'assembling';
      human.assignment.phase = job.phase;
      robot.assignment.phase = job.phase;
      transitionActor(human, commissioning ? 'inspecting' : 'working');
      transitionActor(robot, commissioning ? 'maintaining' : 'building');
      job.ticksRemaining = Math.max(0, job.ticksRemaining - 1);
      if (!commissioning && job.ticksRemaining > 0
          && job.ticksRemaining <= OVERHAUL_BALANCE.construction.commissioningTicks) {
        job.phase = 'commissioning';
        human.assignment.phase = job.phase;
        robot.assignment.phase = job.phase;
        transitionActor(human, 'inspecting');
        transitionActor(robot, 'maintaining');
      }
      syncConstruction(job, entry.structure);
      emit('structure.construction-progressed', {
        jobId: job.id,
        phase: job.phase,
        ticksRemaining: job.ticksRemaining,
        progress: entry.structure.construction.progress,
        humanId: job.humanId,
        robotId: job.robotId,
      }, job.entityId);
      if (job.ticksRemaining <= 0) completeConstruction(job, entry);
    }
  }

  function unlockBlueprints(ids, source) {
    const unlocked = [];
    for (const id of ids) {
      if (!blueprintById(id) || state.unlockIds.includes(id)) continue;
      state.unlockIds.push(id);
      unlocked.push(id);
    }
    if (unlocked.length) emit('research.blueprints-unlocked', { source, unlocks: unlocked });
    return unlocked;
  }

  function updateResearchProgression() {
    if (state.recovery?.phase !== 'online') return [];
    const completed = new Set(state.research.completedIds);
    const newlyCompleted = [];
    for (const node of OVERHAUL_BALANCE.research.nodes) {
      if (completed.has(node.id) || state.progress.research + EPSILON < node.threshold) continue;
      const unlocks = unlockBlueprints(researchUnlockIds(state, node), node.id);
      completed.add(node.id);
      state.research.completedIds.push(node.id);
      state.research.lastUnlock = {
        id: node.id,
        name: node.name,
        unlocks,
        tick: state.tick,
      };
      newlyCompleted.push(node.id);
      emit('research.node-completed', {
        nodeId: node.id,
        name: node.name,
        threshold: node.threshold,
        unlocks,
      });
    }
    return newlyCompleted;
  }

  function updateOpeningProgression() {
    const ticks = state.opening.checkpointTicks;
    const entries = structureEntries(state);
    const upgraded = entries.some((entry) => entry.blueprint?.kind === 'computer'
      && (Number(entry.structure.computeUpgradeLevel) || 0) > 0);
    if (ticks['recover-and-retrofit'] == null
        && state.recovery?.phase === 'online' && upgraded) {
      ticks['recover-and-retrofit'] = state.tick;
      emit('opening.checkpoint-completed', {
        checkpointId: 'recover-and-retrofit', number: 1,
      }, 'recover-and-retrofit');
    }

    const addedGenerator = entries.some((entry) => entry.blueprint?.stats?.powerGeneration > 0
      && !entry.structure.inherited && entry.structure.condition > 0);
    const addedPump = entries.some((entry) => entry.blueprint?.stats?.coolingGeneration > 0
      && !entry.structure.inherited && entry.structure.condition > 0);
    const powerExpanded = addedGenerator
      && Number(state.networks?.power?.telemetry?.capacity || 0) > 24 + EPSILON;
    const coolingExpanded = addedPump
      && Number(state.networks?.cooling?.telemetry?.capacity || 0) > 12 + EPSILON;
    if (ticks['recover-and-retrofit'] != null && ticks['expand-utilities'] == null
        && powerExpanded && coolingExpanded) {
      ticks['expand-utilities'] = state.tick;
      emit('opening.checkpoint-completed', {
        checkpointId: 'expand-utilities', number: 2,
        powerCapacity: state.networks.power.telemetry.capacity,
        coolingCapacity: state.networks.cooling.telemetry.capacity,
      }, 'expand-utilities');
    }

    const utilityTick = ticks['expand-utilities'];
    const completedResearch = state.research.completedIds.find(
      (id) => id !== 'recovery-grid',
    );
    if (utilityTick != null && ticks['research-capability'] == null
        && completedResearch) {
      ticks['research-capability'] = state.tick;
      emit('opening.checkpoint-completed', {
        checkpointId: 'research-capability', number: 3,
        researchId: completedResearch,
      }, 'research-capability');
    }

    const initialOwned = (OVERHAUL_BALANCE.floor.initialOwned.maxX
        - OVERHAUL_BALANCE.floor.initialOwned.minX + 1)
      * (OVERHAUL_BALANCE.floor.initialOwned.maxY
        - OVERHAUL_BALANCE.floor.initialOwned.minY + 1);
    const extraOwned = allCells(state).filter((cell) => cell.owned).length - initialOwned;
    if (ticks['research-capability'] != null && ticks['expand-first-floor'] == null
        && extraOwned >= 12) {
      ticks['expand-first-floor'] = state.tick;
      emit('opening.checkpoint-completed', {
        checkpointId: 'expand-first-floor', number: 4, extraOwned,
      }, 'expand-first-floor');
    }
  }

  function updateStoryProgression() {
    const turns = OVERHAUL_BALANCE.story.turns;
    const currentIndex = turns.findIndex((turn) => turn.id === state.story.currentId);
    if (currentIndex < 0) return null;
    const turn = turns[currentIndex];
    const requirement = storyRequirement(state, turn.id);
    if (!requirement.complete) return null;
    if (!state.story.completedIds.includes(turn.id)) state.story.completedIds.push(turn.id);
    state.story.lastBeat = {
      id: turn.id,
      number: turn.number,
      title: turn.title,
      copy: turn.completion,
      tick: state.tick,
    };
    const next = turns[currentIndex + 1] || null;
    state.story.currentId = next?.id || null;
    state.story.turnStartedTick = state.tick;
    emit('story.turn-completed', {
      turnId: turn.id,
      number: turn.number,
      title: turn.title,
      completion: turn.completion,
      completed: state.story.completedIds.length,
      total: turns.length,
      nextTurnId: next?.id || null,
      nextTitle: next?.title || null,
    }, turn.id);
    return turn.id;
  }

  function purchaseFrontier(key) {
    const parsed = parseCellKey(key);
    if (!parsed || parsed.floor !== state.floor.id) return reject('not-frontier', { cellKey: key });
    const cell = getCell(state, parsed.x, parsed.y);
    if (!cell?.frontier || cell.owned) return reject('not-frontier', { cellKey: key });
    const cost = cell.claimCost;
    if (state.economy.cash + EPSILON < cost) return reject('insufficient-cash', { cellKey: key });
    state.economy.cash -= cost;
    cell.owned = true;
    recomputeFrontier(state);
    emit('cell.claimed', { cellKey: key, cost, cashAfter: state.economy.cash });
    return { ok: true, cellKey: key, cost };
  }

  function claimCell(x, y) {
    return purchaseFrontier(cellKey(state.floor.id, x, y));
  }

  function createStructure(blueprint, condition = 100) {
    const entityId = nextEntityId(blueprint.kind);
    const structure = { entityId, blueprintId: blueprint.id, condition };
    if (isAiEligibleBlueprint(blueprint)) {
      structure.aiEnabled = false;
      structure.aiConnected = false;
      structure.aiFault = null;
    }
    if (blueprint.kind === 'computer') {
      structure.runtime = computerRuntime(blueprint);
    }
    return structure;
  }

  function placementReason(blueprintId, x, y, candidateState = state) {
    const blueprint = blueprintById(blueprintId);
    if (!blueprint || !blueprint.layer) return 'unknown-blueprint';
    const cell = getCell(candidateState, x, y);
    if (!cell?.owned) return 'unowned-cell';
    if (!candidateState.unlockIds.includes(blueprintId)) return 'locked-blueprint';
    if (cell.layers[blueprint.layer]) return 'layer-occupied';
    if (blueprint.placement?.floor && blueprint.placement.floor !== candidateState.floor.number) {
      return 'wrong-floor';
    }
    if (blueprint.placement?.southEdge && y !== candidateState.floor.height - 1) {
      return 'requires-south-edge';
    }
    if (candidateState.economy.cash + EPSILON < blueprint.cost) return 'insufficient-cash';
    return null;
  }

  function refreshNetworks() {
    updateUtilityBurden(state, 0);
    const network = computeNetworks(state);
    state.networks = network.snapshot;
  }

  function previewPlacement(blueprintId, x, y) {
    const reason = placementReason(blueprintId, x, y);
    if (reason) return { ok: false, reason };
    const blueprint = blueprintById(blueprintId);
    const beforeState = clone(state);
    const afterState = clone(state);
    const beforeNetwork = computeNetworks(beforeState).snapshot;
    const previewId = `preview:${blueprintId}:${x},${y}`;
    const structure = {
      entityId: previewId,
      blueprintId,
      condition: 100,
      ...(isAiEligibleBlueprint(blueprint)
        ? { aiEnabled: false, aiConnected: false, aiFault: null } : {}),
    };
    if (blueprint.kind === 'computer') {
      structure.runtime = {
        state: 'off',
        bootRemaining: blueprint.stats.bootTicks,
        powerDelivered: 0,
        coolingDelivered: 0,
        dataConnected: false,
        rawFlops: 0,
        workload: 'idle',
        utilization: 0,
        temperatureC: OVERHAUL_BALANCE.thermal.ambientC,
        throttle: 1,
        fault: null,
      };
    }
    getCell(afterState, x, y).layers[blueprint.layer] = structure;
    const afterNetwork = computeNetworks(afterState).snapshot;
    let networkExtension = null;
    if (['power', 'cooling', 'data', 'ai'].includes(blueprint.layer)) {
      const key = cellKey(afterState.floor.id, x, y);
      const graph = createComponents(afterState, blueprint.layer);
      const componentId = graph.byCell.get(key);
      const component = graph.componentById.get(componentId);
      const connectedNeighbors = neighbors(
        x, y, afterState.floor.width, afterState.floor.height,
      ).filter(([nx, ny]) => getCell(afterState, nx, ny)
        ?.layers[blueprint.layer]?.condition > 0).length;
      const sourceOnComponent = (component?.cells || []).some((componentKey) => {
        const point = parseCellKey(componentKey);
        const cell = point ? getCell(afterState, point.x, point.y) : null;
        return Object.values(cell?.layers || {}).some((candidate) => {
          const candidateBlueprint = blueprintById(candidate?.blueprintId);
          if (!candidate || candidate.condition <= 0 || !candidateBlueprint) return false;
          if (blueprint.layer === 'power') return (candidateBlueprint.stats?.powerGeneration || 0) > 0;
          if (blueprint.layer === 'cooling') return (candidateBlueprint.stats?.coolingGeneration || 0) > 0;
          if (blueprint.layer === 'data') return candidateBlueprint.id === 'data_switch';
          return candidateBlueprint.id === 'ai_controller';
        });
      });
      const componentKeys = new Set(component?.cells || []);
      const livePath = (afterNetwork[blueprint.layer]?.paths || []).some((path) =>
        path.connected && (path.cells || []).some((point) => componentKeys.has(
          cellKey(afterState.floor.id, Number(point.x), Number(point.y)),
        )));
      networkExtension = {
        layer: blueprint.layer,
        connectedNeighbors,
        reachableCells: component?.cells?.length || 1,
        connectedToNetwork: connectedNeighbors > 0,
        connectedToSource: sourceOnComponent,
        live: livePath,
        isolated: connectedNeighbors === 0,
        routeCapacity: blueprint.stats?.capacity || 0,
        supplyCapacity: afterNetwork[blueprint.layer]?.telemetry?.capacity || 0,
      };
    }
    const networkDeltas = {};
    const affectedEndpoints = [];
    for (const layer of ['power', 'cooling', 'data', 'ai']) {
      const before = beforeNetwork[layer].telemetry;
      const after = afterNetwork[layer].telemetry;
      const beforePaths = new Map(beforeNetwork[layer].paths.map((path) => [
        `${path.purpose || 'resource'}:${path.target || path.source || path.id}`,
        path,
      ]));
      const afterPaths = new Map(afterNetwork[layer].paths.map((path) => [
        `${path.purpose || 'resource'}:${path.target || path.source || path.id}`,
        path,
      ]));
      const changed = [...new Set([...beforePaths.keys(), ...afterPaths.keys()])]
        .filter((key) => {
          const left = beforePaths.get(key);
          const right = afterPaths.get(key);
          return !left || !right || left.connected !== right.connected
            || Math.abs((left.capacity || 0) - (right.capacity || 0)) > EPSILON;
        })
        .map((key) => {
          const left = beforePaths.get(key);
          const right = afterPaths.get(key);
          return {
            resource: layer,
            entityId: right?.target || left?.target || right?.source || left?.source || null,
            beforeConnected: left?.connected || false,
            afterConnected: right?.connected || false,
            beforeCapacity: left?.capacity || 0,
            afterCapacity: right?.capacity || 0,
          };
        });
      affectedEndpoints.push(...changed);
      networkDeltas[layer] = {
        before: clone(before),
        after: clone(after),
        capacityDelta: after.capacity - before.capacity,
        headroomDelta: after.headroom - before.headroom,
        maintenanceDelta: after.maintenancePerTick - before.maintenancePerTick,
        affectedEndpoints: changed,
      };
    }
    return {
      ok: true,
      preview: true,
      blueprintId,
      cellKey: cellKey(state.floor.id, x, y),
      cost: blueprint.cost,
      constructionTicks: OVERHAUL_BALANCE.construction.assemblyTicks
        + OVERHAUL_BALANCE.construction.commissioningTicks,
      recurringBurdenFlops: blueprint.stats?.maintenanceFlopsPerTick || 0,
      networkRole: blueprint.networkRole || null,
      networkExtension,
      networkDeltas,
      affectedEndpoints,
    };
  }

  function place(blueprintId, x, y) {
    const blueprint = blueprintById(blueprintId);
    const reason = placementReason(blueprintId, x, y);
    if (reason) return reject(reason, { blueprintId, x, y });
    const cell = getCell(state, x, y);
    state.economy.cash -= blueprint.cost;
    const structure = createStructure(blueprint, 0);
    cell.layers[blueprint.layer] = structure;
    const totalTicks = OVERHAUL_BALANCE.construction.assemblyTicks
      + OVERHAUL_BALANCE.construction.commissioningTicks;
    const job = {
      id: nextEntityId('construction'),
      kind: 'build',
      entityId: structure.entityId,
      blueprintId,
      cellKey: cell.key,
      x,
      y,
      phase: 'queued',
      totalTicks,
      ticksRemaining: totalTicks,
      humanId: null,
      robotId: null,
      queuedTick: state.tick,
    };
    state.construction.jobs.push(job);
    syncConstruction(job, structure);
    assignConstructionCrew(job, { cell, structure, blueprint });
    refreshNetworks();
    emit('structure.placed', {
      blueprintId,
      kind: blueprint.kind,
      layer: blueprint.layer,
      cellKey: cell.key,
      cost: blueprint.cost,
      constructionJobId: job.id,
      operational: false,
    }, structure.entityId);
    emit('structure.construction-queued', {
      jobId: job.id,
      blueprintId,
      cellKey: cell.key,
      totalTicks,
      humanId: job.humanId,
      robotId: job.robotId,
    }, structure.entityId);
    return {
      ok: true,
      entityId: structure.entityId,
      cellKey: cell.key,
      constructionJobId: job.id,
      state: job.phase,
      operational: false,
    };
  }

  function upgradeCompute(entityId) {
    const entry = computerEntries(state).find((item) => item.structure.entityId === entityId);
    if (!entry) return reject('not-compute', { entityId });
    if (state.recovery?.phase !== 'online') return reject('site-not-recovered', { entityId });
    if (entry.structure.condition <= 0) return reject('compute-offline', { entityId });
    if ((Number(entry.structure.computeUpgradeLevel) || 0) >= 1) {
      return reject('compute-already-upgraded', { entityId });
    }
    if (state.construction.jobs.some((job) => job.entityId === entityId)) {
      return reject('compute-work-in-progress', { entityId });
    }
    const cost = OVERHAUL_BALANCE.recovery.computeUpgradeCost;
    if (state.economy.cash + EPSILON < cost) {
      return reject('insufficient-cash', { entityId, operation: 'upgrade-compute' });
    }
    state.economy.cash -= cost;
    entry.structure.condition = 0;
    const totalTicks = OVERHAUL_BALANCE.recovery.computeUpgradeTicks;
    const job = {
      id: nextEntityId('construction'),
      kind: 'compute-upgrade',
      entityId,
      blueprintId: entry.blueprint.id,
      cellKey: entry.cell.key,
      x: entry.cell.x,
      y: entry.cell.y,
      phase: 'queued',
      totalTicks,
      ticksRemaining: totalTicks,
      humanId: null,
      robotId: null,
      queuedTick: state.tick,
    };
    state.construction.jobs.push(job);
    syncConstruction(job, entry.structure);
    assignConstructionCrew(job, entry);
    refreshNetworks();
    emit('computer.upgrade-queued', {
      jobId: job.id,
      cost,
      bonusPercent: OVERHAUL_BALANCE.recovery.computeUpgradeBonusPercent,
      cellKey: entry.cell.key,
    }, entityId);
    return {
      ok: true,
      entityId,
      constructionJobId: job.id,
      cost,
      bonusPercent: OVERHAUL_BALANCE.recovery.computeUpgradeBonusPercent,
    };
  }

  function remove(x, y, layer) {
    if (!LAYERS.includes(layer)) return reject('unknown-layer', { x, y, layer });
    const cell = getCell(state, x, y);
    const structure = cell?.layers[layer];
    if (!structure) return reject('nothing-to-remove', { x, y, layer });
    const constructionJob = state.construction.jobs.find(
      (job) => job.entityId === structure.entityId,
    );
    if (constructionJob) {
      releaseCrew('construction', structure.entityId, constructionJob);
      state.construction.jobs = state.construction.jobs.filter(
        (job) => job.entityId !== structure.entityId,
      );
    }
    const removedFault = state.ai.activeFaults.find(
      (fault) => fault.entityId === structure.entityId,
    );
    if (removedFault) completeAiRepair(removedFault, 'structure-removed');
    cell.layers[layer] = null;
    refreshNetworks();
    emit('structure.removed', {
      blueprintId: structure.blueprintId,
      layer,
      cellKey: cell.key,
    }, structure.entityId);
    return { ok: true, entityId: structure.entityId, cellKey: cell.key };
  }

  function setRoutes(nextRoutes) {
    if (!nextRoutes || typeof nextRoutes !== 'object') return reject('invalid-routes');
    const candidate = { ...state.routes };
    for (const key of ROUTE_KEYS) {
      if (nextRoutes[key] === undefined) continue;
      const value = Number(nextRoutes[key]);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        return reject('invalid-routes', { route: key });
      }
      candidate[key] = value;
    }
    const total = ROUTE_KEYS.reduce((sum, key) => sum + candidate[key], 0);
    if (total > 1 + EPSILON) return reject('route-overflow', { total });
    state.routes = candidate;
    emit('routes.changed', { routes: clone(candidate) });
    return { ok: true, routes: clone(candidate) };
  }

  function setAiEnabled(entityId, enabled) {
    if (typeof enabled !== 'boolean') return reject('invalid-ai-enabled', { entityId });
    const entry = structureEntries(state).find(
      (item) => item.structure.entityId === entityId,
    );
    if (!entry) return reject('missing-structure', { entityId });
    if (!isAiEligibleBlueprint(entry.blueprint)) {
      return reject('ai-ineligible-structure', { entityId });
    }
    entry.structure.aiEnabled = enabled;
    if (!enabled) entry.structure.aiConnected = false;
    refreshNetworks();
    emit('ai.enabled-changed', { enabled }, entityId);
    return { ok: true, entityId, enabled };
  }

  function repairStructure(entityId) {
    const entry = structureEntries(state).find(
      (item) => item.structure.entityId === entityId,
    );
    if (!entry) return reject('missing-structure', { entityId });
    if (!state.recovery?.repairTargetIds.includes(entityId)) {
      return reject('not-recovery-target', { entityId });
    }
    if (entry.structure.condition >= 100) return reject('no-repair-needed', { entityId });
    if (state.recovery.activeRepair) {
      if (state.recovery.activeRepair.entityId === entityId) {
        return { ok: true, ...clone(state.recovery.activeRepair) };
      }
      return reject('repair-in-progress', {
        entityId,
        activeEntityId: state.recovery.activeRepair.entityId,
      });
    }
    const cost = OVERHAUL_BALANCE.recovery.repairCost;
    if (state.economy.cash + EPSILON < cost) {
      return reject('insufficient-cash', { entityId, operation: 'recovery-repair' });
    }
    const crew = assignCrew('recovery', entityId, {
      floor: 0,
      floorKey: state.floor.id,
      x: entry.cell.x,
      y: entry.cell.y,
    });
    if (!crew) return reject('no-idle-crew', { entityId });
    state.economy.cash -= cost;
    state.recovery.phase = 'repairing';
    state.recovery.activeRepair = {
      entityId,
      ...crew,
      cost,
      phase: 'traveling',
      ticksRemaining: OVERHAUL_BALANCE.recovery.repairTicks,
    };
    emit('recovery.repair-started', {
      siteName: state.recovery.siteName,
      ...crew,
      cost,
      phase: state.recovery.activeRepair.phase,
      ticksRemaining: state.recovery.activeRepair.ticksRemaining,
    }, entityId);
    return { ok: true, ...clone(state.recovery.activeRepair) };
  }

  function repairAiFault(entityId) {
    const entry = structureEntries(state).find(
      (item) => item.structure.entityId === entityId,
    );
    if (!entry) return reject('missing-structure', { entityId });
    const fault = state.ai.activeFaults.find((item) => item.entityId === entityId);
    if (!fault || !entry.structure.aiFault) return reject('no-ai-fault', { entityId });
    if (fault.robotId) {
      return {
        ok: true,
        entityId,
        faultId: fault.faultId,
        robotId: fault.robotId,
        repairRemaining: fault.repairRemaining,
      };
    }
    const robot = assignAiRepair(fault);
    if (!robot) return reject('no-idle-robot', { entityId });
    return {
      ok: true,
      entityId,
      faultId: fault.faultId,
      robotId: robot.id,
      repairRemaining: fault.repairRemaining,
    };
  }

  function completeTextTraining() {
    const balance = OVERHAUL_BALANCE.business;
    const available = state.progress.training - state.business.trainingSpent;
    if (available + EPSILON < balance.textTrainingRequired) {
      return reject('insufficient-training', {
        available,
        required: balance.textTrainingRequired,
      });
    }
    state.business.trainingSpent += balance.textTrainingRequired;
    const entityId = nextEntityId('text');
    const model = {
      id: entityId,
      kind: 'text-model',
      state: 'trained',
      trainingFlops: balance.textTrainingRequired,
    };
    state.business.textModels.push(model);
    emitBusiness('text-trained', {
      trainingFlops: balance.textTrainingRequired,
    }, entityId);
    return { ok: true, entityId };
  }

  function buildHarness(textId) {
    const text = state.business.textModels.find((item) => item.id === textId);
    if (!text) return reject('missing-text-model', { textId });
    if (state.business.pendingHarness) return reject('harness-build-active');
    if (state.business.harnesses.some((item) => item.textId === textId)) {
      return reject('harness-already-built', { textId });
    }
    const balance = OVERHAUL_BALANCE.business;
    if (state.economy.cash + EPSILON < balance.harnessBuildCost) {
      return reject('insufficient-cash', { operation: 'build-harness' });
    }
    const robot = state.actors.find((actor) => actor.kind === 'robot' && actor.state === 'idle');
    if (!robot) return reject('no-idle-robot');
    state.economy.cash -= balance.harnessBuildCost;
    const entityId = nextEntityId('harness');
    state.business.pendingHarness = {
      id: entityId,
      textId,
      robotId: robot.id,
      remainingTicks: balance.harnessBuildTicks,
      cost: balance.harnessBuildCost,
    };
    const from = robot.state;
    robot.state = 'building';
    robot.assignment = { kind: 'harness', entityId, textId };
    emit('robot.state-changed', {
      from,
      state: robot.state,
      assignment: clone(robot.assignment),
    }, robot.id);
    return { ok: true, entityId, remainingTicks: balance.harnessBuildTicks };
  }

  function createAgent(harnessId) {
    const harness = state.business.harnesses.find((item) => item.id === harnessId);
    if (!harness) return reject('missing-harness', { harnessId });
    if (state.economy.cash + EPSILON < OVERHAUL_BALANCE.business.agentCreationCost) {
      return reject('insufficient-cash', { operation: 'create-agent' });
    }
    state.economy.cash -= OVERHAUL_BALANCE.business.agentCreationCost;
    const entityId = nextEntityId('agent');
    state.business.agents.push({
      id: entityId,
      kind: 'text-agent',
      state: 'idle',
      harnessId,
      textId: harness.textId,
      jobId: null,
    });
    emitBusiness('agent-created', { harnessId }, entityId);
    return { ok: true, entityId };
  }

  function startJob(agentId) {
    const agent = state.business.agents.find((item) => item.id === agentId);
    if (!agent) return reject('missing-agent', { agentId });
    if (agent.state !== 'idle') return reject('agent-busy', { agentId });
    const entityId = nextEntityId('job');
    const job = {
      id: entityId,
      label: 'Text operations contract',
      detail: 'Connected agent inference',
      status: 'running',
      agentId,
      requiredFlops: OVERHAUL_BALANCE.business.jobWorkRequired,
      completedFlops: 0,
      invoiceId: null,
    };
    state.business.jobs.push(job);
    agent.state = 'working';
    agent.jobId = entityId;
    emit('job.started', { agentId, requiredFlops: job.requiredFlops }, entityId);
    return { ok: true, entityId };
  }

  function receiveInvoice(invoiceId) {
    const invoice = state.business.invoices.find((item) => item.id === invoiceId);
    if (!invoice) return reject('missing-invoice', { invoiceId });
    if (invoice.status !== 'issued') return reject('invoice-not-payable', { invoiceId });
    if (state.sell.fiberFloor !== 1) return reject('missing-f1-fiber', { invoiceId });
    const cashBefore = state.economy.cash;
    state.economy.cash += invoice.amount;
    state.economy.invoicesPaid += 1;
    invoice.status = 'paid';
    invoice.paidTick = state.tick;
    emitBusiness('cash-received', {
      invoiceId,
      amount: invoice.amount,
      cashBefore,
      cashAfter: state.economy.cash,
    }, invoiceId);
    return { ok: true, invoiceId, amount: invoice.amount };
  }

  function hireHuman() {
    const balance = OVERHAUL_BALANCE.business;
    if (state.economy.cash + EPSILON < balance.humanHireCost) {
      return reject('insufficient-cash', { operation: 'hire-human' });
    }
    const humansBefore = state.economy.humansHired;
    const payrollBefore = state.economy.payroll;
    state.economy.cash -= balance.humanHireCost;
    state.economy.humansHired += 1;
    state.economy.payroll += balance.humanPayroll;
    const entityId = nextEntityId('human');
    state.actors.push({
      id: entityId,
      kind: 'human',
      state: 'hired',
      role: 'text-operator',
      assignment: 'onboarding',
      floor: 0,
      floorKey: 'F1',
      x: Math.min(state.floor.width - 1, 6 + humansBefore),
      y: 7,
      onboardingRemaining: balance.humanOnboardingTicks,
      trainingRemaining: balance.humanTrainingTicks,
    });
    emitBusiness('human-hired', {
      humansBefore,
      humansAfter: state.economy.humansHired,
      payrollBefore,
      payrollAfter: state.economy.payroll,
    }, entityId);
    return { ok: true, entityId };
  }

  const actions = {
    purchaseFrontier,
    claimCell,
    previewPlacement,
    place,
    upgradeCompute,
    remove,
    setRoutes,
    setAiEnabled,
    repairStructure,
    repairAiFault,
    completeTextTraining,
    buildHarness,
    createAgent,
    startJob,
    receiveInvoice,
    hireHuman,
  };

  function command(input) {
    if (!input || typeof input !== 'object') return reject('invalid-command');
    let result;
    switch (input.type) {
      case 'purchase-frontier': result = purchaseFrontier(input.cellKey); break;
      case 'preview-placement': result = previewPlacement(input.blueprintId, input.x, input.y); break;
      case 'place': result = place(input.blueprintId, input.x, input.y); break;
      case 'upgrade-compute': result = upgradeCompute(input.entityId); break;
      case 'remove': result = remove(input.x, input.y, input.layer); break;
      case 'set-routes': result = setRoutes(input.routes || input); break;
      case 'set-ai-enabled': result = setAiEnabled(input.entityId, input.enabled); break;
      case 'repair-structure': result = repairStructure(input.entityId); break;
      case 'repair-ai-fault': result = repairAiFault(input.entityId); break;
      case 'complete-text-training': result = completeTextTraining(); break;
      case 'build-harness': result = buildHarness(input.textId); break;
      case 'create-agent': result = createAgent(input.harnessId); break;
      case 'start-job': result = startJob(input.agentId); break;
      case 'receive-invoice': result = receiveInvoice(input.invoiceId); break;
      case 'hire-human': result = hireHuman(); break;
      default: result = reject('unknown-command', { commandType: input.type });
    }
    if (result?.ok && input.type !== 'preview-placement') {
      updateOpeningProgression();
      updateStoryProgression();
    }
    return result;
  }

  function transitionComputer(entry, nextState, eventType, extra = {}) {
    const runtime = entry.structure.runtime;
    if (runtime.state === nextState) return;
    const from = runtime.state;
    runtime.state = nextState;
    emit(eventType || 'computer.state-changed', { from, state: nextState, ...extra },
      entry.structure.entityId);
  }

  function updateComputer(entry, network) {
    const runtime = entry.structure.runtime;
    const stats = entry.blueprint.stats;
    const entityId = entry.structure.entityId;
    runtime.powerDelivered = network.powerDelivered.get(entityId) || 0;
    runtime.coolingDelivered = network.coolingDelivered.get(entityId) || 0;
    runtime.dataConnected = network.dataConnected.get(entityId) || false;
    runtime.rawFlops = 0;

    const powered = runtime.powerDelivered + EPSILON >= stats.powerDemand;
    const cooled = runtime.coolingDelivered + EPSILON >= stats.coolingDemand;
    const connected = powered && cooled && runtime.dataConnected;
    const thermal = OVERHAUL_BALANCE.thermal;

    if (runtime.fault === 'thermal-shutdown') {
      const coolingRate = cooled ? thermal.activeCoolingPerTick : thermal.passiveCoolingPerTick;
      runtime.temperatureC = Math.max(thermal.ambientC, runtime.temperatureC - coolingRate);
      runtime.utilization = 0;
      runtime.workload = 'idle';
      runtime.throttle = 0;
      if (runtime.temperatureC <= thermal.throttleStartC - 5) {
        runtime.fault = null;
        runtime.throttle = 1;
        transitionComputer(entry, 'off', 'computer.fault-cleared', { fault: 'thermal-shutdown' });
      } else {
        transitionComputer(entry, 'blocked', 'computer.blocked', { reason: 'thermal-shutdown' });
      }
      return { gross: 0, external: false };
    }

    if (!connected) {
      if (runtime.state !== 'off') {
        transitionComputer(entry, 'off', 'computer.offline', {
          powerConnected: powered,
          coolingConnected: cooled,
          dataConnected: runtime.dataConnected,
        });
      }
      runtime.bootRemaining = stats.bootTicks;
      runtime.workload = 'idle';
      runtime.utilization = 0;
      runtime.throttle = 1;
      runtime.temperatureC = Math.max(
        thermal.ambientC,
        runtime.temperatureC - thermal.passiveCoolingPerTick,
      );
      return { gross: 0, external: false };
    }

    if (runtime.state === 'off' || runtime.state === 'blocked') {
      runtime.bootRemaining = stats.bootTicks;
      transitionComputer(entry, 'booting', 'computer.boot-started', {
        bootTicks: stats.bootTicks,
      });
      return { gross: 0, external: network.externalConnected.get(entityId) || false };
    }

    if (runtime.state === 'booting') {
      runtime.bootRemaining = Math.max(0, runtime.bootRemaining - 1);
      if (runtime.bootRemaining > 0) return { gross: 0, external: false };
      transitionComputer(entry, 'loaded', 'computer.loaded');
    }

    const previousThrottle = runtime.throttle;
    const heat = stats.heat * runtime.utilization;
    const coolingFraction = Math.min(1, runtime.coolingDelivered / stats.coolingDemand);
    runtime.temperatureC = Math.max(
      thermal.ambientC,
      runtime.temperatureC + heat - thermal.activeCoolingPerTick * coolingFraction,
    );
    if (runtime.temperatureC >= thermal.shutdownC) {
      runtime.fault = 'thermal-shutdown';
      runtime.throttle = 0;
      runtime.workload = 'idle';
      runtime.utilization = 0;
      transitionComputer(entry, 'blocked', 'computer.fault-raised', {
        fault: runtime.fault,
        temperatureC: runtime.temperatureC,
      });
      return { gross: 0, external: false };
    }
    if (runtime.temperatureC > thermal.throttleStartC) {
      const range = thermal.shutdownC - thermal.throttleStartC;
      const fraction = (runtime.temperatureC - thermal.throttleStartC) / range;
      runtime.throttle = Math.max(thermal.minimumThrottle, 1 - fraction);
      if (previousThrottle >= 1 - EPSILON) {
        transitionComputer(entry, 'throttled', 'computer.throttle-started', {
          temperatureC: runtime.temperatureC,
          throttle: runtime.throttle,
        });
      } else {
        runtime.state = 'throttled';
      }
    } else {
      runtime.throttle = 1;
      if (runtime.state === 'throttled') {
        transitionComputer(entry, 'loaded', 'computer.throttle-ended', {
          temperatureC: runtime.temperatureC,
        });
      } else {
        runtime.state = 'loaded';
      }
    }
    const gross = entry.structure.condition > 0 && !entry.structure.aiFault
      ? stats.rawFlops * computeUpgradeMultiplier(entry.structure)
        * runtime.throttle * aiMultiplierFor(state, entry) : 0;
    runtime.rawFlops = gross;
    return { gross, external: network.externalConnected.get(entityId) || false };
  }

  function processHarnessBuild() {
    const pending = state.business.pendingHarness;
    if (!pending) return;
    pending.remainingTicks = Math.max(0, pending.remainingTicks - 1);
    if (pending.remainingTicks > 0) return;
    state.business.harnesses.push({
      id: pending.id,
      kind: 'text-harness',
      state: 'ready',
      textId: pending.textId,
      builtByRobotId: pending.robotId,
    });
    emitBusiness('harness-built', {
      textId: pending.textId,
      robotId: pending.robotId,
    }, pending.id);
    const robot = state.actors.find((actor) => actor.id === pending.robotId);
    if (robot) {
      const from = robot.state;
      robot.state = 'idle';
      robot.assignment = null;
      emit('robot.state-changed', { from, state: robot.state, assignment: null }, robot.id);
    }
    state.business.pendingHarness = null;
  }

  function processBusinessJobs(network, ledger) {
    let available = 0;
    let requested = ledger.jobs;
    for (const path of state.networks.data.paths.filter(
      (item) => item.purpose === 'external' && item.connected,
    )) {
      if (requested <= EPSILON) break;
      const delivered = network.allocateData(path.id, requested);
      available += delivered;
      requested -= delivered;
    }
    ledger.loss += Math.max(0, ledger.jobs - available);
    ledger.jobs = available;
    for (const job of state.business.jobs.filter((item) => item.status === 'running')) {
      if (network.onlineFiberCount <= 0 || available <= EPSILON) continue;
      const delivered = Math.min(available, job.requiredFlops - job.completedFlops);
      job.completedFlops += delivered;
      available -= delivered;
      job.detail = `${job.completedFlops.toFixed(1)} / ${job.requiredFlops} inference FLOPS`;
      if (job.completedFlops + EPSILON < job.requiredFlops) continue;
      job.completedFlops = job.requiredFlops;
      job.status = 'completed';
      job.completedTick = state.tick;
      const agent = state.business.agents.find((item) => item.id === job.agentId);
      if (agent) {
        agent.state = 'idle';
        agent.jobId = null;
      }
      emitBusiness('job-completed', { agentId: job.agentId }, job.id);
      const invoiceId = nextEntityId('invoice');
      const invoice = {
        id: invoiceId,
        jobId: job.id,
        amount: OVERHAUL_BALANCE.business.invoiceAmount,
        status: 'issued',
        issuedTick: state.tick,
      };
      state.business.invoices.push(invoice);
      job.invoiceId = invoiceId;
      emitBusiness('invoice-issued', {
        jobId: job.id,
        amount: invoice.amount,
      }, invoiceId);
    }
  }

  function processHumanStates() {
    for (const human of state.actors.filter((actor) => actor.kind === 'human')) {
      if (human.state === 'hired') {
        human.onboardingRemaining = Math.max(0, (human.onboardingRemaining || 0) - 1);
        if (human.onboardingRemaining > 0) continue;
        const from = human.state;
        human.state = 'training';
        human.assignment = 'text-operations-training';
        emit('human.state-changed', {
          from,
          state: human.state,
          assignment: human.assignment,
        }, human.id);
      } else if (human.state === 'training') {
        human.trainingRemaining = Math.max(0, (human.trainingRemaining || 0) - 1);
        if (human.trainingRemaining > 0) continue;
        const from = human.state;
        human.state = 'working';
        human.assignment = 'text-operations';
        emit('human.state-changed', {
          from,
          state: human.state,
          assignment: human.assignment,
        }, human.id);
      }
    }
  }

  function processRecoveryRepair() {
    const active = state.recovery?.activeRepair;
    if (!active) return;
    const entry = structureEntries(state).find(
      (item) => item.structure.entityId === active.entityId,
    );
    const human = state.actors.find((actor) => actor.id === active.humanId);
    const robot = state.actors.find((actor) => actor.id === active.robotId);
    if (!entry || !human || !robot) return;
    const target = { floor: 0, floorKey: state.floor.id, x: entry.cell.x, y: entry.cell.y };
    const humanArrived = moveActorToward(human, target);
    const robotArrived = moveActorToward(robot, target);
    if (!humanArrived || !robotArrived) {
      active.phase = 'traveling';
      human.assignment.phase = 'traveling';
      robot.assignment.phase = 'traveling';
      transitionActor(human, 'moving');
      transitionActor(robot, 'moving');
      emit('recovery.crew-traveled', {
        humanId: active.humanId,
        robotId: active.robotId,
        phase: active.phase,
        humanPosition: { x: human.x, y: human.y },
        robotPosition: { x: robot.x, y: robot.y },
      }, active.entityId);
      return;
    }
    active.phase = 'maintaining';
    human.assignment.phase = active.phase;
    robot.assignment.phase = active.phase;
    transitionActor(human, 'repairing');
    transitionActor(robot, 'maintaining');
    active.ticksRemaining = Math.max(0, active.ticksRemaining - 1);
    emit('recovery.repair-progressed', {
      humanId: active.humanId,
      robotId: active.robotId,
      phase: active.phase,
      ticksRemaining: active.ticksRemaining,
    }, active.entityId);
    if (active.ticksRemaining > 0) return;
    if (entry) entry.structure.condition = 100;
    if (!state.recovery.completedRepairIds.includes(active.entityId)) {
      state.recovery.completedRepairIds.push(active.entityId);
    }
    releaseCrew('recovery', active.entityId, active);
    emit('recovery.repair-completed', {
      siteName: state.recovery.siteName,
      humanId: active.humanId,
      robotId: active.robotId,
      repaired: state.recovery.completedRepairIds.length,
      total: state.recovery.repairTargetIds.length,
    }, active.entityId);
    state.recovery.activeRepair = null;
    const remaining = state.recovery.repairTargetIds.some((entityId) => {
      const target = structureEntries(state).find(
        (item) => item.structure.entityId === entityId,
      );
      return !target || target.structure.condition <= 0;
    });
    if (remaining) {
      state.recovery.phase = 'triage';
      return;
    }
    state.recovery.phase = 'online';
    if (!state.recovery.completionBonusPaid) {
      state.recovery.completionBonusPaid = true;
      state.economy.cash += OVERHAUL_BALANCE.recovery.completionBonus;
    }
    emit('recovery.site-online', {
      siteName: state.recovery.siteName,
      completionBonus: OVERHAUL_BALANCE.recovery.completionBonus,
    });
    updateResearchProgression();
  }

  function processAiTraining(researchFlops, network) {
    if (network.onlineControllerCount <= 0 || researchFlops <= EPSILON) return;
    const balance = OVERHAUL_BALANCE.ai;
    const xpBefore = state.ai.xp;
    state.ai.xp += researchFlops;
    emit('ai.training-progressed', {
      flops: researchFlops,
      xpBefore,
      xpAfter: state.ai.xp,
      level: state.ai.level,
    }, state.ai.modelId);
    while (state.ai.xp + EPSILON >= state.ai.nextLevelXp) {
      state.ai.xp -= state.ai.nextLevelXp;
      state.ai.level += 1;
      state.ai.nextLevelXp = Math.round(
        balance.baseLevelXp * balance.levelXpGrowth ** state.ai.level,
      );
      state.ai.bonusPercent = Math.min(
        balance.maximumBonusPercent,
        balance.baseBonusPercent + state.ai.level * balance.bonusPercentPerLevel,
      );
      state.ai.efficiencyMultiplier = 1 + state.ai.bonusPercent / 100;
      state.ai.mistakeChance = Math.max(
        balance.minimumMistakeChance,
        balance.baseMistakeChance - state.ai.level * balance.mistakeChanceReductionPerLevel,
      );
      emit('ai.level-up', {
        level: state.ai.level,
        bonusPercent: state.ai.bonusPercent,
        efficiencyMultiplier: state.ai.efficiencyMultiplier,
        mistakeChance: state.ai.mistakeChance,
        nextLevelXp: state.ai.nextLevelXp,
      }, state.ai.modelId);
    }
    if (state.ai.activeFaults.length === 0) state.ai.state = 'training';
  }

  function assignAiRepair(fault) {
    if (fault.robotId) {
      return state.actors.find((actor) => actor.id === fault.robotId) || null;
    }
    const robot = state.actors.find((actor) => actor.kind === 'robot' && actor.state === 'idle');
    if (!robot) return null;
    const entry = structureEntries(state).find(
      (item) => item.structure.entityId === fault.entityId,
    );
    const target = entry ? {
      floor: 0,
      floorKey: state.floor.id,
      x: entry.cell.x,
      y: entry.cell.y,
    } : { floor: 0, floorKey: state.floor.id, x: robot.x, y: robot.y };
    const assignment = {
      kind: 'ai-fault',
      faultId: fault.faultId,
      entityId: fault.entityId,
      repairRemaining: fault.repairRemaining,
      phase: 'traveling',
      target,
    };
    transitionActor(robot, 'moving', assignment);
    fault.robotId = robot.id;
    fault.phase = 'traveling';
    emit('ai.repair-started', {
      faultId: fault.faultId,
      robotId: robot.id,
      phase: fault.phase,
      repairRemaining: fault.repairRemaining,
    }, fault.entityId);
    return robot;
  }

  function completeAiRepair(fault, reason = 'repaired') {
    const entry = structureEntries(state).find(
      (item) => item.structure.entityId === fault.entityId,
    );
    if (entry) {
      entry.structure.aiFault = null;
      entry.structure.condition = 100;
    }
    const robot = state.actors.find((actor) => actor.id === fault.robotId);
    if (robot) {
      const from = robot.state;
      robot.state = 'idle';
      robot.assignment = null;
      emit('robot.state-changed', { from, state: robot.state, assignment: null }, robot.id);
    }
    state.ai.activeFaults = state.ai.activeFaults.filter(
      (item) => item.faultId !== fault.faultId,
    );
    emit('ai.fault-cleared', { faultId: fault.faultId, reason }, fault.entityId);
  }

  function processAiRepairs() {
    for (const fault of state.ai.activeFaults) {
      if (!fault.robotId) assignAiRepair(fault);
    }
    for (const fault of [...state.ai.activeFaults]) {
      if (!fault.robotId) continue;
      const robot = state.actors.find((actor) => actor.id === fault.robotId);
      let target = robot?.assignment?.target;
      if (robot && !target) {
        const entry = structureEntries(state).find(
          (item) => item.structure.entityId === fault.entityId,
        );
        if (entry) {
          target = { floor: 0, floorKey: state.floor.id, x: entry.cell.x, y: entry.cell.y };
          robot.assignment.target = clone(target);
        }
      }
      if (!robot || !moveActorToward(robot, target)) {
        if (robot) transitionActor(robot, 'moving');
        fault.phase = 'traveling';
        emit('ai.repair-crew-traveled', {
          faultId: fault.faultId,
          robotId: fault.robotId,
          position: robot ? { x: robot.x, y: robot.y } : null,
        }, fault.entityId);
        continue;
      }
      fault.phase = 'maintaining';
      robot.assignment.phase = fault.phase;
      transitionActor(robot, 'repairing');
      fault.repairRemaining = Math.max(0, fault.repairRemaining - 1);
      if (robot?.assignment?.faultId === fault.faultId) {
        robot.assignment.repairRemaining = fault.repairRemaining;
      }
      emit('ai.repair-progressed', {
        faultId: fault.faultId,
        robotId: fault.robotId,
        phase: fault.phase,
        repairRemaining: fault.repairRemaining,
      }, fault.entityId);
      if (fault.repairRemaining <= 0) completeAiRepair(fault);
    }
  }

  function maybeRaiseAiFault() {
    const balance = OVERHAUL_BALANCE.ai;
    if (state.tick % balance.faultCheckIntervalTicks !== 0) return;
    const candidates = structureEntries(state)
      .filter((entry) => isAiEligibleBlueprint(entry.blueprint)
        && entry.structure.aiEnabled
        && entry.structure.aiConnected
        && !entry.structure.aiFault
        && entry.structure.condition > 0)
      .sort((a, b) => a.structure.entityId.localeCompare(b.structure.entityId));
    if (!candidates.length) return;
    const rng = { value: state.rngState };
    const failed = candidates.filter(() => nextRandom(rng) < state.ai.mistakeChance);
    state.rngState = rng.value;
    // One incident per audit keeps the early game risky without letting one
    // cadence overwhelm the single starter repair robot.
    const entry = failed[0];
    if (!entry) return;
    const faultId = nextEntityId('ai-fault');
    const fault = {
      faultId,
      entityId: entry.structure.entityId,
      kind: 'ai-mistake',
      raisedTick: state.tick,
      repairRemaining: balance.repairTicks,
    };
    entry.structure.aiFault = faultId;
    entry.structure.condition = 0;
    if (entry.structure.runtime) {
      entry.structure.runtime.rawFlops = 0;
      entry.structure.runtime.utilization = 0;
      entry.structure.runtime.workload = 'idle';
      entry.structure.runtime.state = 'blocked';
    }
    state.ai.activeFaults.push(fault);
    state.ai.totalFaults += 1;
    state.ai.lastFaultTick = state.tick;
    state.ai.state = 'fault';
    const path = state.networks.ai.paths.find((item) => item.target === fault.entityId);
    if (path) {
      path.status = 'fault';
      path.delivered = 0;
    }
    emit('ai.fault-raised', {
      faultId,
      kind: fault.kind,
      mistakeChance: state.ai.mistakeChance,
      repairRemaining: fault.repairRemaining,
    }, fault.entityId);
    assignAiRepair(fault);
  }

  function simulateOneTick() {
    processRecoveryRepair();
    processAiRepairs();
    processConstruction();
    const previousSell = clone(state.sell);
    const network = computeNetworks(state);
    state.networks = network.snapshot;
    const ledger = emptyLedger();
    let requestedSell = 0;
    let routedSell = 0;
    const burden = utilityBurden(state);
    let maintenanceRemaining = burden.requiredFlopsPerTick;

    for (const entry of computerEntries(state)) {
      const runtime = entry.structure.runtime;
      const beforeWorkload = runtime.workload;
      const production = updateComputer(entry, network);
      const potentialGross = production.gross;
      ledger.raw += potentialGross;
      if (potentialGross <= EPSILON) {
        runtime.rawFlops = 0;
        runtime.utilization = 0;
        runtime.workload = 'idle';
        continue;
      }

      const maintenance = Math.min(potentialGross, maintenanceRemaining);
      maintenanceRemaining -= maintenance;
      ledger.loss += maintenance;
      const afterMaintenance = potentialGross - maintenance;
      const internalPath = state.networks.data.paths.find(
        (path) => path.purpose === 'internal' && path.target === entry.structure.entityId,
      );
      const gross = internalPath
        ? network.allocateData(internalPath.id, afterMaintenance) : 0;
      ledger.loss += Math.max(0, afterMaintenance - gross);
      const requested = gross * state.routes.sell;
      const externalPath = state.networks.data.paths.find(
        (path) => path.purpose === 'external' && path.source === entry.structure.entityId,
      );
      const sold = production.external && externalPath
        ? network.allocateData(externalPath.id, requested) : 0;
      const training = gross * state.routes.train;
      const jobs = gross * state.routes.inference;
      const research = gross * state.routes.research;
      const productiveRequested = requested + training + jobs + research;
      const productive = sold + training + jobs + research;
      const idle = Math.max(0, gross - productiveRequested);
      ledger.loss += Math.max(0, requested - sold);
      requestedSell += requested;
      routedSell += sold;
      ledger.sell += sold;
      ledger.training += training;
      ledger.jobs += jobs;
      ledger.reserved += research;
      ledger.idle += idle;
      runtime.utilization = gross > 0 ? productive / gross : 0;
      runtime.workload = dominantWorkload({ sell: sold, training, jobs, research });
      if (runtime.workload !== beforeWorkload) {
        emit('computer.workload-changed', {
          from: beforeWorkload,
          workload: runtime.workload,
          utilization: runtime.utilization,
        }, entry.structure.entityId);
      }
    }

    updateUtilityBurden(state, burden.requiredFlopsPerTick - maintenanceRemaining);
    processBusinessJobs(network, ledger);
    network.refreshTelemetry();

    // Assign any tiny floating residue to idle so the public equality is exact
    // up to normal IEEE-754 addition order.
    const destinations = ledger.sell + ledger.training + ledger.jobs
      + ledger.reserved + ledger.idle + ledger.loss;
    ledger.idle += ledger.raw - destinations;
    state.flops = ledger;
    state.progress.research += ledger.reserved;
    state.progress.training += ledger.training;
    state.progress.inference += ledger.jobs;
    state.progress.rawFlopsSold += ledger.sell;
    updateResearchProgression();
    updateOpeningProgression();
    processAiTraining(ledger.reserved, network);

    const saleIncome = ledger.sell * OVERHAUL_BALANCE.economy.rawFlopsSalePrice;
    if (saleIncome > EPSILON) {
      const cashBefore = state.economy.cash;
      state.economy.cash += saleIncome;
      emit('flops.sold', {
        flops: ledger.sell,
        amount: saleIncome,
        cashBefore,
        cashAfter: state.economy.cash,
      });
    }

    const sellRequested = state.routes.sell > EPSILON;
    const blocked = sellRequested && routedSell + EPSILON < requestedSell;
    const reason = !blocked ? null
      : network.onlineFiberCount === 0 ? 'missing-f1-fiber' : 'no-fiber-path';
    state.sell = {
      requested: sellRequested,
      requestedFlops: requestedSell,
      blocked,
      reason,
      fiberFloor: network.onlineFiberCount > 0 ? 1 : null,
      routedFlops: routedSell,
      incomePerTick: saleIncome,
    };
    if (state.sell.reason && state.sell.reason !== previousSell.reason) {
      emit('sell.blocked', {
        reason: state.sell.reason,
        requestedFlops: state.sell.requestedFlops,
      });
    } else if (!state.sell.blocked && previousSell.blocked) {
      emit('sell.unblocked', { routedFlops: state.sell.routedFlops });
    }
    processHarnessBuild();
    processHumanStates();
    maybeRaiseAiFault();
    updateStoryProgression();
  }

  function tick(steps = 1) {
    const count = Number(steps);
    if (!Number.isInteger(count) || count < 1 || count > 100000) {
      throw new RangeError('tick steps must be an integer from 1 to 100000');
    }
    for (let index = 0; index < count; index++) {
      state.tick += 1;
      simulateOneTick();
      state.completedTick = state.tick;
      emit('simulation.tick-completed', {
        rawFlops: state.flops.raw,
        completedTick: state.completedTick,
      });
    }
    return semanticSnapshot(state);
  }

  function snapshot() {
    return semanticSnapshot(state);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function requireAction(result, label) {
    if (!result.ok) throw new Error(`Scenario action ${label} failed: ${result.reason}`);
    return result;
  }

  function ensurePlaced(blueprintId, x, y) {
    const blueprint = blueprintById(blueprintId);
    const existing = getCell(state, x, y)?.layers[blueprint.layer];
    if (existing?.blueprintId === blueprintId) {
      const pending = state.construction.jobs.find((job) => job.entityId === existing.entityId);
      if (pending) {
        completeConstruction(pending, constructionEntry(existing.entityId), 'scenario-fixture');
        refreshNetworks();
      }
      return existing.entityId;
    }
    if (existing) throw new Error(`Scenario cell ${x},${y} ${blueprint.layer} already occupied`);
    const placed = requireAction(place(blueprintId, x, y), blueprintId);
    const pending = state.construction.jobs.find((job) => job.entityId === placed.entityId);
    if (pending) {
      completeConstruction(pending, constructionEntry(placed.entityId), 'scenario-fixture');
      refreshNetworks();
    }
    return placed.entityId;
  }

  function buildComputerPath({ fiber = false } = {}) {
    const layout = OVERHAUL_SCENARIO_LAYOUT;
    ensurePlaced('generator', layout.generator.x, layout.generator.y);
    ensurePlaced('cooling_pump', layout.coolingPump.x, layout.coolingPump.y);
    ensurePlaced(state.computerBlueprintId, layout.computer.x, layout.computer.y);
    for (const [x, y] of layout.power) {
      ensurePlaced(x === layout.generator.x && y === layout.generator.y
        ? 'power_pole' : 'power_line', x, y);
    }
    for (const [x, y] of layout.cooling) ensurePlaced('cooling_pipe', x, y);
    for (const [x, y] of layout.data) {
      const blueprintId = x === layout.dataSwitch.x && y === layout.dataSwitch.y
        ? 'data_switch' : 'data_cable';
      ensurePlaced(blueprintId, x, y);
    }
    if (fiber) ensurePlaced('fiber_gateway', layout.fiber.x, layout.fiber.y);
  }

  function buildAiTopology() {
    const layout = OVERHAUL_SCENARIO_LAYOUT;
    ensurePlaced('ai_controller', layout.aiController.x, layout.aiController.y);
    for (const [x, y] of layout.ai) ensurePlaced('ai_bus', x, y);
  }

  function setAllAiEligible(enabled) {
    const targets = structureEntries(state)
      .filter((entry) => isAiEligibleBlueprint(entry.blueprint));
    for (const entry of targets) {
      requireAction(setAiEnabled(entry.structure.entityId, enabled), 'AI opt-in');
    }
  }

  function tickUntilLoaded(snapshots, limit = 12) {
    for (let count = 0; count < limit; count++) {
      tick();
      const current = snapshot();
      snapshots.push(current);
      if (current.computers.some((computer) => computer.state === 'loaded'
          && computer.rawFlops > 0)) return;
    }
    throw new Error('Scenario computer did not reach loaded state');
  }

  function prepareScenario() {
    state.unlockIds = Object.keys(OVERHAUL_BLUEPRINTS);
    for (const entry of structureEntries(state)) entry.structure.condition = 100;
    if (state.recovery) {
      state.recovery.phase = 'online';
      state.recovery.activeRepair = null;
      state.recovery.completedRepairIds = [...state.recovery.repairTargetIds];
      state.recovery.completionBonusPaid = true;
    }
    const recoveryRobot = state.actors.find(
      (actor) => actor.kind === 'robot' && actor.assignment?.kind === 'recovery',
    );
    if (recoveryRobot) {
      recoveryRobot.state = 'idle';
      recoveryRobot.assignment = null;
    }
    state.networks = computeNetworks(state).snapshot;
  }

  function runScenario(name) {
    const snapshots = [];
    let scenarioEvents = null;
    prepareScenario();
    switch (name) {
      case 'computer-path-disconnected': {
        for (const entry of structureEntries(state)) {
          if (entry.blueprint?.kind !== 'computer') entry.structure.condition = 0;
        }
        const point = OVERHAUL_SCENARIO_LAYOUT.computer;
        ensurePlaced(state.computerBlueprintId, point.x, point.y);
        tick();
        snapshots.push(snapshot());
        break;
      }
      case 'computer-path-connected':
        buildComputerPath();
        snapshots.push(snapshot());
        tickUntilLoaded(snapshots);
        break;
      case 'computer-overload': {
        if (state.computerBlueprintId !== 'computer_burst') {
          throw new Error('computer-overload scenario requires a burst-start seed');
        }
        buildComputerPath();
        snapshots.push(snapshot());
        requireAction(setRoutes({ sell: 0, research: 0, train: 0, inference: 1 }),
          'overload inference route');
        tickUntilLoaded(snapshots);
        for (let count = 0; count < 120; count++) {
          const current = snapshots.at(-1);
          if (current.computers.some((computer) => computer.state === 'blocked'
              && computer.fault === 'thermal-shutdown')) break;
          tick();
          snapshots.push(snapshot());
        }
        if (!snapshots.some((current) =>
          current.computers.some((computer) => computer.state === 'throttled'))) {
          throw new Error('computer-overload scenario never reached throttled state');
        }
        if (!snapshots.at(-1).computers.some((computer) =>
          computer.state === 'blocked' && computer.fault === 'thermal-shutdown')) {
          throw new Error('computer-overload scenario never reached thermal shutdown');
        }
        break;
      }
      case 'sell-without-f1-fiber':
        buildComputerPath();
        snapshots.push(snapshot());
        requireAction(setRoutes({ sell: 1, research: 0, train: 0, inference: 0 }), 'sell route');
        tickUntilLoaded(snapshots);
        tick();
        snapshots.push(snapshot());
        break;
      case 'sell-with-f1-fiber':
        buildComputerPath({ fiber: true });
        snapshots.push(snapshot());
        requireAction(setRoutes({ sell: 1, research: 0, train: 0, inference: 0 }), 'sell route');
        tickUntilLoaded(snapshots);
        tick();
        snapshots.push(snapshot());
        break;
      case 'flops-routing':
        buildComputerPath({ fiber: true });
        snapshots.push(snapshot());
        requireAction(setRoutes({ sell: 0.2, research: 0.2, train: 0.2, inference: 0.2 }),
          'mixed routes');
        tickUntilLoaded(snapshots);
        tick();
        snapshots.push(snapshot());
        break;
      case 'ai-opted-out-manual':
        buildComputerPath({ fiber: true });
        buildAiTopology();
        snapshots.push(snapshot());
        tickUntilLoaded(snapshots);
        break;
      case 'ai-risk-reward':
        buildComputerPath({ fiber: true });
        setAllAiEligible(true);
        // This captures explicit opt-in without a controller/bus path: no
        // benefit and no fault exposure until the fourth network is real.
        tick();
        snapshots.push(snapshot());
        buildAiTopology();
        snapshots.push(snapshot());
        tickUntilLoaded(snapshots);
        requireAction(setRoutes({ sell: 0, research: 1, train: 0, inference: 0 }),
          'AI research route');
        while (state.tick < 32) {
          tick();
          snapshots.push(snapshot());
        }
        break;
      case 'text-business-loop': {
        const eventOffset = state.business.events.length;
        buildComputerPath({ fiber: true });
        snapshots.push(snapshot());
        requireAction(setRoutes({ sell: 0, research: 0, train: 1, inference: 0 }),
          'training route');
        tickUntilLoaded(snapshots);
        while (state.progress.training - state.business.trainingSpent
            + EPSILON < OVERHAUL_BALANCE.business.textTrainingRequired) {
          tick();
          snapshots.push(snapshot());
        }
        const text = requireAction(completeTextTraining(), 'complete text training');
        snapshots.push(snapshot());

        const harnessBuild = requireAction(buildHarness(text.entityId), 'build harness');
        snapshots.push(snapshot()); // real robot building state
        while (state.business.pendingHarness) {
          tick();
          snapshots.push(snapshot());
        }
        const harness = state.business.harnesses.find((item) => item.id === harnessBuild.entityId);
        if (!harness) throw new Error('Scenario harness build completed without a harness');

        const agent = requireAction(createAgent(harness.id), 'create agent');
        snapshots.push(snapshot());
        const job = requireAction(startJob(agent.entityId), 'start job');
        snapshots.push(snapshot());
        requireAction(setRoutes({ sell: 0, research: 0, train: 0, inference: 1 }),
          'job route');
        while (state.business.jobs.find((item) => item.id === job.entityId)?.status === 'running') {
          tick();
          snapshots.push(snapshot());
        }
        const completedJob = state.business.jobs.find((item) => item.id === job.entityId);
        const invoice = state.business.invoices.find((item) => item.id === completedJob?.invoiceId);
        if (!invoice) throw new Error('Scenario job completed without an invoice');
        requireAction(receiveInvoice(invoice.id), 'receive invoice');
        snapshots.push(snapshot());
        requireAction(hireHuman(), 'hire human');
        snapshots.push(snapshot()); // authoritative hired state
        for (let index = 0; index < OVERHAUL_BALANCE.business.humanOnboardingTicks
            + OVERHAUL_BALANCE.business.humanTrainingTicks; index++) {
          tick();
          snapshots.push(snapshot());
        }
        scenarioEvents = clone(state.business.events.slice(eventOffset));
        break;
      }
      case 'story-campaign': {
        state.economy.cash = 10000;
        state.ai.mistakeChance = 0;
        const advanceTurn = (turnId, limit = 80) => {
          for (let count = 0; state.story.currentId === turnId && count < limit; count++) {
            tick();
            snapshots.push(snapshot());
          }
          if (state.story.currentId === turnId) {
            throw new Error(`Story scenario did not advance past ${turnId}`);
          }
        };

        snapshots.push(snapshot());
        advanceTurn('the-inheritance', 2);
        advanceTurn('first-light', 12);

        const frontier = allCells(state).find((cell) => cell.frontier);
        if (!frontier) throw new Error('Story scenario has no frontier tile');
        requireAction(command({ type: 'purchase-frontier', cellKey: frontier.key }),
          'story frontier claim');
        ensurePlaced('power_line', frontier.x, frontier.y);
        snapshots.push(snapshot());
        advanceTurn('room-to-breathe', 2);

        const layout = OVERHAUL_SCENARIO_LAYOUT;
        requireAction(command({
          type: 'set-routes', routes: { sell: 0, research: 1, train: 0, inference: 0 },
        }), 'story external-markets research');
        while (!state.research.completedIds.includes('external-markets')) {
          tick();
          snapshots.push(snapshot());
        }
        ensurePlaced('fiber_gateway', layout.fiber.x, layout.fiber.y);
        requireAction(command({
          type: 'set-routes', routes: { sell: 1, research: 0, train: 0, inference: 0 },
        }), 'story first-sale route');
        snapshots.push(snapshot());
        advanceTurn('the-outside-line', 12);

        requireAction(command({
          type: 'set-routes', routes: { sell: 0, research: 0, train: 1, inference: 0 },
        }), 'story training route');
        while (state.progress.training - state.business.trainingSpent
            + EPSILON < OVERHAUL_BALANCE.business.textTrainingRequired) {
          tick();
          snapshots.push(snapshot());
        }
        const text = requireAction(command({ type: 'complete-text-training' }),
          'story text training');
        snapshots.push(snapshot());
        if (state.story.currentId === 'the-first-mind') advanceTurn('the-first-mind', 2);

        const harnessBuild = requireAction(command({ type: 'build-harness', textId: text.entityId }),
          'story harness');
        snapshots.push(snapshot());
        while (state.business.pendingHarness) {
          tick();
          snapshots.push(snapshot());
        }
        if (state.story.currentId === 'hands-for-the-mind') advanceTurn('hands-for-the-mind', 2);
        const harness = state.business.harnesses.find((item) => item.id === harnessBuild.entityId);
        if (!harness) throw new Error('Story harness did not finish');

        const agent = requireAction(command({ type: 'create-agent', harnessId: harness.id }),
          'story agent');
        snapshots.push(snapshot());
        if (state.story.currentId === 'the-night-shift') advanceTurn('the-night-shift', 2);
        const job = requireAction(command({ type: 'start-job', agentId: agent.entityId }),
          'story contract');
        requireAction(command({
          type: 'set-routes', routes: { sell: 0, research: 0, train: 0, inference: 1 },
        }), 'story inference route');
        snapshots.push(snapshot());
        while (state.business.jobs.find((item) => item.id === job.entityId)?.status === 'running') {
          tick();
          snapshots.push(snapshot());
        }
        if (state.story.currentId === 'prove-it') advanceTurn('prove-it', 2);

        const completedJob = state.business.jobs.find((item) => item.id === job.entityId);
        const invoice = state.business.invoices.find((item) => item.id === completedJob?.invoiceId);
        if (!invoice) throw new Error('Story contract did not issue an invoice');
        requireAction(command({ type: 'receive-invoice', invoiceId: invoice.id }),
          'story invoice');
        snapshots.push(snapshot());
        if (state.story.currentId === 'make-payroll') advanceTurn('make-payroll', 2);

        requireAction(command({
          type: 'set-routes', routes: { sell: 0, research: 1, train: 0, inference: 0 },
        }), 'story machine-assistance research');
        while (!state.research.completedIds.includes('machine-assistance')) {
          tick();
          snapshots.push(snapshot());
        }
        buildAiTopology();
        const aiTarget = structureEntries(state).find((entry) => entry.blueprint.kind === 'computer');
        if (!aiTarget) throw new Error('Story scenario has no AI target');
        requireAction(command({
          type: 'set-ai-enabled', entityId: aiTarget.structure.entityId, enabled: true,
        }), 'story AI opt-in');
        requireAction(command({ type: 'hire-human' }), 'story human hire');
        snapshots.push(snapshot());
        advanceTurn('shared-control', 12);
        snapshots.push(snapshot());
        break;
      }
      default:
        throw new Error(`Unknown overhaul scenario: ${name}`);
    }
    return scenarioEvents ? { snapshots, events: scenarioEvents } : { snapshots };
  }

  const api = {
    actions,
    command,
    tick,
    snapshot,
    subscribe,
    runScenario,
  };
  Object.defineProperty(api, 'state', { enumerable: true, get: snapshot });
  return Object.freeze(api);
}

export { OVERHAUL_BALANCE, OVERHAUL_BLUEPRINTS } from './catalog.js';
