import { createOverhaulGame } from './core.js';

const root = document.getElementById('overhaul-root');
if (!root) throw new Error('Overhaul entrypoint is missing #overhaul-root');
root.setAttribute('data-overhaul-root', '');

const query = new URLSearchParams(location.search);
const DEFAULT_SEED = query.get('seed') || 'AURORA-17';
const TICK_MS = 500;

let game = null;
let view = null;
let tickTimer = null;

function renderCommitted(snapshot = game?.snapshot()) {
  if (!snapshot) return null;
  view?.render(snapshot);
  document.documentElement.dataset.uiTick = String(snapshot.ticks.completed);
  return snapshot;
}

function teardownMountedGame() {
  if (tickTimer !== null) clearInterval(tickTimer);
  tickTimer = null;
  view?.destroy?.();
  view = null;
  if (window.__overhaulMockGame?.destroy) window.__overhaulMockGame.destroy();
  delete window.__overhaulMockGame;
}

function mountGame({ seed = DEFAULT_SEED, snapshot = null } = {}) {
  teardownMountedGame();
  game = createOverhaulGame(snapshot ? { snapshot } : { seed });
  window.__overhaulGame = game;
  view = window.createOverhaulView(game, { root });
  window.__overhaulView = view;
  renderCommitted(game.snapshot());
  tickTimer = setInterval(() => {
    try {
      renderCommitted(game.tick());
    } catch (error) {
      console.error('Overhaul tick failed', error);
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }, TICK_MS);
  return game.snapshot();
}

function installAcceptanceBridge() {
  const bridge = {
    ready: false,
    reset(options = {}) {
      const requestedSeed = options?.seed ?? DEFAULT_SEED;
      return mountGame({ seed: requestedSeed });
    },
    snapshot() {
      return game.snapshot();
    },
    command(action) {
      const result = game.command(action);
      renderCommitted(game.snapshot());
      return result;
    },
    runScenario(name) {
      const result = game.runScenario(name);
      renderCommitted(game.snapshot());
      return result;
    },
  };
  window.__overhaulAcceptance = bridge;
  mountGame({ seed: DEFAULT_SEED });
  bridge.ready = true;
}

async function waitForViewInstaller() {
  const deadline = performance.now() + 5000;
  while (typeof window.createOverhaulView !== 'function') {
    if (performance.now() >= deadline) {
      throw new Error('Timed out waiting for createOverhaulView');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

await waitForViewInstaller();
window.createOverhaulGame = createOverhaulGame;
installAcceptanceBridge();

window.addEventListener('beforeunload', teardownMountedGame, { once: true });
