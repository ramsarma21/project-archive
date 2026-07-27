# Add a minimal, visually believable SPEECH shape key to the System presenter.
#
# WHY THIS EXISTS
#   The presenter narrates a cinematic lesson, so its mouth must visibly move
#   while speaking. The Meshy-generated head is a single closed skin: the lips
#   are a textured seam on a continuous surface with NO mouth cavity and no
#   interior geometry, so an anatomically "open" mouth would either tear the
#   surface or expose a toothless hole. The honest, non-grotesque motion this
#   topology supports is a restrained JAW DROP: the lower-front face (lower lip,
#   chin and jaw underside) rotates down/back about a jaw hinge while the upper
#   lip, nose, cheeks, eyes, forehead and hair stay put. That reads as speaking
#   at a medium/close shot without distorting the face.
#
# WHAT IT PRODUCES
#   One glTF morph target named `jawOpen` on the single mesh, exported alongside
#   the existing body skeleton, skin weights, materials, textures and the idle/
#   talk/talk2 animation clips. The runtime (SystemPresenter.tsx) drives the
#   `jawOpen` morphTargetInfluence from the deterministic moduleLipSync sampler.
#
# REGION SELECTION IS FROM THE INSPECTED MESH, NOT GUESSED
#   Coordinates below are WORLD-space metres, read from the shipped GLB with
#   .affordwork/inspect-presenter-profile.py on the actual mesh:
#     nose tip      z=1.529  (frontmost midline vertex)  -> MUST NOT MOVE
#     upper lip     z~1.515                               -> zero influence
#     mouth/lips    z~1.500-1.510                         -> partial (stretch)
#     lower lip     z~1.495
#     chin front    z~1.472-1.490 (y~-0.081..-0.086)      -> full influence
#     chin underside z~1.451-1.462 (recedes to y~-0.028)  -> full influence
#     neck front    z<1.440                               -> zero (never drag)
#   The jaw hinge pivot sits behind and above the mouth, near ear/TMJ height.
#
# Run:
#   blender --background --python add_presenter_face_rig.py -- in.glb out.glb
import bpy
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC = os.path.abspath(argv[0])
DST = os.path.abspath(argv[1])
os.makedirs(os.path.dirname(DST), exist_ok=True)

# --- Jaw-open geometry (world metres), from the inspected midline profile. ----
# Vertical falloff: full jaw influence over the lower lip + chin band, tapering
# to zero at the upper lip above and at the neck below so neither is dragged.
Z_UPPER_LIP = 1.515   # influence 0 at/above this height (protects nose/upper lip)
Z_MOUTH_TOP = 1.492   # influence ramps to 1 by here (lower lip)
Z_CHIN_BOT = 1.452    # full influence down to the chin underside
Z_NECK = 1.436        # influence 0 at/below this height (protects the neck)
# Front falloff: only the front face surface swings; the receded back/underside
# and the neck column are left alone.
Y_FRONT_FULL = -0.040  # full influence at/forward of this depth (front = -y)
Y_FRONT_ZERO = 0.005   # zero influence at/behind this depth
# Lateral falloff: keep to the central lower face; the long hair hangs at the
# sides (|x| beyond ~0.11) and must not move.
X_FULL = 0.075
X_ZERO = 0.115
# Jaw hinge pivot (behind + above the mouth, ~TMJ height) and open angle at the
# shape key's full (influence=1.0) pose. The runtime scales this down further.
PIVOT = Vector((0.0, 0.020, 1.552))
OPEN_ANGLE = 0.20      # radians (~11.5 deg) at influence 1.0
MORPH_NAME = "jawOpen"


def smoothstep(edge0, edge1, x):
    if edge0 == edge1:
        return 1.0 if x >= edge1 else 0.0
    t = (x - edge0) / (edge1 - edge0)
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def jaw_mask(w):
    """Influence 0..1 for a world-space vertex on the jaw-open shape."""
    # Height band (1 across the chin/lower-lip, tapering both ends).
    if w.z >= Z_UPPER_LIP or w.z <= Z_NECK:
        vz = 0.0
    elif w.z >= Z_MOUTH_TOP:
        vz = smoothstep(Z_UPPER_LIP, Z_MOUTH_TOP, w.z)  # 1 at MOUTH_TOP -> 0 at UPPER_LIP
    elif w.z <= Z_CHIN_BOT:
        vz = smoothstep(Z_NECK, Z_CHIN_BOT, w.z)          # 0 at NECK -> 1 at CHIN_BOT
    else:
        vz = 1.0
    if vz <= 0.0:
        return 0.0
    vy = smoothstep(Y_FRONT_ZERO, Y_FRONT_FULL, w.y)      # 1 in front, 0 behind
    if vy <= 0.0:
        return 0.0
    vx = 1.0 - smoothstep(X_FULL, X_ZERO, abs(w.x))       # 1 centre, 0 at hair
    return vz * vy * vx


def rotate_x_about(w, pivot, angle):
    """Rotate world point w about the X axis through pivot by angle (radians)."""
    dy = w.y - pivot.y
    dz = w.z - pivot.z
    ca, sa = math.cos(angle), math.sin(angle)
    return Vector((w.x, pivot.y + dy * ca - dz * sa, pivot.z + dy * sa + dz * ca))


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=SRC)

# Blender's glTF importer can spawn a stray helper primitive (a 42-vertex
# Icosphere) that is NOT in the GLB. The real character is the skinned mesh:
# bound to the armature or carrying skin weights. Drop anything else so the
# phantom neither gets a shape key nor lands in the export.
all_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
character = [
    o for o in all_meshes
    if (o.parent and o.parent.type == "ARMATURE") or len(o.vertex_groups) > 0
]
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

# Basis first (captures the neutral pose), then the jaw-open target.
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
assert moved > 50, "jaw mask selected too few vertices; region constants are wrong"

# --- Preserve the imported animation clips and export. -----------------------
# The glTF importer already stashes each clip (idle/talk/talk2) into its own
# muted NLA track. Only clear the ACTIVE action so the exporter does not emit it
# a second time; the NLA tracks re-emit every clip via NLA_TRACKS mode below.
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
