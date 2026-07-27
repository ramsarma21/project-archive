# Close-up QA for the presenter jawOpen morph target. Renders the face from the
# front and 3/4 at several morph influences so a human can confirm the mouth
# moves believably with no tearing, holes, hair movement or head-wide warping.
#
# Run:
#   blender --background --python render_presenter_face_morph_qa.py -- in.glb outDir [influencesCsv]
import bpy, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_DIR = os.path.abspath(argv[1])
INFLUENCES = [float(x) for x in (argv[2].split(",") if len(argv) > 2 else ["0.0", "0.5", "1.0"])]
os.makedirs(OUT_DIR, exist_ok=True)

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

arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
if arm is not None:
    arm.animation_data_create()
    for tr in arm.animation_data.nla_tracks:
        tr.mute = True
    arm.animation_data.action = None
bpy.context.view_layer.update()

kb = mesh.data.shape_keys.key_blocks
assert "jawOpen" in kb, "no jawOpen shape key"


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
center = Vector(((mn.x+mx.x)/2, (mn.y+mx.y)/2, (mn.z+mx.z)/2))
head = Vector((center.x, center.y, mn.z + height * 0.90))

cam_data = bpy.data.cameras.new("qa_cam"); cam = bpy.data.objects.new("qa_cam", cam_data)
scene.collection.objects.link(cam); scene.camera = cam; cam_data.lens = 70

face_dist = max(0.30, height * 0.34)


def shoot(name, target, cam_loc, rx=720, ry=720):
    scene.render.resolution_x = rx; scene.render.resolution_y = ry
    cam.location = cam_loc
    d = target - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    out = os.path.join(OUT_DIR, f"{name}.png")
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("SHOT", out)


for infl in INFLUENCES:
    kb["jawOpen"].value = infl
    bpy.context.view_layer.update()
    tag = f"jaw{int(round(infl*100)):03d}"
    shoot(f"{tag}-front", head, head + Vector((0.0, -face_dist, height * 0.015)))
    shoot(f"{tag}-3q", head, head + Vector((face_dist*0.55, -face_dist*0.85, height*0.02)))

print("MORPH QA DONE", OUT_DIR)
