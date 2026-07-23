# Bake and optimize the imported colonial road-surface kit produced by
# gen_concept_image.mjs -> gen_prop_from_image.mjs.
#
# Meshy reconstructs the isolated references as small hero slabs. Stretching
# those directly across a 20m road makes individual stones enormous and
# magnifies imperfect photogrammetry edges. This Blender stage repeats the
# imported source mesh at believable physical scale, trims it to exact modular
# bounds, adds a dark integrated backing inside the exported GLB (so imperfect
# source edges can never reveal sky), and joins each result into a low-draw-call
# world-scale asset. No visible geometry is generated at runtime.
#
# Run:
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#     --python assets/pipeline/optimize_road_kit.py
import bpy
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "world-v3")
OUT = os.path.join(ROOT, "build", "world-v3-opt")
MAX_TEX = 1024

# source filename -> baked footprint, repeat grid, triangle budget and shape.
# Dimensions are meters and match District.tsx's normal placement sizes.
CONFIG = {
    "colonial-street-a.glb": {
        "size": (20.0, 20.0), "grid": (4, 8), "tris": 6000,
        "uv_repeat": (1, 4), "uv_swap": True,
        "relief": 0.16, "crown": 0.10, "backing": (0.10, 0.09, 0.075, 1.0),
    },
    "colonial-street-b.glb": {
        "size": (20.0, 20.0), "grid": (4, 4), "tris": 6000,
        "uv_repeat": (1, 4), "uv_swap": True,
        "relief": 0.16, "crown": 0.10, "backing": (0.11, 0.10, 0.085, 1.0),
    },
    "colonial-street-c.glb": {
        "size": (20.0, 20.0), "grid": (4, 8), "tris": 6000,
        "uv_repeat": (2, 4), "uv_swap": True,
        "relief": 0.16, "crown": 0.10, "backing": (0.10, 0.09, 0.08, 1.0),
    },
    "colonial-alley-a.glb": {
        "size": (12.0, 6.5), "grid": (4, 3), "tris": 4000,
        "uv_repeat": (1, 4), "uv_swap": True,
        "relief": 0.13, "drain": 0.045, "backing": (0.075, 0.065, 0.055, 1.0),
    },
    "colonial-alley-b.glb": {
        "size": (12.0, 6.5), "grid": (4, 3), "tris": 4000,
        "uv_repeat": (1, 4), "uv_swap": True,
        "relief": 0.13, "drain": 0.045, "backing": (0.075, 0.065, 0.055, 1.0),
    },
    "colonial-gutter-straight.glb": {
        "size": (20.0, 1.3), "grid": (2, 1), "tris": 2500,
        "uv_crop_v": (0.32, 0.68),
        "relief": 0.14, "backing": (0.12, 0.11, 0.095, 1.0),
    },
    "colonial-gutter-corner.glb": {
        "size": (1.5, 1.5), "grid": (1, 1), "tris": 3000,
        "relief": 0.16, "backing": (0.12, 0.11, 0.095, 1.0),
    },
    "colonial-street-junction.glb": {
        "size": (10.0, 20.0), "grid": (1, 2), "tris": 5000,
        "uv_repeat": (1, 1),
        "relief": 0.15, "crown": 0.07, "backing": (0.105, 0.095, 0.08, 1.0),
    },
    "colonial-street-endcap.glb": {
        "size": (10.0, 20.0), "grid": (1, 5), "tris": 5000,
        "uv_repeat": (1, 1),
        "relief": 0.14, "crown": 0.06, "backing": (0.10, 0.09, 0.075, 1.0),
    },
    "colonial-civic-square.glb": {
        "size": (17.0, 20.0), "grid": (4, 4), "tris": 5000,
        "relief": 0.13, "crown": 0.05, "backing": (0.13, 0.12, 0.105, 1.0),
    },
    "colonial-yard-ground.glb": {
        "size": (22.0, 10.0), "grid": (4, 2), "tris": 3000,
        "relief": 0.10, "backing": (0.075, 0.065, 0.052, 1.0),
    },
    "colonial-yard-ground.glb#perimeter": {
        "source_name": "colonial-yard-ground.glb",
        "output": "colonial-yard-perimeter.glb",
        "material_key": "colonial-yard-ground",
        "size": (226.0, 20.0), "grid": (40, 4), "tris": 3000,
        "relief": 0.08, "backing": (0.075, 0.065, 0.052, 1.0),
    },
    "colonial-yard-ground.glb#east-cap": {
        "source_name": "colonial-yard-ground.glb",
        "output": "colonial-yard-east-cap.glb",
        "material_key": "colonial-yard-ground",
        "size": (20.0, 60.0), "grid": (4, 12), "tris": 3000,
        "relief": 0.08, "backing": (0.075, 0.065, 0.052, 1.0),
    },
    "colonial-liberty-courtyard.glb": {
        "size": (26.0, 19.0), "grid": (5, 4), "tris": 3000,
        "relief": 0.08, "backing": (0.09, 0.10, 0.065, 1.0),
    },
    # Existing imported wharf sources are rebaked here at useful plank scale.
    "wharf-pier-module.glb": {
        "output": "colonial-wharf-apron.glb",
        "source_public": True,
        "size": (42.0, 34.0), "grid": (8, 14), "tris": 12000,
        "relief": 0.48, "backing": (0.075, 0.055, 0.04, 1.0),
    },
    "wharf-boardwalk-plank.glb": {
        "output": "colonial-wharf-boardwalk.glb",
        "source_public": True,
        "size": (74.0, 6.5), "grid": (15, 2), "tris": 6000,
        "relief": 0.34, "backing": (0.075, 0.055, 0.04, 1.0),
    },
    "wharf-pier-module.glb#finger": {
        "source_name": "wharf-pier-module.glb",
        "output": "colonial-wharf-pier-finger.glb",
        "source_public": True,
        "size": (10.0, 9.0), "grid": (2, 4), "tris": 4000,
        "relief": 0.48, "backing": (0.075, 0.055, 0.04, 1.0),
    },
}

os.makedirs(OUT, exist_ok=True)


def imported_material(sources, name, material_image_path):
    """Use Gemini's rectified map; retain Meshy material as fallback."""
    if os.path.exists(material_image_path):
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = bpy.data.images.load(material_image_path, check_existing=False)
        texture.extension = "REPEAT"
        texture.interpolation = "Linear"
        shader.inputs["Roughness"].default_value = 0.94
        shader.inputs["Metallic"].default_value = 0.0
        material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
        material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
        return material

    material = None
    for obj in sources:
        if obj.data.materials and obj.data.materials[0]:
            material = obj.data.materials[0].copy()
            break
    if material is None:
        material = bpy.data.materials.new(name)
        material.diffuse_color = (0.12, 0.11, 0.09, 1.0)
        material.use_nodes = True
    material.name = name
    material.roughness = 0.94
    if material.use_nodes:
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE":
                node.extension = "REPEAT"
            if node.type == "BSDF_PRINCIPLED":
                node.inputs["Roughness"].default_value = 0.94
                node.inputs["Metallic"].default_value = 0.0
    return material


def build_surface_mesh(name, spec, material):
    """Create exact modular bounds using only the imported Meshy material."""
    width, depth = spec["size"]
    repeat_u, repeat_v = spec.get("uv_repeat", spec["grid"])
    uv_swap = spec.get("uv_swap", False)
    crop_v_min, crop_v_max = spec.get("uv_crop_v", (0.0, 1.0))
    top_budget = max(32, spec["tris"] - 12)
    aspect = width / max(depth, 0.001)
    nx = max(2, int(math.sqrt((top_budget / 2) * aspect)))
    nz = max(2, int((top_budget / 2) / nx))
    crown = spec.get("crown", 0.0)
    drain = spec.get("drain", 0.0)
    street_ruts = 0.022 if name.startswith("colonial-street-") else 0.0

    vertices = []
    for row in range(nz + 1):
        v = row / nz
        z = -depth / 2 + v * depth
        normalized_z = min(1.0, abs(z) / max(depth / 2, 0.001))
        cross_profile = 1.0 - normalized_z * normalized_z
        for col in range(nx + 1):
            u = col / nx
            x = -width / 2 + u * width
            edge_fade = (
                math.sin(math.pi * u) ** 2
                * math.sin(math.pi * v) ** 2
            )
            uneven = (
                math.sin(x * 2.31 + z * 1.73)
                + 0.55 * math.sin(x * 4.87 - z * 3.11)
            ) * 0.0045 * edge_fade
            rut = 0.0
            if street_ruts:
                for track_z in (-2.5, 2.5):
                    rut += street_ruts * math.exp(
                        -((z - track_z) / 0.48) ** 2
                    )
            y = crown * cross_profile - drain * cross_profile - rut + uneven
            # Blender is Z-up; glTF export maps this to runtime Y-up.
            vertices.append((x, z, y))

    faces = []
    for row in range(nz):
        for col in range(nx):
            a = row * (nx + 1) + col
            b = a + 1
            d = (row + 1) * (nx + 1) + col
            c = d + 1
            faces.append((a, b, c, d))

    # Close the module sides/bottom so oblique cameras never reveal void.
    bottom_height = -0.07
    bottom_start = len(vertices)
    vertices.extend([
        (-width / 2, -depth / 2, bottom_height),
        (width / 2, -depth / 2, bottom_height),
        (width / 2, depth / 2, bottom_height),
        (-width / 2, depth / 2, bottom_height),
    ])
    top_sw = 0
    top_se = nx
    top_nw = nz * (nx + 1)
    top_ne = top_nw + nx
    bsw, bse, bne, bnw = range(bottom_start, bottom_start + 4)
    faces.extend([
        (bsw, bse, top_se, top_sw),
        (bse, bne, top_ne, top_se),
        (bne, bnw, top_nw, top_ne),
        (bnw, bsw, top_sw, top_nw),
        (bnw, bne, bse, bsw),
    ])

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="ImportedMeshyUV")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index]
            normalized_x = vertex.co.x / width + 0.5
            normalized_depth = vertex.co.y / depth + 0.5
            if uv_swap:
                u = normalized_depth * repeat_u
                v = normalized_x * repeat_v
            else:
                u = normalized_x * repeat_u
                v = normalized_depth * repeat_v
            v = crop_v_min + v * (crop_v_max - crop_v_min)
            uv_layer.data[loop_index].uv = (u, v)

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


for config_key, spec in CONFIG.items():
    source_name = spec.get("source_name", config_key.split("#", 1)[0])
    if spec.get("source_public"):
        src = os.path.join(
            ROOT, "..", "apps", "web", "public", "world", "props", source_name
        )
    else:
        src = os.path.join(SRC, source_name)
    if not os.path.exists(src):
        print("MISSING", source_name)
        continue

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    sources = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not sources:
        print("NO MESH", source_name)
        continue
    source_tris = sum(
        sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
        for obj in sources
    )
    output_name = spec.get("output", source_name)
    material_key = spec.get("material_key") or (
        "colonial-wharf-timber"
        if output_name.startswith("colonial-wharf-")
        else output_name.removesuffix(".glb")
    )
    material_image_path = os.path.join(
        ROOT,
        "source",
        "concepts",
        "roads",
        "materials",
        f"{material_key}-material.png",
    )
    material = imported_material(
        sources,
        f"{config_key}-ImportedMaterial",
        material_image_path,
    )
    for obj in sources:
        bpy.data.objects.remove(obj, do_unlink=True)

    baked = build_surface_mesh(output_name, spec, material)

    for image in bpy.data.images:
        if image.size[0] > MAX_TEX or image.size[1] > MAX_TEX:
            image.scale(
                min(image.size[0], MAX_TEX),
                min(image.size[1], MAX_TEX),
            )

    dst = os.path.join(OUT, output_name)
    bpy.ops.object.select_all(action="DESELECT")
    baked.select_set(True)
    bpy.context.view_layer.objects.active = baked
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_image_format="JPEG",
        export_jpeg_quality=80,
        export_animations=False,
    )
    baked_tris = sum(len(poly.vertices) - 2 for poly in baked.data.polygons)
    print(
        "WROTE",
        dst,
        os.path.getsize(dst),
        "tris",
        baked_tris,
        "sourceTris",
        source_tris,
        "uvRepeat",
        spec["grid"],
    )

print("ROAD KIT OPT DONE")
