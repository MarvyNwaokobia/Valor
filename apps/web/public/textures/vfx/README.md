# Impact VFX sprites

Source: **Kenney Particle Pack** ([kenney.nl](https://kenney.nl/assets/particle-pack),
also on [kenney.itch.io](https://kenney.itch.io)), license **CC0** (public domain,
no attribution required — credited here anyway). Fetched from the
[Calinou/kenney-particle-pack](https://github.com/Calinou/kenney-particle-pack)
mirror and downscaled from 512px with `sips`:

- `spark.png` (128px, from `trace_01`) — the hot streak thrown off an impact.
  Elongated on purpose: ImpactFX rotates each one to face its own velocity.
- `smoke.png` (128px, from `smoke_04`) — the dust/smoke puff that lingers.
- `debris.png` (128px, from `dirt_02`) — a gravel spray, one sprite = many chunks.
- `flash.png` (64px, from `light_01`) — the single-frame hot flash at the point
  of contact.

All four are white/greyscale by design; ImpactFX tints them per surface
(concrete grey, dirt brown, wood tan, blood red), so one sprite serves every
material. Drop-in replacements just need to keep that convention.

The bullet-hole **decal** is NOT here — it is drawn procedurally on a canvas at
runtime (`vfx/impactDecalTexture.ts`), because a hole wants a hard dark core and
crisp cracks that a soft particle sprite cannot give.

Note on itch.io: most of the free "bullet impact" packs there are pixel-art
sprite sheets (16x16/32x32, e.g. BDragon1727's Retro Impact packs) meant for 2D
games — they read as cartoon next to Valor's PBR bodycam look. Kenney's pack is
the CC0 set that suits a 3D billboard.
