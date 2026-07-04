# Research tree + palette overhaul (design spec)

Tyler's session asks, rolled into one UX/depth pass: the Maintain allocation
was getting clipped (palette overflow 101px in late-game states), floors need
a rebuild button, incompatible tiles must be visibly disabled in space, and —
the big one — **"all of the space tech needs its own research tree…
we're being lazy by not adding new feature DETAILS."** First real step of #54.

## 1. 🔬 Research Tree modal

Research leaves the cramped palette for a full-screen modal (reuses the modal
pattern). The palette keeps one button: `🔬 Research · N RP`.

**CORE branch** (existing): ⚡ Power, ❄️ Cooling, 🧮 Compute, 🔧 Durability —
now each with a desc line explaining what a level actually does.

**🛰 SPACE branch** (locked until the Dyson blueprint) — every space system
gets a dial:

| Track | Effect per level | Costs (RP) |
|---|---|---|
| 🛡 Rad-hard Shielding | space wear ×0.8 | 120 / 400 |
| ♨ Radiator Alloys | vacuum wall bonus +0.25 (1.5→1.75→2.0) | 100 / 350 |
| 🫧 Closed-loop Recyclers | life-support range +1 (2→3→4) | 90 / 300 |
| ☀ Orbital Panels | space solar ×+0.2 (1.3→1.5→1.7) | 80 / 280 |

All wired through small accessor functions so effects apply live; old saves
backfill missing tech keys at level 0 (existing loader loop).

## 2. 🔧 Maintain becomes an allocation

The old Finance radios (0/10/25% of gross) are replaced by a sixth normalized
allocation slider: the Maintain slice of compute is sold and its proceeds fill
the repair pool (same pattern as UBI). Matches the player's mental model
("allocation into maintaining things") and can't be clipped off-screen.
Legacy `maintainShare` is dropped from saves; `maintainPool` persists.

## 3. Palette: 4-column icon grid

Tool buttons compact to icon + cost (name/stats already live in the hover
tooltip): 20 tools in 5 rows instead of 10. Combined with research moving to
the modal, the palette now fits with all late-game elements visible — a new
worst-case layout test pins this.

## 4. 🏗 Floor overhaul

A warning-colored `🏗 Overhaul` button lives at the end of the floor tab bar
(now always visible): bulldozes every tile on the ACTIVE floor at the standard
50% refund after a confirm. The floor and its topology stay owned.

## 5. 🚫 Space-incompatible tiles disabled in the palette

On station floors, Fan Wall and Power Plant render disabled with 🚫 and a
"no air to move / no oxygen to burn" tooltip + ticker. The palette rebuilds on
floor switch so availability always matches physics.

## Verification

pytest: maintain slider fills pool and heals; fin-maint gone; six sliders;
overhaul refunds 50% and clears the active floor only; blocked tiles disabled
on station and re-enabled on Earth; research modal opens, buys core + space
tracks; each space track's effect verified (wear/wall/range/solar deltas);
worst-case palette layout fits; save roundtrips new tech keys; zero errors.
