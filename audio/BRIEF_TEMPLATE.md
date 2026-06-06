# Audio Brief — `<game name>`

Fill this out before generating any audio. Save the completed brief to `<project>/audio/BRIEF.md`.

## Game

- **Title:**
- **Genre:**
- **Setting / theme (1 sentence):**
- **Player's emotional arc (early → late):**
- **Session length (minutes the player typically hears the music):**

## Vibe

- **Primary direction:** (Hopeful ambient | Dark hypnotic pulse | Sci-fi cinematic | Lo-fi tech-house | Custom: _____)
- **Three adjectives that describe the sound:**
- **Three adjectives that describe what it should NOT be:**
- **Reference tracks or composers (if any):**
- **Tempo (BPM range):**
- **Key / mode (if user has preference):** (Minor for menace, major for hope, modal for "weird" — Phrygian = sci-fi tension, Dorian = thoughtful, Lydian = wonder)

## Scope

- **Tracks to deliver:**
  - [ ] Main loop (always)
  - [ ] Title screen variant
  - [ ] Early-game sparse layer
  - [ ] Late-game dense layer
  - [ ] Tension / warning layer
  - [ ] Victory sting
  - [ ] Game-over sting
  - [ ] Other: _____
- **Estimated total runtime (minutes of unique music):**

## Architecture

- **Adaptive layers?** Yes / No
- **Layer triggers (if yes):** What game state turns each layer on/off?
  - Example: `tension_layer` fades in when `unalignment > 0.6`
- **Pause behavior:** Suspend on tab blur? Yes / No
- **Master volume default:** (0.0–1.0)

## Generation Method

- [ ] Procedural Web Audio (no asset files, synthesized at runtime)
- [ ] Generated audio assets via video-model audio extraction
- [ ] User-provided audio
- [ ] Mixed (specify per layer): _____

## Constraints

- **Total audio bundle budget (KB):** (Procedural: <10 KB. Generated: 200–800 KB per track at 128 kbps.)
- **Sharing across projects?** If yes, where do the shared files live?
- **Browser-only?** Yes (uses Web Audio API). If desktop/mobile native needed, note here.

## Decisions Log

- _Date_ — _Decision_ — _Why_
