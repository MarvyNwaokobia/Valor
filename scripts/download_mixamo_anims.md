# Download Free Combat Animations for Valor

## Quick Setup (5 minutes)

### 1. Install Blender (free)
Download from https://www.blender.org/download/ — macOS Intel 64-bit

### 2. Download animations from Mixamo (free, no subscription)
Go to https://www.mixamo.com (sign in with free Adobe account)

Search and download these animations as FBX (With Skin = NO, 30fps):

**For each class (berserker, phantom, sentinel), download:**

| Animation Name | Search Term on Mixamo | Save As |
|---|---|---|
| heavy_attack | "sword slash" or "great sword slash" | `heavy_attack.fbx` |
| block | "shield block hit" or "standing block" | `block.fbx` |
| dodge | "dodge" or "evade" | `dodge.fbx` |
| combo1 | "punch combo" or "combo attack" | `combo1.fbx` |
| combo2 | "kick combo" or "hook punch" | `combo2.fbx` |
| victory | "victory" or "cheering" | `victory.fbx` |

Place them in the raw directory:
```
apps/web/public/characters/raw/
  berserker/
    heavy_attack.fbx
    block.fbx
    dodge.fbx
    ...
  phantom/
    heavy_attack.fbx
    ...
  sentinel/
    heavy_attack.fbx
    ...
```

### 3. Also get free CC0 animations (no account needed)
- **Quaternius**: https://quaternius.com/packs/universalanimationlibrary2.html
  - Download the free tier — includes combat combos in GLB/FBX
- **Rokoko**: https://www.rokoko.com/resources/rokoko-mocap-13-free-fight-animations
  - 13 free fight animations, Mixamo skeleton, FBX format

### 4. Update the conversion script
Add the new animation filenames to `scripts/fbx_to_glb.py` in the CLASS_FILES dict:

```python
'berserker': {
    'character': 'T-Pose with skin male.fbx',
    'animations': {
        'idle':         'Barbarian.fbx',
        'attack':       'male attack.fbx',
        'heavy_attack': 'heavy_attack.fbx',    # NEW
        'block':        'block.fbx',            # NEW
        'dodge':        'dodge.fbx',            # NEW
        'combo1':       'combo1.fbx',           # NEW
        'combo2':       'combo2.fbx',           # NEW
        'hit':          'male hit.fbx',
        'death':        'Male death.fbx',
        'victory':      'victory.fbx',          # NEW
    },
},
```

### 5. Run the converter
```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/fbx_to_glb.py -- apps/web/public/characters/raw apps/web/public/characters/glb
```

### 6. Update the combat system
Once new animations are in the GLBs, update `apps/web/src/lib/combat/moves.ts`:
- Change `animClip: 'attack'` to `animClip: 'heavy_attack'` for heavy moves
- Add block/dodge animation clips in the fighter state hook
