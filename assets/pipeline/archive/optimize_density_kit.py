# Optimize the outdoor-density-kit Meshy GLBs (assets/build/world-v3 ->
# assets/build/world-v3-opt). Scoped to ONLY the keys listed in
# density_kit.json so it never touches other overnight workers' batches that
# share the world-v3 folders.
#
# Per key it: decimates to the kit tri budget, shrinks textures to the kit max,
# then FITS the module to the ground: centers X/Y in Blender and drops min Z to
# 0 so that after export_yup the module sits on y=0 with the origin centered in
# X/Z (see density_kit.json _meta.axes). Re-exports GLB, JPEG textures, no anim.
#
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
#        --python assets/pipeline/optimize_density_kit.py
import bpy
import os
import json
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "world-v3")
OUT = os.path.join(ROOT, "build", "world-v3-opt")
KIT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "density_kit.json")

with open(KIT) as fh:
    kit = json.load(fh)
TARGETS = {a["key"]: a for a in kit["assets"]}

os.makedirs(OUT, exist_ok=True)


def world_bounds(meshes):
    mins = Vector((1e18, 1e18, 1e18))
    maxs = Vector((-1e18, -1e18, -1e18))
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for i in range(3):
                mins[i] = min(mins[i], world[i])
                maxs[i] = max(maxs[i], world[i])
    return mins, maxs


done = []
for key, spec in sorted(TARGETS.items()):
    name = key + ".glb"
    src = os.path.join(SRC, name)
    if not os.path.exists(src):
        print("MISSING", name)
        continue
    dst = os.path.join(OUT, name)
    target = spec["triBudget"]
    max_tex = spec["maxTex"]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        print("NO MESH", name)
        continue

    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        tri = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if total > target and tri > 800:
            mod = obj.modifiers.new("dec", "DECIMATE")
            mod.ratio = max(0.03, target / total)
            bpy.ops.object.modifier_apply(modifier=mod.name)

    for img in bpy.data.images:
        if img.size[0] > max_tex or img.size[1] > max_tex:
            img.scale(min(img.size[0], max_tex), min(img.size[1], max_tex))

    # Ground-fit: center X/Y, drop min Z to 0 (Blender Z-up -> glTF Y-up on
    # export_yup, so module rests on y=0 with origin centered in X/Z).
    mins, maxs = world_bounds(meshes)
    cx = (mins[0] + maxs[0]) / 2.0
    cy = (mins[1] + maxs[1]) / 2.0
    delta = Vector((-cx, -cy, -mins[2]))
    for obj in bpy.data.objects:
        if obj.parent is None:
            obj.location = obj.location + delta

    bpy.context.view_layer.update()
    fmins, fmaxs = world_bounds([o for o in bpy.data.objects if o.type == "MESH"])
    final_tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons)
                     for o in bpy.data.objects if o.type == "MESH")

    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=80,
        export_animations=False,
    )
    print("WROTE", dst, os.path.getsize(dst),
          "tris", final_tris, "target", target, "srcTris", total,
          "size", [round(fmaxs[i] - fmins[i], 3) for i in range(3)],
          "minZ", round(fmins[2], 4))
    done.append(key)

print("DENSITY KIT OPT DONE", len(done), "of", len(TARGETS))
