// Audio bootstrap for Singularity Tycoon Mini.
// Thin layer over GameAudio that registers the four procedural vibes,
// wires the music UI, and exposes a small API to the game module.

import { GameAudio } from './audio-engine.js';
import { RECIPES } from './synth-recipes.js';

const VIBES = {
  hopeful:    RECIPES.hopefulAmbient,
  dark:       RECIPES.darkHypnoticPulse,
  cinematic:  RECIPES.sciFiCinematic,
  lofi:       RECIPES.lofiTechHouse,
};

let audio = null;
let currentVibe = 'hopeful';

export async function startAudio(initialVibe = 'hopeful') {
  if (audio?.isStarted) return audio;

  const startFactory = VIBES[initialVibe] ?? VIBES.hopeful;
  audio = new GameAudio({
    proceduralLayers: { base: startFactory },
    masterGain: 0.7,
  });
  await audio.start();
  // Bring the base layer up to full
  audio.setLayerGain('base', 1.0, 1200);
  currentVibe = initialVibe;
  return audio;
}

export async function swapVibe(name, crossfadeMs = 1600) {
  if (!audio?.isStarted) return;
  const factory = VIBES[name];
  if (!factory || name === currentVibe) return;
  await audio.swapBaseLayer(name, factory, crossfadeMs);
  currentVibe = name;
}

export function setMusicVolume(v01) {
  audio?.setMasterGain(v01);
}

export function toggleMute() {
  audio?.toggleMute();
  return audio?._muted ?? false;
}

export function getCurrentVibe() { return currentVibe; }
export function isAudioStarted() { return audio?.isStarted ?? false; }
