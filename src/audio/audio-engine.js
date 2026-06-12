// Game Audio Engine — adaptive layer system for browser games.
// Works in sandboxed iframes (uses <audio> elements for binary loading).
// No localStorage, no fetch() of binary assets.
//
// Usage:
//
//   import { GameAudio } from './audio.js';
//
//   const audio = new GameAudio({
//     basePath: './audio/',
//     layers: {
//       base:    { src: 'main_v1.mp3',    loop: true, gain: 1.0 },
//       tension: { src: 'tension_v1.mp3', loop: true, gain: 0.0 },
//     },
//     oneShots: {
//       victory: { src: 'sting_victory.mp3' },
//     },
//     // OR procedural layers:
//     proceduralLayers: {
//       pad: (ctx, out) => startAmbientPad(ctx, out),
//     },
//   });
//
//   // Inside a user-gesture handler:
//   await audio.start();
//
//   // From game loop:
//   audio.setLayerGain('tension', stress);
//
//   // From event:
//   audio.playOneShot('victory');
//
// Classic script (no modules) so the game runs straight from file:// —
// exposes window.GameAudio.

window.GameAudio = class GameAudio {
  constructor(opts = {}) {
    this.basePath = opts.basePath ?? './';
    this.layerDefs = opts.layers ?? {};
    this.oneShotDefs = opts.oneShots ?? {};
    this.proceduralDefs = opts.proceduralLayers ?? {};
    this.masterGainValue = opts.masterGain ?? 0.7;
    this._muted = false;
    this.isStarted = false;

    this.ctx = null;
    this.masterGain = null;
    this.layers = new Map(); // name -> { node: GainNode, audio?: HTMLAudioElement, stopProc?: fn }
    this.oneShots = new Map(); // name -> HTMLAudioElement (pooled clones below)
    this._oneShotPools = new Map(); // name -> Array<HTMLAudioElement>

    // Pause when tab hidden — preserves battery, prevents drift
    this._visHandler = () => {
      if (document.hidden) this.suspend();
      else this.resume();
    };
  }

  async start() {
    if (this.isStarted) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._muted ? 0 : this.masterGainValue;
    this.masterGain.connect(this.ctx.destination);

    // File-based layers
    for (const [name, def] of Object.entries(this.layerDefs)) {
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.loop = !!def.loop;
      el.preload = 'auto';
      el.src = this.basePath + def.src;
      // Create MediaElementSource and a per-layer gain
      const src = this.ctx.createMediaElementSource(el);
      const gain = this.ctx.createGain();
      gain.gain.value = def.gain ?? 0;
      src.connect(gain).connect(this.masterGain);

      // Begin playback (will be quiet if gain=0)
      try { await el.play(); } catch (e) { console.warn('audio play failed', name, e); }
      this.layers.set(name, { node: gain, audio: el });
    }

    // Procedural layers — each is a function(ctx, outNode) returning a stop fn
    for (const [name, factory] of Object.entries(this.proceduralDefs)) {
      const gain = this.ctx.createGain();
      gain.gain.value = 0; // start silent; caller sets gain
      gain.connect(this.masterGain);
      const stopProc = factory(this.ctx, gain);
      this.layers.set(name, { node: gain, stopProc });
    }

    // One-shots — pool of 4 clones each so rapid retrigger doesn't cut off
    for (const [name, def] of Object.entries(this.oneShotDefs)) {
      const pool = [];
      for (let i = 0; i < 4; i++) {
        const el = new Audio();
        el.crossOrigin = 'anonymous';
        el.src = this.basePath + def.src;
        el.preload = 'auto';
        const src = this.ctx.createMediaElementSource(el);
        const gain = this.ctx.createGain();
        gain.gain.value = def.gain ?? 0.9;
        src.connect(gain).connect(this.masterGain);
        pool.push({ el, gain });
      }
      this._oneShotPools.set(name, pool);
    }

    document.addEventListener('visibilitychange', this._visHandler);
    this.isStarted = true;
  }

  setLayerGain(name, target, rampMs = 600) {
    const layer = this.layers.get(name);
    if (!layer || !this.ctx) return;
    const t = this.ctx.currentTime;
    const g = layer.node.gain;
    const clamped = Math.max(0, Math.min(1, target));
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(clamped, t + rampMs / 1000);
  }

  playOneShot(name, opts = {}) {
    const pool = this._oneShotPools.get(name);
    if (!pool) return;
    // Find an idle clone; otherwise the oldest
    let chosen = pool.find((p) => p.el.paused || p.el.ended);
    if (!chosen) chosen = pool[0];
    chosen.el.currentTime = 0;
    chosen.el.play().catch(() => {});
    // Optional ducking — temporarily lower base layer
    if (opts.duck !== false) this._duck(opts.duckAmount ?? 0.3, opts.duckMs ?? 400);
  }

  _duck(amount, ms) {
    const base = this.layers.get('base');
    if (!base || !this.ctx) return;
    const t = this.ctx.currentTime;
    const g = base.node.gain;
    const current = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(current, t);
    g.linearRampToValueAtTime(current * (1 - amount), t + 0.08);
    g.linearRampToValueAtTime(current, t + ms / 1000);
  }

  setMasterGain(v) {
    this.masterGainValue = Math.max(0, Math.min(1, v));
    if (this.masterGain && !this._muted) {
      this.masterGain.gain.linearRampToValueAtTime(
        this.masterGainValue,
        this.ctx.currentTime + 0.1,
      );
    }
  }

  mute() {
    this._muted = true;
    if (this.masterGain) {
      this.masterGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
    }
  }
  unmute() {
    this._muted = false;
    if (this.masterGain) {
      this.masterGain.gain.linearRampToValueAtTime(
        this.masterGainValue,
        this.ctx.currentTime + 0.1,
      );
    }
  }
  toggleMute() { this._muted ? this.unmute() : this.mute(); }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // Swap the procedural base layer to a different recipe, crossfading.
  // The new recipe is started silent; the old layer is faded out then stopped.
  // Both factories must accept (ctx, outputNode) and return a stop function.
  async swapBaseLayer(name, factory, crossfadeMs = 1500) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const oldLayer = this.layers.get('base');

    // Build the new layer at the same gain target as the old base
    const newGain = this.ctx.createGain();
    newGain.gain.value = 0;
    newGain.connect(this.masterGain);
    const newStop = factory(this.ctx, newGain);
    const targetGain = oldLayer ? oldLayer.node.gain.value : 1.0;
    newGain.gain.linearRampToValueAtTime(targetGain, t + crossfadeMs / 1000);

    // Fade out the old layer over the same window, then stop it
    if (oldLayer) {
      oldLayer.node.gain.cancelScheduledValues(t);
      oldLayer.node.gain.setValueAtTime(oldLayer.node.gain.value, t);
      oldLayer.node.gain.linearRampToValueAtTime(0, t + crossfadeMs / 1000);
      // Clean up after the fade completes
      setTimeout(() => {
        if (oldLayer.stopProc) oldLayer.stopProc();
        if (oldLayer.audio) { oldLayer.audio.pause(); oldLayer.audio.src = ''; }
        try { oldLayer.node.disconnect(); } catch (_) {}
      }, crossfadeMs + 100);
    }

    this.layers.set('base', { node: newGain, stopProc: newStop });
    this.currentBaseName = name;
  }

  destroy() {
    document.removeEventListener('visibilitychange', this._visHandler);
    for (const [, layer] of this.layers) {
      if (layer.audio) { layer.audio.pause(); layer.audio.src = ''; }
      if (layer.stopProc) layer.stopProc();
    }
    if (this.ctx) this.ctx.close();
    this.isStarted = false;
  }
};
