# Automated asset verifier for the facially-rigged System presenter GLB.
#
# Asserts the published asset still meets every contract after the facial-rig
# step: the jawOpen morph target exists and only moves the lower-front face, the
# idle/talk/talk2 body clips survive, the skeleton/skin are intact, materials and
# textures are present (no missing images), and the height/feet bounds are
# unchanged. Exits non-zero (fails CI/QA) on any violation.
#
# Run:
#   blender --background --python verify_presenter_face.py -- <glb>
import bpy, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
SRC = os.path.abspath(argv[0]) if argv else os.path.abspath(
    "apps/web/public/world/characters/system-presenter-rigged.glb")

EXPECT_CLIPS = {"idle", "talk", "talk2"}
EXPECT_JOINTS = 24
# Bind-pose (evaluated-mesh) height band. The shipped asset measures ~1.67 m
# this way and the runtime rescales the rig to 1.72 m regardless, so the asset
# contract is only that the figure stays in the natural human ~1.7 m band with
# its feet on the ground; a re-export may drift the bind pose by ~1 cm.
HEIGHT_MIN = 1.63
HEIGHT_MAX = 1.72
FEET_TOL = 0.015
Z_UPPER_LIP = 1.515   # nothing at/above the upper lip may move on jawOpen
MAX_DROP = 0.05       # the jaw target must stay a restrained motion

fail = []

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

all_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
character = [o for o in all_meshes if (o.parent and o.parent.type == "ARMATURE") or len(o.vertex_groups) > 0]
if len(character) != 1:
    fail.append(f"expected 1 character mesh, got {len(character)}")
mesh = character[0]
me = mesh.data

# --- Morph target -------------------------------------------------------------
sk = me.shape_keys
if not sk or "jawOpen" not in sk.key_blocks:
    fail.append("missing jawOpen morph target")
else:
    basis = sk.key_blocks[0]
    jaw = sk.key_blocks["jawOpen"]
    mw = mesh.matrix_world
    moved = 0
    max_drop = 0.0
    above_lip_moved = 0
    for i, v in enumerate(me.vertices):
        d = (jaw.data[i].co - basis.data[i].co)
        if d.length < 1e-6:
            continue
        moved += 1
        w0 = mw @ basis.data[i].co
        w1 = mw @ jaw.data[i].co
        max_drop = max(max_drop, w0.z - w1.z)
        if w0.z >= Z_UPPER_LIP + 0.003:
            above_lip_moved += 1
    if moved < 50:
        fail.append(f"jawOpen moves too few verts ({moved})")
    if max_drop <= 0.002:
        fail.append(f"jawOpen barely moves ({max_drop:.4f} m)")
    if max_drop > MAX_DROP:
        fail.append(f"jawOpen drop too large ({max_drop:.4f} m > {MAX_DROP})")
    if above_lip_moved > 0:
        fail.append(f"jawOpen moves {above_lip_moved} verts above the upper lip (nose/face)")
    print(f"MORPH jawOpen: moved={moved} max_drop={max_drop:.4f} above_lip={above_lip_moved}")

# --- Animation clips ----------------------------------------------------------
clips = {a.name for a in bpy.data.actions}
missing = EXPECT_CLIPS - clips
if missing:
    fail.append(f"missing body clips: {sorted(missing)} (have {sorted(clips)})")
print("CLIPS", sorted(clips))

# --- Skeleton / skin ----------------------------------------------------------
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
if arm is None:
    fail.append("no armature")
else:
    nb = len(arm.data.bones)
    if nb != EXPECT_JOINTS:
        fail.append(f"joint count {nb} != {EXPECT_JOINTS}")
    print("JOINTS", nb)
if not mesh.vertex_groups:
    fail.append("mesh has no skin weights (vertex groups)")

# --- Materials / textures -----------------------------------------------------
mats = [m for m in mesh.data.materials if m]
if len(mats) < 1:
    fail.append("no material on mesh")
imgs = [im for im in bpy.data.images if im.name != "Render Result"]
if len(imgs) < 1:
    fail.append("no texture image")
for im in imgs:
    if im.size[0] <= 0 or im.size[1] <= 0:
        fail.append(f"missing/empty image {im.name}")
print("MATERIALS", len(mats), "IMAGES", [(im.name, tuple(im.size)) for im in imgs])

# --- Bounds / scale -----------------------------------------------------------
# Measure at the neutral BIND pose: mute every animation and clear the active
# action so the idle breathing pose cannot shrink the measured height, and set
# the jaw morph to 0 so the mouth is closed.
if arm is not None and arm.animation_data is not None:
    for tr in arm.animation_data.nla_tracks:
        tr.mute = True
    arm.animation_data.action = None
if sk:
    for kb in sk.key_blocks:
        kb.value = 0.0
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()
ev = mesh.evaluated_get(deps); m = ev.to_mesh()
mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
for v in m.vertices:
    w = ev.matrix_world @ v.co
    for i in range(3):
        mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
ev.to_mesh_clear()
height = mx.z - mn.z
if not (HEIGHT_MIN <= height <= HEIGHT_MAX):
    fail.append(f"height {height:.4f} outside [{HEIGHT_MIN},{HEIGHT_MAX}]")
if abs(mn.z) > FEET_TOL:
    fail.append(f"feet not at ground: minZ={mn.z:.4f}")

# The jaw morph must not change the silhouette height (it's a mouth, not a pose).
if sk and "jawOpen" in sk.key_blocks:
    sk.key_blocks["jawOpen"].value = 1.0
    bpy.context.view_layer.update()
    deps2 = bpy.context.evaluated_depsgraph_get()
    ev2 = mesh.evaluated_get(deps2); m2 = ev2.to_mesh()
    zmin2 = min((ev2.matrix_world @ v.co).z for v in m2.vertices)
    ev2.to_mesh_clear()
    drop = mn.z - zmin2
    if drop > 0.03:
        fail.append(f"jawOpen lowers the whole silhouette by {drop:.4f} m (should be a mouth)")
    sk.key_blocks["jawOpen"].value = 0.0
    print(f"JAW SILHOUETTE drop={drop:.4f}")
print(f"BOUNDS height={height:.4f} minZ={mn.z:.4f}")

if fail:
    print("VERIFY FAIL:")
    for f in fail:
        print("  -", f)
    sys.exit(1)
print("VERIFY OK: facial morph + clips + skin + materials + bounds all pass")
