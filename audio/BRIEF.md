# Audio Brief — Singularity Tycoon Mini

## Game

- **Title:** Singularity Tycoon — Mini
- **Genre:** Tycoon / idle / building
- **Setting:** Tiny AI data center; the small-scale prologue to *Singularity, Inc.*
- **Player's emotional arc:** Curious tinkering → confident scaling → quiet awe at the Dyson Sphere unlock
- **Session length:** 5–20 minutes typical

## Vibe

- **Primary direction (default):** Hopeful ambient (player-selectable at runtime — see below)
- **Adjectives that describe the sound:** patient, optimistic, hypnotic, spacious
- **What it should NOT be:** epic, urgent, percussive, melodramatic
- **Reference vibes:** Mindustry, Dyson Sphere Program, Frostpunk (for the "dark" alt)
- **Tempo:** Generative / no fixed BPM for ambient; ~88 BPM for lo-fi variant
- **Key/mode:** A minor pentatonic (hopeful), Eb minor sketch (dark)

## Scope

- **Tracks/recipes shipped:**
  - [x] Hopeful ambient (default base layer)
  - [x] Dark hypnotic pulse (player swap option)
  - [x] Sci-fi cinematic (player swap option)
  - [x] Lo-fi tech-house (player swap option)
- **Total unique runtime:** Infinite — all four are procedural (Web Audio synthesis, generative)

## Architecture

- **Adaptive layers?** Yes — `swapBaseLayer` crossfade between procedural recipes
- **Layer triggers:** Player-selected via the in-game Music panel
- **Pause behavior:** Suspend audio on tab blur (handled by `GameAudio`)
- **Master volume default:** 0.7

## Generation Method

- **Procedural Web Audio** — all four vibes synthesized at runtime
- Zero credit cost, ~12 KB of JS, perfect loops, infinite variation
- File-based MP3 path reserved for the full game (`act2_orbit`, `quantum_awakening` hero moments)

## Cross-Project Sharing

The two files `src/audio/audio-engine.js` and `src/audio/synth-recipes.js` are the canonical implementation. When the full *Singularity, Inc.* game integrates audio, it imports these same files. The full game extends them with file-based stems for cinematic moments — the engine API is unchanged.

## Decisions Log

- **2026-06-06** — Default to procedural over generated MP3s because the game has long sessions and zero-cost iteration is the right tradeoff for a vibes prototype. — *Tyler asked for runtime swappability, which procedural enables and file-based makes painful in a sandboxed iframe.*
