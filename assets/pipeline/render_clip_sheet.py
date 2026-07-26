# Render a horizontal contact sheet per animation clip so a human (or an agent)
# can actually LOOK at the motion instead of trusting that it loaded. One strip
# per clip, frames sampled evenly across the clip, plus an extra final tile that
# repeats frame 0 for cyclic clips so the loop seam is visible side by side.
#
# Catches what numeric checks cannot: T-pose snapping, inverted knees/elbows,
# broken wrists, ground penetration, and a facing or scale mismatch.
#
# Run:
#   blender --background --python render_clip_sheet.py -- in.glb outDir [tiles] [clip ...]
#
# Env:
#   CLIP_SHEET_ZOOM   camera distance as a multiple of character height (1.55)
#   CLIP_SHEET_FRAMING  "full" (default) or "upper" for a grip/wrist close-up
import bpy
import os
import sys
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
IN_GLB = os.path.abspath(argv[0])
OUT_DIR = os.path.abspath(argv[1])
TILES = int(argv[2]) if len(argv) > 2 else 6
ONLY = set(argv[3:])
ZOOM = float(os.environ.get("CLIP_SHEET_ZOOM", "1.55"))
FRAMING = os.environ.get("CLIP_SHEET_FRAMING", "full")
TILE_W, TILE_H = (420, 620) if FRAMING == "full" else (460, 460)
os.makedirs(OUT_DIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_shadows = True
scene.render.resolution_x = TILE_W
scene.render.resolution_y = TILE_H
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.world = bpy.data.worlds.new("qa")
scene.world.color = (0.62, 0.64, 0.68)

bpy.ops.import_scene.gltf(filepath=IN_GLB)
rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
assert rig, "no armature"
# Skinned meshes only. Blender's glTF importer invents an unskinned +/-1 unit
# "Icosphere" that is not in the file, and including it in the bounds wrecks the
# automatic framing: it made the player render 56% too wide, and it hid the
# officer entirely, since that rig is 0.019 units tall and fits inside the sphere.
meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() is rig]
assert meshes, "no skinned mesh"
for stray in [o for o in bpy.data.objects if o.type == "MESH" and o not in meshes]:
    bpy.data.objects.remove(stray, do_unlink=True)

# Frame the rest pose once so every clip shares one camera: a clip that arrives
# at the wrong scale or facing then reads as wrong inside a constant frame.
deps = bpy.context.evaluated_depsgraph_get()
lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for mesh_obj in meshes:
    ev = mesh_obj.evaluated_get(deps)
    for vertex in ev.to_mesh().vertices:
        world = ev.matrix_world @ vertex.co
        for axis in range(3):
            lo[axis] = min(lo[axis], world[axis])
            hi[axis] = max(hi[axis], world[axis])
    ev.to_mesh_clear()
height = hi.z - lo.z
print(f"REST_BOUNDS lo=({lo.x:.4f},{lo.y:.4f},{lo.z:.4f}) "
      f"hi=({hi.x:.4f},{hi.y:.4f},{hi.z:.4f}) height={height:.4f}")

# A ground plane makes foot penetration and float obvious; it is QA scaffolding,
# not world art. Sized RELATIVE to the character: this cast is not authored at a
# consistent scale (the player rig is 1.8 Blender units tall, the officer 0.019),
# and a fixed-size plane swallows the small ones completely.
extent = max(height * 2.5, 1e-4)
ground = bpy.data.meshes.new("ground")
ground.from_pydata(
    [(-extent, -extent, 0), (extent, -extent, 0), (extent, extent, 0), (-extent, extent, 0)],
    [],
    [(0, 1, 2, 3)],
)
ground.update()
ground_obj = bpy.data.objects.new("ground", ground)
scene.collection.objects.link(ground_obj)
# "upper" frames the hands and head, which is where a two-handed modern grip, a
# broken wrist or a bad flintlock hold actually shows.
focus_z = height * (0.52 if FRAMING == "full" else 0.80)
center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, focus_z))

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
dist = height * ZOOM
cam.location = center + Vector((dist * 0.55, -dist, height * 0.10))
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
cam_data.lens = 52
# Clip planes must follow the subject's scale. Blender's 0.1m default near plane
# is larger than this whole cast member (the officer rig is 0.019 units tall), so
# the leftover default clipped the entire scene away and rendered empty frames.
cam_data.clip_start = max(dist * 0.01, 1e-5)
cam_data.clip_end = dist * 20

actions = {action.name: action for action in bpy.data.actions}
print("CLIPS", len(actions), sorted(actions))
rig.animation_data_create()
for track in rig.animation_data.nla_tracks:
    track.mute = True

tmp = os.path.join(OUT_DIR, "_tile.png")


def render_tile():
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(tmp)
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(TILE_H, TILE_W, 4)


for name in sorted(actions):
    if ONLY and name not in ONLY:
        continue
    action = actions[name]
    rig.animation_data.action = action
    try:
        rig.animation_data.action_slot = action.slots[0]
    except Exception:
        pass
    start, end = action.frame_range
    # Sample the clip, then repeat frame 0 as the last tile: for a cyclic clip
    # the final sampled frame and that repeat must be visually continuous.
    frames = [start + (end - start) * i / (TILES - 1) for i in range(TILES)]
    frames.append(start)
    strip = np.zeros((TILE_H, TILE_W * len(frames), 4), dtype=np.float32)
    for index, frame in enumerate(frames):
        scene.frame_set(int(round(frame)))
        bpy.context.view_layer.update()
        strip[:, index * TILE_W : (index + 1) * TILE_W, :] = render_tile()
    out = bpy.data.images.new(name, width=strip.shape[1], height=TILE_H)
    out.pixels.foreach_set(strip.reshape(-1))
    out.filepath_raw = os.path.join(OUT_DIR, f"{name}.png")
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    print("SHEET", name, f"{len(frames)} tiles", f"frames {int(start)}-{int(end)}")

if os.path.exists(tmp):
    os.remove(tmp)
print("DONE", OUT_DIR)
