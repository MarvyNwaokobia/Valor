"""
Valor — Generate combat animations from existing Mixamo-rigged characters.

Creates block, dodge, heavy_attack, and victory animations by keyframing
bone rotations procedurally. These supplement the existing idle/attack/hit/death.

Run:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/generate_combat_anims.py -- apps/web/public/characters/raw apps/web/public/characters/glb
"""

import bpy
import os
import sys
import math


# ── Existing class configs from fbx_to_glb.py ────────────────────────────────

CLASS_FILES = {
    'berserker': {
        'character': 'T-Pose with skin male.fbx',
        'animations': {
            'idle':         'Barbarian.fbx',
            'attack':       'male attack.fbx',
            'hit':          'male hit.fbx',
            'death':        'Male death.fbx',
        },
    },
    'sentinel': {
        'character': 'T-Pose male.fbx',
        'animations': {
            'idle':         'Idle male.fbx',
            'attack':       'attack male.fbx',
            'hit':          'Hit Reaction male.fbx',
            'death':        'death male.fbx',
        },
    },
    'phantom': {
        'character': 'T-Pose.fbx',
        'animations': {
            'idle':         'Idle.fbx',
            'attack':       'attack.fbx',
            'hit':          'Hit To Body.fbx',
            'death':        'death.fbx',
        },
    },
}


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
    keep = {keep_object} | set(keep_object.children_recursive)
    to_remove = [
        obj for obj in bpy.context.scene.objects
        if obj not in keep and obj.type in ('ARMATURE', 'MESH')
    ]
    for obj in to_remove:
        try:
            bpy.data.objects.remove(obj, do_unlink=True)
        except:
            pass


def push_action_to_nla(armature, action, name):
    action.name = name
    action.use_fake_user = True
    if not armature.animation_data:
        armature.animation_data_create()
    track = armature.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, int(action.frame_range[0]), action)
    armature.animation_data.action = None


def get_bone(armature, names):
    """Try multiple bone name variants and return the first match."""
    for name in names:
        if name in armature.pose.bones:
            return armature.pose.bones[name]
    return None


def keyframe_bone_rotation(bone, frame, euler_xyz):
    """Set bone rotation (Euler XYZ in degrees) and insert keyframe."""
    bone.rotation_mode = 'XYZ'
    bone.rotation_euler = (math.radians(euler_xyz[0]),
                           math.radians(euler_xyz[1]),
                           math.radians(euler_xyz[2]))
    bone.keyframe_insert(data_path="rotation_euler", frame=frame)


def keyframe_bone_location(bone, frame, loc):
    bone.keyframe_insert(data_path="location", frame=frame)


def create_block_animation(armature):
    """Shield-up blocking pose — arms raised, slight crouch."""
    print("  Creating block animation...")
    bpy.context.view_layer.objects.active = armature
    if not armature.animation_data:
        armature.animation_data_create()

    action = bpy.data.actions.new('block')
    armature.animation_data.action = action
    bpy.ops.object.mode_set(mode='POSE')

    spine = get_bone(armature, ['mixamorig:Spine', 'Spine'])
    l_arm = get_bone(armature, ['mixamorig:LeftArm', 'LeftArm'])
    r_arm = get_bone(armature, ['mixamorig:RightArm', 'RightArm'])
    l_fore = get_bone(armature, ['mixamorig:LeftForeArm', 'LeftForeArm'])
    r_fore = get_bone(armature, ['mixamorig:RightForeArm', 'RightForeArm'])

    for frame in [1, 15, 30]:
        bpy.context.scene.frame_set(frame)

        if spine:
            crouch = -8 if frame == 15 else 0
            keyframe_bone_rotation(spine, frame, (crouch, 0, 0))

        if l_arm:
            raise_amt = -60 if frame == 15 else -10
            keyframe_bone_rotation(l_arm, frame, (raise_amt, 0, 20))

        if r_arm:
            raise_amt = -70 if frame == 15 else -10
            keyframe_bone_rotation(r_arm, frame, (raise_amt, 0, -20))

        if l_fore:
            bend = -80 if frame == 15 else -10
            keyframe_bone_rotation(l_fore, frame, (bend, 0, 0))

        if r_fore:
            bend = -90 if frame == 15 else -10
            keyframe_bone_rotation(r_fore, frame, (bend, 0, 0))

    bpy.ops.object.mode_set(mode='OBJECT')
    return action


def create_dodge_animation(armature):
    """Quick sidestep dodge — lean and shift."""
    print("  Creating dodge animation...")
    bpy.context.view_layer.objects.active = armature
    if not armature.animation_data:
        armature.animation_data_create()

    action = bpy.data.actions.new('dodge')
    armature.animation_data.action = action
    bpy.ops.object.mode_set(mode='POSE')

    spine = get_bone(armature, ['mixamorig:Spine', 'Spine'])
    hips = get_bone(armature, ['mixamorig:Hips', 'Hips'])
    spine1 = get_bone(armature, ['mixamorig:Spine1', 'Spine1'])

    for frame in [1, 8, 16, 24]:
        bpy.context.scene.frame_set(frame)

        if spine:
            lean = 25 if frame == 8 else (-15 if frame == 16 else 0)
            keyframe_bone_rotation(spine, frame, (0, 0, lean))

        if spine1:
            lean = -10 if frame == 8 else (5 if frame == 16 else 0)
            keyframe_bone_rotation(spine1, frame, (-5 if frame in [8, 16] else 0, 0, lean))

        if hips:
            hips.rotation_mode = 'XYZ'
            hips.rotation_euler = (0, 0, 0)
            hips.keyframe_insert(data_path="rotation_euler", frame=frame)

    bpy.ops.object.mode_set(mode='OBJECT')
    return action


def create_heavy_attack_animation(armature):
    """Slow powerful overhead swing."""
    print("  Creating heavy_attack animation...")
    bpy.context.view_layer.objects.active = armature
    if not armature.animation_data:
        armature.animation_data_create()

    action = bpy.data.actions.new('heavy_attack')
    armature.animation_data.action = action
    bpy.ops.object.mode_set(mode='POSE')

    spine = get_bone(armature, ['mixamorig:Spine', 'Spine'])
    spine1 = get_bone(armature, ['mixamorig:Spine1', 'Spine1'])
    r_arm = get_bone(armature, ['mixamorig:RightArm', 'RightArm'])
    r_fore = get_bone(armature, ['mixamorig:RightForeArm', 'RightForeArm'])
    l_arm = get_bone(armature, ['mixamorig:LeftArm', 'LeftArm'])

    # Windup (frames 1-20), Strike (frames 20-30), Follow-through (30-45)
    keyframes = {
        1:  {'spine': (0, 0, 0), 'spine1': (0, 0, 0), 'r_arm': (-10, 0, -10), 'r_fore': (-10, 0, 0), 'l_arm': (-10, 0, 10)},
        12: {'spine': (15, 0, -15), 'spine1': (10, 0, -10), 'r_arm': (-120, -20, -30), 'r_fore': (-40, 0, 0), 'l_arm': (-30, 0, 20)},
        20: {'spine': (15, 0, -15), 'spine1': (10, 0, -10), 'r_arm': (-130, -25, -35), 'r_fore': (-30, 0, 0), 'l_arm': (-35, 0, 25)},
        28: {'spine': (-20, 0, 20), 'spine1': (-15, 0, 15), 'r_arm': (-20, 30, 10), 'r_fore': (-60, 0, 0), 'l_arm': (-10, 0, -5)},
        38: {'spine': (-5, 0, 5), 'spine1': (0, 0, 0), 'r_arm': (-10, 10, 0), 'r_fore': (-20, 0, 0), 'l_arm': (-10, 0, 10)},
        45: {'spine': (0, 0, 0), 'spine1': (0, 0, 0), 'r_arm': (-10, 0, -10), 'r_fore': (-10, 0, 0), 'l_arm': (-10, 0, 10)},
    }

    for frame, poses in keyframes.items():
        bpy.context.scene.frame_set(frame)
        if spine:
            keyframe_bone_rotation(spine, frame, poses['spine'])
        if spine1:
            keyframe_bone_rotation(spine1, frame, poses['spine1'])
        if r_arm:
            keyframe_bone_rotation(r_arm, frame, poses['r_arm'])
        if r_fore:
            keyframe_bone_rotation(r_fore, frame, poses['r_fore'])
        if l_arm:
            keyframe_bone_rotation(l_arm, frame, poses['l_arm'])

    bpy.ops.object.mode_set(mode='OBJECT')
    return action


def create_victory_animation(armature):
    """Arms raised in triumph."""
    print("  Creating victory animation...")
    bpy.context.view_layer.objects.active = armature
    if not armature.animation_data:
        armature.animation_data_create()

    action = bpy.data.actions.new('victory')
    armature.animation_data.action = action
    bpy.ops.object.mode_set(mode='POSE')

    spine = get_bone(armature, ['mixamorig:Spine', 'Spine'])
    l_arm = get_bone(armature, ['mixamorig:LeftArm', 'LeftArm'])
    r_arm = get_bone(armature, ['mixamorig:RightArm', 'RightArm'])
    l_fore = get_bone(armature, ['mixamorig:LeftForeArm', 'LeftForeArm'])
    r_fore = get_bone(armature, ['mixamorig:RightForeArm', 'RightForeArm'])

    for frame in [1, 20, 40, 60]:
        bpy.context.scene.frame_set(frame)
        up = frame in [20, 40]

        if spine:
            keyframe_bone_rotation(spine, frame, (-10 if up else 0, 0, 0))
        if l_arm:
            keyframe_bone_rotation(l_arm, frame, (-150 if up else -10, 0, 30 if up else 10))
        if r_arm:
            keyframe_bone_rotation(r_arm, frame, (-150 if up else -10, 0, -30 if up else -10))
        if l_fore:
            keyframe_bone_rotation(l_fore, frame, (-20 if up else -10, 0, 0))
        if r_fore:
            keyframe_bone_rotation(r_fore, frame, (-20 if up else -10, 0, 0))

    bpy.ops.object.mode_set(mode='OBJECT')
    return action


def process_class(class_dir, output_path, class_name):
    print(f"\n{'=' * 52}")
    print(f"  {class_name.upper()}")
    print(f"{'=' * 52}")

    cfg = CLASS_FILES.get(class_name.lower())
    if not cfg:
        print(f"  SKIP — no config for '{class_name}'")
        return False

    char_fbx = os.path.join(class_dir, cfg['character'])
    if not os.path.exists(char_fbx):
        print(f"  ERROR — character file not found: {cfg['character']}")
        return False

    clear_scene()

    # ── Import base character ─────────────────────────────────────────
    print(f"  Importing base: {cfg['character']} ...")
    import_fbx(char_fbx)

    arms = get_armatures()
    if not arms:
        print("  ERROR — no armature found")
        return False

    main_arm = arms[0]
    if not main_arm.animation_data:
        main_arm.animation_data_create()
    main_arm.animation_data.action = None

    # ── Import existing FBX animations ────────────────────────────────
    for anim_name, anim_file in cfg['animations'].items():
        anim_path = os.path.join(class_dir, anim_file)
        if not os.path.exists(anim_path):
            print(f"  WARNING — '{anim_file}' not found")
            continue

        print(f"  Importing: {anim_file} → '{anim_name}'")
        import_fbx(anim_path)

        new_arms = [a for a in get_armatures() if a != main_arm]
        if not new_arms:
            remove_except(main_arm)
            continue

        tmp_arm = new_arms[0]
        action = tmp_arm.animation_data.action if tmp_arm.animation_data else None
        if action:
            push_action_to_nla(main_arm, action, anim_name)
            frames = int(action.frame_range[1] - action.frame_range[0])
            print(f"    ✓ '{anim_name}' — {frames} frames")

        remove_except(main_arm)

    # ── Generate procedural combat animations ─────────────────────────
    for gen_name, gen_func in [
        ('block',        create_block_animation),
        ('dodge',        create_dodge_animation),
        ('heavy_attack', create_heavy_attack_animation),
        ('victory',      create_victory_animation),
    ]:
        try:
            action = gen_func(main_arm)
            push_action_to_nla(main_arm, action, gen_name)
            frames = int(action.frame_range[1] - action.frame_range[0])
            print(f"    ✓ '{gen_name}' — {frames} frames (procedural)")
        except Exception as e:
            print(f"    WARNING — failed to create '{gen_name}': {e}")

    # ── Resize textures ───────────────────────────────────────────────
    for img in bpy.data.images:
        if img.size[0] > 1024 or img.size[1] > 1024:
            scale = 1024 / max(img.size[0], img.size[1])
            new_w = max(1, int(img.size[0] * scale))
            new_h = max(1, int(img.size[1] * scale))
            img.scale(new_w, new_h)

    # ── Export GLB ────────────────────────────────────────────────────
    print("  Exporting GLB ...")
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB',
        export_animations=True,
        export_nla_strips=True,
        export_skins=True,
        export_apply=False,
        export_image_format='WEBP',
        export_image_quality=80,
    )

    if os.path.exists(output_path):
        size_kb = os.path.getsize(output_path) / 1024
        print(f"  ✓ {output_path}  ({size_kb:.0f} KB)")

        # Verify animations
        import json, struct
        with open(output_path, 'rb') as f:
            f.read(12)  # header
            chunk_len = struct.unpack('<I', f.read(4))[0]
            f.read(4)  # chunk type
            json_data = json.loads(f.read(chunk_len))
            anims = [a.get('name', '?') for a in json_data.get('animations', [])]
            print(f"  Animations in GLB: {anims}")

        return True

    print("  ERROR — output not created")
    return False


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 2:
        print(__doc__)
        sys.exit(1)

    raw_dir = os.path.abspath(argv[0])
    glb_dir = os.path.abspath(argv[1])
    print(f"Raw dir: {raw_dir}")
    print(f"GLB dir: {glb_dir}")
    os.makedirs(glb_dir, exist_ok=True)

    ok = fail = 0
    for cls in sorted(os.listdir(raw_dir)):
        cls_path = os.path.join(raw_dir, cls)
        if not os.path.isdir(cls_path) or cls.startswith('.'):
            continue
        out_path = os.path.join(glb_dir, f"{cls}.glb")
        if process_class(cls_path, out_path, cls):
            ok += 1
        else:
            fail += 1

    print(f"\n{'=' * 52}")
    print(f"  Done — {ok} converted, {fail} failed")
    print(f"{'=' * 52}")
