# QA render of the assembled ink-ball pair from rest + representative dab/rock
# transforms to prove orientation, scale, and no clipping. Renders a labeled
# ground grid so we can see the pad-contact / grounding.
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
#        --python assets/pipeline/m4/_inkball_qa.py
import bpy, os, math
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "build", "world-m4-opt", "printer-ink-balls.glb")
OUT = os.path.join(ROOT, "build", "world-m4-opt", "qa")
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# report node names + world bounds
names = [o.name for o in bpy.data.objects]
print("NODES", names)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
mins = Vector((1e18,)*3); maxs = Vector((-1e18,)*3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            mins[i] = min(mins[i], w[i]); maxs[i] = max(maxs[i], w[i])
print("PAIR bounds min", [round(v,3) for v in mins], "max", [round(v,3) for v in maxs], "size", [round(v,3) for v in (maxs-mins)])

center = (mins+maxs)/2.0
dim = max((maxs-mins)) or 1.0

# ground grid
bpy.ops.mesh.primitive_plane_add(size=dim*4, location=(center.x, center.y, mins.z))
grid = bpy.context.active_object
m = bpy.data.materials.new("g"); m.use_nodes=True
m.node_tree.nodes["Principled BSDF"].inputs[0].default_value=(0.18,0.18,0.2,1)
grid.data.materials.append(m)

sun_d = bpy.data.lights.new("s",'SUN'); sun_d.energy=4
sun = bpy.data.objects.new("s",sun_d); bpy.context.scene.collection.objects.link(sun)
sun.rotation_euler=(math.radians(55),math.radians(20),math.radians(40))
world = bpy.data.worlds.new("w"); bpy.context.scene.world=world
world.use_nodes=True; world.node_tree.nodes["Background"].inputs[1].default_value=1.15

cam_d = bpy.data.cameras.new("c"); cam=bpy.data.objects.new("c",cam_d)
bpy.context.scene.collection.objects.link(cam); bpy.context.scene.camera=cam
sc = bpy.context.scene
for eng in ('BLENDER_EEVEE_NEXT','BLENDER_EEVEE','CYCLES'):
    try: sc.render.engine=eng; break
    except Exception: continue
sc.render.resolution_x=640; sc.render.resolution_y=640

def shoot(tag, off_scale=(1.7,-1.7,1.0)):
    r=dim*1.8
    cam.location=center+Vector((r*off_scale[0], r*off_scale[1], r*off_scale[2]))
    d=(center-cam.location).normalized()
    cam.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
    sc.render.filepath=os.path.join(OUT, "printer-ink-balls_"+tag+".png")
    bpy.ops.render.render(write_still=True)
    print("RENDER", tag)

# rest pose
shoot("rest", (1.7,-1.7,0.9))
shoot("rest_side", (0.2,-2.2,0.5))
shoot("rest_front", (2.2,-0.2,0.5))

# --- representative dab (press straight down) + rock (rotate about pad contact)
# applied to the InkBall nodes to prove pivots work with no clipping.
left = bpy.data.objects.get("InkBall_Left")
right = bpy.data.objects.get("InkBall_Right")
if left:
    left.location.z += 0.04           # lift for a mid-dab
    left.rotation_euler.rotate_axis("X", math.radians(18))  # rock forward about origin (pad contact)
if right:
    right.rotation_euler.rotate_axis("X", math.radians(-14))
bpy.context.view_layer.update()
shoot("dabrock", (1.7,-1.7,0.9))
print("QA DONE")
