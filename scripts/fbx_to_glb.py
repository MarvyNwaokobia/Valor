"""
Valor — FBX to GLB batch converter
Run with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/fbx_to_glb.py -- apps/web/public/characters/raw apps/web/public/characters/glb

Folder structure expected:
  raw/
    berserker/
      character.fbx   ← downloaded WITH skin from Mixamo (T-pose or idle)
      idle.fbx        ← downloaded WITHOUT skin
      attack.fbx      ← downloaded WITHOUT skin
      hit.fbx         ← downloaded WITHOUT skin
      death.fbx       ← downloaded WITHOUT skin
    sentinel/
      ...

Output: one GLB per class with all animations embedded as named tracks.
"""

import bpy
import os
import sys


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions,
                  bpy.data.materials, bpy.data.images, bpy.data.textures):
        for item in list(block):
            block.remove(item)


def import_fbx(filepath):
    bpy.ops.import_scene.fbx(
        filepath=filepath,
        use_anim=True,
        automatic_bone_orientation=False,
        use_image_search=True,
    )


def get_armatures():
    return [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']


def remove_except(keep_object):
    """Remove all armatures and meshes except keep_object and its children."""
    to_remove = []
    for obj in bpy.context.scene.objects:
        if obj == keep_object:
            continue
        if obj.type in ('ARMATURE', 'MESH'):
            to_remove.append(obj)
    for obj in to_remove:
        try:
            bpy.data.objects.remove(obj, do_unlink=True)
        except Exception:
            pass


def push_action_to_nla(armature, action, name):
    """Add an action as a named NLA strip on the armature."""
    if not armature.animation_data:
        armature.animation_data_create()
    track = armature.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, int(action.frame_range[0]), action)
    return strip


def process_class(class_dir, output_path, class_name):
    print(f"\n{'=' * 52}")
    print(f"  {class_name.upper()}")
    print(f"{'=' * 52}")

    char_fbx = os.path.join(class_dir, 'character.fbx')
    if not os.path.exists(char_fbx):
        print(f"  SKIP — character.fbx not found in {class_dir}")
        return False

    clear_scene()

    # ── Import base character (mesh + skeleton) ────────────────────────
    print(f"  Importing character mesh...")
    import_fbx(char_fbx)

    arms = get_armatures()
    if not arms:
        print(f"  ERROR — no armature found in character.fbx")
        return False

    main_arm = arms[0]
    print(f"  Armature: {main_arm.name}")

    if not main_arm.animation_data:
        main_arm.animation_data_create()

    # If character.fbx had an embedded animation, register it as 'idle'
    if main_arm.animation_data.action:
        action = main_arm.animation_data.action
        action.name = 'idle'
        push_action_to_nla(main_arm, action, 'idle')
        main_arm.animation_data.action = None
        print(f"  Registered embedded animation as: idle")

    # ── Import each animation file ─────────────────────────────────────
    anim_files = sorted([
        f for f in os.listdir(class_dir)
        if f.lower().endswith('.fbx') and f.lower() != 'character.fbx'
    ])

    for fname in anim_files:
        anim_name = os.path.splitext(fname)[0].lower()
        anim_path = os.path.join(class_dir, fname)
        print(f"  Importing animation: {anim_name}...")

        import_fbx(anim_path)

        # The new armature is everything except main_arm
        new_arms = [a for a in get_armatures() if a != main_arm]
        if not new_arms:
            print(f"    WARNING — no armature found in {fname}, skipping")
            continue

        tmp_arm = new_arms[0]
        if tmp_arm.animation_data and tmp_arm.animation_data.action:
            action = tmp_arm.animation_data.action
            action.name = anim_name
            push_action_to_nla(main_arm, action, anim_name)
            frames = int(action.frame_range[1] - action.frame_range[0])
            print(f"    Added '{anim_name}' ({frames} frames)")
        else:
            print(f"    WARNING — no action found in {fname}")

        # Clean up the temporary import
        remove_except(main_arm)

    # ── Export as GLB ──────────────────────────────────────────────────
    print(f"  Exporting GLB...")
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB',
        export_animations=True,
        export_nla_strips=True,
        export_skins=True,
        export_apply=False,
        export_image_format='AUTO',
    )

    if os.path.exists(output_path):
        size_kb = os.path.getsize(output_path) / 1024
        print(f"  ✓ {output_path} ({size_kb:.0f} KB)")
        return True
    else:
        print(f"  ERROR — output file not created")
        return False


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

    if len(argv) < 2:
        print(__doc__)
        sys.exit(1)

    raw_dir = os.path.abspath(argv[0])
    glb_dir = os.path.abspath(argv[1])

    print(f"Raw dir : {raw_dir}")
    print(f"GLB dir : {glb_dir}")
    os.makedirs(glb_dir, exist_ok=True)

    ok = fail = 0
    for cls in sorted(os.listdir(raw_dir)):
        cls_path = os.path.join(raw_dir, cls)
        if not os.path.isdir(cls_path):
            continue
        out_path = os.path.join(glb_dir, f"{cls}.glb")
        result = process_class(cls_path, out_path, cls)
        if result:
            ok += 1
        else:
            fail += 1

    print(f"\n{'=' * 52}")
    print(f"  Done — {ok} converted, {fail} failed")
    print(f"{'=' * 52}\n")
