# Inspect a rigged presenter GLB's mesh: triangle budget, world bounds, and the
# facial MIDLINE PROFILE (nose tip, lip line, chin, neck) in world metres.
#
# WHY THIS EXISTS
#   add_presenter_face_rig.py places the jawOpen morph using world-Z bands read
#   off ONE specific inspected mesh (Z_UPPER_LIP=1.515 etc). A regenerated
#   presenter has a different face height, so those constants must be re-derived
#   from the new mesh or the jaw drop lands on the wrong band and lip-sync breaks
#   (or the verify_presenter_face.py gate rejects it). The original author read
#   the profile with a private .affordwork script; this is the in-repo, lane-open
#   equivalent so the derivation is reproducible.
#
#   glTF import is Z-up and FRONT is -Y (matches render_presenter_appearance_qa.py
#   and add_presenter_face_rig.py). "Frontmost" therefore means most-negative Y.
#
# Run:
#   blender --background --python inspect_presenter_profile.py -- <glb>
import bpy, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
SRC = os.path.abspath(argv[0]) if argv else os.path.abspath(
    "apps/web/public/world/characters/system-presenter-rigged.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

all_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
character = [o for o in all_meshes if (o.parent and o.parent.type == "ARMATURE") or len(o.vertex_groups) > 0]
assert len(character) == 1, f"expected 1 character mesh, got {len(character)} of {len(all_meshes)}"
mesh = character[0]
me = mesh.data

# Neutral bind pose: mute animation, zero morphs, so the profile is the rest face.
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
if arm is not None and arm.animation_data is not None:
    for tr in arm.animation_data.nla_tracks:
        tr.mute = True
    arm.animation_data.action = None
if me.shape_keys:
    for kb in me.shape_keys.key_blocks:
        kb.value = 0.0
bpy.context.view_layer.update()

tris = sum(len(p.vertices) - 2 for p in me.polygons)
mw = mesh.matrix_world
world = [mw @ v.co for v in me.vertices]
mn = Vector((min(w.x for w in world), min(w.y for w in world), min(w.z for w in world)))
mx = Vector((max(w.x for w in world), max(w.y for w in world), max(w.z for w in world)))
height = mx.z - mn.z

print(f"MESH {mesh.name}: verts={len(me.vertices)} tris={tris}")
print(f"BOUNDS min=({mn.x:.3f},{mn.y:.3f},{mn.z:.3f}) max=({mx.x:.3f},{mx.y:.3f},{mx.z:.3f}) height={height:.4f}")
print(f"MATERIALS {len([m for m in me.materials if m])} SHAPEKEYS "
      f"{list(me.shape_keys.key_blocks.keys()) if me.shape_keys else []}")

# Midline slab (|x| small): scan Z from crown down, report frontmost (min-y) vertex
# per 1cm band so the nose/lip/chin can be read straight off the numbers.
midline = [w for w in world if abs(w.x) < 0.05]
if not midline:
    midline = [w for w in world if abs(w.x) < 0.08]
crown = mx.z
print(f"MIDLINE PROFILE (|x|<0.05, {len(midline)} verts), front = most -Y:")
print("   z(m)   frontY(m)   (scanning crown downward)")
z = crown
band = 0.01
face_floor = crown - 0.34  # a human face+neck spans well under 34cm
while z > face_floor:
    inband = [w for w in midline if z - band <= w.z < z]
    if inband:
        front = min(inband, key=lambda w: w.y)
        print(f"  {z:6.3f}   {front.y:+.4f}   n={len(inband)}")
    z -= band

# Frontmost vertex overall in the upper face = nose tip candidate.
upper = [w for w in midline if w.z > crown - 0.22]
if upper:
    nose = min(upper, key=lambda w: w.y)
    print(f"NOSE TIP candidate: z={nose.z:.4f} y={nose.y:.4f} (frontmost in top 22cm)")
# Offsets validated against the shipped rig (crown 1.700, upperLip 1.515, etc).
print(f"SUGGESTION crown-relative (shipped-rig offsets), crown={crown:.3f}: "
      f"upperLip={crown-0.185:.3f} mouthTop={crown-0.208:.3f} chinBot={crown-0.248:.3f} "
      f"neck={crown-0.264:.3f} pivotZ={crown-0.148:.3f}")
