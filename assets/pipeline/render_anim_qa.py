# Animation QA for a single character GLB: renders rest + idle + multiple talk
# frames from front and 3/4 (plus a face close-up), and MEASURES per-clip root
# motion and foot drift so "in-place / no root jump / feet planted" is a number,
# not an eyeball. Reads what the runtime plays (clips baked into the GLB).
#
# Run:
#   blender --background --python render_anim_qa.py -- in.glb outDir prefix [clip:frame ...]
import bpy
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_DIR = os.path.abspath(argv[1])
PREFIX = argv[2]
SAMPLES = [s.split(":") for s in argv[3:]] or [
    ["rest", "0"], ["idle", "150"], ["talk", "40"], ["talk", "100"], ["talk", "160"], ["talk2", "60"],
]
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
rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
assert rig is not None, "no armature"
all_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
character = [o for o in all_meshes if o.find_armature() is rig]
meshes = character or all_meshes
for o in all_meshes:
    o.hide_render = o not in meshes
    if o not in meshes:
        print("HIDE stray mesh", o.name)

actions = {a.name: a for a in bpy.data.actions}
print("ACTIONS", sorted(actions.keys()))
rig.animation_data_create()
for tr in rig.animation_data.nla_tracks:
    tr.mute = True


def apply(clip, frame):
    if clip == "rest":
        rig.animation_data.action = None
        for pb in rig.pose.bones:
            pb.matrix_basis.identity()
    else:
        rig.animation_data.action = actions[clip]
        try:
            rig.animation_data.action_slot = actions[clip].slots[0]
        except Exception:
            pass
    scene.frame_set(int(frame))
    bpy.context.view_layer.update()


def bounds_bind():
    """Bind-pose bounds of the character meshes (for stable camera framing)."""
    apply("rest", 0)
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    deps = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        ev = o.evaluated_get(deps)
        m = ev.to_mesh()
        for v in m.vertices:
            w = ev.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
        ev.to_mesh_clear()
    return mn, mx


mn, mx = bounds_bind()
height = mx.z - mn.z
center = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2))
head = Vector((center.x, center.y, mn.z + height * 0.90))
print(f"BIND height={height:.4f}")

# ---- Root-motion / foot-drift measurement (Blender Z-up) --------------------
def bone_world(pb):
    return rig.matrix_world @ pb.head

for clip in ["idle", "talk", "talk2"]:
    if clip not in actions:
        continue
    rig.animation_data.action = actions[clip]
    a = actions[clip]
    f0, f1 = int(a.frame_range[0]), int(a.frame_range[1])
    ext = {k: [1e9, -1e9] for k in ("hx", "hy", "hz", "lfx", "lfy", "lfz", "rfx", "rfy", "rfz")}
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        bpy.context.view_layer.update()
        h = bone_world(rig.pose.bones["Hips"])
        lf = bone_world(rig.pose.bones["LeftFoot"])
        rf = bone_world(rig.pose.bones["RightFoot"])
        for k, val in (("hx", h.x), ("hy", h.y), ("hz", h.z), ("lfx", lf.x), ("lfy", lf.y),
                       ("lfz", lf.z), ("rfx", rf.x), ("rfy", rf.y), ("rfz", rf.z)):
            ext[k][0] = min(ext[k][0], val); ext[k][1] = max(ext[k][1], val)
    span = {k: (v[1] - v[0]) * 100.0 for k, v in ext.items()}  # cm
    print(f"ROOTMOTION {clip}: hips span cm X={span['hx']:.2f} Y={span['hy']:.2f} Z={span['hz']:.2f} | "
          f"LeftFoot XY drift={max(span['lfx'],span['lfy']):.2f} Zlift={span['lfz']:.2f} | "
          f"RightFoot XY drift={max(span['rfx'],span['rfy']):.2f} Zlift={span['rfz']:.2f}")

# ---- Renders ----------------------------------------------------------------
cam_data = bpy.data.cameras.new("qa_cam")
cam = bpy.data.objects.new("qa_cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.lens = 55
full_dist = max(2.2, height * 1.9)
face_dist = max(0.35, height * 0.42)


def shoot(name, res, target, loc):
    scene.render.resolution_x, scene.render.resolution_y = res
    cam.location = loc
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    out = os.path.join(OUT_DIR, f"{PREFIX}-{name}.png")
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("SHOT", out)


for clip, frame in SAMPLES:
    apply(clip, frame)
    tag = f"{clip}-{frame}"
    shoot(f"{tag}-front", (560, 800), center, center + Vector((0.0, -full_dist, height * 0.06)))
    shoot(f"{tag}-3q", (560, 800), center, center + Vector((full_dist * 0.55, -full_dist * 0.85, height * 0.10)))
    if clip in ("idle", "talk"):
        shoot(f"{tag}-face", (640, 640), head, head + Vector((0.0, -face_dist, height * 0.02)))

print("ANIM QA DONE", OUT_DIR)
