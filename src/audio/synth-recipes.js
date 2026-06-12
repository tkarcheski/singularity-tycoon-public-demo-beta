// Procedural Web Audio recipes — one per vibe in the SKILL.md questionnaire.
//
// Each recipe is a factory: function(ctx, outputNode) -> stopFn
// Pass these into GameAudio's `proceduralLayers` option.
//
// Recipes:
//   - hopefulAmbient      (Mindustry / Dyson Sphere Program)
//   - darkHypnoticPulse   (Frostpunk / Factorio)
//   - sciFiCinematic      (cosmic, choir pads)
//   - lofiTechHouse       (work music)
//
// Helpers at the bottom.
//
// Classic script (no modules) so the game runs straight from file:// —
// exposes window.SynthRecipes.

(() => {

function hopefulAmbient(ctx, out) {
  // A minor pentatonic, slow random walk, generous reverb
  const SCALE = [220, 261.63, 329.63, 392, 440, 523.25, 659.25];
  const reverb = makeReverb(ctx, 4.0, 2.2);
  reverb.connect(out);

  // Sub bass drone
  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.value = 55; // low A
  subGain.gain.value = 0.10;
  sub.connect(subGain).connect(out);
  sub.start();

  let nextTime = ctx.currentTime + 0.2;
  const step = 1.6;
  let lastIdx = 2;

  const scheduler = setInterval(() => {
    while (nextTime < ctx.currentTime + 0.8) {
      // Random walk, ±2 steps
      lastIdx = Math.max(0, Math.min(SCALE.length - 1, lastIdx + Math.floor(Math.random() * 5) - 2));
      const freq = SCALE[lastIdx];
      playPad(ctx, reverb, freq, nextTime, 3.4, 0.07);
      if (Math.random() < 0.22) playPad(ctx, reverb, freq * 2, nextTime + 0.4, 1.8, 0.04);
      nextTime += step;
    }
  }, 120);

  return () => {
    clearInterval(scheduler);
    sub.stop();
  };
}

function darkHypnoticPulse(ctx, out) {
  // Throbbing low sawtooth, gated by an LFO, no melody — pure menace
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 380;
  filt.Q.value = 6;
  const reverb = makeReverb(ctx, 2.0, 3.0);
  filt.connect(reverb).connect(out);

  const drone = ctx.createOscillator();
  const droneG = ctx.createGain();
  drone.type = 'sawtooth';
  drone.frequency.value = 65.4; // C2
  droneG.gain.value = 0.18;
  drone.connect(droneG).connect(filt);
  drone.start();

  // Throb LFO on filter
  const lfo = ctx.createOscillator();
  const lfoG = ctx.createGain();
  lfo.frequency.value = 0.5; // half-Hz pulse
  lfoG.gain.value = 220;
  lfo.connect(lfoG).connect(filt.frequency);
  lfo.start();

  // Sparse high pings — pentatonic minor
  const PINGS = [311.13, 415.30, 466.16, 622.25]; // Eb minor sketch
  let nextTime = ctx.currentTime + 4;
  const scheduler = setInterval(() => {
    while (nextTime < ctx.currentTime + 0.8) {
      if (Math.random() < 0.4) {
        const freq = PINGS[Math.floor(Math.random() * PINGS.length)];
        playPing(ctx, reverb, freq, nextTime, 0.9, 0.04);
      }
      nextTime += 4.0;
    }
  }, 200);

  return () => {
    clearInterval(scheduler);
    drone.stop();
    lfo.stop();
  };
}

function sciFiCinematic(ctx, out) {
  // Big detuned pad stack, slow chord changes
  const reverb = makeReverb(ctx, 6.0, 1.8);
  reverb.connect(out);
  const CHORDS = [
    [196, 246.94, 293.66, 349.23], // Gm
    [174.61, 220, 261.63, 329.63], // Fmaj7-ish
    [164.81, 207.65, 246.94, 311.13], // Eb
    [196, 246.94, 311.13, 392],    // Gm extended
  ];
  let ci = 0;
  let nextChord = ctx.currentTime + 0.5;

  const scheduler = setInterval(() => {
    if (nextChord < ctx.currentTime + 1.5) {
      const chord = CHORDS[ci % CHORDS.length];
      ci++;
      for (const f of chord) {
        playPad(ctx, reverb, f, nextChord, 8.5, 0.05);
        playPad(ctx, reverb, f * 1.005, nextChord, 8.5, 0.03); // detuned twin
      }
      nextChord += 6.5;
    }
  }, 300);

  return () => clearInterval(scheduler);
}

function lofiTechHouse(ctx, out) {
  // Soft kick on beat, hat off, vinyl noise, light pad
  const reverb = makeReverb(ctx, 1.5, 1.6);
  reverb.connect(out);

  // Vinyl noise
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.05;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const noiseG = ctx.createGain();
  noiseG.gain.value = 0.06;
  const noiseFilt = ctx.createBiquadFilter();
  noiseFilt.type = 'highpass';
  noiseFilt.frequency.value = 3000;
  noise.connect(noiseFilt).connect(noiseG).connect(out);
  noise.start();

  const BPM = 88;
  const beat = 60 / BPM;
  let nextBeat = ctx.currentTime + 0.5;
  let bar = 0;

  const scheduler = setInterval(() => {
    while (nextBeat < ctx.currentTime + 0.8) {
      // Kick on 1, 3
      if (bar % 2 === 0) playKick(ctx, out, nextBeat);
      // Off-beat hat
      playHat(ctx, out, nextBeat + beat * 0.5);
      // Pad chord every 8 beats
      if (bar % 8 === 0) {
        for (const f of [220, 261.63, 329.63]) playPad(ctx, reverb, f, nextBeat, 4, 0.04);
      }
      nextBeat += beat;
      bar++;
    }
  }, 80);

  return () => {
    clearInterval(scheduler);
    noise.stop();
  };
}

// --- helpers ---

function playPad(ctx, out, freq, when, dur, peak) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filt = ctx.createBiquadFilter();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.detune.value = (Math.random() - 0.5) * 6;
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(600, when);
  filt.frequency.linearRampToValueAtTime(2200, when + dur * 0.35);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + dur * 0.4);
  gain.gain.linearRampToValueAtTime(0, when + dur);
  osc.connect(filt).connect(gain).connect(out);
  osc.start(when);
  osc.stop(when + dur + 0.1);
}

function playPing(ctx, out, freq, when, dur, peak) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(gain).connect(out);
  osc.start(when);
  osc.stop(when + dur + 0.05);
}

function playKick(ctx, out, when) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.setValueAtTime(120, when);
  osc.frequency.exponentialRampToValueAtTime(40, when + 0.15);
  g.gain.setValueAtTime(0.25, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
  osc.connect(g).connect(out);
  osc.start(when);
  osc.stop(when + 0.2);
}

function playHat(ctx, out, when) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = 6000;
  const g = ctx.createGain();
  g.gain.value = 0.08;
  src.connect(filt).connect(g).connect(out);
  src.start(when);
}

// --- adaptive tension layer ---
// Runs continuously but silent; the game drives its gain from entropy/mood.
// Dissonant high shimmer over an uneasy low pulse — dread, not melody.
function tensionLayer(ctx, out) {
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = 1800;
  filt.Q.value = 8;
  filt.connect(out);

  // Shimmer: two detuned high sines beating against each other
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  const shimmerG = ctx.createGain();
  oscA.frequency.value = 1244; // D#6-ish
  oscB.frequency.value = 1251; // ~7 Hz beat
  shimmerG.gain.value = 0.05;
  oscA.connect(shimmerG); oscB.connect(shimmerG);
  shimmerG.connect(filt);
  oscA.start(); oscB.start();

  // Uneasy low pulse on a tritone
  const pulse = ctx.createOscillator();
  const pulseG = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lfoG = ctx.createGain();
  pulse.type = 'triangle';
  pulse.frequency.value = 92.5; // F#2 — tritone vs C
  pulseG.gain.value = 0;
  lfo.frequency.value = 1.1;
  lfoG.gain.value = 0.12;
  lfo.connect(lfoG).connect(pulseG.gain);
  pulse.connect(pulseG).connect(out);
  pulse.start(); lfo.start();

  return () => { oscA.stop(); oscB.stop(); pulse.stop(); lfo.stop(); };
}

// --- stingers ---
// Short procedural one-shots: function(ctx, out) fires immediately.
const STINGERS = {
  breakdown(ctx, out) { // falling saw thud — something just died
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.35);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g).connect(out);
    osc.start(t); osc.stop(t + 0.55);
  },
  repair(ctx, out) { // two-note chime up — fixed
    playPing(ctx, out, 523.25, ctx.currentTime, 0.4, 0.1);
    playPing(ctx, out, 783.99, ctx.currentTime + 0.12, 0.5, 0.1);
  },
  cash(ctx, out) { // bright coin blips — money moved
    playPing(ctx, out, 987.77, ctx.currentTime, 0.15, 0.09);
    playPing(ctx, out, 1318.5, ctx.currentTime + 0.08, 0.25, 0.09);
  },
  research(ctx, out) { // rising arpeggio — tech unlocked
    const t = ctx.currentTime;
    [440, 554.37, 659.25, 880].forEach((f, i) => playPing(ctx, out, f, t + i * 0.09, 0.35, 0.08));
  },
  alarm(ctx, out) { // dissonant double blip — entropy strikes
    const t = ctx.currentTime;
    playPing(ctx, out, 622.25, t, 0.18, 0.1);
    playPing(ctx, out, 587.33, t + 0.1, 0.25, 0.1);
  },
  goal(ctx, out) { // major fanfare — Dyson Sphere unlocked
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => playPing(ctx, out, f, t + i * 0.13, 0.9, 0.11));
    playPing(ctx, out, 1318.5, t + 0.55, 1.4, 0.09);
  },
};

function makeReverb(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const ch = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  const node = ctx.createConvolver();
  node.buffer = impulse;
  return node;
}

window.SynthRecipes = {
  hopefulAmbient,
  darkHypnoticPulse,
  sciFiCinematic,
  lofiTechHouse,
  tensionLayer,
  STINGERS,
};

})();
