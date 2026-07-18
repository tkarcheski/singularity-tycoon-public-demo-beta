/** Central, data-only balance catalog for the overhaul simulation core. */

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const OVERHAUL_SCHEMA_VERSION = 1;

export const OVERHAUL_BALANCE = deepFreeze({
  floor: {
    id: 'F1',
    number: 1,
    width: 12,
    height: 8,
    initialOwned: { minX: 3, maxX: 8, minY: 4, maxY: 7 },
  },
  economy: {
    startingCash: 3000,
    rawFlopsSalePrice: 0.2,
  },
  claims: {
    baseCost: 40,
    distanceCost: 8,
    ownedCellCost: 2,
  },
  thermal: {
    ambientC: 24,
    passiveCoolingPerTick: 1,
    activeCoolingPerTick: 5,
    heatPerUtilizationTick: 4,
    throttleStartC: 72,
    shutdownC: 96,
    minimumThrottle: 0.25,
  },
  routes: {
    default: { sell: 0, research: 0.25, train: 0.25, inference: 0.25 },
    epsilon: 1e-9,
  },
  utilities: {
    // Utility upkeep is paid from produced FLOPS. It therefore cannot soft-lock
    // a fresh build, but a carpet of unused links has a visible recurring cost
    // as soon as the datacenter is productive.
    unpaidReliabilityPenaltyPercent: 0,
  },
  business: {
    textTrainingRequired: 20,
    harnessBuildCost: 80,
    harnessBuildTicks: 2,
    agentCreationCost: 30,
    jobWorkRequired: 24,
    invoiceAmount: 1000,
    humanHireCost: 2500,
    humanPayroll: 20,
    humanOnboardingTicks: 1,
    humanTrainingTicks: 2,
  },
  ai: {
    baseBonusPercent: 5,
    bonusPercentPerLevel: 3,
    maximumBonusPercent: 30,
    baseMistakeChance: 0.22,
    minimumMistakeChance: 0.01,
    mistakeChanceReductionPerLevel: 0.025,
    faultCheckIntervalTicks: 20,
    baseLevelXp: 40,
    levelXpGrowth: 1.5,
    controllerCapacity: 32,
    repairTicks: 3,
  },
});

export const OVERHAUL_BLUEPRINTS = deepFreeze({
  floor_claim: {
    id: 'floor_claim',
    name: 'Floor Claim',
    kind: 'floor',
    layer: null,
    cost: 0,
  },
  generator: {
    id: 'generator',
    name: 'Compact Generator',
    kind: 'power-source',
    layer: 'facility',
    cost: 220,
    stats: { powerGeneration: 24 },
  },
  power_line: {
    id: 'power_line',
    name: 'Power Line',
    kind: 'power-link',
    layer: 'power',
    cost: 6,
    networkRole: 'branch',
    stats: { capacity: 16, maintenanceFlopsPerTick: 0.025, reliability: 0.97 },
  },
  power_pole: {
    id: 'power_pole',
    name: 'Power Pole',
    kind: 'power-link',
    layer: 'power',
    cost: 18,
    networkRole: 'trunk',
    stats: { capacity: 36, maintenanceFlopsPerTick: 0.08, reliability: 0.99 },
  },
  cooling_pump: {
    id: 'cooling_pump',
    name: 'Cooling Pump',
    kind: 'cooling-source',
    layer: 'facility',
    cost: 140,
    stats: { powerDemand: 2, coolingGeneration: 12, powerPriority: 1 },
  },
  cooling_pipe: {
    id: 'cooling_pipe',
    name: 'Cooling Pipe',
    kind: 'cooling-link',
    layer: 'cooling',
    cost: 5,
    networkRole: 'branch',
    stats: { capacity: 12, maintenanceFlopsPerTick: 0.03, reliability: 0.975 },
  },
  data_cable: {
    id: 'data_cable',
    name: 'Data Cable',
    kind: 'data-link',
    layer: 'data',
    cost: 5,
    networkRole: 'branch',
    stats: { capacity: 16, maintenanceFlopsPerTick: 0.025, reliability: 0.98 },
  },
  data_switch: {
    id: 'data_switch',
    name: 'Internal Switch',
    kind: 'data-link',
    layer: 'data',
    cost: 70,
    networkRole: 'hub',
    stats: {
      capacity: 48,
      powerDemand: 1,
      powerPriority: 0,
      maintenanceFlopsPerTick: 0.1,
      reliability: 0.995,
    },
  },
  fiber_gateway: {
    id: 'fiber_gateway',
    name: 'F1 Underground Fiber',
    kind: 'external-link',
    layer: 'facility',
    cost: 180,
    placement: { floor: 1, southEdge: true },
    stats: { bandwidth: 32, powerDemand: 1, powerPriority: 2 },
  },
  ai_controller: {
    id: 'ai_controller',
    name: 'AI Controller',
    kind: 'ai-source',
    layer: 'facility',
    cost: 260,
    stats: { powerDemand: 2, powerPriority: 1, aiCapacity: 32 },
  },
  ai_bus: {
    id: 'ai_bus',
    name: 'AI Bus',
    kind: 'ai-link',
    layer: 'ai',
    cost: 8,
    networkRole: 'automation-bus',
    stats: { capacity: 32, maintenanceFlopsPerTick: 0.04, reliability: 0.98 },
  },
  computer_lean: {
    id: 'computer_lean',
    name: 'Lean Compute Node',
    kind: 'computer',
    layer: 'facility',
    cost: 260,
    stats: {
      rawFlops: 8,
      powerDemand: 3,
      coolingDemand: 4,
      bootTicks: 2,
      heat: 3,
      powerPriority: 3,
    },
  },
  computer_steady: {
    id: 'computer_steady',
    name: 'Steady Compute Node',
    kind: 'computer',
    layer: 'facility',
    cost: 320,
    stats: {
      rawFlops: 11,
      powerDemand: 5,
      coolingDemand: 6,
      bootTicks: 2,
      heat: 4,
      powerPriority: 3,
    },
  },
  computer_burst: {
    id: 'computer_burst',
    name: 'Burst Compute Node',
    kind: 'computer',
    layer: 'facility',
    cost: 390,
    stats: {
      rawFlops: 15,
      powerDemand: 7,
      coolingDemand: 7,
      bootTicks: 3,
      heat: 6,
      powerPriority: 3,
    },
  },
});

const COMMON_STARTER_UNLOCKS = [
  'floor_claim',
  'generator',
  'power_line',
  'power_pole',
  'cooling_pump',
  'cooling_pipe',
  'data_cable',
  'data_switch',
  'fiber_gateway',
  'ai_controller',
  'ai_bus',
];

export const OVERHAUL_STARTER_KITS = deepFreeze([
  {
    id: 'lean-start',
    computerBlueprintId: 'computer_lean',
    unlocks: [...COMMON_STARTER_UNLOCKS, 'computer_lean'],
  },
  {
    id: 'steady-start',
    computerBlueprintId: 'computer_steady',
    unlocks: [...COMMON_STARTER_UNLOCKS, 'computer_steady'],
  },
  {
    id: 'burst-start',
    computerBlueprintId: 'computer_burst',
    unlocks: [...COMMON_STARTER_UNLOCKS, 'computer_burst'],
  },
]);

export const OVERHAUL_REQUIRED_START_KINDS = deepFreeze([
  'floor',
  'power-source',
  'power-link',
  'cooling-source',
  'cooling-link',
  'computer',
  'data-link',
  'ai-source',
  'ai-link',
]);

// A compact, legal build wholly inside the initial connected F1 footprint.
// Scenarios use normal placement actions against these coordinates.
export const OVERHAUL_SCENARIO_LAYOUT = deepFreeze({
  generator: { x: 3, y: 4 },
  coolingPump: { x: 3, y: 5 },
  computer: { x: 7, y: 4 },
  dataSwitch: { x: 4, y: 6 },
  fiber: { x: 3, y: 7 },
  aiController: { x: 4, y: 7 },
  power: [
    [3, 4], [4, 4], [5, 4], [6, 4], [7, 4],
    [3, 5], [3, 6], [4, 6], [3, 7], [4, 7],
  ],
  cooling: [
    [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [7, 4],
  ],
  data: [
    [4, 6], [4, 5], [4, 4], [5, 4], [6, 4], [7, 4],
    [3, 6], [3, 7],
  ],
  ai: [
    [3, 4], [4, 4], [5, 4], [6, 4], [7, 4],
    [3, 5], [4, 5], [5, 5], [6, 5], [7, 5],
    [3, 6], [4, 6], [3, 7], [4, 7],
  ],
});

export function blueprintById(id) {
  return OVERHAUL_BLUEPRINTS[id] || null;
}
