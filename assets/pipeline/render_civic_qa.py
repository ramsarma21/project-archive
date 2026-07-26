# QA sheet for an M1 civic landmark: the building at true scale, the runner rig
# standing on it, and the authored deck planes drawn in as wireframe.
#
# The overlay planes are a dev diagnostic and never ship. They are the whole
# point of the sheet: you can see at a glance whether the stone meets the plane
# the player is actually standing on, rather than trusting that it does. The rig
# is there for the other half — a building can sit exactly on its collision and
# still be the wrong size for a 1.55m runner.
#
# Run:
#   blender --background --python assets/pipeline/render_civic_qa.py \
#     -- built.glb hull.json outDir [character.glb]
import bpy
import json
import math
import os
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
BUILT_GLB = os.path.abspath(argv[0])
HULL_JSON = os.path.abspath(argv[1])
OUT_DIR = os.path.abspath(argv[2])
CHARACTER = os.path.abspath(argv[3]) if len(argv) > 3 else None

with open(HULL_JSON) as handle:
    HULL = json.load(handle)
KEY = HULL["key"]
ENV = HULL["envelope"]
DECKS = [d for d in HULL["decks"] if d.get("mask")]
TILE = 820
PLAYER_H = 1.55
os.makedirs(OUT_DIR, exist_ok=True)

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
    """Return (mesh objects, root objects). A rigged character's meshes hang off
    an armature, so the roots are what has to be moved and scaled."""
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


building, _ = import_glb(BUILT_GLB)
lo, hi = world_bounds(building)
print(f"BUILT_SIZE x={hi.x - lo.x:.3f} y={hi.y - lo.y:.3f} z={hi.z - lo.z:.3f} base={lo.z:.3f}")


# glTF is Y-up, Blender is Z-up: a hull-local offset (x, y, z) lands at (x, -z, y).
def to_blender(lx, ly, lz):
    return Vector((lx, -lz, ly))


# ---- the authored decks, as translucent diagnostic planes -------------------

overlay = bpy.data.materials.new("deck-plane")
overlay.diffuse_color = (1.0, 0.32, 0.12, 1.0)
for deck in DECKS:
    box = deck["clipped"]
    width = box["maxX"] - box["minX"]
    depth = box["maxZ"] - box["minZ"]
    centre = to_blender(
        (box["minX"] + box["maxX"]) / 2.0, deck["y"], (box["minZ"] + box["maxZ"]) / 2.0
    )
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=centre)
    plane = bpy.context.active_object
    plane.scale = (width, depth, 1.0)
    plane.name = f"deck-{deck['id']}"
    plane.data.materials.append(overlay)
    # Wireframe only: a filled plane would hide the very surface being judged.
    modifier = plane.modifiers.new("wire", "WIREFRAME")
    modifier.thickness = 0.05
    print(f"DECK {deck['id']} y={deck['y']} {width:.1f}x{depth:.1f}m")


# ---- the runner, on the ground and on the highest authored surface ----------

def largest_standable_point(deck):
    """Centre of the biggest standable run on this deck, in hull-local x/z."""
    n = deck["mask"]["n"]
    rows = deck["mask"]["rows"]
    box = deck["clipped"]
    best = None
    for i in range(n):
        j = 0
        while j < n:
            if rows[i][j] != "1":
                j += 1
                continue
            start = j
            while j < n and rows[i][j] == "1":
                j += 1
            if best is None or (j - start) > best[2]:
                best = (i, start, j - start)
    if best is None:
        return None
    i, start, run = best
    lx = box["minX"] + ((i + 0.5) / n) * (box["maxX"] - box["minX"])
    lz = box["minZ"] + ((start + run / 2.0) / n) * (box["maxZ"] - box["minZ"])
    return lx, lz


stands = []
if DECKS:
    top = DECKS[-1]
    point = largest_standable_point(top)
    if point:
        stands.append((point[0], top["y"], point[1], f"on {top['id']} at {top['y']}m"))
# And one at street level, off the east face, where the run passes.
stands.append((ENV["maxX"] + 1.6, 0.0, 0.0, "in the street off the east face"))

players = []
if CHARACTER and os.path.exists(CHARACTER):
    for lx, ly, lz, label in stands:
        meshes, roots = import_glb(CHARACTER)
        plo, phi = world_bounds(meshes)
        scale = PLAYER_H / (phi.z - plo.z)
        # Multiply, never assign: the cast is exported with a scale already on
        # the armature root, and overwriting it made a 100m runner.
        for root in roots:
            root.scale = root.scale * scale
        bpy.context.view_layer.update()
        plo, phi = world_bounds(meshes)
        target = to_blender(lx, ly, lz)
        for root in roots:
            root.location = root.location + target - Vector((0.0, 0.0, plo.z))
        bpy.context.view_layer.update()
        plo, phi = world_bounds(meshes)
        players.extend(meshes)
        print(f"PLAYER {phi.z - plo.z:.3f}m tall, feet at z={plo.z:.3f}, {label}")

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

light_data = bpy.data.lights.new("sun", type="SUN")
light_data.energy = 3.2
light = bpy.data.objects.new("sun", light_data)
scene.collection.objects.link(light)
light.rotation_euler = (math.radians(48), 0.0, math.radians(38))


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


# Framing is derived from the envelope so the same sheet works for an 11m block
# and a 22m steeple without a second set of hand-tuned numbers.
half_x = (ENV["maxX"] - ENV["minX"]) / 2.0
half_z = (ENV["maxZ"] - ENV["minZ"]) / 2.0
top_y = ENV["maxY"]
reach = max(half_x, half_z)
mid = top_y * 0.5

# Blender's default sensor, and a square render fits the larger dimension — so
# the vertical half-angle is atan(18/lens) either way.
SENSOR_MM = 36.0


def fit_distance(extent, lens, margin=0.14):
    """Camera distance that frames `extent` metres with a margin, for this lens.

    Derived rather than a multiplier. A fixed 1.35x of the height was enough for a
    17.6m Town House and cropped the spire off a 22.2m steeple, and a whole-object
    elevation that silently loses the top of the object is worse than no shot: it
    is the shot you check the silhouette on.
    """
    return (extent * (1.0 + margin) / 2.0) / (SENSOR_MM / 2.0 / lens)

shots = [
    # The east front, square on, with the runner in the street for scale.
    ("civic-east", to_blender(reach + fit_distance(top_y, 52), mid, 0.0), to_blender(0, mid, 0), 52),
    # Three-quarter from the north-east: the face the ascent works round.
    (
        "civic-three-quarter",
        to_blender(
            reach + fit_distance(top_y, 48) * 0.72,
            top_y * 0.62,
            -(reach + fit_distance(top_y, 48) * 0.66),
        ),
        to_blender(0, mid * 0.96, 0),
        48,
    ),
    # The head of the building: the tower, the cupola and the top platform, from
    # a body's height above the highest deck.
    (
        "civic-head",
        to_blender(reach + 5.4, top_y + 3.2, -(reach + 4.6)),
        to_blender(0, top_y - 1.6, 0),
        56,
    ),
    # Street level looking up, which is how the player meets it for most of the
    # run: the arcade and the ground storey.
    ("civic-from-the-street", to_blender(reach + 7.0, 1.7, -(reach + 5.0)), to_blender(0, top_y * 0.55, 0), 34),
    # Straight down the walkable surfaces, so the deck planes and the stone can
    # be compared without perspective arguing about it.
    (
        "civic-decks",
        to_blender(reach + top_y * 0.42, top_y * 1.02, -(reach + top_y * 0.34)),
        to_blender(0, top_y * 0.78, 0),
        62,
    ),
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
sheet = bpy.data.images.new(f"{KEY}-qa", width=TILE * len(shots), height=TILE)
sheet.pixels.foreach_set(strip.reshape(-1))
sheet.filepath_raw = os.path.join(OUT_DIR, f"{KEY}-qa-sheet.png")
sheet.file_format = "PNG"
sheet.save()
print("WROTE", os.path.join(OUT_DIR, f"{KEY}-qa-sheet.png"))
