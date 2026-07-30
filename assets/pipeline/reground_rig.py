# Re-ground a rigged presenter so the bind-pose feet sit exactly on z=0, without
# touching the mesh, skin, morph or clips. The clip-retarget bake can leave the
# rest pose a centimetre or two off the floor; the runtime re-grounds on load, but
# the asset convention (and verify_presenter_face.py) wants feet at 0. This is a
# single uniform vertical translation of the scene roots, so every deformation and
# animation channel is preserved bit-for-bit and only the origin moves.
#
# Run:
#   blender --background --python reground_rig.py -- in.glb out.glb
import bpy, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC = os.path.abspath(argv[0])
DST = os.path.abspath(argv[1])
os.makedirs(os.path.dirname(DST), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
character = [o for o in meshes if (o.parent and o.parent.type == "ARMATURE") or len(o.vertex_groups) > 0]
assert len(character) == 1, f"expected 1 character mesh, got {len(character)}"
mesh = character[0]

# Measure at the neutral bind pose: mute animation, zero morphs.
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
if arm is not None and arm.animation_data is not None:
    for tr in arm.animation_data.nla_tracks:
        tr.mute = True
    arm.animation_data.action = None
if mesh.data.shape_keys:
    for kb in mesh.data.shape_keys.key_blocks:
        kb.value = 0.0
bpy.context.view_layer.update()

deps = bpy.context.evaluated_depsgraph_get()
ev = mesh.evaluated_get(deps)
m = ev.to_mesh()
min_z = min((ev.matrix_world @ v.co).z for v in m.vertices)
ev.to_mesh_clear()
print(f"minZ before reground = {min_z:.4f}")

roots = [o for o in bpy.data.objects if o.parent is None]
for o in roots:
    o.location.z -= min_z
bpy.context.view_layer.update()

# Re-measure to confirm.
deps = bpy.context.evaluated_depsgraph_get()
ev = mesh.evaluated_get(deps)
m = ev.to_mesh()
min_z2 = min((ev.matrix_world @ v.co).z for v in m.vertices)
ev.to_mesh_clear()
print(f"minZ after reground  = {min_z2:.4f}")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=DST,
    export_format="GLB",
    export_yup=True,
    export_skins=True,
    export_morph=True,
    export_morph_normal=True,
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_image_format="JPEG",
    export_jpeg_quality=90,
)
print("WROTE", DST, os.path.getsize(DST))
