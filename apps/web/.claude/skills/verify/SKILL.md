---
name: verify
description: Build, run and visually verify the Valor web app (Next.js + react-three-fiber game). Use when a change needs runtime verification in the real game, especially anything touching the 3D fight scene.
---

# Verifying Valor (apps/web)

## Launch

```bash
cd apps/web
npx next dev -p 3100        # run in background; first compile of /fight takes ~60-90s
curl -s -o /dev/null -w "%{http_code}" 'http://localhost:3100/fight?level=1'  # warm + readiness check (quote the URL, zsh eats ?)
```

No login is required for /fight; with no player session the class defaults to Berserker and pve_level=0 (so any campaign level counts as first clear).

## Drive the game with Playwright

Playwright is a dependency of apps/web; scripts must live IN apps/web (or resolve from it) or node can't find the package. Launch chromium with software GL or the canvas stays black:

```js
chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] })
```

Routes and flow:
- `/fight` quick bot fight, straight to the 3D scene.
- `/fight?level=N` campaign level N (stage per zone: 1-5 lava_arena/Ashfall, 6-10 battle_arena, 11-15 scifi_stage). On first clear a zone-intro card and story dialogue precede the fight; BOTH advance on any click, so click page centre (`page.mouse.click(640,360)`) in a loop until `page.$('canvas')` is truthy.
- After canvas mounts: ~1.5s scene-ready + 3.8s countdown before combat input works.
- Inputs: WASD move, `j` fire, space dodge. Hold a key ~2s to see locomotion.
- Capture `page.on('pageerror')` and console errors; a healthy run prints none.

Screenshot right after countdown for the wide framing; mid-combat for the over-the-shoulder camera. Existing example: apps/web/probe-stride.mjs.
