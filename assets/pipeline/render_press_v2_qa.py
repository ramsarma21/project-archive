# Render sampled animation poses from the final modular press-v2 GLB.
# Output is QA-only under /tmp; no camera/light/geometry is exported.
import bpy
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "interior-kit-opt", "press-common-operable-v2.glb")
OUT = "/tmp/press-v2-qa"
os.makedirs(OUT, exist_ok=True)

def scene_bounds(meshes):
    low = Vector((1e9, 1e9, 1e9))
    high = Vector((-1e9, -1e9, -1e9))
    for obj in meshes:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            low = Vector(tuple(min(low[i], point[i]) for i in range(3)))
            high = Vector(tuple(max(high[i], point[i]) for i in range(3)))
    return low, high


def mute_all(meshes):
    for obj in meshes:
        if not obj.animation_data:
            continue
        for track in obj.animation_data.nla_tracks:
            track.mute = True


def sample(filename, clips=(), frame=0):
    # Import a fresh GLB for every pose so no terminal action state can leak
    # into the next screenshot. Multiple clips allow mechanically correct
    # sequence samples (carriage-out + tympan-open).
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    mute_all(meshes)
    for clip in clips:
        for obj in meshes:
            if not obj.animation_data:
                continue
            for track in obj.animation_data.nla_tracks:
                if track.name == clip:
                    track.mute = False
    scene = bpy.context.scene
    scene.frame_set(frame)
    bpy.context.view_layer.update()

    low, high = scene_bounds(meshes)
    center = (low + high) / 2
    radius = (high - low).length / 2
    camera_data = bpy.data.cameras.new("PressV2_QA_Camera")
    camera = bpy.data.objects.new("PressV2_QA_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = center + Vector((radius * 2.0, -radius * 2.5, radius * 1.25))
    camera.rotation_euler = (center - camera.location).normalized().to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 55
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.filepath = os.path.join(OUT, filename)
    bpy.ops.render.render(write_still=True)
    low_now, high_now = scene_bounds(meshes)
    print("RENDERED", filename, "clips", clips, "frame", frame,
          "bounds", tuple(round(v, 3) for v in low_now), tuple(round(v, 3) for v in high_now))


sample("01-closed.png")
sample("02-press-pull-mid.png", ("pressPull",), 9)
sample("03-press-pull-full.png", ("pressPull",), 17)
sample("04-carriage-out.png", ("carriageOut",), 14)
sample("05-carriage-out-tympan-open-mid.png", ("carriageOut", "tympanOpen"), 10)
sample("06-carriage-out-tympan-open-full.png", ("carriageOut", "tympanOpen"), 20)
print("PRESS V2 QA RENDER DONE")

