# Assemble colonial-door-kit.glb from the two imported Meshy components
# (frame+recess, leaf). Blender is used ONLY for cleanup, decimation, pivots,
# parenting, node naming and animation — no visible production geometry is
# created here (imported-visible-world rule).
#
# Output nodes:
#   Door_Frame   — stationary jamb + lintel casing (from frame-recess component)
#   Door_Recess  — stationary dark vestibule backing (split from same component,
#                  or its recess submesh) that occludes the building's baked
#                  static door once the functional leaf opens
#   Door_Leaf    — the detached leaf, origin/pivot at its bottom hinge-stile edge
#   Door_Latch   — optional latch hardware (parented to the leaf) if present
#
# Animations (leaf only; frame/recess never move):
#   openInward   — leaf swings toward the interior (~1.2s)
#   openOutward  — leaf swings toward the street  (~1.2s)
#   closing is the runtime reversing the matching clip.
#
# Run:
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#     --python assets/pipeline/assemble_door_kit.py
import bpy
import math
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPONENTS = os.path.join(ROOT, "build", "door-kit", "components")
OUT_DIR = os.path.join(ROOT, "build", "door-kit-opt")
FINAL = os.path.join(OUT_DIR, "colonial-door-kit.glb")
os.makedirs(OUT_DIR, exist_ok=True)

FRAME_GLB = os.path.join(COMPONENTS, "colonial-door-frame-recess.glb")
RECESS_GLB = os.path.join(COMPONENTS, "colonial-door-recess.glb")
LEAF_GLB = os.path.join(COMPONENTS, "colonial-door-leaf.glb")

# Target dimensions in the fit-normalized asset-local frame (meters). Blender is
# X-width / Y-depth / Z-height after glTF import. export_yup converts back to
# glTF Y-up where +z is the street-facing front axis (matches doorwayContract).
OPENING_W = 1.20
OPENING_H = 2.05
LEAF_W = 1.12
LEAF_H = 2.00
LEAF_T = 0.10
FPS = 24
OPEN_FRAMES = 30           # ~1.25s at 24fps (brief: 1.0-1.4s)
OPEN_ANGLE = math.radians(78.0)


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def bounds_world(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    low = Vector(tuple(min(p[i] for p in pts) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in pts) for i in range(3)))
    return low, high


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    return new


def join(objs, name):
    activate(objs[0])
    for o in objs:
        o.select_set(True)
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj


def fit_dimensions(obj, desired):
    bpy.context.view_layer.update()
    dims = obj.dimensions
    obj.scale = tuple(desired[i] / max(dims[i], 1e-6) for i in range(3))
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def origin_to(obj, world_point):
    activate(obj)
    bpy.context.scene.cursor.location = world_point
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")


def decimate(obj, target_tris):
    if tris(obj) <= target_tris:
        return
    activate(obj)
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.ratio = max(0.05, target_tris / max(1, tris(obj)))
    bpy.ops.object.modifier_apply(modifier=mod.name)


def center_ground(obj):
    bpy.context.view_layer.update()
    low, high = bounds_world(obj)
    obj.location -= Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
    activate(obj)
    bpy.ops.object.transform_apply(location=True)


def resize_textures(max_px=1024):
    for image in bpy.data.images:
        width, height = image.size[:]
        if max(width, height) <= max_px:
            continue
        ratio = max_px / max(width, height)
        image.scale(max(1, round(width * ratio)), max(1, round(height * ratio)))
        image.pack()


def keyframe_leaf(leaf, action_name, sign):
    """Author a leaf swing action rotating about the hinge (world Z, Z-up)."""
    if leaf.animation_data is None:
        leaf.animation_data_create()
    action = bpy.data.actions.new(action_name)
    leaf.animation_data.action = action
    leaf.rotation_mode = "XYZ"
    for frame, k in ((1, 0.0), (OPEN_FRAMES, 1.0)):
        leaf.rotation_euler[2] = sign * OPEN_ANGLE * k
        leaf.keyframe_insert("rotation_euler", index=2, frame=frame)
    # Blender 5 stores action curves in layered channel bags rather than the
    # legacy action.fcurves collection. The default Bezier interpolation gives
    # the desired weighted ease without reaching into version-specific APIs.
    # Stash to an NLA track so the ACTIONS export emits it as a named clip.
    track = leaf.animation_data.nla_tracks.new()
    track.name = action_name
    track.strips.new(action_name, 1, action)
    leaf.animation_data.action = None
    leaf.rotation_euler[2] = 0.0
    return action


def main():
    reset()
    bpy.context.scene.render.fps = FPS

    # ---- frame + recess ----------------------------------------------------
    frame_parts = import_glb(FRAME_GLB)
    # The concept renders casing + a dark recess backing. If Meshy returns them
    # as separable submeshes keep two nodes; otherwise the whole casing is
    # Door_Frame and a thin recess node is separated by material later by the
    # artist. Here we name the casing Door_Frame and, if a clearly darker/rear
    # island exists, split it into Door_Recess.
    frame = join(frame_parts, "Door_Frame")
    # The generated frame's modeled clear opening occupies ~95% of its height;
    # 2.15m outer height yields ~2.04m clear, keeping the closed leaf/aperture
    # edge error below 5cm without distorting the 2.0m leaf.
    fit_dimensions(frame, (OPENING_W + 0.24, max(0.16, LEAF_T + 0.06), OPENING_H + 0.10))
    center_ground(frame)
    decimate(frame, 5200)

    # Recess is its own isolated Meshy import, never a guessed split/duplicate
    # of the frame mesh. Blender +Y maps behind glTF's +z street-facing plane.
    recess_parts = import_glb(RECESS_GLB)
    recess = join(recess_parts, "Door_Recess")
    fit_dimensions(recess, (OPENING_W - 0.02, 0.18, OPENING_H - 0.02))
    center_ground(recess)
    recess.location.y = 0.14
    activate(recess)
    bpy.ops.object.transform_apply(location=True)
    decimate(recess, 3000)

    # ---- leaf --------------------------------------------------------------
    leaf_parts = import_glb(LEAF_GLB)
    leaf = join(leaf_parts, "Door_Leaf")
    fit_dimensions(leaf, (LEAF_W, LEAF_T, LEAF_H))
    center_ground(leaf)
    # The accepted concept's actual wrought-iron hinge straps are on its right
    # stile. Mirror the imported asset so hardware and authored hinge pivot both
    # land on the kit's left edge.
    leaf.scale.x = -1
    activate(leaf)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Pivot at the bottom hinge-stile edge: min X (hinge side), min Z (floor),
    # centred through the leaf thickness on Y.
    low, high = bounds_world(leaf)
    origin_to(leaf, Vector((low.x, (low.y + high.y) / 2, low.z)))
    # Geometry remains centred in the opening; only the object's origin moves
    # to the hinge. This makes the exported node translation the real hinge and
    # keeps closed bounds centred.
    decimate(leaf, 6500)

    # ---- animation (leaf only) --------------------------------------------
    # Blender +Y exports as glTF -Z (inside, opposite the kit's +Z outward
    # normal), so positive Blender-Z rotation is the inward swing.
    keyframe_leaf(leaf, "openInward", +1.0)
    keyframe_leaf(leaf, "openOutward", -1.0)

    # ---- export ------------------------------------------------------------
    resize_textures(1024)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=FINAL,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_apply=True,
        use_selection=True,
    )
    total = tris(frame) + tris(recess) + tris(leaf)
    print("WROTE", FINAL)
    print("nodes: Door_Frame, Door_Recess, Door_Leaf")
    print("clips: openInward, openOutward")
    print("tris:", total)


main()
