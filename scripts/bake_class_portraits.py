"""
Valor - render class portraits straight from the shipped character GLBs.

Why render rather than draw or generate: these portraits caption the class cards
on the landing page and in onboarding, so they have to BE the character the player
actually gets. Anything else - stock art, an AI render - drifts the moment a model
changes, which is exactly the mismatch this whole pass exists to remove. Rendering
from the GLB means the art regenerates from the source of truth.

Two details that matter more than they look:
  * Posed from the 'idle' clip, not the T-pose. A T-posed character reads as an
    asset, not a person.
  * Per-class rim light in that class's accent colour, matching accentColor in
    apps/web/src/lib/classes.ts, so the cards keep their existing red/blue/violet
    identity without tinting the whole image in post.

Run:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/bake_class_portraits.py -- \
      apps/web/public/characters/glb design/generated/classes
"""

import bpy
import math
import os
import sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
glb_dir, out_dir = argv[0], argv[1]
# Optional third arg: the rifle to put in their hands.
rifle_path = argv[2] if len(argv) > 2 else None
os.makedirs(out_dir, exist_ok=True)

# Accent colours are the linear-space equivalents of accentColor in classes.ts:
# Berserker #ef4444, Sentinel #3b82f6, Phantom #8b5cf6.
CLASSES = {
    'berserker': (0.78, 0.05, 0.05),
    'sentinel':  (0.03, 0.20, 0.85),
    'phantom':   (0.24, 0.09, 0.83),
}

RES_X, RES_Y = 900, 1200


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def pick_engine():
    """EEVEE for real materials; fall back to Workbench on older builds."""
    for name in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            bpy.context.scene.render.engine = name
            return name
        except TypeError:
            continue
    bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'
    return 'BLENDER_WORKBENCH'


def pose_idle(frame=30):
    """Drop the rig onto its idle clip so the portrait is a stance, not a T-pose."""
    for obj in bpy.context.scene.objects:
        if obj.type != 'ARMATURE':
            continue
        idle = next((a for a in bpy.data.actions if 'idle' in a.name.lower()), None)
        if not idle:
            continue
        if not obj.animation_data:
            obj.animation_data_create()
        # NLA strips would override a directly-assigned action, so mute them.
        for track in obj.animation_data.nla_tracks:
            track.mute = True
        obj.animation_data.action = idle
        lo, hi = idle.frame_range
        bpy.context.scene.frame_set(int(min(max(frame, lo), hi)))
        return True
    return False


def find_bone(armature, suffix):
    """Mixamo bone by name suffix. Matches 'mixamorig:RightHand' and the sanitised
    'mixamorig_RightHand' the glTF round-trip can produce, and never
    RightHandIndex1 - hence anchoring to the END of the name."""
    low = suffix.lower()
    for pb in armature.pose.bones:
        if pb.name.lower().endswith(low):
            return pb
    return None


def attach_rifle(rifle_path, char_height):
    """Put a rifle in the operator's hands.

    The idle clip is a RIFLE idle, so without this the hands close around nothing
    and the portrait reads as a character holding an invisible object - which is
    worse than a neutral pose, because the viewer can see the grip.

    Orientation comes from the HANDS, not from the hand bone's own axes. Bone roll
    is a Mixamo authoring detail that differs between rigs, whereas 'the barrel
    runs from the trigger hand towards the support hand' is true of every rifle
    grip. So: forward = right hand -> left hand, up = world up orthogonalised
    against it. The model itself is authored barrel-along-+X, up-along-+Z (5.17 x
    0.35 x 1.79 units), and is scaled from those 5.17 units down to roughly half
    the character's height, a rifle being about 0.9m against a 1.75m operator.
    """
    arm = next((o for o in bpy.context.scene.objects if o.type == 'ARMATURE'), None)
    if not arm:
        return 'no armature'
    rhand, lhand = find_bone(arm, 'righthand'), find_bone(arm, 'lefthand')
    if not rhand or not lhand:
        return 'hand bones not found'

    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=rifle_path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    roots = [o for o in new if o.parent not in new]
    if not roots:
        return 'rifle imported nothing'

    r_world = arm.matrix_world @ rhand.head
    l_world = arm.matrix_world @ lhand.head

    forward = (l_world - r_world)
    if forward.length < 1e-5:
        return 'hands coincident'
    forward.normalize()

    up = Vector((0, 0, 1))
    up = (up - forward * up.dot(forward))
    if up.length < 1e-5:                      # barrel pointing straight up/down
        up = Vector((0, 1, 0))
    up.normalize()
    side = forward.cross(up)

    basis = Matrix.Identity(3)
    basis.col[0] = forward     # model +X is the barrel
    basis.col[1] = side
    basis.col[2] = up          # model +Z is the top of the receiver
    scale = (char_height * 0.5) / 5.169

    xform = (
        Matrix.Translation(r_world)
        @ basis.to_4x4()
        @ Matrix.Diagonal((scale, scale, scale, 1.0))
    )

    # PRE-MULTIPLY, never assign. The glTF importer parents the mesh under a root
    # empty and puts the Y-up -> Z-up correction on that root, so the mesh's world
    # orientation is root @ child, not root. Assigning root.matrix_world threw the
    # child's own rotation away and left the rifle rolled about its barrel - grip
    # pointing sideways instead of down.
    #
    # As imported, the rifle already sits at the world origin with barrel along +X
    # and grip down -Z (verified by rendering it alone), so its original world
    # basis is the identity and pre-multiplying by `xform` lands it exactly where
    # `xform` describes.
    for root in roots:
        root.matrix_world = xform @ root.matrix_world

    # NOTE: the rifle renders in a flat mid-grey, because rifle.glb carries no
    # textures. Overriding its material here did NOT work - assigning a dark
    # Principled BSDF to obj.data.materials, forcing every slot's link to 'DATA',
    # and sweeping metalness/roughness from 0.9/0.35 to 0.0/0.9 all left the render
    # pixel-identical, so something in this import path is not taking the override.
    # Left alone rather than left as dead code.
    #
    # It is tolerable: at card size a lighter weapon actually reads more clearly as
    # a weapon, and on the near-black Sentinel it is the only thing separating the
    # silhouette. Worth revisiting if the guns ever get real textures.
    return f'ok (scale {scale:.3f})'


def mesh_bounds():
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    found = False
    deps = bpy.context.evaluated_depsgraph_get()
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        found = True
        ev = obj.evaluated_get(deps)
        for corner in ev.bound_box:
            world = ev.matrix_world @ Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], world[i])
                hi[i] = max(hi[i], world[i])
    return (lo, hi) if found else (None, None)


def add_light(kind, loc, energy, colour, size=3.0):
    data = bpy.data.lights.new(name=kind, type='AREA')
    data.energy = energy
    data.color = colour
    data.size = size
    obj = bpy.data.objects.new(kind, data)
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)
    return obj


def aim(obj, target):
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


for name, accent in CLASSES.items():
    path = os.path.join(glb_dir, f'{name}.glb')
    if not os.path.exists(path):
        print(f'MISSING {path}')
        continue

    clear()
    engine = pick_engine()
    bpy.ops.import_scene.gltf(filepath=path)
    posed = pose_idle()

    lo, hi = mesh_bounds()
    if lo is None:
        print(f'FAILED {name}: no mesh')
        continue

    centre = (lo + hi) * 0.5
    height = max(hi.z - lo.z, 0.001)

    # Deliberately after mesh_bounds(): the framing is measured on the OPERATOR, and
    # a rifle held out front would drag the bounding box forward and push the camera
    # back on whichever class happens to hold it furthest from the body.
    if rifle_path and os.path.exists(rifle_path):
        print(f'    rifle: {attach_rifle(rifle_path, height)}')
    # Frame the upper body: cards crop tight, and boots are not the selling point.
    focus = Vector((centre.x, centre.y, lo.z + height * 0.68))

    # Three-quarter view: rotate off-axis so the silhouette reads as a person
    # rather than a technical drawing.
    yaw = math.radians(28)
    dist = height * 1.9
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 85           # portrait-length lens, minimal distortion
    cam = bpy.data.objects.new('cam', cam_data)
    cam.location = focus + Vector((math.sin(yaw) * dist, -math.cos(yaw) * dist, height * 0.10))
    bpy.context.scene.collection.objects.link(cam)
    aim(cam, focus)
    bpy.context.scene.camera = cam

    if engine != 'BLENDER_WORKBENCH':
        # Key from camera-left, dim fill opposite, then the accent rim from behind
        # so the character separates from a dark card background.
        add_light('key',  focus + Vector((-dist * 0.55, -dist * 0.5, height * 0.55)), 600, (1.0, 0.96, 0.90), size=4)
        add_light('fill', focus + Vector((dist * 0.6, -dist * 0.45, 0)), 120, (0.65, 0.72, 0.85), size=5)
        add_light('rim',  focus + Vector((dist * 0.35, dist * 0.75, height * 0.5)), 1400, accent, size=3)
        world = bpy.data.worlds.new('w')
        world.use_nodes = True
        world.node_tree.nodes['Background'].inputs[1].default_value = 0.06
        bpy.context.scene.world = world
    else:
        bpy.context.scene.display.shading.light = 'STUDIO'
        bpy.context.scene.display.shading.color_type = 'TEXTURE'

    scene = bpy.context.scene
    scene.render.film_transparent = True     # cards composite over their own background
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.resolution_x = RES_X
    scene.render.resolution_y = RES_Y
    scene.render.filepath = os.path.join(out_dir, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print(f'OK {name}  engine={engine}  posed={posed}  -> {scene.render.filepath}')

print('done')
