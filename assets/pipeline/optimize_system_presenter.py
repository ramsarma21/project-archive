# Targeted web optimizer for a SINGLE rigged character GLB.
#
# optimize_rigged.py is batch-only: it walks build/characters/*-rigged.glb and
# writes build/characters-opt/. That is wrong for a one-off hero asset generated
# while another worker may be touching neighbouring files. This script optimizes
# exactly one input to one output and touches nothing else: decimate skinned
# meshes to a triangle budget, clamp textures to a max dimension, re-export a
# compact GLB with skin weights + skeleton preserved and animations dropped
# (runtime supplies its own clips). Materials are left as-is here; emissive/
# albedo cleanup is a separate JSON-only pass (fix_rig_emissive.py).
#
# A hero presenter is shown ONE at a time in medium/close cinematic shots, so its
# face must survive optimization. Uniform decimation to 30k shattered the curved
# face/hair into a sparse shell soup (angular nose facets, a midline seam ridge and
# jagged hair/decolletage shards) that the base 51k mesh does not have. The optional
# protectFrac argument therefore shields the camera-facing upper body from the
# decimator: vertices whose world height is above (minZ + protectFrac*height) are
# put in a "keep" group with zero collapse weight, so the head/hair/torso keep their
# base density while the lower body (legs) still decimates to hold the budget.
#
# Run:
#   blender --background --python optimize_system_presenter.py -- in.glb out.glb [targetTris] [maxTex] [protectFrac]
import bpy
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC = os.path.abspath(argv[0])
DST = os.path.abspath(argv[1])
TARGET_TRIS = int(argv[2]) if len(argv) > 2 else 30000
MAX_TEX = int(argv[3]) if len(argv) > 3 else 1024
PROTECT_FRAC = float(argv[4]) if len(argv) > 4 else None  # e.g. 0.60 protects the top 40%

os.makedirs(os.path.dirname(DST), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
assert meshes, "no meshes"

total = 0
for obj in meshes:
    total += sum(len(p.vertices) - 2 for p in obj.data.polygons)
print(f"IN tris={total}")

# World-height threshold below which decimation is allowed (upper body protected).
protect_z = None
if PROTECT_FRAC is not None:
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for obj in meshes:
        mw = obj.matrix_world
        for v in obj.data.vertices:
            w = mw @ v.co
            for i in range(3):
                mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    protect_z = mn.z + (mx.z - mn.z) * PROTECT_FRAC
    print(f"PROTECT upper body: world z > {protect_z:.4f} (frac {PROTECT_FRAC})")

for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    tri = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if total > TARGET_TRIS and tri > 2000:
        mod = obj.modifiers.new("dec", "DECIMATE")
        mod.ratio = max(0.05, TARGET_TRIS / total)
        if protect_z is not None:
            # Zero collapse weight above protect_z; full below. Decimate COLLAPSE
            # reads this group so the protected verts are never merged away.
            vg = obj.vertex_groups.new(name="keep_hires")
            mw = obj.matrix_world
            lo, hi = [], []
            for v in obj.data.vertices:
                if (mw @ v.co).z > protect_z:
                    hi.append(v.index)
                else:
                    lo.append(v.index)
            if hi:
                vg.add(hi, 0.0, "REPLACE")
            if lo:
                vg.add(lo, 1.0, "REPLACE")
            mod.vertex_group = vg.name
            mod.vertex_group_factor = 1.0
            mod.invert_vertex_group = False
            print(f"  protected {len(hi)} verts, decimating {len(lo)}")
        bpy.ops.object.modifier_apply(modifier=mod.name)

for img in bpy.data.images:
    if img.size[0] > MAX_TEX or img.size[1] > MAX_TEX:
        print(f"SCALE image {img.name} {tuple(img.size)} -> {MAX_TEX}")
        img.scale(min(img.size[0], MAX_TEX), min(img.size[1], MAX_TEX))

out_total = 0
for obj in meshes:
    out_total += sum(len(p.vertices) - 2 for p in obj.data.polygons)
print(f"OUT tris={out_total}")

bpy.ops.export_scene.gltf(
    filepath=DST,
    export_format="GLB",
    export_yup=True,
    export_image_format="JPEG",
    export_jpeg_quality=85,
    export_animations=False,
    export_skins=True,
)
print("WROTE", DST, os.path.getsize(DST))
