# Combine + productionize the imported objective quest-marker kit into a single
# runtime GLB.
#
#   src: assets/build/world-v3/quest-marker-hero.glb        (raw Meshy image-to-3d)
#        assets/build/world-v3/quest-marker-ground-seal.glb (raw Meshy image-to-3d)
#   out: assets/build/world-v3-opt/objective-marker-kit.glb
#
# For each raw source this script: imports it, drops non-mesh junk
# (cameras/lights/empties), joins its meshes, deletes small disconnected
# photogrammetry debris, reorients by measured extents so the marker's tallest
# axis is +Y and its thinnest axis is +Z (front), non-uniformly scales it to the
# exact spec dimensions, grounds it to y=0 centered on x/z, classifies faces as
# aged brass vs amber enamel inlay by sampling the Meshy baked albedo, then
# assigns two clean shared solid-PBR materials (no textures -> tiny watertight
# file, guaranteed 2 draw calls). Both processed nodes are renamed and combined
# into one scene and exported +Y up. No animation/camera/light/collision, no
# generated pedestal or ground.
#
# Run:
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#     --python assets/pipeline/optimize_quest_marker_kit.py
import bpy
import bmesh
import colorsys
import math
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "world-v3")
OUT = os.path.join(ROOT, "build", "world-v3-opt")
OUT_NAME = "objective-marker-kit.glb"

# key -> exact runtime spec. All orientation/dims below are expressed in
# BLENDER axes (Z-up). The GLB is exported with export_yup=True, which maps
# Blender +Z -> glTF +Y (up), Blender +X -> glTF +X (width), and
# Blender +Y -> glTF -Z (front/depth). So to land the marker as glTF +Y up with
# its front toward glTF +Z, height goes on Blender +Z and depth on Blender +Y.
# axis_order maps each Blender target axis to a ranked source extent
# ("largest"/"middle"/"smallest"); dims are the final Blender (x, y, z) extents.
SPECS = {
    "quest-marker-hero.glb": {
        "node": "QuestMarker_Hero",
        # tallest source axis -> Blender Z (up), middle -> X (width),
        # thinnest -> Y (depth)
        "axis_order": {"x": "middle", "y": "smallest", "z": "largest"},
        "dims": (0.20, 0.035, 0.32),  # Blender (width, depth, height)
        "tris": 3200,
        "ground": True,   # origin bottom-center
    },
    "quest-marker-ground-seal.glb": {
        "node": "QuestMarker_GroundSeal",
        # thinnest source axis -> Blender Z (height), the two large disc axes
        # -> Blender X/Y (diameter) so the seal lies flat after export
        "axis_order": {"x": "largest", "y": "middle", "z": "smallest"},
        "dims": (0.62, 0.62, 0.018),  # Blender (diameter, diameter, height)
        "tris": 2100,
        "ground": True,   # origin geometric center on x/y, bottom plane at z=0
    },
}

MAT_BRASS = "M_QuestMarker_Brass"
MAT_INLAY = "M_QuestMarker_Inlay"

# Aged warm brass with restrained dark patina (linear base color). Deliberately
# deep and slightly olive so it reads as an old civic instrument rather than
# bright polished/rose gold.
BRASS_COLOR = (0.150, 0.104, 0.040, 1.0)
BRASS_METALLIC = 0.82
BRASS_ROUGHNESS = 0.58
# Restrained deep amber enamel inlay (linear base color, non-emissive - a civic
# instrument accent, deliberately NOT a glowing loot beacon or candy highlight).
INLAY_COLOR = (0.360, 0.092, 0.010, 1.0)
INLAY_METALLIC = 0.0
INLAY_ROUGHNESS = 0.42


def make_materials():
    """Two shared solid-PBR materials reused by both nodes -> 2 draw calls."""
    brass = bpy.data.materials.new(MAT_BRASS)
    brass.use_nodes = True
    bsdf = brass.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = BRASS_COLOR
    bsdf.inputs["Metallic"].default_value = BRASS_METALLIC
    bsdf.inputs["Roughness"].default_value = BRASS_ROUGHNESS

    inlay = bpy.data.materials.new(MAT_INLAY)
    inlay.use_nodes = True
    bsdf = inlay.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = INLAY_COLOR
    bsdf.inputs["Metallic"].default_value = INLAY_METALLIC
    bsdf.inputs["Roughness"].default_value = INLAY_ROUGHNESS
    return brass, inlay


def import_and_join(src):
    """Import one source and join ONLY its freshly-added meshes (never any
    previously-finished node already sitting in the scene)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=src)
    new = [o for o in bpy.data.objects if o not in before]
    for obj in list(new):
        if obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not meshes:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def local_diag(me):
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    return math.sqrt(
        (max(xs) - min(xs)) ** 2
        + (max(ys) - min(ys)) ** 2
        + (max(zs) - min(zs)) ** 2
    )


def weld(obj, frac=0.0004):
    """Merge Meshy's coincident/unwelded vertices so the shell forms real
    connected components (its raw triangle soup is otherwise fully split)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=max(1e-6, local_diag(me) * frac))
    bm.to_mesh(me)
    bm.free()
    me.update()


def remove_debris(obj, rel=0.03):
    """In-place (no object separation): flood-fill connected face islands and
    delete tiny disconnected photogrammetry specks whose bbox diagonal is below
    `rel` of the largest island. Keeps structural pieces (seal arc segments,
    central diamond, hero finial). Done in bmesh so no bpy Object references are
    invalidated."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    visited = set()
    islands = []
    for face in bm.faces:
        if face.index in visited:
            continue
        stack = [face]
        visited.add(face.index)
        comp = []
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for edge in cur.edges:
                for lf in edge.link_faces:
                    if lf.index not in visited:
                        visited.add(lf.index)
                        stack.append(lf)
        islands.append(comp)

    def island_diag(comp):
        pts = [v.co for fc in comp for v in fc.verts]
        xs = [p.x for p in pts]
        ys = [p.y for p in pts]
        zs = [p.z for p in pts]
        return math.sqrt(
            (max(xs) - min(xs)) ** 2
            + (max(ys) - min(ys)) ** 2
            + (max(zs) - min(zs)) ** 2
        )

    diags = [island_diag(c) for c in islands]
    biggest = max(diags) if diags else 0.0
    drop_faces = []
    kept = 0
    for comp, d in zip(islands, diags):
        if biggest > 0 and d < rel * biggest:
            drop_faces.extend(comp)
        else:
            kept += 1
    if drop_faces and kept > 0:
        bmesh.ops.delete(bm, geom=drop_faces, context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.update()
    print(
        "  debris: islands=%d kept=%d droppedFaces=%d"
        % (len(islands), kept, len(drop_faces))
    )
    return obj


def find_baked_image(obj):
    for mat in obj.data.materials:
        if not mat or not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image and tuple(node.image.size) != (0, 0):
                return node.image
    return None


# Amber enamel reads as a restrained accent, never the dominant surface. Brass
# baked albedo is golden (hue ~0.11-0.13); the recessed enamel is more orange
# (hue ~0.06-0.08), more saturated and a touch darker. We score every face for
# "amber-ness" relative to that and promote only a capped top fraction, so the
# inlay stays a minority accent regardless of the absolute baked palette.
INLAY_FRACTION = 0.12
INLAY_SCORE_FLOOR = 0.10


def amber_score(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    hue_pref = math.exp(-((h - 0.07) ** 2) / (2 * 0.028 ** 2))
    # Penalise golden/bright brass (higher hue, higher value); reward saturated
    # orange in a mid/low value band.
    return hue_pref * (s ** 1.5) * max(0.0, 1.0 - 0.6 * v)


def classify_faces(obj):
    """Return per-polygon material indices (0 brass, 1 inlay) by sampling the
    Meshy baked albedo at each face's UV centroid and promoting only the most
    amber-like minority of faces to the inlay material."""
    me = obj.data
    n = len(me.polygons)
    idx = [0] * n
    img = find_baked_image(obj)
    if img is None or not me.uv_layers:
        # No baked texture available: tag a tiny arbitrary cluster so the inlay
        # material still exports (better than a missing named material).
        for i in range(min(n, max(4, int(0.01 * n)))):
            idx[i] = 1
        return idx, sum(idx)
    pixels = list(img.pixels)
    w, h = img.size
    uv = me.uv_layers.active.data
    scores = []
    for poly in me.polygons:
        us = vs = 0.0
        for li in poly.loop_indices:
            co = uv[li].uv
            us += co[0]
            vs += co[1]
        cnt = len(poly.loop_indices)
        px = min(w - 1, max(0, int((us / cnt % 1.0) * w)))
        py = min(h - 1, max(0, int((vs / cnt % 1.0) * h)))
        off = (py * w + px) * 4
        scores.append(amber_score(pixels[off], pixels[off + 1], pixels[off + 2]))
    ranked = sorted(range(n), key=lambda i: scores[i], reverse=True)
    cap = max(4, int(INLAY_FRACTION * n))
    hits = 0
    for i in ranked[:cap]:
        if scores[i] < INLAY_SCORE_FLOOR and hits >= 4:
            break
        idx[i] = 1
        hits += 1
    return idx, hits


def assign_materials(obj, face_idx, brass, inlay):
    obj.data.materials.clear()
    obj.data.materials.append(brass)
    obj.data.materials.append(inlay)
    for poly in obj.data.polygons:
        poly.material_index = face_idx[poly.index]


def reorient_and_scale(obj, axis_order, dims):
    """Permute local vertex coords so ranked source extents land on the target
    axes, then non-uniformly scale to the exact spec dimensions. Objects are
    symmetric, so a possible mirror from the permutation is visually harmless;
    normals are recomputed outward afterwards."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    me = obj.data
    ext = [
        max(v.co[i] for v in me.vertices) - min(v.co[i] for v in me.vertices)
        for i in range(3)
    ]
    ranked = sorted(range(3), key=lambda i: ext[i], reverse=True)
    rank_axis = {"largest": ranked[0], "middle": ranked[1], "smallest": ranked[2]}
    src_for = (
        rank_axis[axis_order["x"]],
        rank_axis[axis_order["y"]],
        rank_axis[axis_order["z"]],
    )
    for v in me.vertices:
        c = v.co.copy()
        v.co = Vector((c[src_for[0]], c[src_for[1]], c[src_for[2]]))
    me.update()

    ext2 = [
        max(v.co[i] for v in me.vertices) - min(v.co[i] for v in me.vertices)
        for i in range(3)
    ]
    factor = Vector((
        dims[0] / ext2[0] if ext2[0] else 1.0,
        dims[1] / ext2[1] if ext2[1] else 1.0,
        dims[2] / ext2[2] if ext2[2] else 1.0,
    ))
    for v in me.vertices:
        v.co = Vector((v.co[0] * factor[0], v.co[1] * factor[1], v.co[2] * factor[2]))
    me.update()

    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()


def ground_center(obj):
    """Center on Blender x/y and rest the bottom plane on Blender z=0. After
    export_yup this yields glTF origin at bottom-center on the ground plane
    (glTF y=0), centered on glTF x/z."""
    bpy.context.view_layer.update()
    me = obj.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    minz = min(zs)
    for v in me.vertices:
        v.co = Vector((v.co.x - cx, v.co.y - cy, v.co.z - minz))
    me.update()
    obj.location = (0.0, 0.0, 0.0)


def decimate(obj, target):
    tri = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tri > target and tri > 500:
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new("dec", "DECIMATE")
        mod.ratio = max(0.04, target / tri)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def main():
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    brass, inlay = make_materials()

    finished_names = []
    for key, spec in SPECS.items():
        src = os.path.join(SRC, key)
        if not os.path.exists(src):
            print("MISSING", key)
            continue
        print("=== processing", key)
        obj = import_and_join(src)
        if obj is None:
            print("NO_MESH", key)
            continue
        src_tris = tri_count(obj)
        weld(obj)
        obj = remove_debris(obj)
        out_tris = decimate(obj, spec["tris"])
        face_idx, amber_hits = classify_faces(obj)
        assign_materials(obj, face_idx, brass, inlay)
        # Scale + ground are the FINAL geometry ops so exact spec dimensions and
        # a clean bottom plane survive (decimation runs before this).
        reorient_and_scale(obj, spec["axis_order"], spec["dims"])
        if spec["ground"]:
            ground_center(obj)
        obj.data.validate(verbose=False)
        obj.data.update()
        obj.name = spec["node"]
        obj.data.name = spec["node"] + "_Mesh"
        finished_names.append(spec["node"])
        print(
            "  node=%s srcTris=%d outTris=%d amberFaces=%d dims=%s"
            % (spec["node"], src_tris, out_tris, amber_hits, spec["dims"])
        )

    # Purge any leftover Meshy materials/images so nothing hidden is embedded.
    keep_mats = {MAT_BRASS, MAT_INLAY}
    for mat in list(bpy.data.materials):
        if mat.name not in keep_mats:
            bpy.data.materials.remove(mat)
    for img in list(bpy.data.images):
        bpy.data.images.remove(img)

    finished = [bpy.data.objects[n] for n in finished_names if n in bpy.data.objects]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in finished:
        obj.select_set(True)
    if finished:
        bpy.context.view_layer.objects.active = finished[0]

    dst = os.path.join(OUT, OUT_NAME)
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
    )
    total = sum(tri_count(o) for o in finished)
    print(
        "WROTE",
        dst,
        os.path.getsize(dst),
        "nodes",
        [o.name for o in finished],
        "combinedTris",
        total,
    )
    print("QUEST MARKER KIT OPT DONE")


main()
