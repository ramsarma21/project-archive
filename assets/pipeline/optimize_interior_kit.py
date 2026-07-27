# Optimize the interior FURNISHING/TRADE kit GLBs, scoped ONLY to this kit's
# keys so it never touches the shared world-v3 / world-v3-opt build tree used by
# the structural / wharf workers.
#   src: assets/build/interior-kit/<key>.glb   (raw Meshy)
#   out: assets/build/interior-kit-opt/<key>.glb
# Per-key triangle + texture budgets mirror interior_kit_queue.mjs.
# For each asset: decimate to the tri budget, scale textures to the tex budget,
# recalc normals outward, drop non-mesh junk (cameras/lights/empties),
# ground to y=0 and center on x/z, export GLB (JPEG textures, no animations).
# Run:
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#     --python assets/pipeline/optimize_interior_kit.py
import bpy
import os
import sys
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from transcode_static_textures import enforce_texture_policy  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "interior-kit")
OUT = os.path.join(ROOT, "build", "interior-kit-opt")

# key -> (tri_budget, max_texture) mirroring interior_kit_queue.mjs
BUDGETS = {
    "int-paper-surface-flat": (2000, 512),
    "int-foodware-cluster": (8000, 512),
    "int-pantry-cupboard-stocked": (12000, 1024),
    "int-textile-personal-cluster": (10000, 512),
    "int-wall-peg-cluster": (8000, 512),
    "int-repair-mending-cluster": (8000, 512),
    "press-common-operable": (15000, 1024),
    "printer-composition-workstation": (15000, 1024),
    "printer-drying-rack": (10000, 1024),
    "merchant-scale-measure": (8000, 512),
    "court-record-pigeonholes": (12000, 1024),
    "court-sealing-desk": (10000, 1024),
    "customhouse-counter-gate": (15000, 1024),
    "crown-arms-1760": (8000, 1024),
    "customs-seizure-shelf": (12000, 1024),
    "meetinghouse-box-pew-block": (12000, 1024),
    "meetinghouse-pulpit-soundingboard": (15000, 1024),
    "meetinghouse-gallery-impression": (20000, 1024),
    "meetinghouse-deacons-set": (8000, 512),
    "tavern-serving-dresser": (12000, 1024),
    "warehouse-platform-scale": (12000, 1024),
    "warehouse-hoist-tackle": (10000, 1024),
    "chandlery-stock-cluster": (15000, 1024),
    "ropewalk-laying-rig": (15000, 1024),
    "tailor-workbench-stock": (15000, 1024),
    "shoemaker-workbench-stock": (15000, 1024),
    "baker-stock-cluster": (15000, 1024),
    "provisions-stock-cluster": (15000, 1024),
    "bookseller-stock-cluster": (15000, 1024),
}

os.makedirs(OUT, exist_ok=True)


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


processed = 0
for key, (target, max_tex) in sorted(BUDGETS.items()):
    src = os.path.join(SRC, key + ".glb")
    dst = os.path.join(OUT, key + ".glb")
    if not os.path.exists(src):
        print("MISSING", key)
        continue

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    # Drop any non-mesh junk Meshy/importer may add (cameras, lights, empties).
    for obj in list(bpy.data.objects):
        if obj.type not in ("MESH",):
            bpy.data.objects.remove(obj, do_unlink=True)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        print("NO_MESH", key)
        continue

    src_tris = tri_count(meshes)

    # Decimate the whole asset proportionally toward the tri budget.
    if src_tris > target:
        ratio = max(0.04, target / src_tris)
        for obj in meshes:
            tri = sum(len(p.vertices) - 2 for p in obj.data.polygons)
            if tri > 500:
                bpy.context.view_layer.objects.active = obj
                mod = obj.modifiers.new("dec", "DECIMATE")
                mod.ratio = ratio
                bpy.ops.object.modifier_apply(modifier=mod.name)

    # Recalculate normals outward.
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)

    # Scale down oversized textures.
    for img in bpy.data.images:
        if img.size[0] > max_tex or img.size[1] > max_tex:
            img.scale(min(img.size[0], max_tex), min(img.size[1], max_tex))

    # Ground to the floor and center horizontally. glTF imports Y-up as Blender
    # Z-up, so the vertical axis in Blender is Z; export_yup=True converts it
    # back to glTF Y at export, leaving the asset grounded at glTF y=0.
    bpy.context.view_layer.update()
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            mins = Vector((min(mins[i], world[i]) for i in range(3)))
            maxs = Vector((max(maxs[i], world[i]) for i in range(3)))
    center = (mins + maxs) / 2.0
    offset = Vector((-center.x, -center.y, -mins.z))
    for obj in meshes:
        obj.location += offset
    bpy.context.view_layer.update()

    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=85,
        export_animations=False,
    )
    # This factory already forces JPEG, so it is not a source of the multi-megabyte
    # PNG albedo the interior shells and the door kit had. What it does not do is
    # police alphaMode: a Meshy source material can arrive with a blend mode set,
    # and the exporter faithfully writes alphaMode BLEND over an albedo with no
    # transparency in it, which buys a sorted transparent draw per instance for
    # nothing. The policy pass measures alpha and relaxes those to OPAQUE; the
    # image half is a no-op here.
    enforce_texture_policy(dst, quality=95, skip_normals=True)
    out_tris = tri_count([o for o in bpy.data.objects if o.type == "MESH"])
    print("WROTE", key, os.path.getsize(dst), "srcTris", src_tris, "outTris", out_tris, "target", target, "tex", max_tex)
    processed += 1

print("INTERIOR KIT OPT DONE", processed)
