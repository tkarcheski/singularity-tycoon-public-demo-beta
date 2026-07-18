# Connected Datacenter Art Direction

Status: implementation contract for #108, with #95, #97, #105, #106, and
#109 as downstream consumers.

## Read order

The floor must read in this order at gameplay distance:

1. owned, frontier, and locked territory;
2. machines, humans, robots, and current work;
3. a selected resource or endpoint;
4. local faults, overloads, and repairs;
5. ambient material detail.

Background texture, utility decoration, and cosmetic motion must never outrank
an actor, a selected build target, or a failure.

## Camera and scale

- Fixed top-down three-quarter impression inside a square tile; no perspective
  distortion that changes placement coordinates.
- One facility remains the central silhouette while power, cooling, data, and
  AI occupy narrow edge channels above/below the equipment plane.
- Tile seams and fasteners establish scale. Small decals, vents, service
  channels, and wear may vary cosmetically but never resemble connections.
- Humans, robots, and computers keep stable anchors so state changes do not
  look like teleportation.

## Material language

- Floor plate: dark graphite composite, recessed seams, cool metal fasteners.
- Structural channel: blackened steel with low cyan environmental reflection.
- Power: warm yellow copper/ceramic details.
- Cooling: cold cyan metal, condensation only during real delivery or leaks.
- Data: violet optical accents with discrete packet markers in edit mode.
- AI: magenta control trace, visually thinner and more precise than data.
- Fault: desaturated gray smoke plus fault-specific red/orange accents.
- Repair: white/cyan task light and short warm tool sparks.

## Palette and lighting

The neutral world uses blue-black values so semantic colors have headroom.
Ambient light is cool and directional; productive equipment adds a local pool
of light, while idle equipment remains still and low-emission. Overload adds a
localized warm lower glow. Broken equipment loses its productive emission.

Semantic colors are never the only signal. Shape, position, text, line pattern,
and static reduced-motion markers carry the same meaning.

## Density modes

### Default

- Machines and actors dominate.
- Utility links are quiet tile-edge traces.
- No full-path flow animation.

### Build/edit

- The selected resource gains full contrast and directional motion.
- Legal ports and capacity delta appear.
- Other resources dim without disappearing semantically.

### Inspect

- One source-to-target chain and first bottleneck gain focus.
- Exact capacity, delivered amount, utilization, and headroom appear in text.

### Incident

- Fault VFX remain local to the broken entity.
- Smoke and sparks are bounded, event-driven, and stop on recovery.
- The broken reason and repair progress remain visible without motion/audio.

## Motion law

Still means idle. Motion means committed activity.

- Idle: no looping work animation.
- Starting/booting: short mechanical or screen sequence.
- Productive: localized fans, pumps, screens, task light, or actor motion.
- High load: faster authored machinery plus warmer local light.
- Throttled: visibly strained but slower productive result.
- Broken: productive animation stops; bounded smoke/flicker/spark state begins.
- Repairing: robot contacts the real target; task light/tool feedback ends on
  the recovery tick.

Decorative ambient motion may not make an idle tile look productive.

## Asset workflow

- Prefer code-native shapes for semantic routes, UI state, and elements that
  must scale or recolor accessibly.
- Use image-supported concept exploration for floor themes, material studies,
  equipment silhouettes, damage variants, and larger environmental set pieces.
- Curate generated references into consistent perspective, palette, scale, and
  anchors before they enter the game.
- Keep editable sources and record prompt/model/source provenance for every
  generated raster.
- Export game-ready PNG/WebP assets with stable names, bounded dimensions, and
  documented anchors. Missing assets must fall back without hiding state.

## Review frames

Every art pass ships screenshots at 1440×900 and 1100×700 for:

1. sparse opening footprint;
2. dense operational floor in default mode;
3. one active resource edit;
4. selected bottleneck inspection;
5. overload;
6. broken equipment and robot repair;
7. reduced motion;
8. forced colors/high contrast.

The pass fails if text clips, the floor heartbeat stalls, inactive networks
dominate the image, or a reviewer mistakes idle equipment for productive work.
