const AUDIO_SETTINGS_KEY = 'singularity-overhaul-audio-v1';
const SCORE_STATES = Object.freeze(['calm', 'building', 'pressure', 'breakthrough']);
const SCORE_TRANSITION_SECONDS = 1.2;
const MAX_POLYPHONY = 10;

const MUSIC_LAYERS = Object.freeze({
  calm: { frequencies: [55, 82.5], types: ['sine', 'triangle'], pulseHz: 0.08 },
  building: { frequencies: [65.41, 98], types: ['triangle', 'sawtooth'], pulseHz: 1.35 },
  pressure: { frequencies: [46.25, 48.1], types: ['sawtooth', 'square'], pulseHz: 2.4 },
  breakthrough: { frequencies: [110, 164.81], types: ['triangle', 'sine'], pulseHz: 0.72 },
});

const RECIPE_COOLDOWNS = Object.freeze({
  'fan-grind-down': 1400,
  'relay-snap': 260,
  'coolant-hiss': 1200,
  'transformer-thump': 1000,
  'repair-servo': 700,
  'repair-tool': 360,
});

function clamp(value, min = 0, max = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : min;
}

function safeStorage() {
  try { return globalThis.localStorage || null; } catch (_) { return null; }
}

function defaultContextFactory() {
  const Constructor = globalThis.AudioContext || globalThis.webkitAudioContext;
  return Constructor ? new Constructor() : null;
}

function defaultClock() {
  return {
    now: () => globalThis.performance?.now?.() ?? Date.now(),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
  };
}

function setValue(parameter, value, atTime = 0) {
  if (!parameter) return;
  try {
    parameter.cancelScheduledValues?.(atTime);
    if (typeof parameter.setValueAtTime === 'function') parameter.setValueAtTime(value, atTime);
    else parameter.value = value;
  } catch (_) { parameter.value = value; }
}

function crossfade(parameter, value, context) {
  if (!parameter || !context) return;
  const now = context.currentTime || 0;
  try {
    parameter.cancelScheduledValues?.(now);
    if (typeof parameter.setTargetAtTime === 'function') {
      parameter.setTargetAtTime(value, now, SCORE_TRANSITION_SECONDS / 3);
    } else {
      parameter.value = value;
    }
  } catch (_) { parameter.value = value; }
}

function ramp(parameter, value, atTime, exponential = false) {
  if (!parameter) return;
  const method = exponential ? 'exponentialRampToValueAtTime' : 'linearRampToValueAtTime';
  try {
    if (typeof parameter[method] === 'function') parameter[method](value, atTime);
    else parameter.value = value;
  } catch (_) { parameter.value = value; }
}

function disconnect(node) {
  try { node?.disconnect?.(); } catch (_) { /* already disconnected */ }
}

function stop(node) {
  try { node?.stop?.(); } catch (_) { /* already stopped */ }
}

function scoreStateFor(snapshot, holds) {
  const tick = Number(snapshot?.ticks?.completed ?? snapshot?.ticks?.raw ?? 0);
  if (tick <= holds.breakthroughUntil) return 'breakthrough';
  const computers = Array.isArray(snapshot?.computers) ? snapshot.computers : [];
  const pressure = (snapshot?.ai?.activeFaults?.length || 0) > 0
    || snapshot?.sell?.blocked === true
    || computers.some((computer) => ['blocked', 'throttled'].includes(computer.state)
      || Boolean(computer.fault));
  if (pressure) return 'pressure';
  const actors = Array.isArray(snapshot?.actors) ? snapshot.actors : [];
  const activeConstruction = actors.some((actor) => ['building', 'repairing'].includes(actor.state));
  if (activeConstruction || tick <= holds.buildingUntil) return 'building';
  return 'calm';
}

function recipesForEvent(event, snapshot) {
  if (!event?.type) return [];
  const structure = snapshot?.structures?.find?.((item) => item.id === event.entityId);
  const resource = structure?.kind || structure?.layer || '';
  if (event.type === 'ai.fault-raised' || event.type === 'computer.fault-raised') {
    if (resource.includes('cooling')) return ['relay-snap', 'coolant-hiss'];
    if (resource.includes('power')) return ['relay-snap', 'transformer-thump'];
    return ['relay-snap', 'fan-grind-down'];
  }
  if (event.type === 'ai.repair-started') return ['repair-servo'];
  if (event.type === 'ai.repair-progressed') return ['repair-tool'];
  if (event.type === 'ai.fault-cleared' || event.type === 'computer.fault-cleared') {
    return ['relay-snap'];
  }
  return [];
}

function eventKey(event) {
  return String(event?.id || `${event?.type || 'event'}:${event?.tick || 0}:${event?.entityId || ''}`);
}

function loadSettings(storage) {
  const defaults = { musicVolume: 0.38, sfxVolume: 0.72, musicMuted: false, sfxMuted: false };
  try {
    const value = JSON.parse(storage?.getItem?.(AUDIO_SETTINGS_KEY) || 'null');
    if (!value || typeof value !== 'object') return defaults;
    return {
      musicVolume: clamp(value.musicVolume ?? defaults.musicVolume),
      sfxVolume: clamp(value.sfxVolume ?? defaults.sfxVolume),
      musicMuted: value.musicMuted === true,
      sfxMuted: value.sfxMuted === true,
    };
  } catch (_) { return defaults; }
}

export function createOverhaulAudio(options = {}) {
  const contextFactory = options.contextFactory || defaultContextFactory;
  const clock = options.clock || defaultClock();
  const storage = options.storage === undefined ? safeStorage() : options.storage;
  const settings = loadSettings(storage);
  const holds = { buildingUntil: -1, breakthroughUntil: -1 };
  const seenEvents = new Set();
  const seenEventOrder = [];
  const cooldowns = new Map();
  const activeVoices = new Map();
  const voiceTimers = new Set();
  const lifecycleCleanups = [];
  const musicSources = [];
  const layerBuses = new Map();
  const graph = { master: null, music: null, sfx: null };
  const diagnostics = {
    playedByRecipe: Object.fromEntries(Object.keys(RECIPE_COOLDOWNS).map((key) => [key, 0])),
    lastRecipes: [],
    cooldownSuppressed: 0,
    polyphonyDropped: 0,
    lockedSuppressed: 0,
    peakPolyphony: 0,
  };

  let context = null;
  let noiseBuffer = null;
  let graphCreated = false;
  let unlocked = false;
  let hidden = false;
  let pageSuspended = false;
  let destroyed = false;
  let scoreState = 'calm';
  let previousScoreState = null;
  let lastCommittedTick = -1;
  let lastSeed = null;
  let nextVoiceId = 1;

  function saveSettings() {
    try { storage?.setItem?.(AUDIO_SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { /* optional */ }
  }

  function updateMix() {
    const now = context?.currentTime || 0;
    const musicValue = settings.musicMuted ? 0 : settings.musicVolume;
    const sfxValue = settings.sfxMuted ? 0 : settings.sfxVolume;
    setValue(graph.music?.gain, musicValue, now);
    setValue(graph.sfx?.gain, sfxValue, now);
  }

  function createGain(value = 1) {
    const node = context.createGain();
    setValue(node.gain, value, context.currentTime || 0);
    return node;
  }

  function createNoiseBuffer() {
    if (noiseBuffer || typeof context.createBuffer !== 'function') return noiseBuffer;
    const sampleRate = context.sampleRate || 44100;
    noiseBuffer = context.createBuffer(1, sampleRate * 2, sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    let random = 0x51f15e;
    for (let index = 0; index < channel.length; index += 1) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      channel[index] = (random / 0xffffffff) * 2 - 1;
    }
    return noiseBuffer;
  }

  function startMusicLayer(name, definition) {
    const bus = createGain(name === scoreState ? 0.9 : 0.0001);
    bus.connect(graph.music);
    layerBuses.set(name, bus);
    definition.frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const voice = createGain(index === 0 ? 0.09 : 0.045);
      oscillator.type = definition.types[index];
      setValue(oscillator.frequency, frequency, context.currentTime || 0);
      oscillator.connect(voice);
      voice.connect(bus);
      oscillator.start();
      musicSources.push({ source: oscillator, nodes: [voice] });
    });
    const lfo = context.createOscillator();
    const lfoDepth = createGain(0.018);
    lfo.type = 'sine';
    setValue(lfo.frequency, definition.pulseHz, context.currentTime || 0);
    lfo.connect(lfoDepth);
    lfoDepth.connect(bus.gain);
    lfo.start();
    musicSources.push({ source: lfo, nodes: [lfoDepth] });
  }

  function ensureGraph() {
    if (graphCreated || destroyed) return graphCreated;
    try { context = context || contextFactory?.() || null; } catch (_) { context = null; }
    if (!context) return false;
    graph.master = createGain(0.82);
    graph.music = createGain(0);
    graph.sfx = createGain(0);
    graph.music.connect(graph.master);
    graph.sfx.connect(graph.master);
    graph.master.connect(context.destination);
    for (const name of SCORE_STATES) startMusicLayer(name, MUSIC_LAYERS[name]);
    createNoiseBuffer();
    graphCreated = true;
    updateMix();
    return true;
  }

  async function reconcileLifecycle() {
    if (!context || destroyed) return false;
    const shouldRun = unlocked && !hidden && !pageSuspended;
    try {
      if (shouldRun && context.state !== 'running') await context.resume?.();
      if (!shouldRun && context.state === 'running') await context.suspend?.();
    } catch (_) { return false; }
    return context.state === 'running';
  }

  async function unlock() {
    if (destroyed) return false;
    unlocked = true;
    if (!ensureGraph()) return false;
    return reconcileLifecycle();
  }

  function finishVoice(voice) {
    if (!voice || !activeVoices.has(voice.id)) return;
    activeVoices.delete(voice.id);
    if (voice.timer !== null) {
      clock.clearTimeout(voice.timer);
      voiceTimers.delete(voice.timer);
    }
    for (const source of voice.sources) stop(source);
    for (const node of voice.nodes) disconnect(node);
  }

  function addEnvelope(gainNode, gain, start, duration, attack = 0.015) {
    setValue(gainNode.gain, 0.0001, start);
    ramp(gainNode.gain, Math.max(0.0001, gain), start + attack);
    ramp(gainNode.gain, 0.0001, start + duration, true);
  }

  function addTone(voice, { type = 'sine', frequency, endFrequency = frequency,
    gain = 0.2, delay = 0, duration = 0.3, filterFrequency = null }) {
    const startAt = (context.currentTime || 0) + delay;
    const oscillator = context.createOscillator();
    const amplitude = createGain(0.0001);
    oscillator.type = type;
    setValue(oscillator.frequency, Math.max(1, frequency), startAt);
    ramp(oscillator.frequency, Math.max(1, endFrequency), startAt + duration, true);
    addEnvelope(amplitude, gain, startAt, duration);
    let tail = oscillator;
    if (filterFrequency && typeof context.createBiquadFilter === 'function') {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      setValue(filter.frequency, filterFrequency, startAt);
      oscillator.connect(filter);
      tail = filter;
      voice.nodes.push(filter);
    }
    tail.connect(amplitude);
    amplitude.connect(graph.sfx);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.03);
    voice.sources.push(oscillator);
    voice.nodes.push(amplitude);
  }

  function addNoise(voice, { gain = 0.12, delay = 0, duration = 0.4,
    filterType = 'bandpass', frequency = 900 }) {
    const buffer = createNoiseBuffer();
    if (!buffer || typeof context.createBufferSource !== 'function') return;
    const startAt = (context.currentTime || 0) + delay;
    const source = context.createBufferSource();
    const amplitude = createGain(0.0001);
    source.buffer = buffer;
    let tail = source;
    if (typeof context.createBiquadFilter === 'function') {
      const filter = context.createBiquadFilter();
      filter.type = filterType;
      setValue(filter.frequency, frequency, startAt);
      source.connect(filter);
      tail = filter;
      voice.nodes.push(filter);
    }
    addEnvelope(amplitude, gain, startAt, duration, 0.008);
    tail.connect(amplitude);
    amplitude.connect(graph.sfx);
    source.start(startAt);
    source.stop(startAt + duration + 0.03);
    voice.sources.push(source);
    voice.nodes.push(amplitude);
  }

  function buildRecipe(recipe, voice) {
    switch (recipe) {
      case 'fan-grind-down':
        addTone(voice, { type: 'sawtooth', frequency: 185, endFrequency: 31,
          gain: 0.16, duration: 0.82, filterFrequency: 620 });
        addNoise(voice, { gain: 0.075, duration: 0.75, filterType: 'lowpass', frequency: 700 });
        return 850;
      case 'relay-snap':
        addNoise(voice, { gain: 0.21, duration: 0.055, filterType: 'highpass', frequency: 1700 });
        addTone(voice, { type: 'square', frequency: 145, endFrequency: 72,
          gain: 0.12, duration: 0.075 });
        return 110;
      case 'coolant-hiss':
        addNoise(voice, { gain: 0.18, duration: 0.9, filterType: 'bandpass', frequency: 1300 });
        addTone(voice, { type: 'sine', frequency: 220, endFrequency: 105,
          gain: 0.035, duration: 0.7 });
        return 950;
      case 'transformer-thump':
        addTone(voice, { type: 'sine', frequency: 74, endFrequency: 24,
          gain: 0.34, duration: 0.42 });
        addNoise(voice, { gain: 0.065, duration: 0.18, filterType: 'lowpass', frequency: 240 });
        return 460;
      case 'repair-servo':
        addTone(voice, { type: 'sawtooth', frequency: 92, endFrequency: 270,
          gain: 0.085, duration: 0.22, filterFrequency: 900 });
        addTone(voice, { type: 'sawtooth', frequency: 260, endFrequency: 115,
          gain: 0.075, delay: 0.24, duration: 0.24, filterFrequency: 900 });
        return 520;
      case 'repair-tool':
        addNoise(voice, { gain: 0.095, duration: 0.13, filterType: 'highpass', frequency: 2100 });
        addTone(voice, { type: 'square', frequency: 620, endFrequency: 410,
          gain: 0.045, duration: 0.1 });
        return 180;
      default:
        return 0;
    }
  }

  function playRecipe(recipe, event) {
    if (!unlocked || !graphCreated || context?.state !== 'running' || settings.sfxMuted) {
      diagnostics.lockedSuppressed += 1;
      return false;
    }
    const now = clock.now();
    const cooldownKey = `${recipe}:${event?.entityId || 'global'}`;
    const previous = cooldowns.get(cooldownKey);
    if (previous !== undefined && now - previous < RECIPE_COOLDOWNS[recipe]) {
      diagnostics.cooldownSuppressed += 1;
      return false;
    }
    if (activeVoices.size >= MAX_POLYPHONY) {
      diagnostics.polyphonyDropped += 1;
      return false;
    }
    const voice = { id: nextVoiceId, recipe, sources: [], nodes: [], timer: null };
    nextVoiceId += 1;
    activeVoices.set(voice.id, voice);
    try {
      const duration = buildRecipe(recipe, voice);
      if (!duration) {
        finishVoice(voice);
        return false;
      }
      cooldowns.set(cooldownKey, now);
      diagnostics.playedByRecipe[recipe] += 1;
      diagnostics.lastRecipes.push({ recipe, eventId: eventKey(event), entityId: event?.entityId || null });
      diagnostics.lastRecipes.splice(0, Math.max(0, diagnostics.lastRecipes.length - 20));
      diagnostics.peakPolyphony = Math.max(diagnostics.peakPolyphony, activeVoices.size);
      voice.timer = clock.setTimeout(() => finishVoice(voice), duration + 120);
      voiceTimers.add(voice.timer);
      return true;
    } catch (_) {
      finishVoice(voice);
      return false;
    }
  }

  function setScoreState(nextState) {
    if (!SCORE_STATES.includes(nextState) || nextState === scoreState) return;
    previousScoreState = scoreState;
    scoreState = nextState;
    for (const name of SCORE_STATES) {
      crossfade(layerBuses.get(name)?.gain, name === scoreState ? 0.9 : 0.0001, context);
    }
  }

  function rememberEvent(key) {
    if (seenEvents.has(key)) return false;
    seenEvents.add(key);
    seenEventOrder.push(key);
    if (seenEventOrder.length > 256) seenEvents.delete(seenEventOrder.shift());
    return true;
  }

  function consumeEvents(snapshot, events) {
    const tick = Number(snapshot?.ticks?.completed ?? snapshot?.ticks?.raw ?? 0);
    for (const event of Array.isArray(events) ? events : []) {
      if (!rememberEvent(eventKey(event))) continue;
      if (['structure.placed', 'cell.claimed', 'ai.repair-started', 'ai.repair-progressed']
        .includes(event.type)) holds.buildingUntil = Math.max(holds.buildingUntil, tick + 8);
      if (['ai.level-up', 'text-trained', 'agent-created', 'job-completed', 'human-hired']
        .includes(event.type)) holds.breakthroughUntil = Math.max(holds.breakthroughUntil, tick + 12);
      for (const recipe of recipesForEvent(event, snapshot)) playRecipe(recipe, event);
    }
  }

  function commit(snapshot, events = []) {
    if (destroyed || !snapshot) return inspect();
    const tick = Number(snapshot?.ticks?.completed ?? snapshot?.ticks?.raw ?? 0);
    if (snapshot.seed !== lastSeed || tick < lastCommittedTick) {
      seenEvents.clear();
      seenEventOrder.splice(0);
      holds.buildingUntil = -1;
      holds.breakthroughUntil = -1;
    }
    lastSeed = snapshot.seed ?? null;
    lastCommittedTick = tick;
    consumeEvents(snapshot, events);
    setScoreState(scoreStateFor(snapshot, holds));
    return inspect();
  }

  function setVolumes({ music, sfx } = {}) {
    if (music !== undefined) settings.musicVolume = clamp(music);
    if (sfx !== undefined) settings.sfxVolume = clamp(sfx);
    updateMix();
    saveSettings();
    return inspect();
  }

  function setMuted({ music, sfx } = {}) {
    if (music !== undefined) settings.musicMuted = Boolean(music);
    if (sfx !== undefined) settings.sfxMuted = Boolean(sfx);
    updateMix();
    saveSettings();
    return inspect();
  }

  function setVisibility(isHidden) {
    hidden = Boolean(isHidden);
    void reconcileLifecycle();
    return inspect();
  }

  function setPageSuspended(isSuspended) {
    pageSuspended = Boolean(isSuspended);
    void reconcileLifecycle();
    return inspect();
  }

  function attachLifecycle(documentTarget = globalThis.document, windowTarget = globalThis.window) {
    if (!documentTarget || !windowTarget || destroyed) return () => {};
    hidden = documentTarget.visibilityState === 'hidden';
    const onGesture = () => { void unlock(); };
    const onKey = (event) => {
      void unlock();
      if (event.code !== 'KeyM' || event.repeat) return;
      if (event.shiftKey) setMuted({ sfx: !settings.sfxMuted });
      else setMuted({ music: !settings.musicMuted });
    };
    const onVisibility = () => setVisibility(documentTarget.visibilityState === 'hidden');
    const onPageHide = () => setPageSuspended(true);
    const onPageShow = () => setPageSuspended(false);
    documentTarget.addEventListener('pointerdown', onGesture, { passive: true });
    documentTarget.addEventListener('keydown', onKey);
    documentTarget.addEventListener('visibilitychange', onVisibility);
    windowTarget.addEventListener('pagehide', onPageHide);
    windowTarget.addEventListener('pageshow', onPageShow);
    const cleanup = () => {
      documentTarget.removeEventListener('pointerdown', onGesture);
      documentTarget.removeEventListener('keydown', onKey);
      documentTarget.removeEventListener('visibilitychange', onVisibility);
      windowTarget.removeEventListener('pagehide', onPageHide);
      windowTarget.removeEventListener('pageshow', onPageShow);
    };
    lifecycleCleanups.push(cleanup);
    return cleanup;
  }

  function inspect() {
    return {
      version: 1,
      supported: Boolean(context || globalThis.AudioContext || globalThis.webkitAudioContext),
      contextState: context?.state || 'uninitialized',
      lifecycle: { unlocked, hidden, pageSuspended, destroyed },
      mix: {
        music: { volume: settings.musicVolume, muted: settings.musicMuted,
          effective: settings.musicMuted ? 0 : settings.musicVolume },
        sfx: { volume: settings.sfxVolume, muted: settings.sfxMuted,
          effective: settings.sfxMuted ? 0 : settings.sfxVolume },
      },
      score: {
        state: scoreState,
        previousState: previousScoreState,
        transitionMs: SCORE_TRANSITION_SECONDS * 1000,
        layerTargets: Object.fromEntries(SCORE_STATES.map((name) => [name, name === scoreState ? 1 : 0])),
        loopsCreated: musicSources.length,
        activeLoops: destroyed ? 0 : musicSources.length,
      },
      sfx: {
        activeVoices: activeVoices.size,
        maxPolyphony: MAX_POLYPHONY,
        pendingCleanupTimers: voiceTimers.size,
        ...diagnostics,
        playedByRecipe: { ...diagnostics.playedByRecipe },
        lastRecipes: diagnostics.lastRecipes.map((item) => ({ ...item })),
      },
      lastCommittedTick,
    };
  }

  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    while (lifecycleCleanups.length) lifecycleCleanups.pop()();
    for (const voice of [...activeVoices.values()]) finishVoice(voice);
    for (const item of musicSources) {
      stop(item.source);
      item.nodes.forEach(disconnect);
    }
    musicSources.splice(0);
    layerBuses.forEach(disconnect);
    layerBuses.clear();
    disconnect(graph.music);
    disconnect(graph.sfx);
    disconnect(graph.master);
    try { await context?.close?.(); } catch (_) { /* page teardown */ }
  }

  return Object.freeze({
    commit,
    unlock,
    setVolumes,
    setMuted,
    setVisibility,
    setPageSuspended,
    attachLifecycle,
    inspect,
    destroy,
  });
}

export { SCORE_STATES };
