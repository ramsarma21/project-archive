# Neutral-light appearance QA for the System presenter GLB.
#
# WHY THIS EXISTS
#   The presenter is rendered at runtime as a cyan hologram, which hides whether
#   the underlying ASSET (face, symmetry, silhouette, clothing fit) is actually
#   camera-ready. This script renders the imported rig under a flat neutral
#   studio light with the true texture so attractiveness/readability is judged
#   from the geometry itself, not from bloom. It produces the full comparison
#   set the appearance-refinement task requires: full body, face front, 3/4
#   left and right, strict profile, and a speaking (jaw mid-open) face shot.
#
#   It NEVER bakes lighting into the model and NEVER edits the asset; it only
#   reads a GLB and writes PNGs. Run it before and after a refinement pass into
#   two directories and compare side by side.
#
# Run:
#   blender --background --python render_presenter_appearance_qa.py -- in.glb outDir [prefix]
import bpy, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_DIR = os.path.abspath(argv[1])
PREFIX = argv[2] if len(argv) > 2 else ""
os.makedirs(OUT_DIR, exist_ok=True)


def name(base):
    return f"{PREFIX}-{base}" if PREFIX else base


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("qa")
scene.world.color = (0.72, 0.72, 0.74)

bpy.ops.import_scene.gltf(filepath=IN_GLB)
all_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
character = [o for o in all_meshes if (o.parent and o.parent.type == "ARMATURE") or len(o.vertex_groups) > 0]
mesh = character[0]
for o in all_meshes:
    o.hide_render = o not in character

# Render in the imported neutral bind pose: silence any animation so the idle
# breathing pose cannot skew the silhouette or head tilt.
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
if arm is not None:
    arm.animation_data_create()
    for tr in arm.animation_data.nla_tracks:
        tr.mute = True
    arm.animation_data.action = None

# Close the mouth by default (jaw morph 0); a dedicated shot opens it.
kb = mesh.data.shape_keys.key_blocks if mesh.data.shape_keys else None
if kb and "jawOpen" in kb:
    kb["jawOpen"].value = 0.0
bpy.context.view_layer.update()


def bounds():
    mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
    deps = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(deps); m = ev.to_mesh()
    for v in m.vertices:
        w = ev.matrix_world @ v.co
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    ev.to_mesh_clear()
    return mn, mx


mn, mx = bounds()
height = mx.z - mn.z
center = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))
# The head sits near the crown; nudge the face target just below the crown so
# the whole face (not the hair top) is centred.
head = Vector((0.0, (mn.y + mx.y) / 2, mn.z + height * 0.88))
print(f"BOUNDS height={height:.4f} center=({center.x:.3f},{center.y:.3f},{center.z:.3f})")

cam_data = bpy.data.cameras.new("qa_cam")
cam = bpy.data.objects.new("qa_cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def shoot(base, res_x, res_y, target, cam_loc, lens=70):
    scene.render.resolution_x = res_x; scene.render.resolution_y = res_y
    cam_data.lens = lens
    cam.location = cam_loc
    d = target - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    out = os.path.join(OUT_DIR, f"{name(base)}.png")
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("SHOT", out)


# glTF import is Z-up; -Y is "front".
full_dist = max(2.2, height * 1.9)
shoot("full-front", 620, 900, center, center + Vector((0.0, -full_dist, height * 0.02)), lens=55)
shoot("full-3q", 620, 900, center, center + Vector((full_dist * 0.5, -full_dist * 0.85, height * 0.08)), lens=55)

face_dist = max(0.32, height * 0.36)
shoot("face-front", 760, 760, head, head + Vector((0.0, -face_dist, height * 0.012)))
shoot("face-3q-left", 760, 760, head, head + Vector((-face_dist * 0.55, -face_dist * 0.85, height * 0.02)))
shoot("face-3q-right", 760, 760, head, head + Vector((face_dist * 0.55, -face_dist * 0.85, height * 0.02)))
shoot("face-profile", 760, 760, head, head + Vector((face_dist * 1.02, 0.0, height * 0.01)))

# Speaking: jaw mid-open, front face.
if kb and "jawOpen" in kb:
    kb["jawOpen"].value = 0.5
    bpy.context.view_layer.update()
    shoot("face-jaw-mid", 760, 760, head, head + Vector((0.0, -face_dist, height * 0.012)))
    kb["jawOpen"].value = 0.0

print("APPEARANCE QA DONE", OUT_DIR)
