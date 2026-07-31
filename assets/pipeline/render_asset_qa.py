# Legible isolation QA render for a world asset GLB: a 3/4 view and a high
# roof/top view, with a metre grid, a 1.7 m human-height scale reference, and
# white platform markers at the level's authored standable bands, so a claim
# that "the gallery lands at 5.35" is read off the picture, not asserted.
#
# Run: blender --background --python assets/pipeline/render_asset_qa.py -- <glb> <outdir> <label> [markers csv] [front_deg]
import bpy
import bmesh
import os
import sys
import math
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_DIR = os.path.abspath(argv[1])
LABEL = argv[2] if len(argv) > 2 else os.path.splitext(os.path.basename(IN_GLB))[0]
MARKERS = [float(x) for x in argv[3].split(",")] if len(argv) > 3 and argv[3] else []
FRONT_DEG = float(argv[4]) if len(argv) > 4 else 0.0     # extra yaw to face the loading front
RES = 1100
os.makedirs(OUT_DIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
# EEVEE (not Workbench): Workbench's TEXTURE mode ignores glTF baseColorFactor, so
# a single-atlas asset that tints per material (the steeple) reads uniform there.
# EEVEE shows the real shipped materials, which is what the eye-test needs.
scene.render.engine = "BLENDER_EEVEE"
scene.view_settings.view_transform = "Standard"
scene.render.resolution_x = RES
scene.render.resolution_y = int(RES * 0.8)
scene.render.image_settings.file_format = "PNG"
world = bpy.data.worlds.new("qa"); world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.65, 0.70, 1.0)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.1
scene.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.5; sun.rotation_euler = (math.radians(58), math.radians(12), math.radians(-58))
scene.collection.objects.link(sun)
fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "SUN"))
fill.data.energy = 1.2; fill.rotation_euler = (math.radians(62), 0, math.radians(130))
scene.collection.objects.link(fill)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=IN_GLB)
imported = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
assert imported, "no mesh in asset"

lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for obj in imported:
    for corner in obj.bound_box:
        w = obj.matrix_world @ Vector(corner)
        for a in range(3):
            lo[a] = min(lo[a], w[a]); hi[a] = max(hi[a], w[a])
size = hi - lo
center = (lo + hi) / 2
print(f"ASSET_SIZE_M x={size.x:.3f} y={size.y:.3f} z={size.z:.3f}")

# ---- ground plane (for contact shadows / a grounded read) ---------------------
span = max(size.x, size.y) + 10
bpy.ops.mesh.primitive_plane_add(size=span * 2, location=(center.x, center.y, 0))
ground = bpy.context.active_object
gmat = bpy.data.materials.new("ground"); gmat.use_nodes = True
gmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.5, 0.52, 0.55, 1)
gmat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
ground.data.materials.append(gmat)


def box(name, x0, x1, y0, y1, z0, z1, rgba):
    m = bpy.data.meshes.new(name); bb = bmesh.new()
    vs = [bb.verts.new(p) for p in [(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0),(x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)]]
    for f in [(0,1,2,3),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:
        bb.faces.new([vs[i] for i in f])
    bb.to_mesh(m); bb.free()
    o = bpy.data.objects.new(name, m); scene.collection.objects.link(o)
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = rgba
        bsdf.inputs["Emission Strength"].default_value = 0.35
    o.data.materials.append(mat)
    return o


# ---- scale pole beside the asset: red, with a 1.7 m human-height segment -------
px = hi.x + 1.6
pole_top = max(size.z, (max(MARKERS) if MARKERS else 0) + 0.5)
box("pole", px, px + 0.18, -0.09, 0.09, 0.0, pole_top, (0.72, 0.05, 0.05, 1))
box("human", px - 0.02, px + 0.20, -0.11, 0.11, 0.0, 1.7, (0.95, 0.35, 0.2, 1))   # 1.7 m human ref
# white platform markers at the authored standable bands, sighting toward the asset
for h in MARKERS:
    box(f"mk{h}", lo.x - 0.4, px + 0.4, -0.55, 0.55, h - 0.03, h + 0.03, (0.96, 0.96, 0.96, 1))

cam_data = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam); scene.camera = cam
cam_data.lens = 52


def shoot(name, rel):
    d = max(size) * 1.7
    cam.location = center + Vector(rel) * d
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT_DIR, f"{LABEL}__{name}.png")
    bpy.ops.render.render(write_still=True)
    print("WROTE", scene.render.filepath)


# 3/4 view onto the +Y loading front and the +X side; a lower frontal view that
# reads the jettied ledges; a roof view from high front.
shoot("34", (0.85, 1.15, 0.55))
shoot("front", (0.35, 1.45, 0.32))
shoot("roof", (0.35, 0.95, 1.25))
