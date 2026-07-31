# Engine-style render (EEVEE, environment + key light, neutral Standard view) that
# approximates how the game (three.js MeshStandardMaterial) lights the GLB — used
# to VERIFY the brick reads lit (not black/unlit from a bad normal map), the way
# the owner will see it in-engine.
# Run: blender --background --python render_engine.py -- <glb> <outdir> <label> [front_deg]
import bpy, os, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0]); OUT_DIR = os.path.abspath(argv[1])
LABEL = argv[2] if len(argv) > 2 else os.path.splitext(os.path.basename(IN_GLB))[0]
FRONT_DEG = float(argv[3]) if len(argv) > 3 else 0.0
os.makedirs(OUT_DIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
scene.render.resolution_x = 1300; scene.render.resolution_y = 950
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Standard"      # neutral, engine-like (no filmic)

# environment: soft even sky so materials read at their true value (like an engine
# irradiance probe), plus a key sun for form.
world = bpy.data.worlds.new("env"); world.use_nodes = True; scene.world = world
bgn = world.node_tree.nodes["Background"]
bgn.inputs[0].default_value = (0.62, 0.66, 0.72, 1.0); bgn.inputs[1].default_value = 1.4

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=IN_GLB)
imported = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
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

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.2; sun.data.angle = math.radians(3); sun.data.color = (1.0, 0.96, 0.9)
sun.rotation_euler = (math.radians(54), math.radians(-12), math.radians(35))
scene.collection.objects.link(sun)

span = max(size.x, size.y) + 30
bpy.ops.mesh.primitive_plane_add(size=span * 2, location=(center.x, center.y, 0))
gm = bpy.data.materials.new("g"); gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.16, 0.17, 0.18, 1)
gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
bpy.context.active_object.data.materials.append(gm)

cam_data = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cam_data)
scene.collection.objects.link(cam); scene.camera = cam; cam_data.lens = 44


def shoot(name, rel, aim=0.45):
    d = max(size) * 1.9
    cam.location = center + Vector(rel) * d
    look = Vector((center.x, center.y, lo.z + size.z * aim))
    cam.rotation_euler = (look - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT_DIR, f"{LABEL}__{name}.png")
    bpy.ops.render.render(write_still=True)
    print("WROTE", scene.render.filepath)


shoot("engine", (0.72, 1.12, 0.42))
