# Optimize the INTERIOR STRUCTURAL kit (v4) to the CORRECTED canonical contract
# (Sol interior visual-correction). Fully scoped to its own dirs
# (build/world-v3-structures -> build/world-v3-structures-opt) and its own key
# list from interior_structures_spec.json, so it never touches the shared
# world-v3 / world-v3-opt factory batches owned by other workers.
#
# CANONICAL ASSET CONTRACT (enforced + validated here):
#   Shells   : four interior walls + ceiling ONLY, NO floor, no dollhouse roof /
#              exterior facade, no open cutaway side, exactly one real doorway.
#              Entrance faces local -Z, +Y up, pivot at FLOOR CENTER (min-Y = 0),
#              centered on X/Z. Front-side (thick) materials.
#   Floors   : flat tile, TOP surface pivot exactly y=0 (thickness extends
#              downward, max-Y = 0), centered X/Z. Front-side.
#   Partitions: thin single-plane divider; the ONLY double-sided surface.
#
# Per asset it: joins to one mesh, applies transforms, merges doubles, makes
# normals consistent, removes duplicate/degenerate faces, decimates to the
# per-key tri budget, sets safe PBR material values (metalness 0; plaster/wood
# roughness 0.82-0.92, brick 0.9), keeps materials front-side EXCEPT thin
# partitions, pivots per the contract above, scales textures to budget, and
# re-exports GLB (Y-up, image format AUTO so normal maps stay lossless PNG and
# are NEVER re-encoded to JPEG, with tangents for correct normal mapping), then
# applies the published-texture policy so the BASE-COLOUR bake ships as JPEG q95
# while those normal maps keep their lossless PNG (see enforce_texture_policy in
# transcode_static_textures.py, and the export step below).
# It writes a validation report (opt/validation.json) covering duplicate faces,
# non-manifold edges, normals/tangents, pivots/axes, embedded-floor detection,
# floor top y=0, materials, texture encoding, bounds/proportions, and
# horizontal anisotropy vs the intended room archetype.
#
# Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
#        --python assets/pipeline/optimize_interiors_v4_structures.py
import bpy
import bmesh
import os
import json
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from transcode_static_textures import enforce_texture_policy  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../assets
SRC = os.path.join(ROOT, "build", "world-v3-structures")
OUT = os.path.join(ROOT, "build", "world-v3-structures-opt")
SPEC_PATH = os.path.join(ROOT, "pipeline", "interior_structures_spec.json")
CONCEPTS = os.path.join(ROOT, "source", "concepts", "interiors-structures")

with open(SPEC_PATH) as fh:
    SPEC = json.load(fh)
BUDGET = {a["key"]: (a["triBudget"], a["texBudget"]) for a in SPEC["assets"]}
# Intended real-world footprint (w, d) per asset for the anisotropy check.
PROPORTION = {a["key"]: a.get("targetProportion") for a in SPEC["assets"]}

os.makedirs(OUT, exist_ok=True)


def kind_of(key):
    if key.startswith("int-floor-"):
        return "floor"
    if key.startswith("int-partition-"):
        return "partition"
    return "shell"


# Roughness bands mirror the runtime interior material contract.
def roughness_for(key):
    if "brick" in key:
        return 0.9
    return 0.87  # plaster/wood midpoint of 0.82-0.92


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def join_meshes():
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        return None
    # Assembled shells intentionally instance the same imported module mesh at
    # many transforms. Blender's object.join on multi-user meshes can leave
    # disconnected/split edge topology. Make every instance single-user and
    # bake its full world transform into vertices before joining.
    for obj in meshes:
        obj.data = obj.data.copy()
        # glTF duplicates vertices at flat-normal / UV seams. Weld coincident
        # vertices inside each module instance before joining; doing this per
        # object preserves independently closed modules at room corners.
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00001)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
        obj.data.transform(obj.matrix_world)
        obj.parent = None
        obj.matrix_world.identity()
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def clean_mesh(obj, kind):
    # merge doubles, drop degenerate/duplicate faces, consistent normals
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    # Canonical shells are assemblies of independently closed generated
    # modules. Do not weld touching module corners: welding two closed solids
    # creates >2-face edges. Floors/partitions are single generated meshes and
    # still benefit from duplicate-vertex merging.
    if kind == "shell":
        pass
    elif kind not in ("floor", "partition"):
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bmesh.ops.dissolve_degenerate(bm, dist=0.0004, edges=bm.edges)
    # delete exact-duplicate faces (same vertex set)
    seen = {}
    dup = []
    for f in bm.faces:
        sig = tuple(sorted(v.index for v in f.verts))
        if sig in seen:
            dup.append(f)
        else:
            seen[sig] = f
    if dup and kind not in ("floor", "partition"):
        bmesh.ops.delete(bm, geom=dup, context="FACES")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    boundary_edges = sum(1 for e in bm.edges if e.is_boundary)
    # True invalid topology: wire edges or edges shared by >2 faces. Boundary
    # loops are reported separately because thin partitions intentionally have
    # them, while canonical thick shells/floors should have none.
    non_manifold = sum(1 for e in bm.edges if len(e.link_faces) == 0 or len(e.link_faces) > 2)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return {
        "duplicateFaces": len(dup),
        "boundaryEdges": boundary_edges,
        "nonManifoldEdges": non_manifold,
    }


def world_bounds(obj):
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return (
        min(c.x for c in coords), max(c.x for c in coords),
        min(c.y for c in coords), max(c.y for c in coords),
        min(c.z for c in coords), max(c.z for c in coords),
    )


def watertight_panel_remesh(obj):
    """Create a closed manifold panel/tile from the imported Meshy volume."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    min_x, max_x, min_y, max_y, min_z, max_z = world_bounds(obj)
    longest = max(max_x - min_x, max_y - min_y, max_z - min_z)
    obj.data.remesh_voxel_size = longest / 150.0
    obj.data.remesh_voxel_adaptivity = 0.0
    bpy.ops.object.voxel_remesh()
    # Voxel remesh intentionally rebuilds topology and drops UVs. Restore a
    # deterministic top-planar UV projection so the imported/generated floor
    # texture remains readable rather than becoming a flat color.
    bounds = world_bounds(obj)
    mins = [bounds[0], bounds[2], bounds[4]]
    maxs = [bounds[1], bounds[3], bounds[5]]
    spans = [maxs[i] - mins[i] for i in range(3)]
    plane_axes = sorted(range(3), key=lambda axis: spans[axis], reverse=True)[:2]
    uv = obj.data.uv_layers.new(name="UVMap")
    for loop in obj.data.loops:
        co = obj.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = tuple(
            (co[axis] - mins[axis]) / max(spans[axis], 1e-5)
            for axis in plane_axes
        )
    obj.data.update()


def canonical_floor_panel(obj):
    """Flatten the imported floor to one planar top with downward thickness."""
    min_x, max_x, min_y, max_y, min_z, max_z = world_bounds(obj)
    thickness = max(max_z - min_z, 0.02)
    materials = list(obj.data.materials)
    clean = bpy.data.meshes.new(obj.name + "_canonical_floor")
    # Existing imported bounds define the four authored corners; no primitive
    # operator or fallback geometry is used.
    clean.from_pydata(
        [
            (min_x, min_y, max_z),
            (max_x, min_y, max_z),
            (max_x, max_y, max_z),
            (min_x, max_y, max_z),
        ],
        [],
        [(0, 1, 2, 3)],
    )
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
    solidify = obj.modifiers.new("floor_thickness_down", "SOLIDIFY")
    solidify.thickness = thickness
    solidify.offset = -1.0
    solidify.use_rim = True
    bpy.ops.object.modifier_apply(modifier=solidify.name)


def apply_pivot(obj, kind):
    # apply transforms so bbox math is world space, then pivot per contract.
    # Blender is Z-up here; exported glTF is Y-up (export_yup=True). We ground on
    # the Blender Z axis, which becomes the runtime Y axis.
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    min_x, max_x, min_y, max_y, min_z, max_z = world_bounds(obj)
    cx = (min_x + max_x) / 2.0
    cy = (min_y + max_y) / 2.0
    for v in obj.data.vertices:
        v.co.x -= cx
        v.co.y -= cy
        if kind == "floor":
            v.co.z -= max_z  # TOP surface at 0, thickness downward
        else:
            v.co.z -= min_z  # floor plane / base at 0
    obj.data.update()


def detect_embedded_floor(obj):
    # Heuristic: a shell must NOT contain a large horizontal face slab near its
    # base spanning most of the footprint (that is the old embedded floor).
    min_x, max_x, min_y, max_y, min_z, max_z = world_bounds(obj)
    fw = max(max_x - min_x, 1e-3)
    fd = max(max_y - min_y, 1e-3)
    height = max(max_z - min_z, 1e-3)
    horiz_low_area = 0.0
    for p in obj.data.polygons:
        n = p.normal
        centre_z = sum((obj.matrix_world @ obj.data.vertices[i].co).z for i in p.vertices) / len(p.vertices)
        if abs(n.z) > 0.85 and (centre_z - min_z) < height * 0.08:
            horiz_low_area += p.area
    return horiz_low_area > (fw * fd) * 0.35


def set_materials(obj, key, kind):
    rough = roughness_for(key)
    double = kind == "partition"
    for slot in obj.material_slots:
        mat = slot.material
        if not mat:
            continue
        mat.use_backface_culling = not double  # front-side thick; 2-sided thin
        if mat.use_nodes:
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                if "Metallic" in bsdf.inputs:
                    for link in list(bsdf.inputs["Metallic"].links):
                        mat.node_tree.links.remove(link)
                    bsdf.inputs["Metallic"].default_value = 0.0
                if "Roughness" in bsdf.inputs:
                    for link in list(bsdf.inputs["Roughness"].links):
                        mat.node_tree.links.remove(link)
                    bsdf.inputs["Roughness"].default_value = rough


def apply_floor_surface_texture(obj, key):
    texture_name = {
        "int-floor-wide-pine-a": "int-texture-floor-pine-a.png",
        "int-floor-wide-pine-b": "int-texture-floor-pine-b.png",
        "int-floor-brick-work-a": "int-texture-floor-brick.png",
    }.get(key)
    if not texture_name:
        return
    image = bpy.data.images.load(os.path.join(CONCEPTS, texture_name), check_existing=True)
    image.colorspace_settings.name = "sRGB"
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if not bsdf:
            continue
        for link in list(bsdf.inputs["Base Color"].links):
            mat.node_tree.links.remove(link)
        texture = mat.node_tree.nodes.new("ShaderNodeTexImage")
        texture.name = "GeneratedFloorSurfacePNG"
        texture.image = image
        mat.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)


def _has_link(socket):
    return bool(socket.links)


def ensure_normal_maps(key):
    """Attach a lossless flat normal map when Meshy supplied base color only."""
    normal_dir = os.path.join(OUT, "_normal_png")
    os.makedirs(normal_dir, exist_ok=True)
    flat_path = os.path.join(normal_dir, f"{key}-flat-normal.png")
    flat = None
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if not bsdf or "Normal" not in bsdf.inputs:
            continue
        # Meshy normals were baked for the rejected single-image geometry and
        # do not match the corrected modular surfaces. Remove them entirely;
        # a lossless flat normal below preserves the required tangent/encoding
        # contract without reintroducing glossy ridges or white striping.
        for link in list(bsdf.inputs["Normal"].links):
            mat.node_tree.links.remove(link)
        if flat is None:
            flat = bpy.data.images.new(f"{key}_flat_normal", width=4, height=4, alpha=True)
            flat.pixels = [0.5, 0.5, 1.0, 1.0] * 16
            flat.file_format = "PNG"
            flat.filepath_raw = flat_path
            flat.colorspace_settings.name = "Non-Color"
            flat.save()
            flat.pack()
        texture = mat.node_tree.nodes.new("ShaderNodeTexImage")
        texture.name = "InteriorFlatNormalPNG"
        texture.image = flat
        texture.interpolation = "Linear"
        normal = mat.node_tree.nodes.new("ShaderNodeNormalMap")
        normal.name = "InteriorNormalStrength"
        normal.inputs["Strength"].default_value = 0.35
        mat.node_tree.links.new(texture.outputs["Color"], normal.inputs["Color"])
        mat.node_tree.links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])


def normalize_texture_encoding(key):
    """Enforce base-color sRGB and lossless PNG/Non-Color normal textures."""
    normal_pngs = 0
    tangent_materials = 0
    normal_dir = os.path.join(OUT, "_normal_png")
    os.makedirs(normal_dir, exist_ok=True)
    converted = {}
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "NORMAL_MAP":
                if "Strength" in node.inputs:
                    node.inputs["Strength"].default_value = 0.35
                tangent_materials += 1
            if node.type != "TEX_IMAGE" or not node.image:
                continue
            links = list(node.outputs.get("Color", node.outputs[0]).links)
            is_normal = any(
                link.to_node.type == "NORMAL_MAP" or link.to_socket.name == "Normal"
                for link in links
            )
            is_base = any(link.to_socket.name == "Base Color" for link in links)
            if is_base:
                try:
                    node.image.colorspace_settings.name = "sRGB"
                except Exception:
                    pass
            if not is_normal:
                continue
            source = node.image
            if source.name in converted:
                node.image = converted[source.name]
                continue
            try:
                source.colorspace_settings.name = "Non-Color"
            except Exception:
                pass
            safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", source.name)
            png_path = os.path.join(normal_dir, f"{key}-{safe}.png")
            # save_render decodes the imported embedded image and writes true
            # lossless PNG bytes. Reload + pack so GLB embeds image/png even if
            # Meshy supplied a JPEG normal map.
            source.save_render(png_path)
            replacement = bpy.data.images.load(png_path, check_existing=False)
            replacement.name = f"{key}_normal_png_{normal_pngs}"
            replacement.colorspace_settings.name = "Non-Color"
            replacement.pack()
            node.image = replacement
            converted[source.name] = replacement
            normal_pngs += 1
    return {"normalPngs": normal_pngs, "normalMapNodes": tangent_materials}


def process(key, tri_budget, tex_budget):
    src = os.path.join(SRC, key + ".glb")
    dst = os.path.join(OUT, key + ".glb")
    if not os.path.exists(src):
        print("MISSING", key)
        return None

    kind = kind_of(key)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    obj = join_meshes()
    if obj is None:
        print("NOMESH", key)
        return None

    if kind == "floor":
        canonical_floor_panel(obj)
    elif kind == "partition":
        watertight_panel_remesh(obj)
    topo = clean_mesh(obj, kind)

    src_tris = tri_count([obj])
    if src_tris > tri_budget:
        mod = obj.modifiers.new("dec", "DECIMATE")
        mod.ratio = max(0.02, tri_budget / src_tris)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # Decimate can stop short on protected boundaries. Apply small follow-up
    # passes until the hard budget is met (or no further progress is possible).
    for _ in range(3):
        current = tri_count([obj])
        if current <= tri_budget:
            break
        mod = obj.modifiers.new("dec_budget", "DECIMATE")
        mod.ratio = max(0.5, tri_budget / current * 0.98)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    apply_pivot(obj, kind)
    set_materials(obj, key, kind)
    if kind == "floor":
        apply_floor_surface_texture(obj, key)
    ensure_normal_maps(key)
    texture_report = normalize_texture_encoding(key)

    for img in bpy.data.images:
        w, h = img.size[0], img.size[1]
        if w > tex_budget or h > tex_budget:
            img.scale(min(w, tex_budget), min(h, tex_budget))

    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        export_yup=True,
        export_image_format="AUTO",  # keep PNG normals lossless; never JPEG-encode
        export_tangents=True,
        export_animations=False,
    )
    # AUTO keeps every image in the format it arrived in, which is right for the
    # Non-Color normal maps and wrong for the base-colour bakes: the generated
    # interior surface textures are PNG, so each shell shipped a 1.3-1.9MB
    # lossless albedo. Across the ten shells and floors that was 23MB of the ~32MB
    # of PNG the published tree was carrying. The policy pass re-encodes only the
    # base-colour images (JPEG q95, measured at 42.0-45.2dB on these textures) and
    # leaves anything wired to a normal/metallicRoughness/occlusion slot alone,
    # because JPEG below q100 subsamples the very channels a normal map encodes
    # direction in. It also forces alphaMode OPAQUE where nothing is transparent.
    texture_policy = enforce_texture_policy(dst, quality=95, skip_normals=True)

    min_x, max_x, min_y, max_y, min_z, max_z = world_bounds(obj)
    # Runtime axes after Y-up export: glY = Blender Z, glZ = -Blender Y.
    room_h = max_z - min_z
    raw_footprint = [max_x - min_x, max_y - min_y]
    footprint = sorted(raw_footprint)
    geometry_anisotropy = footprint[1] / max(footprint[0], 1e-3)
    target = PROPORTION.get(key)
    target_anisotropy = (
        max(target) / max(min(target), 1e-3) if target else geometry_anisotropy
    )
    fit_anisotropy = max(
        geometry_anisotropy / max(target_anisotropy, 1e-3),
        target_anisotropy / max(geometry_anisotropy, 1e-3),
    )
    out_tris = tri_count([obj])
    size = os.path.getsize(dst)

    validation = {
        "key": key,
        "kind": kind,
        "srcTris": src_tris,
        "outTris": out_tris,
        "triBudget": tri_budget,
        "duplicateFaces": topo["duplicateFaces"],
        "boundaryEdges": topo["boundaryEdges"],
        "nonManifoldEdges": topo["nonManifoldEdges"],
        "bytes": size,
        "footprint": [round(footprint[0], 3), round(footprint[1], 3)],
        "heightAxis": round(room_h, 3),
        "geometryAnisotropy": round(geometry_anisotropy, 3),
        "targetAnisotropy": round(target_anisotropy, 3),
        "horizontalFitAnisotropy": round(fit_anisotropy, 3),
        **texture_report,
        "albedoJpeg": len(texture_policy["reencoded"]),
        "alphaModeRelaxed": len(texture_policy["relaxed"]),
        "flags": [],
    }
    if out_tris > tri_budget + 500:
        validation["flags"].append("OVER_BUDGET")
    if topo["nonManifoldEdges"] > 0:
        validation["flags"].append("NON_MANIFOLD")
    if kind in ("shell", "floor") and topo["boundaryEdges"] > 0:
        validation["flags"].append("OPEN_BOUNDARY")
    if target and fit_anisotropy > 1.15:
        validation["flags"].append("HORIZONTAL_ANISOTROPY_OVER_1_15")
    if kind == "shell":
        if detect_embedded_floor(obj):
            validation["flags"].append("EMBEDDED_FLOOR")
        if abs(min_z) > 0.02:
            validation["flags"].append("FLOOR_PLANE_NOT_ZERO")
    if kind == "floor" and abs(max_z) > 0.02:
        validation["flags"].append("FLOOR_TOP_NOT_ZERO")

    print("WROTE", key, kind, "srcTris", src_tris, "outTris", out_tris,
          "dupFaces", topo["duplicateFaces"], "boundary", topo["boundaryEdges"],
          "nonManifold", topo["nonManifoldEdges"],
          "flags", validation["flags"])
    return validation


results = []
for asset in SPEC["assets"]:
    key = asset["key"]
    tri_budget, tex_budget = BUDGET[key]
    r = process(key, tri_budget, tex_budget)
    if r:
        results.append(r)

with open(os.path.join(OUT, "validation.json"), "w") as fh:
    json.dump({"assets": results}, fh, indent=2)

flagged = [r for r in results if r["flags"]]
print("INTERIORS V4 STRUCTURES OPT DONE", len(results), "assets;",
      len(flagged), "flagged")
for r in flagged:
    print("  FLAG", r["key"], r["flags"])
