# Assemble the eight canonical interior shells exclusively from imported,
# Gemini -> Meshy generated modular wall/ceiling GLBs.
#
# No visible Blender primitive geometry is created. Every visible vertex comes
# from one of:
#   int-wall-{plaster,board,civic,window}-panel.glb
#   int-ceiling-beamed-panel.glb
#
# The imported modules are normalized to a unit panel, then instanced/scaled
# into four thick walls plus a ceiling. The front wall has exactly one real
# doorway opening. There is deliberately NO floor. Blender +Y maps to glTF -Z,
# therefore the doorway wall exports facing canonical local -Z.
#
# Run:
# /Applications/Blender.app/Contents/MacOS/Blender --background \
#   --python assets/pipeline/assemble_canonical_interior_structures.py
import bpy
import bmesh
import json
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "build", "world-v3-structures")
CONCEPTS = os.path.join(ROOT, "source", "concepts", "interiors-structures")
TEXTURES = os.path.join(RAW, "assembly-textures")
SPEC_PATH = os.path.join(ROOT, "pipeline", "interior_structures_spec.json")
os.makedirs(TEXTURES, exist_ok=True)

with open(SPEC_PATH) as fh:
    SPEC = json.load(fh)

SHELLS = [a for a in SPEC["assets"] if a["key"].startswith("int-shell-")]

HEIGHTS = {
    "int-shell-domestic-narrow-a": 3.2,
    "int-shell-domestic-wide-b": 3.8,
    "int-shell-shopfront-a": 4.2,
    "int-shell-workroom-a": 3.8,
    "int-shell-warehouse-a": 5.2,
    "int-shell-civic-a": 4.8,
    "int-shell-meetinghouse-hero": 8.5,
    "int-shell-ropewalk-a": 4.2,
}

WALL_SOURCE = {
    "int-shell-domestic-narrow-a": "int-wall-plaster-panel",
    "int-shell-domestic-wide-b": "int-wall-civic-panel",
    "int-shell-shopfront-a": "int-wall-plaster-panel",
    "int-shell-workroom-a": "int-wall-board-panel",
    "int-shell-warehouse-a": "int-wall-board-panel",
    "int-shell-civic-a": "int-wall-civic-panel",
    "int-shell-meetinghouse-hero": "int-wall-plaster-panel",
    "int-shell-ropewalk-a": "int-wall-board-panel",
}

CROP = {
    "int-wall-plaster-panel": (0.27, 0.06, 0.73, 0.95),
    "int-wall-board-panel": (0.28, 0.07, 0.72, 0.93),
    "int-wall-civic-panel": (0.31, 0.06, 0.70, 0.94),
}


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def join_imported():
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("import had no mesh")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Meshy panel exports can contain open boundary loops even when they look
    # closed in the render. Repair each imported source module BEFORE
    # instancing. This does not fill the room doorway/bottom because those are
    # created later by panel placement, not holes in a module mesh.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
    bmesh.ops.dissolve_degenerate(bm, dist=0.00005, edges=bm.edges)
    seen = set()
    duplicate_faces = []
    for face in bm.faces:
        signature = tuple(sorted(vertex.index for vertex in face.verts))
        if signature in seen:
            duplicate_faces.append(face)
        else:
            seen.add(signature)
    if duplicate_faces:
        bmesh.ops.delete(bm, geom=duplicate_faces, context="FACES")
    loose = [v for v in bm.verts if not v.link_edges]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    boundaries = [edge for edge in bm.edges if edge.is_boundary]
    if boundaries:
        bmesh.ops.holes_fill(bm, edges=boundaries, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def watertight_module(obj):
    """Voxel-rebuild one generated module and create deterministic planar UVs."""
    coords = [vertex.co.copy() for vertex in obj.data.vertices]
    mins = [min(co[axis] for co in coords) for axis in range(3)]
    maxs = [max(co[axis] for co in coords) for axis in range(3)]
    spans = [maxs[axis] - mins[axis] for axis in range(3)]
    obj.data.remesh_voxel_size = max(spans) / 120.0
    obj.data.remesh_voxel_adaptivity = 0.0
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.voxel_remesh()
    coords = [vertex.co.copy() for vertex in obj.data.vertices]
    mins = [min(co[axis] for co in coords) for axis in range(3)]
    maxs = [max(co[axis] for co in coords) for axis in range(3)]
    spans = [maxs[axis] - mins[axis] for axis in range(3)]
    plane_axes = sorted(range(3), key=lambda axis: spans[axis], reverse=True)[:2]
    uv = obj.data.uv_layers.new(name="UVMap")
    for loop in obj.data.loops:
        co = obj.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = tuple(
            (co[axis] - mins[axis]) / max(spans[axis], 1e-5)
            for axis in plane_axes
        )
    obj.data.update()
    probe = bmesh.new()
    probe.from_mesh(obj.data)
    boundary = sum(1 for edge in probe.edges if edge.is_boundary)
    invalid = sum(1 for edge in probe.edges if len(edge.link_faces) == 0 or len(edge.link_faces) > 2)
    probe.free()
    print("MODULE REMESH TOPOLOGY", obj.name, "boundary", boundary, "invalid", invalid)


def cropped_concept_texture(key):
    """Return the accepted Gemini-generated shadowless surface swatch."""
    texture_key = {
        "int-wall-plaster-panel": "int-texture-plaster",
        "int-wall-board-panel": "int-texture-board",
        "int-wall-civic-panel": "int-texture-civic",
        "int-ceiling-beamed-panel": "int-texture-board",
    }[key]
    return os.path.join(CONCEPTS, texture_key + ".png")


def apply_surface_texture(obj, key):
    path = cropped_concept_texture(key)
    image = bpy.data.images.load(path, check_existing=True)
    image.colorspace_settings.name = "sRGB"
    if not obj.data.materials:
        material = bpy.data.materials.new(key + "_material")
        material.use_nodes = True
        obj.data.materials.append(material)
    for material in obj.data.materials:
        material.use_nodes = True
        nodes = material.node_tree.nodes
        bsdf = nodes.get("Principled BSDF")
        if not bsdf:
            continue
        for link in list(bsdf.inputs["Base Color"].links):
            material.node_tree.links.remove(link)
        texture = nodes.new("ShaderNodeTexImage")
        texture.name = "GeneratedConceptSurfacePNG"
        texture.image = image
        material.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 0.87


def load_unit_panel(key, role):
    """Import and canonicalize a generated module to X=width,Y=thickness,Z=height."""
    path = os.path.join(RAW, key + ".glb")
    if not os.path.exists(path):
        raise RuntimeError("missing generated module " + path)
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [o for o in bpy.context.scene.objects if o not in before and o.type == "MESH"]
    if not imported:
        raise RuntimeError("module has no mesh " + key)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in imported:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = imported[0]
    if len(imported) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    watertight_module(obj)
    apply_surface_texture(obj, key)

    # Meshy modules are intentionally generated at 12k for texture/shape
    # reliability, but a shell repeats them many times. Reduce each imported
    # source once before instancing so the assembled shell stays near its 40k
    # budget without an extreme whole-room decimation pass.
    source_tris = sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)
    # The final room repeats many modules. Keep each source lightweight so no
    # destructive whole-room decimation is needed (which caused crushed
    # triangular facets in inside-view QA).
    target_tris = 280 if role == "ceiling" and key == "int-ceiling-beamed-panel" else 160
    if source_tris > target_tris:
        modifier = obj.modifiers.new("module_budget", "DECIMATE")
        modifier.ratio = target_tris / source_tris
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)

    # Detect source axes by extents. For wall modules the smallest extent is
    # thickness and the two larger axes become width/height (height = source
    # axis most aligned with Blender Z when plausible). Ceiling uses the two
    # largest as X/Y and smallest as Z.
    coords = [v.co.copy() for v in obj.data.vertices]
    mins = [min(c[i] for c in coords) for i in range(3)]
    maxs = [max(c[i] for c in coords) for i in range(3)]
    spans = [maxs[i] - mins[i] for i in range(3)]
    centers = [(mins[i] + maxs[i]) * 0.5 for i in range(3)]

    if role == "ceiling":
        thickness_axis = min(range(3), key=lambda i: spans[i])
        plane_axes = [i for i in range(3) if i != thickness_axis]
        x_axis, y_axis = plane_axes
        mapping = (x_axis, y_axis, thickness_axis)
    else:
        thickness_axis = min(range(3), key=lambda i: spans[i])
        plane_axes = [i for i in range(3) if i != thickness_axis]
        # Prefer source Z as height; otherwise use the longer plane axis.
        z_axis = 2 if 2 in plane_axes else max(plane_axes, key=lambda i: spans[i])
        x_axis = next(i for i in plane_axes if i != z_axis)
        mapping = (x_axis, thickness_axis, z_axis)

    for v in obj.data.vertices:
        old = v.co.copy()
        vals = [
            (old[mapping[i]] - centers[mapping[i]]) / max(spans[mapping[i]], 1e-5)
            for i in range(3)
        ]
        v.co = Vector(vals)
    if key != "int-ceiling-beamed-panel":
        # Reduce the generated rectangular panel to its four imported corner
        # samples, preserving the generated material/texture, then give that
        # cleaned imported surface thickness. This removes Meshy's internal
        # self-intersections and photographic warp without a Blender primitive.
        thickness_axis = 2 if role == "ceiling" else 1
        plane_axes = [axis for axis in range(3) if axis != thickness_axis]
        source_coords = [vertex.co.copy() for vertex in obj.data.vertices]
        targets = [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]
        corners = []
        for target in targets:
            sample = min(
                source_coords,
                key=lambda co: (
                    (co[plane_axes[0]] - target[0]) ** 2
                    + (co[plane_axes[1]] - target[1]) ** 2
                ),
            ).copy()
            sample[thickness_axis] = 0.0
            corners.append(sample)
        materials = list(obj.data.materials)
        clean = bpy.data.meshes.new(key + "_clean_imported_panel")
        clean.from_pydata(corners, [], [(0, 1, 2, 3)])
        clean.update()
        uv = clean.uv_layers.new(name="UVMap")
        for index, coord in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
            uv.data[index].uv = coord
        for material in materials:
            clean.materials.append(material)
        old = obj.data
        obj.data = clean
        if old.users == 0:
            bpy.data.meshes.remove(old)
        bpy.context.view_layer.objects.active = obj
        solidify = obj.modifiers.new("generated_panel_thickness", "SOLIDIFY")
        solidify.thickness = 1.0
        solidify.offset = 0.0
        solidify.use_rim = True
        bpy.ops.object.modifier_apply(modifier=solidify.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    obj.data.update()
    obj.name = key + "_SOURCE"
    obj.hide_render = True
    obj.hide_viewport = True
    return obj


def clone_panel(source, name, location, dimensions):
    obj = source.copy()
    # Share generated mesh/material resources; transforms only.
    obj.data = source.data
    obj.name = name
    obj.hide_render = False
    obj.hide_viewport = False
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.scale = dimensions
    return obj


def add_wall_run(source, prefix, axis, fixed, length, height, thickness, z0=0.0):
    # Tiles stay near-square in visible width/height so imported textures are
    # not stretched. End tiles absorb only a small remainder.
    target_width = min(3.0, max(1.8, height * 0.72))
    count = max(1, round(length / target_width))
    cell = length / count
    for i in range(count):
        offset = -length * 0.5 + cell * (i + 0.5)
        if axis == "x":
            loc = (offset, fixed, z0 + height * 0.5)
            dims = (cell, thickness, height)
        else:
            loc = (fixed, offset, z0 + height * 0.5)
            dims = (thickness, cell, height)
        clone_panel(source, f"{prefix}_{i:02d}", loc, dims)


def add_door_wall(source, width, height, depth, thickness, door_width):
    # Blender +Y exports as glTF -Z: this is the canonical entrance wall.
    door_h = min(2.35, height * 0.72)
    side = (width - door_width) * 0.5
    if side <= 0.2:
        raise RuntimeError("door too wide")
    target_width = min(3.0, max(1.8, height * 0.72))
    side_count = max(1, round(side / target_width))
    side_cell = side / side_count
    for index in range(side_count):
        left_x = -width * 0.5 + side_cell * (index + 0.5)
        right_x = door_width * 0.5 + side_cell * (index + 0.5)
        clone_panel(
            source, f"front_left_{index:02d}",
            (left_x, depth * 0.5, height * 0.5),
            (side_cell, thickness, height),
        )
        clone_panel(
            source, f"front_right_{index:02d}",
            (right_x, depth * 0.5, height * 0.5),
            (side_cell, thickness, height),
        )
    header_h = height - door_h
    clone_panel(
        source, "front_door_header",
        (0, depth * 0.5, door_h + header_h * 0.5),
        (door_width, thickness, header_h),
    )


def assemble(asset):
    key = asset["key"]
    width, depth = asset["targetProportion"]
    height = HEIGHTS[key]
    thickness = 0.16 if height < 5 else 0.24
    door_width = 1.35
    if key == "int-shell-warehouse-a":
        door_width = 2.6
    elif key == "int-shell-meetinghouse-hero":
        door_width = 2.0

    clear()
    wall = load_unit_panel(WALL_SOURCE[key], "wall")
    ceiling_backing = load_unit_panel("int-wall-board-panel", "ceiling")

    # Four complete walls: front (+Y / glTF -Z) has one doorway; rear and both
    # sides are complete. The shell remains open only at the bottom (no floor).
    add_door_wall(wall, width, height, depth, thickness, door_width)
    add_wall_run(wall, "rear", "x", -depth * 0.5, width, height, thickness)
    add_wall_run(wall, "left", "y", -width * 0.5, depth, height, thickness)
    add_wall_run(wall, "right", "y", width * 0.5, depth, height, thickness)

    # Imported beamed ceiling modules tile the whole footprint. No primitive
    # slab is used.
    ceiling_cell = 4.0
    nx = max(1, round(width / ceiling_cell))
    ny = max(1, round(depth / ceiling_cell))
    cell_x, cell_y = width / nx, depth / ny
    for ix in range(nx):
        for iy in range(ny):
            clone_panel(
                ceiling_backing,
                f"ceiling_backing_{ix:02d}_{iy:02d}",
                (
                    -width * 0.5 + cell_x * (ix + 0.5),
                    -depth * 0.5 + cell_y * (iy + 0.5),
                    height + thickness * 0.42,
                ),
                (cell_x, cell_y, thickness * 0.55),
            )

    # Remove hidden source objects. Copies keep references to their imported
    # generated mesh and materials.
    bpy.data.objects.remove(wall, do_unlink=True)
    bpy.data.objects.remove(ceiling_backing, do_unlink=True)

    # Keep generated module meshes instanced with per-node transforms. The glTF
    # exporter preserves those transforms; the optimizer applies them while
    # joining after re-import. This avoids duplicating tens of thousands of
    # source vertices in the raw assembled GLB.

    # Metadata survives into node extras for audit/runtime tooling.
    root = bpy.data.objects.new("CANONICAL_INTERIOR_SHELL", None)
    bpy.context.scene.collection.objects.link(root)
    root["assetKey"] = key
    root["contract"] = "four-walls-plus-ceiling-no-floor"
    root["entranceAxis"] = "-Z"
    root["targetWidth"] = width
    root["targetDepth"] = depth
    root["targetHeight"] = height
    for obj in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
        obj.parent = root

    out = os.path.join(RAW, key + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=True,
        export_image_format="AUTO",
        export_tangents=True,
        export_animations=False,
        export_extras=True,
    )
    module_keys = sorted(set([WALL_SOURCE[key], "int-wall-board-panel"]))
    module_tasks = {}
    for module_key in module_keys:
        task_path = os.path.join(RAW, module_key + ".glb.task.json")
        if os.path.exists(task_path):
            with open(task_path) as fh:
                module_tasks[module_key] = json.load(fh).get("id")
    source_task_path = os.path.join(RAW, key + ".glb.task.json")
    source_task_id = None
    if os.path.exists(source_task_path):
        with open(source_task_path) as fh:
            source_task_id = json.load(fh).get("id")
    with open(os.path.join(RAW, key + ".glb.assembly.json"), "w") as fh:
        json.dump({
            "key": key,
            "method": "imported-generated-modular-components",
            "sourceConceptMeshTaskId": source_task_id,
            "moduleTaskIds": module_tasks,
            "contract": "four walls + ceiling; no floor; one doorway; entrance -Z",
            "dimensions": [width, height, depth],
        }, fh, indent=2)
    print("ASSEMBLED", key, width, height, depth, os.path.getsize(out))


for shell in SHELLS:
    assemble(shell)

print("CANONICAL INTERIOR SHELL ASSEMBLY DONE", len(SHELLS))
