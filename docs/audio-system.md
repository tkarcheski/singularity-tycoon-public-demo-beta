# Audio System

All music is **synthesized at runtime** with Web Audio — there are no audio files in the repo. Four player-selectable "vibes" run as generative, infinite, perfectly-looping layers (~12 KB of JS total).

## The vibes

| Vibe | Recipe | Character |
|---|---|---|
| Hopeful *(default)* | `hopefulAmbient` | A-minor-pentatonic random-walk pads over a 55 Hz sine drone, long convolution reverb |
| Dark | `darkHypnoticPulse` | C2 sawtooth drone through an LFO-throbbed lowpass; sparse E♭-minor pings |
| Cinematic | `sciFiCinematic` | Detuned-twin pad stacks cycling four chords (Gm/F/E♭) on a 6.5 s period, 6 s reverb |
| Lo-fi | `lofiTechHouse` | 88 BPM kick/off-beat-hat, looped vinyl-noise bed, pad chord every 8 beats |

Each recipe is a factory `function(audioCtx, outputNode) → stopFn`. Schedulers use the look-ahead pattern (a `setInterval` that schedules ~0.8 s of events into the future on the audio clock), so timing stays sample-accurate even when the JS main thread hiccups.

## GameAudio engine (`src/audio/audio-engine.js`)

A small reusable adaptive-music engine, designed to outlive this prototype:

- **Layers** — named gain-staged channels under a master gain. Supports file-backed layers (`<audio>` element + `MediaElementSource`, sandbox-iframe-safe) and procedural layers (factory functions). Mini uses only procedural.
- **`swapBaseLayer(name, factory, ms)`** — equal-window crossfade: the new recipe starts silent and ramps up while the old ramps to zero, then is stopped and disconnected. This powers the in-game vibe switcher.
- **`setLayerGain` / `setMasterGain`** — click-free ramps via `linearRampToValueAtTime` with proper `cancelScheduledValues` hygiene.
- **One-shots** — pooled ×4 `<audio>` clones per sound with optional auto-ducking of the base layer (unused in Mini; reserved for the full game).
- **Autoplay policy** — `audio.start()` must be called from a user gesture; the game gates this behind the "Click to enable music" overlay.
- **Tab visibility** — the context suspends on `document.hidden` and resumes on return (battery + drift protection).

## Bootstrap (`src/audio/index.js`)

Maps vibe names → recipes and exposes `window.GameMusic` with the five functions the game uses: `startAudio`, `swapVibe`, `setMusicVolume`, `toggleMute`, `isAudioStarted`. The game script never touches the engine directly.

## Design brief

`audio/BRIEF.md` documents the intent: *patient, optimistic, hypnotic, spacious — NOT epic, urgent, percussive, melodramatic*, with Mindustry / Dyson Sphere Program / Frostpunk as reference points. The file-based MP3 path in the engine is reserved for hero moments in the full game.
