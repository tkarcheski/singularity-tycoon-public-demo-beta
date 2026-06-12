// Audio bootstrap for Singularity Tycoon Mini.
// Thin layer over GameAudio that registers the four procedural vibes,
// wires the music UI, and exposes a small API to the game script.
//
// Classic script (no modules) so the game runs straight from file:// —
// reads window.GameAudio + window.SynthRecipes, exposes window.GameMusic.

(() => {

const GameAudio = window.GameAudio;
const RECIPES = window.SynthRecipes;

const VIBES = {
  hopeful:    RECIPES.hopefulAmbient,
  dark:       RECIPES.darkHypnoticPulse,
  cinematic:  RECIPES.sciFiCinematic,
  lofi:       RECIPES.lofiTechHouse,
};

let audio = null;
let currentVibe = 'hopeful';

async function startAudio(initialVibe = 'hopeful') {
  if (audio?.isStarted) return audio;

  const startFactory = VIBES[initialVibe] ?? VIBES.hopeful;
  audio = new GameAudio({
    proceduralLayers: { base: startFactory, tension: RECIPES.tensionLayer },
    masterGain: 0.7,
  });
  await audio.start();
  // Bring the base layer up to full; tension stays silent until the game raises it
  audio.setLayerGain('base', 1.0, 1200);
  currentVibe = initialVibe;
  return audio;
}

// Adaptive intensity 0..1 — driven by entropy/mood each sim tick
function setTension(v01) {
  if (!audio?.isStarted) return;
  audio.setLayerGain('tension', Math.max(0, Math.min(1, v01)) * 0.6, 900);
}

// Procedural one-shots: breakdown, repair, cash, research, alarm, goal
function playStinger(name) {
  if (!audio?.isStarted) return;
  const fire = RECIPES.STINGERS[name];
  if (!fire) return;
  const g = audio.ctx.createGain();
  g.gain.value = 0.9;
  g.connect(audio.masterGain);
  fire(audio.ctx, g);
}

async function swapVibe(name, crossfadeMs = 1600) {
  if (!audio?.isStarted) return;
  const factory = VIBES[name];
  if (!factory || name === currentVibe) return;
  await audio.swapBaseLayer(name, factory, crossfadeMs);
  currentVibe = name;
}

function setMusicVolume(v01) {
  audio?.setMasterGain(v01);
}

function toggleMute() {
  audio?.toggleMute();
  return audio?._muted ?? false;
}

function getCurrentVibe() { return currentVibe; }
function isAudioStarted() { return audio?.isStarted ?? false; }

window.GameMusic = {
  startAudio,
  swapVibe,
  setMusicVolume,
  toggleMute,
  getCurrentVibe,
  isAudioStarted,
  setTension,
  playStinger,
};

})();
