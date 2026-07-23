# Assemble press-common-operable-v2 entirely from imported Meshy components.
# Blender is used only for cleanup, decimation, orientation, pivots, parenting,
# texture atlasing, and animation. No visible production geometry is created.
#
# Run:
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#     --python assets/pipeline/assemble_press_v2.py
import bpy
import math
import os
import numpy as np
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "build", "interior-kit", "press-v2-components")
COMPONENT_OPT = os.path.join(ROOT, "build", "interior-kit-opt", "press-v2-components")
FINAL = os.path.join(ROOT, "build", "interior-kit-opt", "press-common-operable-v2.glb")
FRAME_ATLAS_PATH = os.path.join(RAW, "press-common-operable-v2-frame-atlas.png")
MECHANISM_ATLAS_PATH = os.path.join(RAW, "press-common-operable-v2-mechanism-atlas.png")
os.makedirs(COMPONENT_OPT, exist_ok=True)

# key: (node name, target tris, desired Blender xyz dimensions)
# Blender is Z-up after glTF import; export_yup converts back to glTF Y-up.
SPECS = {
    "press-frame-body": ("Press_Frame", 14000, (1.25, 1.55, 2.10)),
    "press-lever-bar": ("Press_Lever", 2500, (1.05, 0.075, 0.075)),
    "press-screw-spindle": ("Press_Screw", 4500, (0.18, 0.18, 0.78)),
    "press-platen-board": ("Press_Platen", 3000, (0.76, 0.62, 0.12)),
    "press-carriage-coffin": ("Press_Carriage", 4500, (0.80, 1.12, 0.16)),
    "press-tympan-frame": ("Press_Tympan", 3500, (0.75, 1.06, 0.055)),
    "press-frisket-frame": ("Press_Frisket", 3000, (0.72, 1.02, 0.045)),
}


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def tris(obj):
    return sum(len(poly.vertices) - 2 for poly in obj.data.polygons)


def bounds_world(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    low = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    high = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    return low, high


def origin_to(obj, world_point):
    activate(obj)
    bpy.context.scene.cursor.location = world_point
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")


def fit_dimensions(obj, desired):
    bpy.context.view_layer.update()
    dims = obj.dimensions
    obj.scale = tuple(desired[i] / max(dims[i], 1e-6) for i in range(3))
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def parent_keep_world(child, parent):
    bpy.context.view_layer.update()
    world = child.matrix_world.copy()
    child.parent = parent
    child.matrix_world = world
    bpy.context.view_layer.update()


def clean_and_decimate(obj, target):
    activate(obj)
    # Recalculate imported normals; the source mesh remains imported geometry.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    count = tris(obj)
    if count > target:
        modifier = obj.modifiers.new("PressV2Budget", "DECIMATE")
        modifier.ratio = target / count
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def export_component(obj, key):
    activate(obj)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(COMPONENT_OPT, key + ".glb"),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=85,
        export_animations=False,
    )


def import_component(key, node_name, target, desired):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(RAW, key + ".glb"))
    new_objects = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in new_objects if obj.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"{key}: expected one imported mesh, got {len(meshes)}")
    obj = meshes[0]
    obj.name = node_name
    obj.data.name = node_name + "_Mesh"
    for extra in new_objects:
        if extra != obj:
            bpy.data.objects.remove(extra, do_unlink=True)
    clean_and_decimate(obj, target)
    export_component(obj, key)
    fit_dimensions(obj, desired)
    return obj


def imported_base_image(obj):
    material = obj.data.materials[0] if obj.data.materials else None
    if not material or not material.node_tree:
        raise RuntimeError(f"{obj.name}: imported material missing")
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf and bsdf.inputs["Base Color"].is_linked:
        source = bsdf.inputs["Base Color"].links[0].from_node
        if source.type == "TEX_IMAGE" and source.image:
            return source.image
    candidates = [
        node.image for node in material.node_tree.nodes
        if node.type == "TEX_IMAGE" and node.image and "normal" not in node.image.name.lower()
    ]
    if not candidates:
        raise RuntimeError(f"{obj.name}: imported base-color image missing")
    return candidates[0]


def resized_pixels(image, width, height):
    source_width, source_height = image.size
    pixels = np.asarray(image.pixels[:], dtype=np.float32).reshape(source_height, source_width, 4)
    xs = np.linspace(0, source_width - 1, width).astype(np.int32)
    ys = np.linspace(0, source_height - 1, height).astype(np.int32)
    return pixels[np.ix_(ys, xs)]


def write_atlas(name, pixels, path):
    height, width, _ = pixels.shape
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    image.pixels.foreach_set(pixels.reshape(-1))
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    image.pack()
    return image


def atlas_material(name, image):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    texture = material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    material.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.82
    return material


def make_atlases(frame, mechanisms):
    # Keep each imported Meshy UV layout intact. The frame gets one full atlas;
    # the six moving components occupy a deterministic 3x2 texture tile grid.
    frame_pixels = resized_pixels(imported_base_image(frame), 1024, 1024)
    frame_atlas = write_atlas("PressV2_FrameAtlas", frame_pixels, FRAME_ATLAS_PATH)
    frame_material = atlas_material("PressV2_FrameMaterial", frame_atlas)
    frame.data.materials.clear()
    frame.data.materials.append(frame_material)

    atlas_pixels = np.zeros((1024, 1024, 4), dtype=np.float32)
    atlas_pixels[:, :, 3] = 1.0
    columns, rows = 3, 2
    for index, obj in enumerate(mechanisms):
        column = index % columns
        row = index // columns
        x0 = round(column * 1024 / columns)
        x1 = round((column + 1) * 1024 / columns)
        y0 = round(row * 1024 / rows)
        y1 = round((row + 1) * 1024 / rows)
        atlas_pixels[y0:y1, x0:x1] = resized_pixels(imported_base_image(obj), x1 - x0, y1 - y0)
        if not obj.data.uv_layers:
            raise RuntimeError(f"{obj.name}: imported mesh has no UVs")
        for loop in obj.data.uv_layers.active.data:
            loop.uv.x = (column + loop.uv.x) / columns
            loop.uv.y = (row + loop.uv.y) / rows

    mechanism_atlas = write_atlas(
        "PressV2_MechanismAtlas", atlas_pixels, MECHANISM_ATLAS_PATH)
    mechanism_material = atlas_material("PressV2_MechanismMaterial", mechanism_atlas)
    for obj in mechanisms:
        obj.data.materials.clear()
        obj.data.materials.append(mechanism_material)
    return frame_atlas, mechanism_atlas


def action_to_nla(obj, clip, frames, data_path, index=None):
    obj.animation_data_clear()
    obj.animation_data_create()
    action = bpy.data.actions.new(f"{clip}__{obj.name}")
    obj.animation_data.action = action
    for frame, value in frames:
        if data_path == "location":
            obj.location = value
        elif data_path == "rotation_euler":
            obj.rotation_euler = value
        else:
            raise ValueError(data_path)
        obj.keyframe_insert(data_path=data_path, index=index if index is not None else -1, frame=frame)
    track = obj.animation_data.nla_tracks.new()
    track.name = clip
    strip = track.strips.new(clip, int(frames[0][0]), action)
    strip.name = clip
    strip.extrapolation = "HOLD_FORWARD"
    obj.animation_data.action = None


def add_transform_clip(obj, clip, frame_values):
    obj.animation_data_create()
    action = bpy.data.actions.new(f"{clip}__{obj.name}")
    obj.animation_data.action = action
    for frame, location, rotation in frame_values:
        obj.location = location
        obj.rotation_euler = rotation
        obj.keyframe_insert(data_path="location", frame=frame)
        obj.keyframe_insert(data_path="rotation_euler", frame=frame)
    track = obj.animation_data.nla_tracks.new()
    track.name = clip
    strip = track.strips.new(clip, int(frame_values[0][0]), action)
    strip.name = clip
    strip.extrapolation = "HOLD_FORWARD"
    obj.animation_data.action = None


bpy.ops.wm.read_factory_settings(use_empty=True)
parts = {}
for key, (node_name, target, desired) in SPECS.items():
    parts[node_name] = import_component(key, node_name, target, desired)

frame = parts["Press_Frame"]
lever = parts["Press_Lever"]
screw = parts["Press_Screw"]
platen = parts["Press_Platen"]
carriage = parts["Press_Carriage"]
tympan = parts["Press_Tympan"]
frisket = parts["Press_Frisket"]

# Frame origin: centered on floor. It is the hierarchy root.
low, high = bounds_world(frame)
origin_to(frame, Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z)))
frame.location = (0, 0, 0)

# Lever pivot is the plain end; generated bulb/grip remains at the outer end.
low, high = bounds_world(lever)
origin_to(lever, Vector((high.x, (low.y + high.y) / 2, (low.z + high.z) / 2)))
lever.rotation_euler.z = math.pi
lever.location = (0, 0.02, 1.62)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# Screw and platen use centered origins for vertical travel and screw rotation.
low, high = bounds_world(screw)
origin_to(screw, (low + high) / 2)
screw.location = (0, 0.02, 1.59)
low, high = bounds_world(platen)
origin_to(platen, (low + high) / 2)
platen.location = (0, 0.02, 1.23)

# Carriage rests in under the platen. Front/out direction is Blender -Y,
# which exports as glTF +Z (toward the pressman).
low, high = bounds_world(carriage)
origin_to(carriage, (low + high) / 2)
carriage.location = (0, 0.02, 0.93)

# Tympan/frisket hinge origins are the back (+Y) short edge and lower surface.
low, high = bounds_world(tympan)
origin_to(tympan, Vector(((low.x + high.x) / 2, high.y, low.z)))
tympan.location = (0, 0.02 + 1.06 / 2, 1.035)
low, high = bounds_world(frisket)
origin_to(frisket, Vector(((low.x + high.x) / 2, high.y, low.z)))
frisket.location = (0, 0.02 + 1.02 / 2, 1.095)

# Parent hierarchy with world transforms preserved. The frisket follows the
# tympan hinge; both ride with the sliding carriage.
for obj in (lever, screw, platen, carriage):
    parent_keep_world(obj, frame)
parent_keep_world(tympan, carriage)
parent_keep_world(frisket, tympan)

# Atlas after transforms/parenting. Only imported source textures contribute;
# no Blender-generated visible geometry or procedural production material.
make_atlases(frame, [lever, screw, platen, carriage, tympan, frisket])

fps = 24
bpy.context.scene.render.fps = fps
for obj in parts.values():
    obj.rotation_mode = "XYZ"
rest_lever = lever.rotation_euler.copy()
rest_lever.z = math.radians(-50)
lever.rotation_euler = rest_lever
rest_screw = screw.rotation_euler.copy()
rest_platen = platen.location.copy()
rest_screw_loc = screw.location.copy()
rest_carriage = carriage.location.copy()
rest_tympan = tympan.rotation_euler.copy()
rest_frisket = frisket.rotation_euler.copy()

# Impression: 0.67 s pull ending at full compression; release reverses in
# 0.54 s. Lever and screw rotate together. The 0.03 m coarse-screw stroke
# closes the measured 0.03 m rest gap without penetrating the frisket/tympan.
pull_angle = math.radians(85)
impression_drop = 0.03
add_transform_clip(lever, "pressPull", [
    (1, lever.location.copy(), rest_lever),
    (9, lever.location.copy(), (rest_lever.x, rest_lever.y, rest_lever.z + math.radians(42))),
    (17, lever.location.copy(), (rest_lever.x, rest_lever.y, rest_lever.z + pull_angle)),
])
add_transform_clip(screw, "pressPull", [
    (1, rest_screw_loc, rest_screw),
    (9, rest_screw_loc + Vector((0, 0, -impression_drop / 2)), (rest_screw.x, rest_screw.y, rest_screw.z + math.radians(42))),
    (17, rest_screw_loc + Vector((0, 0, -impression_drop)), (rest_screw.x, rest_screw.y, rest_screw.z + pull_angle)),
])
add_transform_clip(platen, "pressPull", [
    (1, rest_platen, platen.rotation_euler.copy()),
    (9, rest_platen + Vector((0, 0, -impression_drop / 2)), platen.rotation_euler.copy()),
    (17, rest_platen + Vector((0, 0, -impression_drop)), platen.rotation_euler.copy()),
])
add_transform_clip(lever, "pressRelease", [
    (1, lever.location.copy(), (rest_lever.x, rest_lever.y, rest_lever.z + pull_angle)),
    (14, lever.location.copy(), rest_lever),
])
add_transform_clip(screw, "pressRelease", [
    (1, rest_screw_loc + Vector((0, 0, -impression_drop)), (rest_screw.x, rest_screw.y, rest_screw.z + pull_angle)),
    (14, rest_screw_loc, rest_screw),
])
add_transform_clip(platen, "pressRelease", [
    (1, rest_platen + Vector((0, 0, -impression_drop)), platen.rotation_euler.copy()),
    (14, rest_platen, platen.rotation_euler.copy()),
])

# Carriage stroke: 0.54 s, 0.72 m along its rails. The full extension clears
# the parked lever/frame before the tympan is opened.
out_location = rest_carriage + Vector((0, -0.72, 0))
add_transform_clip(carriage, "carriageOut", [
    (1, rest_carriage, carriage.rotation_euler.copy()),
    (14, out_location, carriage.rotation_euler.copy()),
])
add_transform_clip(carriage, "carriageIn", [
    (1, out_location, carriage.rotation_euler.copy()),
    (14, rest_carriage, carriage.rotation_euler.copy()),
])

# Tympan opens about its back-edge hinge. Frisket stays nested with a slight
# independent fold so the two imported frames do not z-fight while open.
open_tympan = (rest_tympan.x - math.radians(78), rest_tympan.y, rest_tympan.z)
open_frisket = (rest_frisket.x - math.radians(8), rest_frisket.y, rest_frisket.z)
add_transform_clip(tympan, "tympanOpen", [
    (1, tympan.location.copy(), rest_tympan),
    (20, tympan.location.copy(), open_tympan),
])
add_transform_clip(frisket, "tympanOpen", [
    (1, frisket.location.copy(), rest_frisket),
    (20, frisket.location.copy(), open_frisket),
])
add_transform_clip(tympan, "tympanClose", [
    (1, tympan.location.copy(), open_tympan),
    (20, tympan.location.copy(), rest_tympan),
])
add_transform_clip(frisket, "tympanClose", [
    (1, frisket.location.copy(), open_frisket),
    (20, frisket.location.copy(), rest_frisket),
])

# Each animated object has a forward/rest-starting clip and a reverse/full-
# starting clip. Put the rest-starting clip last so NLA's frame-0 hold resolves
# the static GLB node to the closed/up/in pose while all clips remain exported.
rest_track_by_object = {
    lever: "pressPull",
    screw: "pressPull",
    platen: "pressPull",
    carriage: "carriageOut",
    tympan: "tympanOpen",
    frisket: "tympanOpen",
}
for obj, track_name in rest_track_by_object.items():
    tracks = obj.animation_data.nla_tracks
    old_track = next(track for track in tracks if track.name == track_name)
    old_strip = old_track.strips[0]
    action = old_strip.action
    start = old_strip.frame_start
    tracks.remove(old_track)
    new_track = tracks.new()
    new_track.name = track_name
    new_strip = new_track.strips.new(track_name, int(start), action)
    new_strip.name = track_name
    new_strip.extrapolation = "HOLD_FORWARD"

# Evaluate at frame 0, then restore the exported default pose to closed,
# carriage-in, platen-up.
bpy.context.scene.frame_start = 0
bpy.context.scene.frame_end = 20
bpy.context.scene.frame_set(0)
lever.rotation_euler = rest_lever
screw.rotation_euler = rest_screw
screw.location = rest_screw_loc
platen.location = rest_platen
carriage.location = rest_carriage
tympan.rotation_euler = rest_tympan
frisket.rotation_euler = rest_frisket
bpy.context.view_layer.update()

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=FINAL,
    export_format="GLB",
    export_yup=True,
    export_image_format="AUTO",
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_merge_animation="ACTION",
)
print("WROTE", FINAL, os.path.getsize(FINAL))
print("TRIS", sum(tris(obj) for obj in parts.values()))
print("NODES", ", ".join(parts.keys()))

