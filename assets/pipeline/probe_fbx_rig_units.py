# Report the unit space of a Mixamo-rigged character FBX/GLB as Blender sees it.
#
# WHY THIS EXISTS. `officer-rigged.glb` shipped at 1/100 scale while every one of
# its fourteen siblings, baked by the same script in the same batch, came out
# human-sized. The difference cannot be in the bake code, so it has to be in the
# input, and the only way to see it is from inside Blender: the FBX importer's
# unit handling is what differs between these files, and nothing downstream of
# the import records what it decided.
#
# Prints, for the armature and each skinned mesh:
#   * the scene unit scale and the FBX's own declared unit scale;
#   * the armature OBJECT scale (Mixamo FBX imports at 0.01; a metre rig at 1.0);
#   * the Hips rest length in armature-local units - the quantity
#     rescale_hips_location divides by, so ~110 means centimetres and ~1.1 metres;
#   * the mesh bounds in LOCAL units and in WORLD metres. The gap between those
#     two columns is the whole question: local tells you what unit the vertices
#     are in, world tells you whether the object transform corrects for it.
#
# Usage:
#   blender --background --python probe_fbx_rig_units.py -- in.fbx [more ...]
import bpy
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def probe(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lower = path.lower()
    if lower.endswith(".glb") or lower.endswith(".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        bpy.ops.import_scene.fbx(filepath=path, use_anim=True)
    bpy.context.view_layer.update()

    rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    print(f"=== {os.path.basename(path)}")
    print(f"  scene.unit_settings.scale_length = {bpy.context.scene.unit_settings.scale_length}")
    if rig is None:
        print("  NO ARMATURE")
        return
    print(f"  armature '{rig.name}' scale = {tuple(round(v, 6) for v in rig.scale)}")
    print(f"  armature matrix_world diag  = {tuple(round(rig.matrix_world[i][i], 6) for i in range(4))}")
    hips = next((b for b in rig.data.bones if "Hips" in b.name), None)
    if hips is not None:
        local = hips.matrix_local.translation.length
        world = (rig.matrix_world @ hips.matrix_local.translation).length
        print(f"  Hips rest length: local={local:.6f}  world={world:.6f} m  (bone '{hips.name}')")
    print(f"  bones = {len(rig.data.bones)}")

    for mesh in [o for o in bpy.data.objects if o.type == "MESH"]:
        if not mesh.data.vertices:
            continue
        ys = [v.co.y for v in mesh.data.vertices]
        zs = [v.co.z for v in mesh.data.vertices]
        wz = [(mesh.matrix_world @ v.co).z for v in mesh.data.vertices]
        # Blender is Z-up, so Z is height locally and in world; Y is depth. Both
        # local axes are printed because an FBX that arrives Y-up puts height in Y.
        print(
            f"  mesh '{mesh.name}' verts={len(mesh.data.vertices)} "
            f"parent={mesh.parent.name if mesh.parent else None} "
            f"scale={tuple(round(v, 6) for v in mesh.scale)}"
        )
        print(
            f"    local  spanY={max(ys) - min(ys):.6f}  spanZ={max(zs) - min(zs):.6f}\n"
            f"    world  spanZ={max(wz) - min(wz):.6f} m  minZ={min(wz):.6f}"
        )


for target in argv:
    probe(os.path.abspath(target))
