# Optimize the imported printshop-hanging-sign prop produced by
#   gen_concept_image.mjs -> gen_prop_from_image.mjs (Meshy image-to-3D).
#
# Scoped to a SINGLE key so it never touches the factory batches or other
# world-v3 props. Reads assets/build/world-v3/printshop-hanging-sign.glb and
# writes assets/build/world-v3-opt/printshop-hanging-sign.glb.
#
# What it does:
#   - Joins the (already single) Meshy mesh and decimates to <= TARGET_TRIS.
#   - Caps embedded textures at MAX_TEX (albedo + normal), re-embeds as JPEG.
#   - Relocates the origin to the WALL MOUNTING-PLATE end so the asset can be
#     placed against a facade without manual offset.
#
# Meshy fused the whole assembly (bracket + chains + signboard) into one mesh
# of ~2000 disconnected shells, so a clean semantic Bracket/Signboard object or
# material split is NOT safe and is deliberately not attempted (reported in the
# task sidecar instead). The flat signboard face keeps its own UV region in the
# single Material_0 slot, so authored Mercer lettering/artwork can be layered on
# later by overriding that material's base texture.
#
# Local axes of the exported GLB (glTF / three, y-up):
#   +X : projection direction, from wall mounting plate toward the signboard (~1.9 m)
#   +Y : up (~1.06 m)
#   +/-Z : the two double-sided board faces / thickness (~0.14 m)
#   origin (0,0,0) : wall mounting-plate end -- X at the plate (min X), Y at the
#                    plate's vertical center, Z at the thickness center.
#
# Run:
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#     --python assets/pipeline/optimize_printshop_sign.py
import bpy
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "world-v3", "printshop-hanging-sign.glb")
OUT_DIR = os.path.join(ROOT, "build", "world-v3-opt")
DST = os.path.join(OUT_DIR, "printshop-hanging-sign.glb")
MAX_TEX = 1024
TARGET_TRIS = 7500

os.makedirs(OUT_DIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

import mathutils

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("NO MESH imported")

# Join any multi-mesh export into one object.
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
obj.name = "PrintshopHangingSign"

src_tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)

# Decimate to the triangle budget.
if src_tris > TARGET_TRIS:
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = max(0.02, TARGET_TRIS / src_tris)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)

out_tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)

# --- Relocate origin to the wall mounting-plate end (Blender coords) ---
# Blender axes here: X = horizontal span, Y = thickness, Z = vertical.
verts = [obj.matrix_world @ v.co for v in obj.data.vertices]
xs = [p.x for p in verts]
ys = [p.y for p in verts]
zs = [p.z for p in verts]
min_x, max_x = min(xs), max(xs)
width = max_x - min_x
thick_center = (min(ys) + max(ys)) / 2.0

# Vertical center of the plate = vertical center of the min-X (wall) slab.
plate_slab = [p for p in verts if p.x <= min_x + 0.12 * width]
plate_vert_center = (min(p.z for p in plate_slab) + max(p.z for p in plate_slab)) / 2.0

# Translate geometry so the mounting-plate junction sits at the world origin,
# then bake the transform so it is the exported origin.
obj.location.x -= min_x
obj.location.y -= thick_center
obj.location.z -= plate_vert_center
bpy.context.view_layer.objects.active = obj
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# --- Cap texture resolution ---
for img in bpy.data.images:
    if img.size[0] > MAX_TEX or img.size[1] > MAX_TEX:
        img.scale(min(img.size[0], MAX_TEX), min(img.size[1], MAX_TEX))

bpy.ops.export_scene.gltf(
    filepath=DST,
    export_format="GLB",
    export_yup=True,
    export_image_format="JPEG",
    export_jpeg_quality=85,
    export_animations=False,
)

# Report final bounds in exported (glTF y-up) orientation.
verts2 = [obj.matrix_world @ v.co for v in obj.data.vertices]
bx = (min(p.x for p in verts2), max(p.x for p in verts2))
by = (min(p.y for p in verts2), max(p.y for p in verts2))  # -> glTF Z (thickness)
bz = (min(p.z for p in verts2), max(p.z for p in verts2))  # -> glTF Y (up)
print("WROTE", DST, os.path.getsize(DST))
print("SRC_TRIS", src_tris, "OUT_TRIS", out_tris)
print("MATERIALS", [m.name for m in obj.data.materials])
print("ORIGIN_BLENDER_SPAN_X %.3f..%.3f (0 at plate)" % (bx[0], bx[1]))
print("SPAN_UP_Z %.3f..%.3f" % (bz[0], bz[1]))
print("SPAN_THICK_Y %.3f..%.3f" % (by[0], by[1]))
print("PRINTSHOP SIGN OPT DONE")
