# Optimize + name the M4 prop batch. Scoped to assets/build/world-m4 -> world-m4-opt
# so it never touches other factory batches. Per key: decimate to a tri budget,
# downscale textures to <=1024, wrap the mesh under a single named root node, and
# (for the B11 event kit) add object-space named pivot empties positioned by the
# measured bounding box so the runtime can hang/swing/carry/light the imported
# GLB without any procedural stand-in geometry.
#
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
#        --python assets/pipeline/m4/optimize_m4_props.py
import bpy
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "build", "world-m4")
OUT = os.path.join(ROOT, "build", "world-m4-opt")
MAX_TEX = 1024

# key -> tri budget
TARGETS = {
    "roof-walk-board": 12000,
    "roof-walk-board-long": 14000,
    "effigy-oliver": 16000,
    "effigy-boot": 8000,
    "organizer-crate-perch": 12000,
    "protest-torch": 5000,
    "protest-banner-cloth": 6000,
    "coin-paper-set": 4000,
    "street-dog": 16000,
}

# key -> [(pivotName, (fx, fHeight, fDepth))] where each f is a bbox fraction:
#   fx in [-0.5,0.5] across footprint width, fDepth in [-0.5,0.5] across
#   footprint depth (+ = front/+Z in glTF), fHeight in [0,1] from feet (0) to
#   top (1). Empties are parented to the named root. NB: the glTF importer maps
#   Y-up glTF to Z-up Blender, so height is Blender Z and depth is Blender Y.
PIVOTS = {
    "effigy-oliver": [
        ("effigy_hang_pivot", (0.0, 1.0, 0.0)),
        ("effigy_carry_pivot", (0.0, 0.5, 0.0)),
        ("placard_mount", (0.0, 0.62, 0.45)),
    ],
    "effigy-boot": [
        ("boot_swing_pivot", (0.0, 1.0, 0.0)),
    ],
    "protest-torch": [
        ("torch_flame", (0.0, 1.0, 0.0)),
    ],
    "protest-banner-cloth": [
        ("banner_face", (0.0, 0.6, 0.35)),
        ("banner_sway_pivot", (0.0, 1.0, 0.0)),
    ],
    "organizer-crate-perch": [
        ("perch_stand", (0.0, 1.0, 0.0)),
    ],
}

# Final runtime asset key rename (drop the "-cloth" suffix on the banner).
RENAME = {"protest-banner-cloth": "protest-banner"}

os.makedirs(OUT, exist_ok=True)


def world_bbox(meshes):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return lo, hi


for key, target in sorted(TARGETS.items()):
    src = os.path.join(SRC, key + ".glb")
    if not os.path.exists(src):
        print("MISSING", key)
        continue
    out_key = RENAME.get(key, key)
    dst = os.path.join(OUT, out_key + ".glb")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        print("NO MESH", key)
        continue

    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        tri = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if total > target and tri > 1200:
            mod = obj.modifiers.new("dec", "DECIMATE")
            mod.ratio = max(0.04, target / total)
            bpy.ops.object.modifier_apply(modifier=mod.name)
    for img in bpy.data.images:
        if img.size[0] > MAX_TEX or img.size[1] > MAX_TEX:
            img.scale(min(img.size[0], MAX_TEX), min(img.size[1], MAX_TEX))

    bpy.context.view_layer.update()
    lo, hi = world_bbox(meshes)
    size = hi - lo
    ctr = (lo + hi) * 0.5

    # Root empty carrying the semantic asset key; parent all meshes to it.
    root = bpy.data.objects.new(out_key, None)
    root.empty_display_size = 0.2
    bpy.context.collection.objects.link(root)
    for i, obj in enumerate(meshes):
        obj.name = f"{out_key}_mesh" if len(meshes) == 1 else f"{out_key}_mesh_{i}"
        wm = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = wm

    for name, (fx, f_height, f_depth) in PIVOTS.get(key, []):
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 0.12
        bpy.context.collection.objects.link(e)
        e.parent = root
        # Blender is Z-up after the glTF import; height runs along Z, footprint
        # depth along Y. Root sits at the origin, so local == world here.
        e.location = Vector((
            ctr.x + fx * size.x,
            ctr.y + f_depth * size.y,
            lo.z + f_height * size.z,
        ))

    tot_after = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=82,
        export_animations=False,
    )
    print("WROTE", dst, os.path.getsize(dst), "tris", total, "->", tot_after,
          "pivots", len(PIVOTS.get(key, [])))

print("M4 PROPS OPT DONE")
