# Beauty render for a world asset GLB: Cycles, overcast harbour light, a wet dock
# plane for grounding + reflection, soft raking sun, AgX view. For the owner's
# photoreal eye-test (NOT the flat QA render with scale bars).
# Run: blender --background --python render_beauty.py -- <glb> <outdir> <label> [front_deg] [samples]
import bpy, os, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_DIR = os.path.abspath(argv[1])
LABEL = argv[2] if len(argv) > 2 else os.path.splitext(os.path.basename(IN_GLB))[0]
FRONT_DEG = float(argv[3]) if len(argv) > 3 else 0.0
SAMPLES = int(argv[4]) if len(argv) > 4 else 160
os.makedirs(OUT_DIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
try:
    scene.cycles.device = "GPU"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
except Exception as e:
    print("GPU setup skipped:", e)
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000
scene.render.image_settings.file_format = "PNG"
try:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Base Contrast"
except TypeError:
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium Contrast"
scene.view_settings.exposure = 1.1

# ---- overcast harbour sky: soft graded dome, cool ----------------------------
world = bpy.data.worlds.new("sky"); world.use_nodes = True; scene.world = world
wnt = world.node_tree; wnt.nodes.clear()
wout = wnt.nodes.new("ShaderNodeOutputWorld")
bg = wnt.nodes.new("ShaderNodeBackground")
grad = wnt.nodes.new("ShaderNodeTexGradient")
mapp = wnt.nodes.new("ShaderNodeMapping")
texc = wnt.nodes.new("ShaderNodeTexCoord")
ramp = wnt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.30
ramp.color_ramp.elements[0].color = (0.52, 0.56, 0.62, 1)   # lower sky (haze band)
ramp.color_ramp.elements[1].position = 0.9
ramp.color_ramp.elements[1].color = (0.78, 0.82, 0.88, 1)   # upper sky
wnt.links.new(texc.outputs["Generated"], mapp.inputs["Vector"])
wnt.links.new(mapp.outputs["Vector"], grad.inputs["Vector"])
wnt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
wnt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 2.2
wnt.links.new(bg.outputs["Background"], wout.inputs["Surface"])

# ---- import asset ------------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=IN_GLB)
imported = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
assert imported, "no mesh"
if FRONT_DEG:
    for o in imported:
        o.rotation_euler[2] += math.radians(FRONT_DEG)
    bpy.context.view_layer.update()
lo = Vector((1e9, 1e9, 1e9)); hi = -lo
for obj in imported:
    for c in obj.bound_box:
        w = obj.matrix_world @ Vector(c)
        for a in range(3):
            lo[a] = min(lo[a], w[a]); hi[a] = max(hi[a], w[a])
size = hi - lo; center = (lo + hi) / 2

# ---- wet dock plank ground --------------------------------------------------
span = max(size.x, size.y) + 40
bpy.ops.mesh.primitive_plane_add(size=span * 2, location=(center.x, center.y, 0))
ground = bpy.context.active_object
gm = bpy.data.materials.new("dock"); gm.use_nodes = True
gb = gm.node_tree.nodes["Principled BSDF"]
gb.inputs["Base Color"].default_value = (0.10, 0.11, 0.12, 1)
gb.inputs["Roughness"].default_value = 0.42        # damp -> soft reflection
if "Specular IOR Level" in gb.inputs: gb.inputs["Specular IOR Level"].default_value = 0.5
ground.data.materials.append(gm)

# ---- overcast key on the loading front + cool side fill + soft raking sun ----
def area(name, energy, sz, color, loc, aim):
    a = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
    a.data.energy = energy; a.data.size = sz; a.data.color = color
    a.location = Vector(loc)
    a.rotation_euler = (Vector(aim) - a.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(a)
    return a

front = Vector((center.x + size.x * 0.4, center.y + span * 0.7, size.z * 1.3))
area("key", 6000, 26, (1.0, 0.97, 0.9), front, (center.x, center.y, size.z * 0.5))
area("fill", 2600, 30, (0.72, 0.8, 0.92), (center.x - span, center.y, size.z * 1.4), (center.x, center.y, size.z * 0.5))
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 1.6; sun.data.angle = math.radians(6.0); sun.data.color = (1.0, 0.94, 0.85)
sun.rotation_euler = (math.radians(52), math.radians(-14), math.radians(28))
scene.collection.objects.link(sun)

cam_data = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam); scene.camera = cam
cam_data.lens = 46


def shoot(name, rel, aim=0.42):
    d = max(size) * 1.9
    cam.location = center + Vector(rel) * d
    look = Vector((center.x, center.y, lo.z + size.z * aim))
    cam.rotation_euler = (look - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT_DIR, f"{LABEL}__{name}.png")
    bpy.ops.render.render(write_still=True)
    print("WROTE", scene.render.filepath)


shoot("hero", (0.72, 1.15, 0.42))     # 3/4 hero onto the loading front
shoot("roof", (0.45, 0.9, 1.1))       # high angle reading the roof deck + gallery
