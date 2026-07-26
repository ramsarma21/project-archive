# QA sheet for the Liberty elm: the tree at true scale, a runner standing on the
# crown bough where the dive lands, and the authored deck planes drawn in.
#
# The overlay planes are a dev diagnostic and never ship. They are the whole
# point of the sheet: you can see at a glance whether the wood meets the plane
# the player is actually standing on, rather than trusting that it does.
#
# Run:
#   blender --background --python assets/pipeline/render_elm_qa.py \
#     -- elm.glb hull.json outDir [character.glb]
import bpy
import json
import math
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
ELM_GLB = os.path.abspath(argv[0])
HULL_JSON = os.path.abspath(argv[1])
OUT_DIR = os.path.abspath(argv[2])
CHARACTER = os.path.abspath(argv[3]) if len(argv) > 3 else None

with open(HULL_JSON) as handle:
    HULL = json.load(handle)
TIERS = HULL["tiers"]
AXIS_X, AXIS_Z = HULL["axisWorld"]
TILE = 760
os.makedirs(OUT_DIR, exist_ok=True)

# Where the leap of faith puts a player, straight out of the level's route.
DIVE_WORLD = (79.6, 8.3, 1.9)
PLAYER_H = 1.55

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.render.resolution_x = TILE
scene.render.resolution_y = TILE
scene.render.image_settings.file_format = "PNG"
scene.world = bpy.data.worlds.new("qa")
scene.world.color = (0.62, 0.66, 0.71)


def import_glb(path):
    """Return (mesh objects, root objects). A rigged character's meshes hang
    off an armature, so the roots are what has to be moved and scaled."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    fresh = [o for o in bpy.data.objects if o not in before]
    return (
        [o for o in fresh if o.type == "MESH"],
        [o for o in fresh if o.parent is None],
    )


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


elm, _ = import_glb(ELM_GLB)
lo, hi = world_bounds(elm)
print(f"ELM_SIZE x={hi.x - lo.x:.3f} y={hi.y - lo.y:.3f} z={hi.z - lo.z:.3f} base={lo.z:.3f}")

# glTF is Y-up, Blender is Z-up: a game offset (x, y, z) lands at (x, -z, y).
def to_blender(gx, gy, gz):
    return Vector((gx, -gz, gy))


# ---- the authored decks, as translucent diagnostic planes -------------------

overlay = bpy.data.materials.new("deck-plane")
overlay.diffuse_color = (1.0, 0.32, 0.12, 1.0)
for tier in TIERS:
    width = tier["maxX"] - tier["minX"]
    depth = tier["maxZ"] - tier["minZ"]
    centre = to_blender(
        (tier["minX"] + tier["maxX"]) / 2.0, tier["y"], (tier["minZ"] + tier["maxZ"]) / 2.0
    )
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=centre)
    plane = bpy.context.active_object
    plane.scale = (width, depth, 1.0)
    plane.name = f"deck-{tier['id']}"
    plane.data.materials.append(overlay)
    # Wireframe only: a filled plane would hide the very surface being judged.
    modifier = plane.modifiers.new("wire", "WIREFRAME")
    modifier.thickness = 0.06
    print(f"DECK {tier['id']} y={tier['y']} {width:.1f}x{depth:.1f}m")

# ---- the runner, on the crown bough where the dive lands -------------------

player = []
if CHARACTER and os.path.exists(CHARACTER):
    player, roots = import_glb(CHARACTER)
    plo, phi = world_bounds(player)
    scale = PLAYER_H / (phi.z - plo.z)
    # Multiply, never assign: the cast is exported with a scale already on the
    # armature root, and overwriting it made a 100m runner.
    for root in roots:
        root.scale = root.scale * scale
    bpy.context.view_layer.update()
    # Re-measure scaled, then set the feet on the deck rather than guessing at
    # the rig's own floor: the point of the shot is that they touch.
    plo, phi = world_bounds(player)
    stand = to_blender(DIVE_WORLD[0] - AXIS_X, DIVE_WORLD[1], DIVE_WORLD[2] - AXIS_Z)
    for root in roots:
        root.location = root.location + stand - Vector((0.0, 0.0, plo.z))
    bpy.context.view_layer.update()
    plo, phi = world_bounds(player)
    print(f"PLAYER {phi.z - plo.z:.3f}m tall, feet at z={plo.z:.3f} (deck {DIVE_WORLD[1]})")

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.lens = 50

light_data = bpy.data.lights.new("sun", type="SUN")
light_data.energy = 3.0
light = bpy.data.objects.new("sun", light_data)
scene.collection.objects.link(light)
light.rotation_euler = (math.radians(52), 0.0, math.radians(35))


def shot(name, eye, target, lens=50):
    cam_data.lens = lens
    cam.location = Vector(eye)
    cam.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    path = os.path.join(OUT_DIR, f"{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("WROTE", path)
    return path


shots = [
    # The whole tree, square on, with the runner for scale.
    ("elm-elevation", (2.0, -30.0, 9.5), (0.0, 0.0, 8.6), 46),
    # The climax: the crown bough at 8.3m, from a body's height above it.
    ("elm-crown-bough", (-7.4, -8.2, 11.4), (-1.4, -1.1, 8.5), 52),
    # The runner where the dive drops them, for scale against the bough.
    ("elm-scale", (-5.6, -5.0, 9.9), (-1.3, -1.0, 8.9), 58),
    # The landmark read from the Town House vista, 29m back and 17.6m up.
    ("elm-vista", (-28.0, -3.0, 17.6), (0.0, 0.0, 9.0), 62),
    # Underneath, where the crowd stands and the effigy hangs.
    ("elm-from-below", (-9.5, -9.5, 1.7), (0.0, 0.0, 7.4), 34),
]
for name, eye, target, lens in shots:
    shot(name, eye, target, lens)

# Contact sheet, so one image answers the question.
strip = np.zeros((TILE, TILE * len(shots), 4), dtype=np.float32)
for index, (name, _, _, _) in enumerate(shots):
    image = bpy.data.images.load(os.path.join(OUT_DIR, f"{name}.png"))
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    strip[:, index * TILE : (index + 1) * TILE, :] = pixels.reshape(TILE, TILE, 4)
sheet = bpy.data.images.new("elm-qa", width=TILE * len(shots), height=TILE)
sheet.pixels.foreach_set(strip.reshape(-1))
sheet.filepath_raw = os.path.join(OUT_DIR, "elm-qa-sheet.png")
sheet.file_format = "PNG"
sheet.save()
print("WROTE", os.path.join(OUT_DIR, "elm-qa-sheet.png"))
