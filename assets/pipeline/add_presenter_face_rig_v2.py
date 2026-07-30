# Add the jawOpen speech morph to a REGENERATED presenter, deriving the facial
# bands from the mesh itself instead of the hardcoded world-Z constants in
# add_presenter_face_rig.py.
#
# WHY A v2
#   add_presenter_face_rig.py's Z_UPPER_LIP=1.515 etc were read off ONE inspected
#   mesh. A regenerated presenter has a different face position, so those absolute
#   constants land the jaw on the wrong band. This script finds the midline NOSE
#   TIP (the frontmost upper-face vertex, which the original script names as the
#   fixed anchor that MUST NOT MOVE) and rebuilds the SAME proven geometry as
#   offsets from it, so it self-fits any presenter of human scale.
#
#   The nose tip is the right anchor, not the crown: hair height varies, so
#   crown-relative bands drift (this cast's nose sits crown-0.21, the reference
#   mesh's at crown-0.17). The offsets below are exactly the shipped rig's,
#   expressed as (nose - dz), read back from add_presenter_face_rig.py's own
#   constants (nose 1.529, upperLip 1.515, mouthTop 1.492, chin 1.452, neck 1.436):
#     upperLip nose-0.014, mouthTop nose-0.037, chinBot nose-0.077,
#     neck nose-0.093, pivot z nose+0.023; front falloff nose_y+0.071/+0.116.
#   verify_presenter_face.py is still the gate: it independently asserts the jaw
#   moves >=50 verts, drops <=0.05 m, and moves NOTHING above its absolute
#   upper-lip line, so this derivation cannot ship a mis-placed morph unnoticed.
#
# Run:
#   blender --background --python add_presenter_face_rig_v2.py -- in.glb out.glb
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC = os.path.abspath(argv[0])
DST = os.path.abspath(argv[1])
os.makedirs(os.path.dirname(DST), exist_ok=True)

OPEN_ANGLE = 0.20   # radians (~11.5 deg) at influence 1.0; runtime caps lower
MORPH_NAME = "jawOpen"


def smoothstep(edge0, edge1, x):
    if edge0 == edge1:
        return 1.0 if x >= edge1 else 0.0
    t = (x - edge0) / (edge1 - edge0)
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def rotate_x_about(w, pivot, angle):
    dy = w.y - pivot.y
    dz = w.z - pivot.z
    ca, sa = math.cos(angle), math.sin(angle)
    return Vector((w.x, pivot.y + dy * ca - dz * sa, pivot.z + dy * sa + dz * ca))


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=SRC)

# The real character is the skinned mesh; drop any stray importer primitive.
all_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
character = [o for o in all_meshes if (o.parent and o.parent.type == "ARMATURE") or len(o.vertex_groups) > 0]
assert len(character) == 1, f"expected exactly one character mesh, got {len(character)} of {len(all_meshes)}"
for o in all_meshes:
    if o not in character:
        print("DROP stray mesh", o.name, len(o.data.vertices), "verts")
        bpy.data.objects.remove(o, do_unlink=True)
obj = character[0]
me = obj.data
mw = obj.matrix_world
mwi = mw.inverted()

assert me.shape_keys is None, "mesh already has shape keys; refusing to double-add"

# --- Derive the facial bands from the mesh (crown- and nose-relative). --------
world = [mw @ v.co for v in me.vertices]
crown = max(w.z for w in world)
midline = [w for w in world if abs(w.x) < 0.05] or [w for w in world if abs(w.x) < 0.08]
# Nose tip = frontmost (most -Y) midline vertex in the upper face band.
upper = [w for w in midline if w.z > crown - 0.22]
nose = min(upper, key=lambda w: w.y) if upper else min(midline, key=lambda w: w.y)
nose_y = nose.y
nose_z = nose.z

Z_UPPER_LIP = nose_z - 0.014  # influence 0 at/above (protects nose/upper lip)
Z_MOUTH_TOP = nose_z - 0.037  # influence ramps to 1 by here (lower lip)
Z_CHIN_BOT = nose_z - 0.077   # full influence down to the chin underside
Z_NECK = nose_z - 0.093       # influence 0 at/below (protects the neck)
Y_FRONT_FULL = nose_y + 0.071 # full influence forward of this depth (front = -y)
Y_FRONT_ZERO = nose_y + 0.116 # zero influence behind this depth
X_FULL = 0.075                # central lower face; hair hangs beyond ~0.11
X_ZERO = 0.115
PIVOT = Vector((0.0, nose_y + 0.131, nose_z + 0.023))  # jaw hinge, ~TMJ height

print(f"DERIVED crown={crown:.4f} nose=(y={nose_y:.4f},z={nose_z:.4f})")
print(f"  upperLip={Z_UPPER_LIP:.4f} mouthTop={Z_MOUTH_TOP:.4f} chinBot={Z_CHIN_BOT:.4f} "
      f"neck={Z_NECK:.4f} pivotZ={PIVOT.z:.4f}")


def jaw_mask(w):
    if w.z >= Z_UPPER_LIP or w.z <= Z_NECK:
        vz = 0.0
    elif w.z >= Z_MOUTH_TOP:
        vz = smoothstep(Z_UPPER_LIP, Z_MOUTH_TOP, w.z)
    elif w.z <= Z_CHIN_BOT:
        vz = smoothstep(Z_NECK, Z_CHIN_BOT, w.z)
    else:
        vz = 1.0
    if vz <= 0.0:
        return 0.0
    vy = smoothstep(Y_FRONT_ZERO, Y_FRONT_FULL, w.y)
    if vy <= 0.0:
        return 0.0
    vx = 1.0 - smoothstep(X_FULL, X_ZERO, abs(w.x))
    return vz * vy * vx


basis = obj.shape_key_add(name="Basis", from_mix=False)
jaw = obj.shape_key_add(name=MORPH_NAME, from_mix=False)

moved = 0
max_drop = 0.0
for i, v in enumerate(me.vertices):
    w = mw @ v.co
    m = jaw_mask(w)
    if m <= 0.0:
        continue
    neww = rotate_x_about(w, PIVOT, OPEN_ANGLE * m)
    jaw.data[i].co = mwi @ neww
    moved += 1
    max_drop = max(max_drop, w.z - neww.z)

print(f"JAW SHAPE moved={moved} verts, max_z_drop={max_drop:.4f} m at influence 1.0")
assert moved > 50, "jaw mask selected too few vertices; the derived bands are wrong for this mesh"
assert max_drop <= 0.05, f"jaw drop {max_drop:.4f} exceeds the restrained-motion ceiling"

# Preserve any imported clips (idle/talk/talk2 stashed in muted NLA tracks); only
# clear the active action so the exporter does not emit it twice.
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
if arm is not None and arm.animation_data is not None:
    arm.animation_data.action = None
    print("NLA CLIPS", [t.name for t in arm.animation_data.nla_tracks])

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
