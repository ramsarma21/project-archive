# Render M1's own arrangement of draws around one collision part.
#
# This rebuilds `FittedGlb` exactly: a PROP is contain-fitted into the box the
# level asks for (the smallest of the three box/mesh ratios), a SHELL or MODULE is
# scaled onto its box per axis, and both are then plan-centred and BOTTOM-ALIGNED
# on the placement plane. If that arithmetic is wrong here the picture is a lie,
# so it is the same arithmetic `verify_m1_placements.mjs` uses to raycast with.
#
# The frame that matters is not the prop, it is the JOIN: whether the top of the
# drawn object is at the height the collision says the player stands on. So the
# plane is drawn as a wire frame around the part's own footprint, at exactly the
# height the verifier probes, and the answer is whether the art meets it.
#
# Run:
#   blender --background --python assets/pipeline/render_m1_in_place.py -- \
#     scene.json out.png --eye 7,3.4,7 --look 12.2,1.6,1.4 [--res 1280x800] [--lens 40]
import bpy
import json
import math
import os
import sys

from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
SCENE_JSON = os.path.abspath(argv[0])
OUT_PNG = os.path.abspath(argv[1])

opts = {"eye": None, "look": None, "res": "1280x800", "lens": "40", "plane": "1", "hide": ""}
rest = argv[2:]
for index in range(0, len(rest) - 1, 2):
    name = rest[index].lstrip("-")
    if name not in opts:
        raise SystemExit(f"unknown option {rest[index]}")
    opts[name] = rest[index + 1]

with open(SCENE_JSON) as handle:
    SCENE = json.load(handle)
PART = SCENE["part"]
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WORLD = os.path.join(REPO, "apps", "web", "public", "world")
WIDTH, HEIGHT = (int(v) for v in str(opts["res"]).split("x"))


def log(*parts):
    print("[in-place]", *parts)


# glTF and the level are Y-up; Blender is Z-up. Game (x, y, z) is Blender
# (x, -z, y), which is a +90 degree rotation about X and therefore proper — so a
# yaw about game +y is the same yaw, same sign, about Blender +z.
def to_blender(x, y, z):
    return Vector((x, -z, y))


def parse_point(text):
    return [float(v) for v in text.split(",")]


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.render.resolution_x = WIDTH
scene.render.resolution_y = HEIGHT
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("qa")
scene.world.color = (0.42, 0.46, 0.52)

# A cutaway list, for subjects that are enclosed by what the level draws around
# them. HOLLIS_BUTTRESS needs one: the lean-to's deck at 5.2m is drawn as a solid
# bottom-aligned at 1.35m across x 73.5..77.5 and z 14.6..17.0, and the ropewalk
# shell begins at z 17.0, so the buttress stands in a closed slot with no eye-level
# sightline to it from any direction. Hiding those two is a section drawing, not a
# rearrangement: every draw still stands exactly where the mission puts it, and
# anything hidden is named in the log so a picture cannot quietly omit something.
HIDDEN = {name for name in str(opts["hide"]).split(",") if name}

drawn = 0
skipped = []
for placement in SCENE["placements"]:
    if placement["id"] in HIDDEN or placement["asset"] in HIDDEN:
        skipped.append(f"{placement['id']} ({placement['asset']}: hidden for the cutaway)")
        continue
    path = os.path.join(WORLD, placement["assetPath"].replace("world/", "", 1))
    if not os.path.exists(path):
        skipped.append(f"{placement['id']} ({placement['asset']}: no file)")
        continue
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    fresh = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in fresh if o.type == "MESH"]
    if not meshes:
        skipped.append(f"{placement['id']} ({placement['asset']}: no mesh)")
        continue

    group = bpy.data.objects.new(f"pin_{placement['id']}", None)
    scene.collection.objects.link(group)
    for obj in fresh:
        if obj.parent is None:
            obj.parent = group
    bpy.context.view_layer.update()

    def world_bounds(objects):
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for obj in objects:
            for corner in obj.bound_box:
                point = obj.matrix_world @ Vector(corner)
                for axis in range(3):
                    lo[axis] = min(lo[axis], point[axis])
                    hi[axis] = max(hi[axis], point[axis])
        return lo, hi

    lo, hi = world_bounds(meshes)
    natural = hi - lo
    size = placement["size"]
    # natural is in Blender axes: x is game x, y is game z, z is game y.
    ratios = (size[0] / natural.x, size[1] / natural.z, size[2] / natural.y)
    if placement["fit"] == "PROP":
        factor = min(ratios)
        group.scale = (factor, factor, factor)
    else:
        group.scale = (ratios[0], ratios[2], ratios[1])
    group.rotation_euler = (0.0, 0.0, placement.get("yaw") or 0.0)
    bpy.context.view_layer.update()

    lo, hi = world_bounds(meshes)
    centre = (lo + hi) / 2.0
    target = to_blender(placement["pos"][0], placement["pos"][1], placement["pos"][2])
    group.location = (
        group.location.x + (target.x - centre.x),
        group.location.y + (target.y - centre.y),
        group.location.z + (target.z - lo.z),
    )
    bpy.context.view_layer.update()
    drawn += 1

log(f"{drawn} draws built, {len(skipped)} skipped")
for line in skipped:
    log(f"  skipped {line}")

# The plane the route stands on, as a wire frame around the part's own footprint.
# Procedural and a dev diagnostic, which is the one thing the imported-world rule
# leaves open: nothing here is a stand-in for art.
if opts["plane"] == "1":
    rect = PART["rect"]
    plane = PART["plane"]
    bar = 0.03
    edges = [
        (rect["minX"], rect["maxX"], rect["minZ"], rect["minZ"]),
        (rect["minX"], rect["maxX"], rect["maxZ"], rect["maxZ"]),
        (rect["minX"], rect["minX"], rect["minZ"], rect["maxZ"]),
        (rect["maxX"], rect["maxX"], rect["minZ"], rect["maxZ"]),
    ]
    marker = bpy.data.materials.new("collision-plane")
    marker.diffuse_color = (0.95, 0.15, 0.12, 1.0)
    for index, (x0, x1, z0, z1) in enumerate(edges):
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        cube = bpy.context.active_object
        cube.name = f"plane_edge_{index}"
        cube.scale = (max(x1 - x0, bar) / 2.0, max(z1 - z0, bar) / 2.0, bar / 2.0)
        cube.location = to_blender((x0 + x1) / 2.0, plane, (z0 + z1) / 2.0)
        cube.data.materials.append(marker)
    log(f"plane frame drawn at {plane:.2f}m around {PART['id']}")

eye = to_blender(*parse_point(opts["eye"]))
look = to_blender(*parse_point(opts["look"]))
camera_data = bpy.data.cameras.new("cam")
camera_data.lens = float(opts["lens"])
camera = bpy.data.objects.new("cam", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera.location = eye
camera.rotation_euler = (look - eye).to_track_quat("-Z", "Y").to_euler()

os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
scene.render.filepath = OUT_PNG
scene.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
log(f"WROTE {OUT_PNG}")
