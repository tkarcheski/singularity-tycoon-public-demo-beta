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
        floor: 0, floorKey: 'F1', x: 4, y: 7,
      },
      {
        id: 'robot-2', kind: 'robot', state: 'idle', assignment: null,
        floor: 0, floorKey: 'F1', x: 5, y: 7,
      },
    ],
    networks: emptyNetworks(),
    ai: defaultAiState(),
    tick: 0,
    completedTick: 0,
    nextEntityId: 3,
    eventSequence: 0,
  };
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
  restored.ai = { ...defaultAiState(), ...(restored.ai || {}) };
  restored.ai.activeFaults = Array.isArray(restored.ai.activeFaults)
    ? restored.ai.activeFaults : [];
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

function createComponents(state, layer) {
  const occupied = new Set(
    allCells(state).filter((cell) => cell.layers[layer]).map((cell) => cell.key),
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

function computeNetworks(state) {
  const entries = structureEntries(state);
  const computers = computerEntries(state);
  const power = createComponents(state, 'power');
  const cooling = createComponents(state, 'cooling');
  const data = createComponents(state, 'data');
  const ai = createComponents(state, 'ai');

  function componentCapacity(component, layer) {
    if (!component) return 0;
    const capacities = component.cells.map((key) => {
      const point = parseCellKey(key);
      const structure = getCell(state, point.x, point.y)?.layers[layer];
      const blueprint = blueprintById(structure?.blueprintId);
      if (!structure || structure.condition <= 0) return 0;
      const entry = { structure, blueprint, layer };
      return (blueprint?.stats?.capacity || 0) * aiMultiplierFor(state, entry);
    });
    return capacities.length ? Math.min(...capacities) : 0;
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
    const sourcesByComponent = new Map();
    for (const entry of entries.filter(
      (item) => item.blueprint?.stats?.powerGeneration > 0 && item.structure.condition > 0,
    )) {
      const componentId = power.byCell.get(entry.cell.key);
      if (!componentId) continue;
      const multiplier = useAi ? aiMultiplierFor(state, entry) : 1;
      const generated = entry.blueprint.stats.powerGeneration * multiplier;
      supply.set(componentId, (supply.get(componentId) || 0) + generated);
      if (!sourcesByComponent.has(componentId)) sourcesByComponent.set(componentId, []);
      sourcesByComponent.get(componentId).push(entry);
    }
    const delivered = new Map();
    for (const entry of consumers) {
      const componentId = power.byCell.get(entry.cell.key);
      const need = entry.blueprint.stats.powerDemand;
      const available = componentId ? supply.get(componentId) || 0 : 0;
      const amount = available + EPSILON >= need ? need : 0;
      delivered.set(entry.structure.entityId, amount);
      if (componentId && amount > 0) supply.set(componentId, available - amount);
    }
    return { delivered, sourcesByComponent };
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
  const aiPaths = [];
  const eligible = entries.filter((entry) => isAiEligibleBlueprint(entry.blueprint));
  for (const entry of eligible) {
    const componentId = ai.byCell.get(entry.cell.key);
    const component = ai.componentById.get(componentId);
    const sources = controllersByComponent.get(componentId) || [];
    const source = firstEntry(sources);
    const enabled = entry.structure.aiEnabled === true;
    const physicalConnected = sources.length > 0 && component?.capacity > 0;
    const assisted = enabled && physicalConnected;
    const faulted = Boolean(entry.structure.aiFault);
    entry.structure.aiConnected = assisted;
    aiConnected.set(entry.structure.entityId, assisted);
    aiPaths.push({
      id: `ai:${source?.structure.entityId || 'none'}:${entry.structure.entityId}`,
      source: source?.structure.entityId || null,
      target: entry.structure.entityId,
      from: pathPoint(source),
      to: pathPoint(entry),
      cells: component ? component.cells.map((key) => {
        const point = parseCellKey(key);
        return { floor: 0, x: point.x, y: point.y };
      }) : [],
      connected: physicalConnected,
      enabled,
      capacity: component
        ? Math.min(component.capacity, source?.blueprint.stats.aiCapacity || 0) : 0,
      delivered: assisted && !faulted ? 1 : 0,
      status: faulted ? 'fault'
        : !enabled ? 'disabled'
          : assisted ? 'active' : 'blocked',
    });
  }
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
    const capacity = componentCapacity(component, 'power');
    return {
      id: `power:${source?.structure.entityId || 'none'}:${entry.structure.entityId}`,
      floor: 0,
      source: source?.structure.entityId || null,
      target: entry.structure.entityId,
      from: pathPoint(source),
      to: pathPoint(entry),
      connected: sources.length > 0 && capacity > 0,
      capacity,
      delivered: powerDelivered.get(entry.structure.entityId) || 0,
      status: sources.length === 0 || capacity <= 0 ? 'blocked'
        : (powerDelivered.get(entry.structure.entityId) || 0) > 0 ? 'active' : 'starved',
    };
  });

  const pumpsByComponent = new Map();
  const coolingSupply = new Map();
  for (const entry of entries.filter((item) => item.blueprint?.stats?.coolingGeneration > 0)) {
    const componentId = cooling.byCell.get(entry.cell.key);
    const powered = (powerDelivered.get(entry.structure.entityId) || 0)
      + EPSILON >= (entry.blueprint.stats.powerDemand || 0);
    if (!componentId || !powered || entry.structure.condition <= 0) continue;
    const generation = entry.blueprint.stats.coolingGeneration * aiMultiplierFor(state, entry);
    coolingSupply.set(componentId, (coolingSupply.get(componentId) || 0) + generation);
    if (!pumpsByComponent.has(componentId)) pumpsByComponent.set(componentId, []);
    pumpsByComponent.get(componentId).push(entry);
  }

  const coolingDelivered = new Map();
  const coolingPaths = [];
  for (const entry of computers) {
    const componentId = cooling.byCell.get(entry.cell.key);
    const component = cooling.componentById.get(componentId);
    const sources = pumpsByComponent.get(componentId) || [];
    const source = firstEntry(sources);
    const available = componentId ? coolingSupply.get(componentId) || 0 : 0;
    const capacity = componentCapacity(component, 'cooling');
    const need = entry.blueprint.stats.coolingDemand;
    const delivered = Math.min(need, available, capacity);
    coolingDelivered.set(entry.structure.entityId, delivered);
    if (componentId && delivered > 0) coolingSupply.set(componentId, available - delivered);
    coolingPaths.push({
      id: `cooling:${source?.structure.entityId || 'none'}:${entry.structure.entityId}`,
      floor: 0,
      source: source?.structure.entityId || null,
      target: entry.structure.entityId,
      from: pathPoint(source),
      to: pathPoint(entry),
      connected: sources.length > 0 && capacity > 0,
      capacity,
      delivered,
      status: sources.length === 0 || capacity <= 0 ? 'blocked'
        : delivered > 0 ? 'active' : 'starved',
    });
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
  for (const entry of computers) {
    const componentId = data.byCell.get(entry.cell.key);
    const component = data.componentById.get(componentId);
    const switches = poweredSwitchesByComponent.get(componentId) || [];
    const fibers = onlineFibersByComponent.get(componentId) || [];
    const dataSwitch = firstEntry(switches);
    const fiber = firstEntry(fibers);
    const capacity = componentCapacity(component, 'data');
    const externalCapacity = fiber
      ? Math.min(capacity, fiber.blueprint.stats.bandwidth * aiMultiplierFor(state, fiber)) : 0;
    const internal = switches.length > 0 && capacity > 0;
    const external = internal && fibers.length > 0;
    dataConnected.set(entry.structure.entityId, internal);
    externalConnected.set(entry.structure.entityId, external);
    dataPaths.push({
      id: `data:${dataSwitch?.structure.entityId || 'none'}:${entry.structure.entityId}`,
      floor: 0,
      source: dataSwitch?.structure.entityId || null,
      target: entry.structure.entityId,
      from: pathPoint(dataSwitch),
      to: pathPoint(entry),
      purpose: 'internal',
      connected: internal,
      capacity,
      delivered: 0,
      status: internal ? 'idle' : 'blocked',
    });
    dataPaths.push({
      id: `data:${entry.structure.entityId}:${fiber?.structure.entityId || 'none'}`,
      floor: 0,
      source: entry.structure.entityId,
      target: fiber?.structure.entityId || null,
      from: pathPoint(entry),
      to: pathPoint(fiber),
      purpose: 'external',
      connected: external,
      capacity: externalCapacity,
      delivered: 0,
      status: external ? 'active' : 'blocked',
    });
  }

  return {
    snapshot: {
      power: { paths: powerPaths },
      cooling: { paths: coolingPaths },
      data: { paths: dataPaths },
      ai: { paths: aiPaths },
    },
    powerDelivered,
    coolingDelivered,
    dataConnected,
    externalConnected,
    aiConnected,
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
      workload: runtime.workload,
      utilization: runtime.utilization,
      temperatureC: runtime.temperatureC,
      throttle: runtime.throttle,
      fault: runtime.fault,
    };
  });
  const computerActors = computers.map((computer) => ({
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
    const baseMetrics = {
      powerGeneration: stats.powerGeneration || 0,
      powerCapacity: entry.layer === 'power' ? stats.capacity || 0 : 0,
      coolingGeneration: stats.coolingGeneration || 0,
      coolingCapacity: entry.layer === 'cooling' ? stats.capacity || 0 : 0,
      dataCapacity: entry.layer === 'data' ? stats.capacity || 0 : 0,
      externalBandwidth: stats.bandwidth || 0,
      rawFlops: stats.rawFlops || 0,
    };
    return {
      id: entry.structure.entityId,
      blueprintId: entry.blueprint.id,
      kind: entry.blueprint.kind,
      layer: entry.layer,
      label: entry.blueprint.name,
      floor: 0,
      floorKey: state.floor.id,
      x: entry.cell.x,
      y: entry.cell.y,
      condition: entry.structure.condition,
      aiEnabled,
      aiConnected,
      aiEfficiencyMultiplier,
      aiFault: entry.structure.aiFault || null,
      baseMetrics,
      effectiveMetrics: Object.fromEntries(Object.entries(baseMetrics)
        .map(([key, value]) => [key, value * aiEfficiencyMultiplier])),
    };
  });
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
    business: clone(state.business),
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

  function createStructure(blueprint) {
    const entityId = nextEntityId(blueprint.kind);
    const structure = { entityId, blueprintId: blueprint.id, condition: 100 };
    if (isAiEligibleBlueprint(blueprint)) {
      structure.aiEnabled = false;
      structure.aiConnected = false;
      structure.aiFault = null;
    }
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
    return structure;
  }

  function place(blueprintId, x, y) {
    const blueprint = blueprintById(blueprintId);
    if (!blueprint || !blueprint.layer) return reject('unknown-blueprint', { blueprintId });
    if (!state.unlockIds.includes(blueprintId)) return reject('locked-blueprint', { blueprintId });
    const cell = getCell(state, x, y);
    if (!cell?.owned) return reject('unowned-cell', { blueprintId, x, y });
    if (cell.layers[blueprint.layer]) return reject('layer-occupied', { blueprintId, x, y });
    if (blueprint.placement?.floor && blueprint.placement.floor !== state.floor.number) {
      return reject('wrong-floor', { blueprintId, x, y });
    }
    if (blueprint.placement?.southEdge && y !== state.floor.height - 1) {
      return reject('requires-south-edge', { blueprintId, x, y });
    }
    if (state.economy.cash + EPSILON < blueprint.cost) {
      return reject('insufficient-cash', { blueprintId, x, y });
    }
    state.economy.cash -= blueprint.cost;
    const structure = createStructure(blueprint);
    cell.layers[blueprint.layer] = structure;
    emit('structure.placed', {
      blueprintId,
      kind: blueprint.kind,
      layer: blueprint.layer,
      cellKey: cell.key,
      cost: blueprint.cost,
    }, structure.entityId);
    return { ok: true, entityId: structure.entityId, cellKey: cell.key };
  }

  function remove(x, y, layer) {
    if (!LAYERS.includes(layer)) return reject('unknown-layer', { x, y, layer });
    const cell = getCell(state, x, y);
    const structure = cell?.layers[layer];
    if (!structure) return reject('nothing-to-remove', { x, y, layer });
    const removedFault = state.ai.activeFaults.find(
      (fault) => fault.entityId === structure.entityId,
    );
    if (removedFault) completeAiRepair(removedFault, 'structure-removed');
    cell.layers[layer] = null;
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
    emit('ai.enabled-changed', { enabled }, entityId);
    return { ok: true, entityId, enabled };
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
    place,
    remove,
    setRoutes,
    setAiEnabled,
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
    switch (input.type) {
      case 'purchase-frontier': return purchaseFrontier(input.cellKey);
      case 'place': return place(input.blueprintId, input.x, input.y);
      case 'remove': return remove(input.x, input.y, input.layer);
      case 'set-routes': return setRoutes(input.routes || input);
      case 'set-ai-enabled': return setAiEnabled(input.entityId, input.enabled);
      case 'repair-ai-fault': return repairAiFault(input.entityId);
      case 'complete-text-training': return completeTextTraining();
      case 'build-harness': return buildHarness(input.textId);
      case 'create-agent': return createAgent(input.harnessId);
      case 'start-job': return startJob(input.agentId);
      case 'receive-invoice': return receiveInvoice(input.invoiceId);
      case 'hire-human': return hireHuman();
      default: return reject('unknown-command', { commandType: input.type });
    }
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
      ? stats.rawFlops * runtime.throttle * aiMultiplierFor(state, entry) : 0;
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
    let available = ledger.jobs;
    let deliveredToJobs = 0;
    for (const job of state.business.jobs.filter((item) => item.status === 'running')) {
      if (network.onlineFiberCount <= 0 || available <= EPSILON) continue;
      const delivered = Math.min(available, job.requiredFlops - job.completedFlops);
      job.completedFlops += delivered;
      available -= delivered;
      deliveredToJobs += delivered;
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
    let externalDelivery = deliveredToJobs;
    for (const path of state.networks.data.paths.filter(
      (item) => item.purpose === 'external' && item.connected,
    )) {
      if (externalDelivery <= EPSILON) break;
      const capacityLeft = Math.max(0, path.capacity - path.delivered);
      const delivered = Math.min(capacityLeft, externalDelivery);
      path.delivered += delivered;
      externalDelivery -= delivered;
      if (path.delivered > 0) path.status = 'active';
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
    const from = robot.state;
    robot.state = 'repairing';
    robot.assignment = {
      kind: 'ai-fault',
      faultId: fault.faultId,
      entityId: fault.entityId,
      repairRemaining: fault.repairRemaining,
    };
    fault.robotId = robot.id;
    emit('robot.state-changed', {
      from,
      state: robot.state,
      assignment: clone(robot.assignment),
    }, robot.id);
    emit('ai.repair-started', {
      faultId: fault.faultId,
      robotId: robot.id,
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
      fault.repairRemaining = Math.max(0, fault.repairRemaining - 1);
      const robot = state.actors.find((actor) => actor.id === fault.robotId);
      if (robot?.assignment?.faultId === fault.faultId) {
        robot.assignment.repairRemaining = fault.repairRemaining;
      }
      emit('ai.repair-progressed', {
        faultId: fault.faultId,
        robotId: fault.robotId,
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
    processAiRepairs();
    const previousSell = clone(state.sell);
    const network = computeNetworks(state);
    state.networks = network.snapshot;
    const ledger = emptyLedger();
    let requestedSell = 0;
    let routedSell = 0;

    for (const entry of computerEntries(state)) {
      const runtime = entry.structure.runtime;
      const beforeWorkload = runtime.workload;
      const production = updateComputer(entry, network);
      const gross = production.gross;
      ledger.raw += gross;
      if (gross <= EPSILON) {
        runtime.rawFlops = 0;
        runtime.utilization = 0;
        runtime.workload = 'idle';
        continue;
      }

      const requested = gross * state.routes.sell;
      const sold = production.external ? requested : 0;
      const training = gross * state.routes.train;
      const jobs = gross * state.routes.inference;
      const research = gross * state.routes.research;
      const productive = sold + training + jobs + research;
      const idle = Math.max(0, gross - productive);
      requestedSell += requested;
      routedSell += sold;
      ledger.sell += sold;
      ledger.training += training;
      ledger.jobs += jobs;
      ledger.reserved += research;
      ledger.idle += idle;
      runtime.utilization = gross > 0 ? productive / gross : 0;
      runtime.workload = dominantWorkload({ sell: sold, training, jobs, research });
      const internalPath = state.networks.data.paths.find(
        (path) => path.purpose === 'internal' && path.target === entry.structure.entityId,
      );
      if (internalPath) {
        internalPath.delivered = Math.min(internalPath.capacity, gross);
        internalPath.status = internalPath.delivered > 0 ? 'active' : 'idle';
      }
      const externalPath = state.networks.data.paths.find(
        (path) => path.purpose === 'external' && path.source === entry.structure.entityId,
      );
      if (externalPath) {
        externalPath.delivered = Math.min(externalPath.capacity, sold);
        externalPath.status = !externalPath.connected ? 'blocked'
          : externalPath.delivered > 0 ? 'active' : 'idle';
      }
      if (runtime.workload !== beforeWorkload) {
        emit('computer.workload-changed', {
          from: beforeWorkload,
          workload: runtime.workload,
          utilization: runtime.utilization,
        }, entry.structure.entityId);
      }
    }

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
    processBusinessJobs(network, ledger);
    processHumanStates();
    maybeRaiseAiFault();
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
    if (existing?.blueprintId === blueprintId) return existing.entityId;
    if (existing) throw new Error(`Scenario cell ${x},${y} ${blueprint.layer} already occupied`);
    return requireAction(place(blueprintId, x, y), blueprintId).entityId;
  }

  function buildComputerPath({ fiber = false } = {}) {
    const layout = OVERHAUL_SCENARIO_LAYOUT;
    ensurePlaced('generator', layout.generator.x, layout.generator.y);
    ensurePlaced('cooling_pump', layout.coolingPump.x, layout.coolingPump.y);
    ensurePlaced(state.computerBlueprintId, layout.computer.x, layout.computer.y);
    for (const [x, y] of layout.power) ensurePlaced('power_line', x, y);
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

  function runScenario(name) {
    const snapshots = [];
    let scenarioEvents = null;
    switch (name) {
      case 'computer-path-disconnected': {
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
