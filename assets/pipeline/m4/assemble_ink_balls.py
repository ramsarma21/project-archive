# Assemble the standalone printer's ink-ball PAIR (asset key `printer-ink-balls`)
# from a single Meshy image-to-3D source ink ball. A matched pair of common-press
# ink balls are identical tools, so we build ONE clean, oriented, scaled ball and
# instance it twice (shared mesh data -> one embedded texture set) as two named
# nodes InkBall_Left / InkBall_Right, giving a real two-mesh GLB (no destructive
# split of a fused pair). Each ball carries handle-aligned, centerline pivot
# empties (grip at the handle top, rock at the pad contact, plus a semantic
# InkSurface node at the ink-loaded leather face) so the runtime can dab (press
# straight down) and rock (rotate about the pad contact) the imported object
# without any procedural stand-in.
#
# Rest pose (documented): +Y up (glTF). Each ball stands handle-UP, ink pad DOWN
# and grounded (pad contact at y=0), the dabbing-ready pose. The two balls sit
# side by side across local X; the right ball is yawed 180deg so the stitched
# seam faces outward (natural matched-pair variation) while sharing geometry.
#
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
#        --python assets/pipeline/m4/assemble_ink_balls.py
import bpy
import bmesh
import os
import math
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "build", "world-m4", "printer-ink-ball.glb")
OUT_DIR = os.path.join(ROOT, "build", "world-m4-opt")
KEY = "printer-ink-balls"
DST = os.path.join(OUT_DIR, KEY + ".glb")

TARGET_TRIS_PER_BALL = 2800   # pair ~= 5600 tris (<=6k combined; hard max 10k)
MAX_TEX = 1024
BALL_HEIGHT = 0.30            # m, single-ball overall height (pad contact -> handle top)
HALF_SEP = 0.105             # m, half the center-to-center spacing of the pair

os.makedirs(OUT_DIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no mesh imported")

# --- join into a single mesh object -----------------------------------------
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active

# Bake the object's world transform (incl. the glTF import parent's Y-up -> Z-up
# conversion) straight into the mesh DATA, then reset the object to identity with
# no parent. All reorientation below operates on mesh data via matrices, which is
# deterministic in Blender's --background mode (object-transform operators can
# silently no-op headless).
me = obj.data
me.transform(obj.matrix_world)
obj.parent = None
obj.matrix_basis = Matrix.Identity(4)
me.update()


def mesh_bounds():
    lo = Vector((1e18, 1e18, 1e18))
    hi = Vector((-1e18, -1e18, -1e18))
    for v in me.vertices:
        for i in range(3):
            lo[i] = min(lo[i], v.co[i])
            hi[i] = max(hi[i], v.co[i])
    return lo, hi


def xform(mat):
    me.transform(mat)
    me.update()


# --- clean: weld, drop loose verts, recompute normals -----------------------
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
loose = [v for v in bm.verts if not v.link_faces]
if loose:
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me)
bm.free()
me.update()

# --- orient (measurement-based, frame-agnostic): the handle axis is the LONGEST
#     dimension; the ink pad is the bulky end and the turned handle the thin end.
#     Stand the handle axis vertical (+Z, Blender) with the thin handle end UP so
#     the pad faces DOWN (dabbing-ready rest pose). ------------------------------
lo, hi = mesh_bounds()
size = hi - lo
long_axis = max(range(3), key=lambda i: size[i])
print("PRE-ORIENT size", [round(v, 3) for v in size], "long_axis", long_axis)
if long_axis == 0:      # X -> Z
    xform(Matrix.Rotation(math.radians(90.0), 4, "Y"))
elif long_axis == 1:    # Y -> Z
    xform(Matrix.Rotation(math.radians(90.0), 4, "X"))

# Now the handle axis is Z. Find which end is the thin handle (small XY radius)
# vs the bulky ink pad, and flip 180 about X if the pad is currently on top.
lo, hi = mesh_bounds()
height = hi.z - lo.z
cx = (lo.x + hi.x) * 0.5
cy = (lo.y + hi.y) * 0.5
top_r = []
bot_r = []
for v in me.vertices:
    r = math.hypot(v.co.x - cx, v.co.y - cy)
    if v.co.z >= hi.z - 0.25 * height:
        top_r.append(r)
    elif v.co.z <= lo.z + 0.25 * height:
        bot_r.append(r)
top_mean = sum(top_r) / max(1, len(top_r))
bot_mean = sum(bot_r) / max(1, len(bot_r))
print("END radius top", round(top_mean, 4), "bot", round(bot_mean, 4))
if top_mean > bot_mean:
    # bulky pad is on top -> flip so the thin handle points up
    xform(Matrix.Rotation(math.radians(180.0), 4, "X"))
    print("FLIPPED handle to +Z")

# --- scale so single-ball height == BALL_HEIGHT -----------------------------
lo, hi = mesh_bounds()
size = hi - lo
s = BALL_HEIGHT / size.z
xform(Matrix.Scale(s, 4))

# --- center XY + ground (minZ->0), baking origin at the pad-contact center ----
lo, hi = mesh_bounds()
delta = Vector((-(lo.x + hi.x) * 0.5, -(lo.y + hi.y) * 0.5, -lo.z))
xform(Matrix.Translation(delta))
lo, hi = mesh_bounds()
top_z = hi.z
print("SINGLE BALL bounds size", [round(v, 4) for v in (hi - lo)], "top_z", round(top_z, 4))

# --- decimate to per-ball tri budget ----------------------------------------
tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
if tris > TARGET_TRIS_PER_BALL:
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.ratio = max(0.02, TARGET_TRIS_PER_BALL / tris)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
tris_after = sum(len(p.vertices) - 2 for p in obj.data.polygons)
print("TRIS per ball", tris, "->", tris_after)

bpy.ops.object.shade_smooth()

# --- downscale textures ------------------------------------------------------
for img in bpy.data.images:
    if img.size[0] > MAX_TEX or img.size[1] > MAX_TEX:
        img.scale(min(img.size[0], MAX_TEX), min(img.size[1], MAX_TEX))
        print("SCALED TEX", img.name, "->", tuple(img.size))

# --- build the pair hierarchy ------------------------------------------------
root = bpy.data.objects.new(KEY, None)
root.empty_display_size = 0.05
bpy.context.collection.objects.link(root)


def attach(child, parent, loc, rot_z=0.0):
    child.parent = parent
    child.matrix_parent_inverse.identity()
    child.location = loc
    child.rotation_euler = (0.0, 0.0, rot_z)


# Left ball = the built object.
obj.name = "InkBall_Left"
if obj.data.materials:
    obj.data.materials[0].name = "InkBallLeather"
attach(obj, root, Vector((-HALF_SEP, 0.0, 0.0)))

# Right ball = instance sharing the same mesh data (one embedded texture set),
# yawed 180deg so the seam faces outward.
right = obj.copy()  # shares obj.data
bpy.context.collection.objects.link(right)
right.name = "InkBall_Right"
attach(right, root, Vector((HALF_SEP, 0.0, 0.0)), rot_z=math.radians(180.0))


def add_pivot(name, parent, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.015
    bpy.context.collection.objects.link(e)
    e.parent = parent
    e.matrix_parent_inverse.identity()
    e.location = Vector(loc)
    return e


# Handle-aligned centerline pivots, in each ball's local frame (origin = pad
# contact, +Z up). These ride the parent ball node's yaw automatically.
for side, ball in (("Left", obj), ("Right", right)):
    add_pivot(f"InkBall_{side}_grip", ball, (0.0, 0.0, top_z))          # hand / dab handle
    add_pivot(f"InkBall_{side}_rock", ball, (0.0, 0.0, 0.0))            # rock pivot (pad contact)
    add_pivot(f"InkSurface_{side}", ball, (0.0, 0.0, top_z * 0.10))     # ink-loaded leather face

# --- export ------------------------------------------------------------------
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=DST,
    export_format="GLB",
    export_yup=True,
    export_image_format="JPEG",   # embed as JPEG (M4 convention) to hold GLB <=1MB
    export_jpeg_quality=90,
    export_animations=False,
    use_selection=True,
)
print("WROTE", DST, os.path.getsize(DST))
print("INK BALL ASSEMBLE DONE")
