# Build M1's roofline kit: the plank gantry, the gambrel ridge walk, the chimney
# stack and the arcade pier.
#
# Why these are authored rather than generated
# --------------------------------------------
# The elm needed Meshy because a tree has to look grown. Nothing in this kit
# does. A gangway is four boards, a leaded flat is sheet and rolls, a chimney is
# a corbelled prism and an arcade pier is a plinth, a shaft and an impost. What
# they need is not a silhouette a generator can invent; it is a SURFACE that says
# 1765, and a generated albedo gives that for a tenth of the bytes a generated
# mesh costs. That trade is already proved in this repo: the road kit's paving
# materials paved the whole eighty-eight metre level for 1.9MB where its own GLB
# plates would have been 23MB.
#
# The half of the problem that is not taste
# -----------------------------------------
# Every asset here is a ONE-ENTRY cluster in the level's scenery, and `drawBox`
# treats those completely differently from the elm's several-entry cluster: it
# ignores the declared dimensions and sizes the box off the collision entry,
# then FittedGlb BOTTOM-ALIGNS the mesh on it. For a mass that is exactly right.
# For a deck it means the dressing is bottom-aligned on the plane the player
# walks on, so the walking surface of a plank ends up a board's thickness ABOVE
# the deck and the runner's boots sink into it by that much.
#
# There is no way to author around it — the lowest point of the mesh is what
# lands on the plane — so the only lever is to spend the whole vertical budget on
# the board itself. A gangway plank is therefore 30mm of pine and nothing else:
# no bearers under it, no cleats or hand ropes over it, because 30mm above the
# deck is a boot sole hidden inside a board and 200mm is a runner buried to the
# ankle. That is also just what a fire board is, which is the happy case.
#
# Everything load-bearing is read out of the hull JSON, which is generated from
# GEOMETRY by export_roofline_hulls.mjs. Nothing here transcribes a number.
#
# Run:
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#     --python assets/pipeline/build_roofline_kit.py -- hull.json outdir [key ...]
import bmesh
import bpy
import json
import math
import os
import random
import subprocess
import sys

import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
HULL_JSON = os.path.abspath(argv[0])
OUT_DIR = os.path.abspath(argv[1])
WANTED = argv[2:]

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MATERIALS = os.path.join(REPO, "assets", "source", "concepts", "m1-roofline")

with open(HULL_JSON) as handle:
    HULL = json.load(handle)

# How far above the deck plane the highest point of a walkable prop may sit.
# Same number the elm's verifier uses, and for the same reason: a surface
# slightly low is hidden by the boot, a surface high is a visible intersection.
TOL_ABOVE = 0.05

# Textures are re-encoded to JPEG before Blender ever sees them, with sips, at
# the quality the road kit published in its own manifest.
#
# Not a detail. Handing the exporter a PNG and asking for JPEG re-encodes it at
# something near lossless — a 1024 square came out at 1.08MB, which is four
# times what the same image is worth and would have put a 2.8m plank in the same
# weight class as the whole Liberty Tree. Curiously it only happened to images
# that were NOT resized on the way in, so the two small ones in the same build
# came out correct and the bug would have been easy to miss. Pre-encoding takes
# the decision away from the exporter: what is on disk is what ships.
JPEG_QUALITY = 80

SOURCES = {
    "plank": "mat-gangway-plank-a.png",
    "lead": "mat-gambrel-lead-a.png",
    "shingle": "mat-gambrel-shingle-a.png",
    "brick-chimney": "mat-boston-brick-english-a.png",
    "brick-pier": "mat-boston-brick-flemish-a.png",
    "stone": "mat-dressed-stone-a.png",
    # -b, not -a: -a's boards were tarred to a uniform near-black with the
    # weathering baked top to bottom, which made the shed one striped surface and
    # allowed exactly one vertical repeat. -b has separate boards with their own
    # colours and no gradient, so it tiles both ways.
    "board-ropewalk": "mat-ropewalk-board-b.png",
}

# Real-world metres one tile of each material covers. Measured off the images
# rather than guessed: nine plank bands across the plank tile at a 0.26m board
# is 2.3m; the brick tiles show roughly twelve courses, and a course with its
# joint is 75mm, so 0.9m.
TILE_M = {
    "plank": 2.30,
    "lead": 1.60,
    "shingle": 1.30,
    "brick-chimney": 0.90,
    "brick-pier": 0.90,
    "stone": 1.20,
    # Twelve boards across the -b tile, so 3.3m makes each one eleven inches,
    # which is what a sheathing board was.
    "board-ropewalk": 3.30,
}

RNG = random.Random(17650814)


def log(*parts):
    print("[roofline]", *parts)


def draw_box(key, prefer_tag=None):
    """The box the level fits this asset into, read off the hull.

    Where one key is drawn at several entries with different boxes — the arcade
    pier is drawn at three — the mesh can only match some of them. Taking the
    per-axis MINIMUM over the boxes that matter keeps the tightest one at scale
    1.0 and leaves the looser ones with a small gap, which is the failure that
    reads as "the pier is slightly narrower than its collision" rather than as
    "the pier is a vertical smear".
    """
    hull = HULL[key]
    draws = hull["draws"]
    if prefer_tag:
        tagged = {
            mass["id"] for mass in hull["masses"] if prefer_tag in (mass["tags"] or [])
        }
        chosen = [draw for draw in draws if set(draw["parts"]) & tagged]
        if chosen:
            draws = chosen
    sizes = np.array([draw["size"] for draw in draws], dtype=float)
    box = sizes.min(axis=0)
    if len(sizes) > 1 and not np.allclose(sizes, box):
        log(f"{key}: {len(sizes)} boxes {[list(s) for s in sizes]} -> fitting {list(box)}")
    return tuple(float(v) for v in box)


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------


def encode(name, px):
    """Re-encode a concept PNG to a served-size JPEG, and cache it in the build."""
    source = os.path.join(MATERIALS, SOURCES[name])
    if not os.path.exists(source):
        raise SystemExit(f"missing material source: {source}")
    cache = os.path.join(OUT_DIR, "..", "world-m1-roofline", "tex")
    cache = os.path.abspath(cache)
    os.makedirs(cache, exist_ok=True)
    # Keyed on the SOURCE file and not on the material name. Named by the
    # material, the cache silently served the old tile for a whole build after
    # `board-ropewalk` was repointed from mat-ropewalk-board-a to -b: same bytes,
    # same triangle count, and nothing to say the new art had not been used.
    stem = os.path.splitext(SOURCES[name])[0]
    out = os.path.join(cache, f"{stem}-{px}.jpg")
    if not os.path.exists(out):
        subprocess.run(
            [
                "sips",
                "-s", "format", "jpeg",
                "-s", "formatOptions", str(JPEG_QUALITY),
                "-Z", str(px),
                source,
                "--out", out,
            ],
            check=True,
            capture_output=True,
        )
    log(f"texture {name} {px}px {os.path.getsize(out) // 1024}KB")
    return out


SERVED = os.path.join(REPO, "apps", "web", "public")


def graded(name, path, target):
    """Re-grade a tile so its mean colour is another surface's mean colour.

    Per-channel gain and nothing else. It is the crudest correction there is and
    it is the right one here: the generated Flemish tile already has the bond,
    the course height, the hand-made size variation and the lime joints, all of
    which the target atlas patch is far too small to supply. What it does NOT
    have is the Town House's clay, and clay is a colour. Grading keeps everything
    the tile is good at and takes the one thing the building can say better.

    The gain is capped. A tile dragged more than half again in any channel is not
    being matched, it is being repainted, and that is worth saying out loud.
    """
    image = bpy.data.images.load(path, check_existing=False)
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    flat = pixels.reshape(-1, 4)
    mean = flat[:, :3].mean(axis=0)
    gain = np.clip(target / np.maximum(mean, 1e-4), 0.55, 1.8)
    log(
        f"grade {name}: tile mean ({mean[0]:.4f}, {mean[1]:.4f}, {mean[2]:.4f}) "
        f"-> gain ({gain[0]:.3f}, {gain[1]:.3f}, {gain[2]:.3f})"
    )
    flat[:, :3] = np.clip(flat[:, :3] * gain, 0.0, 1.0)
    image.pixels.foreach_set(flat.reshape(-1))
    out = os.path.splitext(path)[0] + "-matched.jpg"
    image.filepath_raw = out
    image.file_format = "JPEG"
    bpy.context.scene.render.image_settings.quality = JPEG_QUALITY
    image.save()
    bpy.data.images.remove(image)
    log(f"grade {name}: wrote {os.path.basename(out)} {os.path.getsize(out) // 1024}KB")
    return out


def atlas_block_rgb(glb, low, high, chromatic):
    """The mean colour of the calmest block of a shipped GLB's own texture atlas.

    The pier is the Town House's arcaded ground floor, so its brick has to be
    that building's brick, and `bldg-townhouse-civic.glb` has now shipped — with
    the brick baked into a Meshy atlas rather than published as a tile. There is
    nothing to reuse directly, but there IS something to MEASURE, and matching a
    measured colour is a different thing from matching a remembered one.

    The search is build_m1_civic.py's own `flat_atlas_uv`, which had to solve
    exactly this on exactly this atlas: thumbnail it, then take the lowest
    variance block whose brightness is in the band asked for, pricing saturation
    into the score so a request for brick cannot be answered with lead.
    """
    before = set(bpy.data.images)
    path = os.path.join(SERVED, glb)
    if not os.path.exists(path):
        log(f"atlas: {glb} is not shipped; leaving the tile ungraded")
        return None
    bpy.ops.import_scene.gltf(filepath=path)
    images = [i for i in bpy.data.images if i not in before and i.size[0] >= 64]
    if not images:
        log(f"atlas: {glb} carries no image big enough to sample")
        return None
    source = max(images, key=lambda i: i.size[0] * i.size[1])
    grid = 48
    thumb = source.copy()
    thumb.scale(grid, grid)
    pixels = np.empty(grid * grid * 4, dtype=np.float32)
    thumb.pixels.foreach_get(pixels)
    bpy.data.images.remove(thumb)
    rgb = pixels.reshape(grid, grid, 4)[:, :, :3]
    luma = rgb.mean(axis=2)
    chroma = (rgb.max(axis=2) - rgb.min(axis=2)) / np.maximum(rgb.max(axis=2), 1e-4)
    block = 4
    best = None
    for row in range(grid - block + 1):
        for col in range(grid - block + 1):
            patch = luma[row : row + block, col : col + block]
            mean = float(patch.mean())
            if not (low <= mean <= high):
                continue
            # A NEGATIVE weight on saturation is a request for the coloured
            # thing rather than for the grey one.
            score = float(patch.std()) - chromatic * float(
                chroma[row : row + block, col : col + block].mean()
            )
            if best is None or score < best[0]:
                best = (score, row, col)
    if best is None:
        log(f"atlas: no block of {glb} fell in the {low:.2f}..{high:.2f} band")
        return None
    _, row, col = best
    patch = rgb[row : row + block, col : col + block, :].reshape(-1, 3)
    mean = patch.mean(axis=0)
    log(
        f"atlas {glb}: brick block at ({col},{row}) mean linear rgb "
        f"({mean[0]:.4f}, {mean[1]:.4f}, {mean[2]:.4f})"
    )
    return mean


def load_material(name, px, match=None):
    """One image, one Principled BSDF. Lead is the only one that is not wood or clay."""
    path = encode(name, px)
    if match is not None:
        path = graded(name, path, match)
    image = bpy.data.images.load(path, check_existing=True)
    material = bpy.data.materials.new(f"m1-{name}")
    material.use_nodes = True
    tree = material.node_tree
    principled = tree.nodes["Principled BSDF"]
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.extension = "REPEAT"
    tree.links.new(principled.inputs["Base Color"], texture.outputs["Color"])
    principled.inputs["Metallic"].default_value = 0.0
    principled.inputs["Roughness"].default_value = 0.72 if name == "lead" else 0.9
    return material, image


def plank_bands(image):
    """Where the plank tile's boards are, so a board never lands on a gap line.

    The build lays real boards with real gaps between them, so mapping the tile
    straight across the raft would print the tile's own dark gap lines down the
    middle of them. Instead each board is mapped to a strip INSIDE one of the
    tile's boards. Which columns those are is measured off the image the way the
    elm sampled its bark UVs, because a tile generated tomorrow will not have
    its gaps in the same places as this one.
    """
    width, height = image.size
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(height, width, 4)
    luma = pixels[:, :, :3].mean(axis=2).mean(axis=0)
    kernel = np.ones(5) / 5.0
    smooth = np.convolve(luma, kernel, mode="same")
    threshold = np.percentile(smooth, 22)
    dark = smooth < threshold

    # Gap runs, then the lit spans between them are the boards.
    edges = np.diff(dark.astype(np.int8))
    starts = list(np.where(edges == 1)[0] + 1)
    ends = list(np.where(edges == -1)[0] + 1)
    if dark[0]:
        starts = [0] + starts
    if dark[-1]:
        ends = ends + [width]
    gaps = [(a, b) for a, b in zip(starts, ends) if b - a >= 2]

    bands = []
    cursor = 0
    for a, b in gaps:
        if a - cursor > width * 0.03:
            bands.append((cursor, a))
        cursor = b
    if width - cursor > width * 0.03:
        bands.append((cursor, width))

    # Pull in from each edge so a bilinear sample at the boundary cannot reach
    # into the gap next door.
    inset = max(2, int(width * 0.006))
    usable = [
        (a + inset, b - inset) for a, b in bands if (b - inset) - (a + inset) > width * 0.02
    ]
    if not usable:
        usable = [(int(width * 0.30), int(width * 0.42))]
    log(f"plank tile: {len(gaps)} gap runs, {len(usable)} usable board bands")
    return [(a / width, b / width) for a, b in usable]


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------
# Built with Blender Z up. The exporter's export_yup maps Blender (x, y, z) to
# glTF (x, z, -y), so Blender X stays game X, Blender Z becomes game height, and
# Blender Y becomes game depth with its sign flipped. Nothing in this kit is
# asymmetric front-to-back, so the sign never has to be reasoned about.

FACE_AXES = {
    "+z": (0, 1),
    "-z": (0, 1),
    "+x": (1, 2),
    "-x": (1, 2),
    "+y": (0, 2),
    "-y": (0, 2),
}


def add_box(mesh, uv_layer, lo, hi, material, tile, uv_offset=(0.0, 0.0), skip=(), tile_v=None):
    """An axis-aligned box with planar per-face UVs in real-world metres.

    `tile_v` gives the vertical axis its own tile length, and it exists because
    of what the rope house's first proof looked like. A vertical-board material
    is seamless ACROSS the boards and not along them — it carries the algae at
    the bottom of the wall and the sun-bleaching at the top inside the one tile —
    so repeating it up an 8.6m wall printed that gradient five times and the shed
    came out in horizontal stripes. Setting `tile_v` to the wall's own height
    maps the tile once from sill to eaves, which stretches the grain along its
    length, where nobody can see it, and puts the weathering where the weather
    actually is.
    """
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    corners = {
        (i, j, k): Vector((x1 if i else x0, y1 if j else y0, z1 if k else z0))
        for i in (0, 1)
        for j in (0, 1)
        for k in (0, 1)
    }
    quads = {
        "+z": [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
        "-z": [(0, 1, 0), (1, 1, 0), (1, 0, 0), (0, 0, 0)],
        "+x": [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
        "-x": [(0, 1, 0), (0, 0, 0), (0, 0, 1), (0, 1, 1)],
        "+y": [(1, 1, 0), (0, 1, 0), (0, 1, 1), (1, 1, 1)],
        "-y": [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
    }
    verts = {}
    for name, keys in quads.items():
        if name in skip:
            continue
        loop = []
        for key in keys:
            if key not in verts:
                verts[key] = mesh.verts.new(corners[key])
            loop.append(verts[key])
        try:
            face = mesh.faces.new(loop)
        except ValueError:
            continue
        face.material_index = material
        axis_u, axis_v = FACE_AXES[name]
        for vertex_loop in face.loops:
            point = vertex_loop.vert.co
            # On a side face the second axis is height; on a top or bottom face
            # it is not, so tile_v only applies where there is a vertical to
            # stretch along.
            v_tile = tile_v if (tile_v and axis_v == 2) else tile
            vertex_loop[uv_layer].uv = (
                point[axis_u] / tile + uv_offset[0],
                point[axis_v] / v_tile + uv_offset[1],
            )


def add_solid(mesh, uv_layer, corners, material, tile, uv_axes=(0, 2)):
    """`add_box`, but for a six-faced solid that is not axis-aligned.

    Takes the same (i, j, k) corner dictionary `add_box` builds internally, so a
    caller can move individual corners: a louvre blade is a box whose outer pair
    of edges has been dropped, and a chamfered kerb arris is a box whose top
    outer edge has been pulled in. Winding is left to the caller's
    `recalc_face_normals`, which every builder here already runs — a slat tilted
    the other way would otherwise come out inside-out.
    """
    quads = (
        ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)),
        ((0, 1, 0), (1, 1, 0), (1, 0, 0), (0, 0, 0)),
        ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)),
        ((0, 1, 0), (0, 0, 0), (0, 0, 1), (0, 1, 1)),
        ((1, 1, 0), (0, 1, 0), (0, 1, 1), (1, 1, 1)),
        ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)),
    )
    axis_u, axis_v = uv_axes
    verts = {}
    for quad in quads:
        loop = []
        for key in quad:
            if key not in verts:
                verts[key] = mesh.verts.new(corners[key])
            loop.append(verts[key])
        try:
            face = mesh.faces.new(loop)
        except ValueError:
            continue
        face.material_index = material
        for vertex_loop in face.loops:
            point = vertex_loop.vert.co
            vertex_loop[uv_layer].uv = (point[axis_u] / tile, point[axis_v] / tile)


def add_slat(mesh, uv_layer, x, y, z_in, z_out, thick, cross, material, tile):
    """One louvre blade: a board tilted so its outer edge sheds water.

    `x` and `y` are (lo, hi) plan extents and `cross` is the plan axis the blade
    projects along, so the top face runs from `z_in` at that axis's LOW end to
    `z_out` at its high end. The caller orders the pair, which is what lets one
    function serve all four sides of a monitor: on the south side the outside is
    the low end and on the north side it is the high end.
    """
    corners = {}
    for i in (0, 1):
        for j in (0, 1):
            top = z_in + (z_out - z_in) * ((i, j)[cross])
            for k in (0, 1):
                corners[(i, j, k)] = Vector((x[i], y[j], top if k else top - thick))
    add_solid(mesh, uv_layer, corners, material, tile, uv_axes=(1 - cross, 2))


def add_strut(mesh, uv_layer, start, end, radius, material, tile, sides=8):
    """A round timber between two points, as a low-sided prism.

    Every member of a scaffold is this: standards, ledgers, putlogs and braces
    differ only in where their ends are. The caps are flat and perpendicular to
    the run, so an axis-aligned member's end lands EXACTLY on the coordinate
    asked for — which is what lets the putlogs pin the bounding box on the
    scaffold's 2.5m width while the standards stay inboard of it.
    """
    start, end = Vector(start), Vector(end)
    axis = end - start
    length = axis.length
    if length < 1e-6:
        return
    axis = axis / length
    reference = Vector((0.0, 0.0, 1.0))
    if abs(axis.dot(reference)) > 0.98:
        reference = Vector((1.0, 0.0, 0.0))
    u = axis.cross(reference).normalized()
    v = axis.cross(u)
    rings = []
    for point in (start, end):
        rings.append(
            [
                mesh.verts.new(
                    point
                    + u * (radius * math.cos(2.0 * math.pi * s / sides))
                    + v * (radius * math.sin(2.0 * math.pi * s / sides))
                )
                for s in range(sides)
            ]
        )
    faces = []
    for s in range(sides):
        t = (s + 1) % sides
        faces.append([rings[0][s], rings[0][t], rings[1][t], rings[1][s]])
    faces.append(list(reversed(rings[0])))
    faces.append(list(rings[1]))
    for loop in faces:
        try:
            face = mesh.faces.new(loop)
        except ValueError:
            continue
        face.material_index = material
        for vertex_loop in face.loops:
            point = vertex_loop.vert.co
            # Along the timber and round it: the grain of a pole runs its length,
            # so the long axis takes the U and the girth takes the V.
            along = (point - start).dot(axis)
            vertex_loop[uv_layer].uv = (along / tile, (point - start).dot(u) / tile)


def add_grid(mesh, uv_layer, points, material, tile, uv_offset=(0.0, 0.0), flip=False):
    """A quad grid from a 2D array of positions, UV-mapped by its X/Y footprint."""
    verts = [[mesh.verts.new(point) for point in row] for row in points]
    for j in range(len(points) - 1):
        for i in range(len(points[0]) - 1):
            loop = [verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]]
            if flip:
                loop.reverse()
            try:
                face = mesh.faces.new(loop)
            except ValueError:
                continue
            face.material_index = material
            for vertex_loop in face.loops:
                point = vertex_loop.vert.co
                vertex_loop[uv_layer].uv = (
                    point[0] / tile + uv_offset[0],
                    point[1] / tile + uv_offset[1],
                )


def finish(mesh, name, materials, target, exact_z, out_name):
    """Centre, pin the base to zero, hit the target box exactly, export.

    FittedGlb contain-fits on the smallest of the three box/mesh ratios and then
    bottom-aligns, so a millimetre of overshoot on ANY axis shrinks the whole
    prop on ALL of them. A chimney 10mm too wide draws its cap 9mm under the
    collision it is vaulted over. So the horizontal axes are trued to the box
    rather than trusted, and `exact_z` says whether the height is load-bearing
    (a chimney cap, a pier meeting a soffit) or merely capped (a plank, which
    only has to stay under the tolerance).
    """
    data = bpy.data.meshes.new(name)
    mesh.to_mesh(data)
    mesh.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    for material in materials:
        obj.data.materials.append(material)

    coords = np.array([v.co[:] for v in obj.data.vertices])
    lo, hi = coords.min(axis=0), coords.max(axis=0)
    size = hi - lo
    log(f"{name}: built {size[0]:.4f} x {size[1]:.4f} x {size[2]:.4f} (blender xyz)")

    scale = [target[0] / size[0], target[2] / size[1], 1.0]
    if exact_z:
        scale[2] = target[1] / size[2]
    for vertex in obj.data.vertices:
        vertex.co.x = (vertex.co.x - (lo[0] + hi[0]) / 2.0) * scale[0]
        vertex.co.y = (vertex.co.y - (lo[1] + hi[1]) / 2.0) * scale[1]
        vertex.co.z = (vertex.co.z - lo[2]) * scale[2]
    log(f"{name}: trued by ({scale[0]:.5f}, {scale[1]:.5f}, {scale[2]:.5f})")

    coords = np.array([v.co[:] for v in obj.data.vertices])
    lo, hi = coords.min(axis=0), coords.max(axis=0)
    height = hi[2] - lo[2]
    assert abs(lo[2]) < 1e-6, f"{name}: base is at {lo[2]:+.5f}, not 0"
    assert abs((hi[0] - lo[0]) - target[0]) < 5e-4, f"{name}: x {(hi[0] - lo[0]):.4f}"
    assert abs((hi[1] - lo[1]) - target[2]) < 5e-4, f"{name}: z {(hi[1] - lo[1]):.4f}"
    if exact_z:
        assert abs(height - target[1]) < 5e-4, f"{name}: y {height:.4f} != {target[1]:.4f}"
    else:
        assert height <= TOL_ABOVE + 1e-9, (
            f"{name}: {height * 1000:.0f}mm tall, so its surface draws that far above the "
            f"deck plane; the ceiling is {TOL_ABOVE * 1000:.0f}mm"
        )
    log(f"{name}: FINAL x={hi[0] - lo[0]:.4f} y={height:.4f} z={hi[1] - lo[1]:.4f}")

    for poly in obj.data.polygons:
        poly.use_smooth = False
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    log(f"{name}: {tris} tris")

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, out_name)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_animations=False,
        export_image_format="JPEG",
        export_jpeg_quality=80,
        use_selection=True,
    )
    log(f"WROTE {path} {os.path.getsize(path)}")
    return path


def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------------------------------------------------------------------------
# 1. roof-plank-gantry — the fire board off the Town House leads
# ---------------------------------------------------------------------------
# Rough-sawn softwood staging boards laid across a 2.8m gap between two roofs at
# the same height, which is exactly what a fire board was. The entire vertical
# budget goes into the boards: 30mm of pine, cupped and weathered, with the ends
# left ragged the way boards cut to no particular length are.


def build_gantry():
    key = "roof-plank-gantry"
    box = draw_box(key)
    span, depth = box[0], box[2]
    new_scene()
    plank, image = load_material("plank", 1024)
    bands = plank_bands(image)
    tile = TILE_M["plank"]

    mesh = bmesh.new()
    uv_layer = mesh.loops.layers.uv.new("UVMap")

    # Five boards. A staging plank was nine to eleven inches, and five across a
    # 1.2m gangway lands at nine and a bit, which is why five.
    count = 5
    gap = 0.007
    widths = [1.0 + RNG.uniform(-0.09, 0.09) for _ in range(count)]
    total = (depth - gap * (count - 1)) / sum(widths)
    widths = [w * total for w in widths]

    THICK = 0.030
    CUP = 0.0045
    NSEG_X, NSEG_Y = 14, 3

    y = -depth / 2.0
    for index, width in enumerate(widths):
        y0, y1 = y, y + width
        y = y1 + gap

        # Two boards reach both ends so the raft measures its full span; the
        # others are short at one end. A gangway made of identical boards reads
        # as a manufactured panel.
        if index in (1, 3):
            x0, x1 = -span / 2.0, span / 2.0
        else:
            short = RNG.uniform(0.012, 0.055)
            if RNG.random() < 0.5:
                x0, x1 = -span / 2.0 + short, span / 2.0
            else:
                x0, x1 = -span / 2.0, span / 2.0 - short

        thick = THICK * RNG.uniform(0.86, 1.0)
        band = bands[RNG.randrange(len(bands))]
        # Along the grain the board is as long as it is; across it, the strip is
        # whatever one tile board gives, stretched to this board's width. Wood
        # grain does not mind a few per cent of stretch and it guarantees no gap
        # line lands on a board.
        v_scale = 1.0 / tile
        v_offset = RNG.uniform(0.0, 1.0)

        top = []
        bottom = []
        for j in range(NSEG_Y + 1):
            tv = j / NSEG_Y
            row_top = []
            row_bottom = []
            for i in range(NSEG_X + 1):
                tu = i / NSEG_X
                # Cupped across the board and very slightly hollowed along it:
                # both only ever take the surface DOWN, which is free, where
                # anything upward is spent out of the 50mm ceiling.
                cup = CUP * (1.0 - (2.0 * tv - 1.0) ** 2)
                wear = 0.0015 * math.sin(tu * math.pi * 2.0 + index)
                row_top.append(
                    Vector((x0 + (x1 - x0) * tu, y0 + (y1 - y0) * tv, thick - cup - abs(wear)))
                )
                row_bottom.append(Vector((x0 + (x1 - x0) * tu, y0 + (y1 - y0) * tv, 0.0)))
            top.append(row_top)
            bottom.append(row_bottom)

        def board_uv(point, band=band, v_scale=v_scale, v_offset=v_offset, y0=y0, y1=y1):
            across = (point[1] - y0) / (y1 - y0)
            return (band[0] + across * (band[1] - band[0]), point[0] * v_scale + v_offset)

        for rows, flip in ((top, False), (bottom, True)):
            verts = [[mesh.verts.new(point) for point in row] for row in rows]
            for j in range(len(rows) - 1):
                for i in range(len(rows[0]) - 1):
                    loop = [verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]]
                    if flip:
                        loop.reverse()
                    face = mesh.faces.new(loop)
                    face.material_index = 0
                    for vertex_loop in face.loops:
                        vertex_loop[uv_layer].uv = board_uv(vertex_loop.vert.co)

        # The four sawn sides, closed against the top and bottom grids so the
        # board is a solid and a probe ray cannot fall through its edge.
        for side in ("x0", "x1", "y0", "y1"):
            ring = []
            if side in ("y0", "y1"):
                j = 0 if side == "y0" else NSEG_Y
                pairs = [(top[j][i], bottom[j][i]) for i in range(NSEG_X + 1)]
            else:
                i = 0 if side == "x0" else NSEG_X
                pairs = [(top[j][i], bottom[j][i]) for j in range(NSEG_Y + 1)]
            ring = pairs if side in ("y1", "x0") else list(reversed(pairs))
            for a, b in zip(ring, ring[1:]):
                loop = [
                    mesh.verts.new(a[0]),
                    mesh.verts.new(b[0]),
                    mesh.verts.new(b[1]),
                    mesh.verts.new(a[1]),
                ]
                face = mesh.faces.new(loop)
                face.material_index = 0
                for vertex_loop in face.loops:
                    vertex_loop[uv_layer].uv = board_uv(vertex_loop.vert.co)

    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    return finish(mesh, key, [plank], box, exact_z=False, out_name=f"{key}.glb")


# ---------------------------------------------------------------------------
# 2. roof-ridge-walk — the flat top of the Hollis Street gambrel
# ---------------------------------------------------------------------------
# A gambrel's flat top was leaded, because shingles will not hold on a deck that
# shallow, and a leaded flat carried a boarded walk down its spine for the sweep
# and the plumber. Both are inside the 50mm ceiling: the lead sits at 10mm, its
# rolls at 30mm, the walk boards at 42mm. Round the edge a shingle apron falls
# away to nothing, which is what says "this flat is the top of a shingled roof"
# rather than "this is a grey rectangle in the air".


def build_ridge_walk():
    key = "roof-ridge-walk"
    box = draw_box(key)
    length, depth = box[0], box[2]
    new_scene()
    lead, _ = load_material("lead", 512)
    plank, plank_image = load_material("plank", 512)
    shingle, _ = load_material("shingle", 512)
    bands = plank_bands(plank_image)

    mesh = bmesh.new()
    uv_layer = mesh.loops.layers.uv.new("UVMap")
    LEAD, PLANK, SHINGLE = 0, 1, 2

    APRON = 0.16
    LEAD_Y = 0.010
    ROLL_Y = 0.030
    WALK_Y = 0.042
    WALK_HALF = 0.30

    inner_x = length / 2.0 - APRON
    inner_y = depth / 2.0 - APRON

    # The lead flat, gently undulating the way hand-dressed sheet does. The
    # undulation is a couple of millimetres and only ever below LEAD_Y.
    nx, ny = 46, 16
    points = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x = -inner_x + (2.0 * inner_x) * i / nx
            y = -inner_y + (2.0 * inner_y) * j / ny
            ripple = 0.0018 * (
                math.sin(x * 2.1 + 0.7) * math.sin(y * 3.3 - 0.4)
                + 0.5 * math.sin(x * 5.7 + y * 1.9)
            )
            row.append(Vector((x, y, LEAD_Y - abs(ripple))))
        points.append(row)
    add_grid(mesh, uv_layer, points, LEAD, TILE_M["lead"])

    # Lead rolls across the fall, one per bay, skipped where the walk covers them.
    bays = max(2, int(round(length / 1.6)))
    for bay in range(1, bays):
        x = -inner_x + (2.0 * inner_x) * bay / bays
        half = 0.035
        for sign in (-1, 1):
            y_from = WALK_HALF if sign > 0 else -inner_y
            y_to = inner_y if sign > 0 else -WALK_HALF
            steps = 7
            rows = []
            for step in range(steps + 1):
                t = step / steps
                # Half-round in section: a lead roll is a timber core dressed over.
                dx = -half + 2.0 * half * t
                z = LEAD_Y + (ROLL_Y - LEAD_Y) * math.sin(math.pi * t) ** 0.65
                rows.append(
                    [Vector((x + dx, y_from, z)), Vector((x + dx, y_to, z))]
                )
            add_grid(mesh, uv_layer, rows, LEAD, TILE_M["lead"])

    # The walk: three boards down the spine, each mapped into its own band of
    # the plank tile so the tile's gap lines never land on a board.
    walk_boards = 3
    walk_gap = 0.008
    board_w = (2.0 * WALK_HALF - walk_gap * (walk_boards - 1)) / walk_boards
    for index in range(walk_boards):
        y0 = -WALK_HALF + index * (board_w + walk_gap)
        y1 = y0 + board_w
        band = bands[RNG.randrange(len(bands))]
        offset = (band[0], RNG.uniform(0.0, 1.0))
        # Mapped by hand rather than through add_box's planar projection: the
        # board wants its grain running along its length, not along the world.
        lo = (-inner_x, y0, LEAD_Y)
        hi = (inner_x, y1, WALK_Y)
        before = len(mesh.faces)
        add_box(mesh, uv_layer, lo, hi, PLANK, TILE_M["plank"], skip=("-z",))
        mesh.faces.ensure_lookup_table()
        for face in list(mesh.faces)[before:]:
            for vertex_loop in face.loops:
                point = vertex_loop.vert.co
                across = (point[1] - y0) / max(y1 - y0, 1e-6)
                vertex_loop[uv_layer].uv = (
                    band[0] + across * (band[1] - band[0]),
                    point[0] / TILE_M["plank"] + offset[1],
                )

    # The shingle apron: from the lead's edge out to the collision footprint,
    # falling to nothing so the flat reads as sitting inside a shingled roof.
    for side in ("x0", "x1", "y0", "y1"):
        steps = 4
        rows = []
        for step in range(steps + 1):
            t = step / steps
            z = LEAD_Y * (1.0 - t) ** 1.4
            if side in ("x0", "x1"):
                sign = -1.0 if side == "x0" else 1.0
                x = sign * (inner_x + APRON * t)
                rows.append(
                    [
                        Vector((x, -depth / 2.0 + APRON * (1.0 - t) * 0.0, z)),
                        Vector((x, depth / 2.0, z)),
                    ]
                )
                rows[-1][0].y = -depth / 2.0
            else:
                sign = -1.0 if side == "y0" else 1.0
                y = sign * (inner_y + APRON * t)
                rows.append(
                    [Vector((-length / 2.0, y, z)), Vector((length / 2.0, y, z))]
                )
        add_grid(mesh, uv_layer, rows, SHINGLE, TILE_M["shingle"], flip=(side in ("x1", "y0")))

    # Close the underside so nothing is a one-sided sheet from below.
    add_box(
        mesh,
        uv_layer,
        (-length / 2.0, -depth / 2.0, -0.0),
        (length / 2.0, depth / 2.0, 0.0009),
        SHINGLE,
        TILE_M["shingle"],
        skip=("+z",),
    )

    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    return finish(mesh, key, [lead, plank, shingle], box, exact_z=False, out_name=f"{key}.glb")


# ---------------------------------------------------------------------------
# 3. roof-chimney-stack — 1765 Boston brick
# ---------------------------------------------------------------------------
# The collision is 1.10m square and 1.05m over the leads, and the level's note
# says taller is a mantle and deeper is blocked. So the corbelled cap is what
# reaches the full 1.10 and the shaft is inset behind it: the widest thing on the
# stack is the thing the player vaults, which is both correct masonry and the
# right read. Two flues are open at the crown, mapped into the sootiest corner
# of the tile.


def build_chimney():
    key = "roof-chimney-stack"
    box = draw_box(key)
    side, height = box[0], box[1]
    new_scene()
    brick, _ = load_material("brick-chimney", 768)
    tile = TILE_M["brick-chimney"]

    mesh = bmesh.new()
    uv_layer = mesh.loops.layers.uv.new("UVMap")

    half = side / 2.0
    apron_h = 0.055 * height / 1.05
    cap_h = 0.075 * height / 1.05
    corbel_h = 0.085 * height / 1.05
    shaft_top = height - cap_h - 2.0 * corbel_h

    # Lead apron flashing where the stack leaves the roof. Reaches the full
    # footprint, which is also what pins the bounding box at the base.
    add_box(mesh, uv_layer, (-half, -half, 0.0), (half, half, apron_h), 0, tile, skip=("+z",))

    # The shaft, course by course. Each course is a brick and its joint, and
    # each is set out by a millimetre or two of its own, which is what hand-laid
    # brick looks like in silhouette and costs nothing.
    shaft_half = half - 0.080
    course = 0.075
    courses = max(4, int((shaft_top - apron_h) / course))
    step = (shaft_top - apron_h) / courses
    for index in range(courses):
        z0 = apron_h + index * step
        z1 = z0 + step
        jitter = RNG.uniform(-0.002, 0.0025)
        h = shaft_half + jitter
        add_box(
            mesh,
            uv_layer,
            (-h, -h, z0),
            (h, h, z1),
            0,
            tile,
            uv_offset=(RNG.uniform(-0.02, 0.02), 0.0),
            skip=("+z", "-z"),
        )

    # Two corbel courses stepping out to the collision footprint.
    for index, (inset, z0, z1) in enumerate(
        (
            (0.040, shaft_top, shaft_top + corbel_h),
            (0.000, shaft_top + corbel_h, shaft_top + 2.0 * corbel_h),
        )
    ):
        h = half - inset
        add_box(mesh, uv_layer, (-h, -h, z0), (h, h, z1), 0, tile, skip=("+z", "-z"))

    # The cap, with the crown left open as two flues. Built as a grid of cells
    # with the flue cells omitted, so the openings are edged by whole cells and
    # come out slightly ragged, which is how brick edges an opening.
    cap_z0 = shaft_top + 2.0 * corbel_h
    cap_half = half - 0.022
    cells = 13
    flue_depth = 0.06
    flues = []
    for sign in (-1, 1):
        cx = sign * cap_half * 0.44
        flues.append((cx - cap_half * 0.26, cx + cap_half * 0.26, -cap_half * 0.34, cap_half * 0.34))

    def in_flue(x, y):
        return any(x0 <= x <= x1 and y0 <= y <= y1 for x0, x1, y0, y1 in flues)

    edge = np.linspace(-cap_half, cap_half, cells + 1)
    # The sootiest part of the tile is its top edge, so the crown and the flue
    # linings are mapped there and the shaft is not.
    soot = (0.0, 0.86)
    for j in range(cells):
        for i in range(cells):
            x0, x1 = edge[i], edge[i + 1]
            y0, y1 = edge[j], edge[j + 1]
            if in_flue((x0 + x1) / 2.0, (y0 + y1) / 2.0):
                continue
            add_box(
                mesh,
                uv_layer,
                (x0, y0, cap_z0),
                (x1, y1, height),
                0,
                tile,
                uv_offset=soot,
                skip=("+x", "-x", "+y", "-y", "-z"),
            )
    # The flue linings and their floors.
    for x0, x1, y0, y1 in flues:
        add_box(
            mesh,
            uv_layer,
            (x0, y0, height - flue_depth),
            (x1, y1, height),
            0,
            tile,
            uv_offset=soot,
            skip=("+z",),
        )
    # And the cap's outer skin, so the ragged grid does not show its cell walls.
    add_box(
        mesh,
        uv_layer,
        (-cap_half, -cap_half, cap_z0),
        (cap_half, cap_half, height),
        0,
        tile,
        uv_offset=soot,
        skip=("+z", "-z"),
    )

    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    return finish(mesh, key, [brick], box, exact_z=True, out_name=f"{key}.glb")


# ---------------------------------------------------------------------------
# 4. service-wall-end — the Town House arcade pier
# ---------------------------------------------------------------------------
# The 1713 Town House stood on an open arcaded ground floor, a merchants'
# exchange, and Dock Square's arcade in this mission is the same thing: a run of
# brick piers carrying a solid soffit at 3.40m. So the pier is a granite plinth,
# a Flemish-bond brick shaft, a granite impost band at the springing, and above
# it the haunch of the arch spreading along the run — which is the detail that
# makes it an arcade rather than a row of posts.


def build_pier():
    key = "service-wall-end"
    box = draw_box(key, prefer_tag="arcade")
    width, height, depth = box[0], box[1], box[2]
    new_scene()
    # Measured against the building this pier stands under, in the scene that is
    # about to be thrown away, before the pier is built into it.
    target = atlas_block_rgb("world/props/bldg-townhouse-civic.glb", 0.10, 0.46, chromatic=0.5)
    new_scene()
    brick, _ = load_material("brick-pier", 1024, match=target)
    stone, _ = load_material("stone", 512)
    BRICK, STONE = 0, 1
    brick_tile = TILE_M["brick-pier"]
    stone_tile = TILE_M["stone"]

    mesh = bmesh.new()
    uv_layer = mesh.loops.layers.uv.new("UVMap")

    hx, hy = width / 2.0, depth / 2.0
    plinth_h = 0.16
    chamfer_h = 0.07
    # A deeper impost than the first proof carried. On the asset sheet that pier
    # read as a chimney: a brick shaft with a corbel on top is a chimney, and the
    # one thing that makes it masonry carrying an arch instead is a proper
    # springing course. So the impost is 0.16 rather than 0.10 and it oversails
    # the shaft as a nosing, which puts a hard shadow line across the pier at the
    # height the arch starts.
    impost_z0 = height - 0.62
    impost_h = 0.16
    shaft_inset_x, shaft_inset_y = 0.045, 0.055

    # Plinth: full footprint, which fixes the bounding box on both horizontals.
    add_box(mesh, uv_layer, (-hx, -hy, 0.0), (hx, hy, plinth_h), STONE, stone_tile, skip=("-z",))
    # Chamfered weathering course off the plinth into the shaft.
    steps = 3
    for step in range(steps):
        t0, t1 = step / steps, (step + 1) / steps
        z0 = plinth_h + chamfer_h * t0
        z1 = plinth_h + chamfer_h * t1
        x0 = hx - shaft_inset_x * t1
        y0 = hy - shaft_inset_y * t1
        add_box(mesh, uv_layer, (-x0, -y0, z0), (x0, y0, z1), STONE, stone_tile, skip=("+z", "-z"))

    # The shaft, laid course by course so the brick reads in silhouette too.
    sx, sy = hx - shaft_inset_x, hy - shaft_inset_y
    shaft_z0 = plinth_h + chamfer_h
    course = 0.076
    courses = max(6, int((impost_z0 - shaft_z0) / course))
    step_h = (impost_z0 - shaft_z0) / courses
    for index in range(courses):
        z0 = shaft_z0 + index * step_h
        jitter = RNG.uniform(-0.0018, 0.002)
        add_box(
            mesh,
            uv_layer,
            (-sx + jitter, -sy + jitter, z0),
            (sx - jitter, sy - jitter, z0 + step_h),
            BRICK,
            brick_tile,
            uv_offset=(RNG.uniform(-0.03, 0.03), index * 0.0),
            skip=("+z", "-z"),
        )

    # Granite impost band at the springing: full footprint again.
    add_box(
        mesh,
        uv_layer,
        (-hx, -hy, impost_z0),
        (hx, hy, impost_z0 + impost_h),
        STONE,
        stone_tile,
        skip=("+z", "-z"),
    )

    # The arch haunch. The arcade runs along the pier's depth axis, so the
    # brickwork spreads along that axis as it rises into the soffit — the
    # beginning of the arches either side.
    #
    # It spreads along the RUN and barely across it, which is the correction the
    # first proof needed most. Spreading equally on both axes is a flare, and a
    # flare on top of a brick shaft reads as a chimney cap; an arch springs along
    # the arcade and the face of the pier stays flat. So the depth axis takes the
    # whole quarter-circle and the face keeps a hair of it for the arris.
    haunch_z0 = impost_z0 + impost_h
    steps = 6
    for step in range(steps):
        t0, t1 = step / steps, (step + 1) / steps
        z0 = haunch_z0 + (height - haunch_z0) * t0
        z1 = haunch_z0 + (height - haunch_z0) * t1
        # A quarter-circle profile: narrow at the springing, full at the soffit.
        def spread(t):
            return math.sin(t * math.pi / 2.0)

        y1 = (hy - shaft_inset_y) + shaft_inset_y * spread(t1)
        y0 = (hy - shaft_inset_y) + shaft_inset_y * spread(t0)
        x1 = (hx - shaft_inset_x) + shaft_inset_x * (0.25 * spread(t1))
        x0 = (hx - shaft_inset_x) + shaft_inset_x * (0.25 * spread(t0))
        # Two rings so the taper is a surface rather than a stack of steps.
        rings = [
            [Vector((-x0, -y0, z0)), Vector((x0, -y0, z0)), Vector((x0, y0, z0)), Vector((-x0, y0, z0))],
            [Vector((-x1, -y1, z1)), Vector((x1, -y1, z1)), Vector((x1, y1, z1)), Vector((-x1, y1, z1))],
        ]
        lower = [mesh.verts.new(p) for p in rings[0]]
        upper = [mesh.verts.new(p) for p in rings[1]]
        for i in range(4):
            k = (i + 1) % 4
            face = mesh.faces.new([lower[i], lower[k], upper[k], upper[i]])
            face.material_index = BRICK
            for vertex_loop in face.loops:
                point = vertex_loop.vert.co
                along = point[1] if abs(point[0]) > abs(point[1]) else point[0]
                vertex_loop[uv_layer].uv = (along / brick_tile, point[2] / brick_tile)
    # Cap the top flush with the soffit.
    add_box(
        mesh,
        uv_layer,
        (-hx + 0.001, -hy + 0.001, height - 0.004),
        (hx - 0.001, hy - 0.001, height),
        BRICK,
        brick_tile,
        skip=("-z",),
    )

    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    return finish(mesh, key, [brick, stone], box, exact_z=True, out_name=f"{key}.glb")


# ---------------------------------------------------------------------------
# 5. int-shell-ropewalk-a — the rope house, from outside as well as in
# ---------------------------------------------------------------------------
# The shipped shell is an interior: four walls and a ceiling with the normals
# turned inward, 34.16 x 4.31 x 12.16 natural. Two things follow from that.
#
# The first is the one the mission sees. M1 does not only pass through this
# building — it lands on its roof out of a hatch, and the yard beyond it is the
# duel arena, so the shed is looked at from outside and from above for most of
# the section. Inward normals mean there is nothing there to look at: it reads as
# a matte black hole in the town.
#
# The second is arithmetic, and it is worse. A structural shell is fitted with
# `fit: "SHELL"`, which scales per axis onto the box exactly, so a 4.31m-tall
# mesh in an 8.6m box is stretched to very nearly TWICE its height. Every board
# on the inside is two metres tall. Rebuilding the shell at exactly the box it is
# given — 22 x 8.6 x 10 — makes that scale 1.0 on all three axes, so fixing the
# outside and fixing the stretch are the same job.
#
# Everything that has to line up is read out of the hull rather than transcribed:
# the door is the gap the north wall's two masses leave between them, and the
# hatch is the hole the four roof decks leave between them. If GEOMETRY moves the
# door, the door in the art moves with it.


def _local_frame(hull):
    """Blender-space mapping for a draw, from the draw's own box.

    The exporter maps Blender (x, y, z) to glTF (x, z, -y), so Blender X is game
    X but Blender Y is game Z NEGATED. Every other asset in this kit is
    symmetric front to back and could ignore that; this one has a door in one
    wall and a hatch off-centre in both axes, so it is written down once here and
    never reasoned about again.
    """
    draw = hull["draws"][0]
    cx, _, cz = draw["pos"]
    return (
        lambda game_x: game_x - cx,  # bx
        lambda game_z: cz - game_z,  # by
    )


def _door_gap(hull, bx):
    """The opening in the north wall: the x range its masses do not cover."""
    north = sorted(
        (m for m in hull["masses"] if m["id"].startswith("ROPEWALK_WALL_N")),
        key=lambda m: m["rect"]["minX"],
    )
    assert len(north) == 2, f"expected the north wall in two pieces, got {len(north)}"
    gap = (north[0]["rect"]["maxX"], north[1]["rect"]["minX"])
    assert gap[1] > gap[0], "the north wall's two masses do not leave a gap"
    log(f"ropewalk: door gap game x {gap[0]:.2f}..{gap[1]:.2f} ({gap[1] - gap[0]:.2f}m wide)")
    return sorted((bx(gap[0]), bx(gap[1])))


def _hatch(hull, bx, by):
    """The hole in the roof: what the four roof decks leave between them."""
    decks = {d["id"]: d["rect"] for d in hull["decks"]}
    west, east = decks["ROPEWALK_ROOF_W"], decks["ROPEWALK_ROOF_E"]
    north, south = decks["ROPEWALK_ROOF_N"], decks["ROPEWALK_ROOF_S"]
    x0, x1 = west["maxX"], east["minX"]
    z0, z1 = north["maxZ"], south["minZ"]
    assert x1 > x0 and z1 > z0, "the roof decks do not leave a hatch between them"
    log(f"ropewalk: hatch game x {x0:.2f}..{x1:.2f} z {z0:.2f}..{z1:.2f}")
    return sorted((bx(x0), bx(x1))), sorted((by(z0), by(z1)))


def build_ropewalk_shell():
    key = "int-shell-ropewalk-a"
    hull = HULL[key]
    box = draw_box(key)
    length, height, depth = box[0], box[1], box[2]
    bx, by = _local_frame(hull)
    door_x = _door_gap(hull, bx)
    hatch_x, hatch_y = _hatch(hull, bx, by)

    # Wall thickness, off the masses, so the reveal in the door is the reveal the
    # player is actually stopped by.
    north = next(m for m in hull["masses"] if m["id"] == "ROPEWALK_WALL_N_W")
    wall_t = north["rect"]["maxZ"] - north["rect"]["minZ"]
    log(f"ropewalk: box {length} x {height} x {depth}, wall {wall_t:.2f}m")

    new_scene()
    board, board_image = load_material("board-ropewalk", 1024)
    # The gambrel's lead tile is a pale oxide bloom, which is right for 26 square
    # metres seen from beside it and wrong for 220 seen from above: at that size it
    # came out a white plate, and M1 runs at night, so a white plate on a working
    # shed reads as snow on it. Graded to dull weathered lead — the same
    # measured-target machinery the pier's brick uses, with the target named
    # rather than sampled because there is no shipped lead roof to sample.
    lead, _ = load_material("lead", 768, match=np.array([0.105, 0.112, 0.118]))
    stone, _ = load_material("stone", 512)
    BOARD, LEAD, STONE = 0, 1, 2
    board_tile = TILE_M["board-ropewalk"]

    mesh = bmesh.new()
    uv_layer = mesh.loops.layers.uv.new("UVMap")

    hx, hy = length / 2.0, depth / 2.0
    # The battens are the outermost thing on the building, so they are what pins
    # the bounding box; the boarding behind them is recessed by their thickness.
    # That is the whole reason this shed has a silhouette rather than a footprint:
    # a flush wall of one material at this size is a painted slab.
    BATTEN = 0.05
    ROOF_T = 0.20
    SILL = 0.30
    door_top = 4.2
    wall_top = height - ROOF_T
    # Three tiles from sill to eaves, with a ledger on every seam.
    #
    # Four passes to get here, and the last one was a new tile rather than new
    # arithmetic. With the old tile the weathering was baked top to bottom, so
    # there was exactly one honest number of vertical repeats and it cost a
    # four-and-a-half-times stretch — which turns a tar streak into a hard line.
    # `mat-ropewalk-board-b` has no gradient in it, so the tile can repeat up the
    # wall at its own scale and keep its cross-grain.
    #
    # Three repeats, because three divides the wall into 2.7m lifts and a
    # sheathing board is not eight metres long anyway: the seams are where the
    # boards really do stop, and a ledger sits on each one. Nothing is hidden —
    # the joint is the construction.
    LIFTS = 3
    board_tile_v = (wall_top - SILL) / LIFTS
    rails = [SILL + board_tile_v * lift for lift in range(1, LIFTS)]

    def wall(x0, x1, y0, y1, z0, z1, skip=()):
        add_box(
            mesh,
            uv_layer,
            (x0, y0, z0),
            (x1, y1, z1),
            BOARD,
            board_tile,
            skip=skip,
            tile_v=board_tile_v,
            uv_offset=(0.0, -SILL / board_tile_v),
        )

    # ---- the four walls, boarded, recessed behind the battens ----------------
    # South and the two ends are blind; the north has the door in it.
    inner_x0, inner_x1 = -hx + wall_t, hx - wall_t
    inner_y0, inner_y1 = -hy + wall_t, hy - wall_t

    # North (game z low -> Blender y high) in two pieces, with a lintel over the
    # opening between them.
    wall(-hx + BATTEN, door_x[0], inner_y1, hy - BATTEN, SILL, wall_top)
    wall(door_x[1], hx - BATTEN, inner_y1, hy - BATTEN, SILL, wall_top)
    wall(door_x[0], door_x[1], inner_y1, hy - BATTEN, door_top, wall_top)
    # South, blind.
    wall(-hx + BATTEN, hx - BATTEN, -hy + BATTEN, inner_y0, SILL, wall_top)
    # The two gable ends, between the long walls.
    wall(-hx + BATTEN, inner_x0, inner_y0, inner_y1, SILL, wall_top)
    wall(inner_x1, hx - BATTEN, inner_y0, inner_y1, SILL, wall_top)

    # ---- a stone sill course ------------------------------------------------
    # Boarding stood on a stone or brick sill because boarding in the ground
    # rots, and it is also what stops the building looking like it was dropped on
    # the street. Full footprint, so it and the battens agree about the box.
    for x0, x1, y0, y1 in (
        (-hx, hx, inner_y1, hy),
        (-hx, hx, -hy, inner_y0),
        (-hx, inner_x0, inner_y0, inner_y1),
        (inner_x1, hx, inner_y0, inner_y1),
    ):
        add_box(mesh, uv_layer, (x0, y0, 0.0), (x1, y1, SILL), STONE, TILE_M["stone"], skip=("+z",))

    # ---- battens ------------------------------------------------------------
    # Over every board joint, which on a rope house is what keeps the weather out
    # of a wall made of loose vertical boards.
    def battens(along_x, fixed0, fixed1, count):
        span = (length if along_x else depth) - 2.0 * BATTEN
        for index in range(count + 1):
            centre = -span / 2.0 + span * index / count
            a, b = centre - 0.045, centre + 0.045
            if along_x:
                lo, hi = (a, fixed0, SILL), (b, fixed1, wall_top)
            else:
                lo, hi = (fixed0, a, SILL), (fixed1, b, wall_top)
            # The door is a hole; a batten across it is a stripe in mid air.
            if along_x and fixed1 > 0 and not (b < door_x[0] or a > door_x[1]):
                lo = (lo[0], lo[1], door_top)
            add_box(
                mesh,
                uv_layer,
                lo,
                hi,
                BOARD,
                board_tile,
                skip=("+z", "-z"),
                tile_v=board_tile_v,
                uv_offset=(0.0, -SILL / board_tile_v),
            )

    battens(True, hy - BATTEN, hy, 12)
    battens(True, -hy, -hy + BATTEN, 12)
    battens(False, -hx, -hx + BATTEN, 6)
    battens(False, hx - BATTEN, hx, 6)

    # ---- the ledgers --------------------------------------------------------
    for rail_z in rails:
        for x0, x1, y0, y1 in (
            (-hx + BATTEN, hx - BATTEN, hy - BATTEN - 0.02, hy),
            (-hx + BATTEN, hx - BATTEN, -hy, -hy + BATTEN + 0.02),
            (-hx, -hx + BATTEN + 0.02, -hy + BATTEN, hy - BATTEN),
            (hx - BATTEN - 0.02, hx, -hy + BATTEN, hy - BATTEN),
        ):
            # Not across the doorway.
            if y1 >= hy and not (x1 < door_x[0] or x0 > door_x[1]) and rail_z < door_top:
                for a, b in ((x0, door_x[0]), (door_x[1], x1)):
                    if b > a:
                        add_box(
                            mesh, uv_layer,
                            (a, y0, rail_z - 0.075), (b, y1, rail_z + 0.075),
                            BOARD, board_tile, tile_v=board_tile_v,
                        )
                continue
            add_box(
                mesh, uv_layer,
                (x0, y0, rail_z - 0.075), (x1, y1, rail_z + 0.075),
                BOARD, board_tile, tile_v=board_tile_v,
            )

    # ---- the door head ------------------------------------------------------
    # A cart door into a rope house had a heavy timber head over it. Inside the
    # footprint, so it costs nothing at the box.
    add_box(
        mesh,
        uv_layer,
        (door_x[0] - 0.12, inner_y1 - 0.02, door_top),
        (door_x[1] + 0.12, hy, door_top + 0.26),
        BOARD,
        board_tile,
    )

    # ---- the roof -----------------------------------------------------------
    # Lead, not shingle, and for the reason the gambrel walk gives: shingles will
    # not hold on a deck this shallow, and the mission's own roof decks put this
    # one dead flat at 8.60. Laid as the four plates the four decks are, so the
    # hatch the player drops through is a hole in the art and not just in the
    # collision.
    plates = [
        (-hx, hatch_x[0], -hy, hy),
        (hatch_x[1], hx, -hy, hy),
        (hatch_x[0], hatch_x[1], -hy, hatch_y[0]),
        (hatch_x[0], hatch_x[1], hatch_y[1], hy),
    ]
    # A longer tile than the gambrel's, because this deck is 220 square metres
    # rather than 26 and the lead tile's own light and dark patches read as a
    # chequerboard when they repeat fourteen times across a roof.
    roof_tile = TILE_M["lead"] * 1.75
    for x0, x1, y0, y1 in plates:
        add_box(mesh, uv_layer, (x0, y0, height - ROOF_T), (x1, y1, height), LEAD, roof_tile)

    # Lead rolls across the fall, one per bay, kept clear of the hatch. Every
    # millimetre of them is BELOW 8.60, because the roof is a surface the player
    # runs across and anything standing proud of it is a trip in the art that the
    # collision does not have.
    bays = max(4, int(round(length / 2.2)))
    for bay in range(1, bays):
        x = -hx + length * bay / bays
        if hatch_x[0] - 0.2 < x < hatch_x[1] + 0.2:
            continue
        half = 0.05
        steps = 6
        rows = []
        for step in range(steps + 1):
            t = step / steps
            dx = -half + 2.0 * half * t
            # A hollow rather than a roll: a dressed lead joint, taken downward.
            z = height - 0.012 * math.sin(math.pi * t) ** 0.7
            rows.append([Vector((x + dx, -hy, z)), Vector((x + dx, hy, z))])
        add_grid(mesh, uv_layer, rows, LEAD, roof_tile)

    # ---- inside: the roof structure ----------------------------------------
    # Joists on the underside, so a player on the tie beam in the dark is under a
    # roof rather than under a plane. Cheap and it is the only thing above the
    # beam they can see.
    joists = max(6, int(round(length / 1.9)))
    for index in range(joists):
        x = -hx + wall_t + (length - 2.0 * wall_t) * (index + 0.5) / joists
        if hatch_x[0] - 0.1 < x < hatch_x[1] + 0.1:
            continue
        add_box(
            mesh,
            uv_layer,
            (x - 0.07, inner_y0, height - ROOF_T - 0.22),
            (x + 0.07, inner_y1, height - ROOF_T),
            BOARD,
            board_tile,
            skip=("+z",),
        )

    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    return finish(
        mesh, key, [board, lead, stone], box, exact_z=True, out_name=f"{key}.glb"
    )


# ---------------------------------------------------------------------------
# 6. roof-ridge-monitor — three metres of meeting house the meeting house cannot draw
# ---------------------------------------------------------------------------
# MEETING_RIDGE is a walkable plane at 11.20m on a building whose collision mass
# stops at 8.20m. A single-entry cluster takes its draw box from its OWN
# collision, so `bldg-meeting-hollis` is drawn to 8.20 and no roof art on it can
# reach the walk; `roof-ridge-walk` cannot close the gap either, because it is
# 42mm of leaded flat and did exactly what it was built to do — put its boards ON
# the plane, with three metres of sky underneath them.
#
# So the gap is filled with a raised monitor, which is what a New England meeting
# house put over its roof to light and vent the hall: a louvred timber lantern
# the length of the ridge with a leaded walk on top for the plumber. 2.8m deep on
# an 8.6m building reads as a monitor rather than as a full gambrel, which is the
# trade the owner took.
#
# The whole vertical budget is spent DOWNWARD from the plane, the same discipline
# the plank and the fire board follow and for the same reason: `drawBox` hangs a
# lone deck's dressing by its declared `standableAt`, so the mesh's top face is
# the plane and everything else is under the boot. Nothing may stand above it —
# no parapet, no ridge cresting, no finial — because the box top IS 11.20m and
# anything over it is a metre of monitor drawn below where the player walks.


def build_ridge_monitor():
    key = "roof-ridge-monitor"
    box = draw_box(key)
    length, height, depth = box[0], box[1], box[2]
    new_scene()
    lead, _ = load_material("lead", 1024)
    plank, plank_image = load_material("plank", 1024)
    board, _ = load_material("board-ropewalk", 1024)
    bands = plank_bands(plank_image)
    LEAD, PLANK, BOARD = 0, 1, 2

    mesh = bmesh.new()
    uv_layer = mesh.loops.layers.uv.new("UVMap")

    hx, hy = length / 2.0, depth / 2.0
    # Read bottom to top, these are a flashed kerb, a sill, the louvred housing,
    # a boxed cornice, and 30mm of leadwork. Only the last of those is inside the
    # tolerance the probe measures; the rest is what the thing looks like from
    # the roof below, which is the whole point of building it at all.
    APRON_Z = 0.16
    SILL_Z = 0.34
    EAVES_Z = height - 0.62
    CORNICE_Z = height - 0.30
    LEAD_Z = height - 0.03
    # How far the louvred housing is set back from the plan on x. The cornice is
    # full width, so this is the shadow line that makes the monitor a built thing
    # rather than an extruded rectangle.
    BODY_IN = 0.17

    # WHY THE HOUSING IS ONLY THE SOUTHERN HALF OF THE DEPTH
    # -----------------------------------------------------
    # The deck this dresses is 2.8m deep and its plane is at 11.20m, but the roof
    # UNDER it at 8.20m is walked: `D_MEETING_ROOF` stands at world z 9.00 and
    # `E_GAMBREL_S` at 10.20, both inside this footprint, and both are the foot of
    # a climb up onto the walk. The first build filled all 2.8m solid, and the
    # frame from E_GAMBREL_S — the owner's own named vantage — came back with the
    # player standing INSIDE the louvres.
    #
    # No solid form based at 8.20 and full-depth at 11.20 can leave headroom over
    # z=9.00: a body standing there needs 1.9m of it 1.4m in from the north edge,
    # and even a vertical face set back that far is a cantilever wider than what
    # is left holding it up. So the monitor is what it would really have been on a
    # roof with a walk on it — a louvred vent housing along the SOUTH side, and
    # the rest of the walk carried on posts and joists over open air. The player
    # arrives beside a post at the head of the climb instead of inside a wall.
    #
    # The leadwork above stays full-depth, and that half is not negotiable: the
    # probe rays a 21 x 21 grid over the whole 9.4 x 2.8 rect at 11.20m.
    #
    # WHICH SIDE IS NORTH. The exporter maps Blender +Y to game -Z, so the game's
    # NORTH — the side both route nodes stand on — is Blender -Y. The first
    # attempt at this put the housing on -Y by name and built it on the wrong
    # side of the walk; the frame from E_GAMBREL_S came back identical to the
    # solid version, which is the only reason it was caught. Every edge below is
    # therefore named for the game direction, never for the Blender sign.
    HOUSING_D = 1.30
    SOUTH_Y = hy               # game z 7.60, the far side from the route
    HOUSE_Y = hy - HOUSING_D   # game z 8.90, the housing's north face
    NORTH_Y = -hy              # game z 10.40, the walk's outer edge
    POST = 0.075

    # The flashed apron where the housing meets the meeting house's lead flat at
    # 8.20m. Under the housing only: full depth here would be a 160mm lead kerb
    # under the feet of both nodes standing on the roof in front of it.
    add_box(mesh, uv_layer, (-hx, HOUSE_Y - 0.10, 0.0), (hx, SOUTH_Y, APRON_Z), LEAD,
            TILE_M["lead"], skip=("-z",))
    # The oak sill the frame is tenoned into, weathered on top so the apron sheds.
    add_box(mesh, uv_layer, (-hx + 0.05, HOUSE_Y - 0.05, APRON_Z),
            (hx - 0.05, SOUTH_Y - 0.05, SILL_Z), BOARD, TILE_M["board-ropewalk"],
            skip=("-z",))

    # The body behind the louvres, boarded and in shadow. Solid rather than open:
    # the runtime draws single-sided, so an open lantern is a hole you can see
    # the inside of the far wall through from every angle the route uses.
    core_x = hx - BODY_IN - 0.11
    add_box(mesh, uv_layer, (-core_x, HOUSE_Y + 0.11, SILL_Z),
            (core_x, SOUTH_Y - BODY_IN - 0.11, EAVES_Z),
            BOARD, TILE_M["board-ropewalk"], skip=("+z", "-z"),
            tile_v=(EAVES_Z - SILL_Z))

    # Corner posts and mullions, dividing the housing into bays. Six along the
    # length: on a 9.4m monitor that is a 1.5m bay, which is the panel a pair of
    # hands could louvre.
    frame_x = hx - BODY_IN
    frame_far, frame_near = SOUTH_Y - BODY_IN, HOUSE_Y
    long_bays = 6
    stiles_x = [-frame_x + (2.0 * frame_x) * i / long_bays for i in range(long_bays + 1)]
    for x in stiles_x:
        for y in (frame_far, frame_near):
            add_box(mesh, uv_layer, (x - POST, y - POST, SILL_Z), (x + POST, y + POST, EAVES_Z),
                    BOARD, TILE_M["board-ropewalk"], skip=("+z", "-z"),
                    tile_v=(EAVES_Z - SILL_Z))

    # The louvres. Blades at a 0.17m pitch, each projecting 0.10m out of the
    # frame and dropping 0.055 across that projection — enough tilt to throw a
    # shadow line under every blade, which is the only thing that reads at night.
    PITCH, THICK, PROJ, DROP = 0.17, 0.032, 0.10, 0.055
    top_blade = EAVES_Z - 0.06
    blades = int((top_blade - SILL_Z - 0.08) / PITCH)
    for index in range(blades):
        z = SILL_Z + 0.08 + (index + 1) * PITCH
        for bay in range(long_bays):
            x = (stiles_x[bay] + POST, stiles_x[bay + 1] - POST)
            add_slat(mesh, uv_layer, x, (frame_far, frame_far + PROJ), z, z - DROP, THICK,
                     1, PLANK, TILE_M["plank"])
            add_slat(mesh, uv_layer, x, (frame_near - PROJ, frame_near), z - DROP, z, THICK,
                     1, PLANK, TILE_M["plank"])
        y = (frame_near + POST, frame_far - POST)
        add_slat(mesh, uv_layer, (frame_x, frame_x + PROJ), y, z, z - DROP, THICK,
                 0, PLANK, TILE_M["plank"])
        add_slat(mesh, uv_layer, (-frame_x - PROJ, -frame_x), y, z - DROP, z, THICK,
                 0, PLANK, TILE_M["plank"])

    # The open half: posts on the walk's north edge carrying it, with a joist
    # back to the housing over each one. Everything else here lives in the top
    # 0.6m so a standing body passes under it, which is the whole reason this
    # half is open at all.
    for x in stiles_x:
        add_box(mesh, uv_layer, (x - POST, NORTH_Y, 0.0), (x + POST, NORTH_Y + 2.0 * POST, EAVES_Z),
                BOARD, TILE_M["board-ropewalk"], skip=("+z",),
                tile_v=EAVES_Z)
        add_box(mesh, uv_layer, (x - 0.055, NORTH_Y, EAVES_Z - 0.19),
                (x + 0.055, HOUSE_Y, EAVES_Z), BOARD, TILE_M["board-ropewalk"],
                skip=("+z",))

    # The cornice, full plan and full depth, on a bed mould stepped back to the
    # frame. It oversails by BODY_IN, which throws the whole side into shadow
    # from below — the one elevation of this object anybody looks at from the
    # street is the underside of this.
    add_box(mesh, uv_layer, (-hx + 0.09, -hy + 0.09, EAVES_Z - 0.10),
            (hx - 0.09, hy - 0.09, EAVES_Z + 0.02), BOARD, TILE_M["board-ropewalk"],
            skip=("+z", "-z"))
    add_box(mesh, uv_layer, (-hx, -hy, EAVES_Z + 0.02), (hx, hy, CORNICE_Z),
            BOARD, TILE_M["board-ropewalk"], skip=("+z", "-z"))

    # The leadwork, and the only 30mm of this object the route can feel. Same
    # section as the gambrel walk it replaces: sheets seamed over rolls, a walk
    # down the spine, and a flush gutter round the edge that carries the probe's
    # outermost ray. Everything is AT the plane or below it, never over.
    add_box(mesh, uv_layer, (-hx, -hy, CORNICE_Z), (hx, hy, LEAD_Z), LEAD,
            TILE_M["lead"], skip=("-z",))
    GUTTER = 0.24
    for lo, hi in ((-hy, -hy + GUTTER), (hy - GUTTER, hy)):
        add_box(mesh, uv_layer, (-hx, lo, LEAD_Z), (hx, hi, height), LEAD, TILE_M["lead"])
    for lo, hi in ((-hx, -hx + GUTTER), (hx - GUTTER, hx)):
        add_box(mesh, uv_layer, (lo, -hy + GUTTER, LEAD_Z), (hi, hy - GUTTER, height),
                LEAD, TILE_M["lead"])

    flat_x, flat_y = hx - GUTTER, hy - GUTTER
    rolls = max(2, int(round((2.0 * flat_x) / 1.05)))
    for index in range(1, rolls):
        x = -flat_x + (2.0 * flat_x) * index / rolls
        add_box(mesh, uv_layer, (x - 0.055, -flat_y, LEAD_Z), (x + 0.055, flat_y, height),
                LEAD, TILE_M["lead"])

    WALK_HALF = 0.33
    walk_boards = 3
    walk_gap = 0.008
    board_w = (2.0 * WALK_HALF - walk_gap * (walk_boards - 1)) / walk_boards
    for index in range(walk_boards):
        y0 = -WALK_HALF + index * (board_w + walk_gap)
        y1 = y0 + board_w
        strip = bands[RNG.randrange(len(bands))]
        offset = RNG.uniform(0.0, 1.0)
        before = len(mesh.faces)
        add_box(mesh, uv_layer, (-flat_x, y0, LEAD_Z), (flat_x, y1, height), PLANK,
                TILE_M["plank"], skip=("-z",))
        mesh.faces.ensure_lookup_table()
        for face in list(mesh.faces)[before:]:
            for vertex_loop in face.loops:
                point = vertex_loop.vert.co
                across = (point[1] - y0) / max(y1 - y0, 1e-6)
                vertex_loop[uv_layer].uv = (
                    strip[0] + across * (strip[1] - strip[0]),
                    point[0] / TILE_M["plank"] + offset,
                )

    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    return finish(mesh, key, [lead, plank, board], box, exact_z=True, out_name=f"{key}.glb")


# ---------------------------------------------------------------------------
# 7. printshop-sign-hood — the catch outside Edes & Gill
# ---------------------------------------------------------------------------
# 50mm, and all of it board. PRINTSHOP_SIGN is a lone DECK at 6.20m declared
# 0.05m tall and standable at 0.05, so `drawBox` boxes it 3.20 x 0.05 x 1.40 and
# hangs it at 6.15: the mesh's top face IS the surface the player lands on and
# there are fifty millimetres underneath it for the whole object.
#
# That rules out the shape the name suggests. A hood with a sign swinging under
# it needs a metre of pendant, and a pendant inside this box would put its own
# bottom on the box floor and lift the boarding 400mm above the catch — which is
# precisely the defect `printshop-hanging-sign` shipped, arrived at from the
# other direction. So the sign is the hood's painted soffit, the boards run out
# from the wall the way a hood's boards do, and the fascia takes the front edge.


def build_sign_hood():
    key = "printshop-sign-hood"
    box = draw_box(key)
    length, thick, depth = box[0], box[1], box[2]
    new_scene()
    plank, plank_image = load_material("plank", 512)
    board, _ = load_material("board-ropewalk", 512)
    bands = plank_bands(plank_image)
    PLANK, BOARD = 0, 1

    mesh = bmesh.new()
    uv_layer = mesh.loops.layers.uv.new("UVMap")
    hx, hy = length / 2.0, depth / 2.0

    # The soffit: one continuous painted board under everything, which is what
    # the sign is. It also closes the underside, so nothing here is a one-sided
    # sheet seen from the street below, and it is what shows through the 6mm
    # gaps between the boards rather than the inside of the hood.
    SOFFIT = 0.012
    BOARD_BASE = 0.009
    add_box(mesh, uv_layer, (-hx, -hy, 0.0), (hx, hy, SOFFIT), BOARD,
            TILE_M["board-ropewalk"])

    # The boarding, running OUT from the wall rather than along it — which is how
    # a hood is boarded, because that is the way the water has to go. Twelve
    # boards on a 3.2m frontage is a nine-inch board.
    count = 12
    gap = 0.006
    widths = [1.0 + RNG.uniform(-0.07, 0.07) for _ in range(count)]
    total = (length - gap * (count - 1)) / sum(widths)
    widths = [w * total for w in widths]
    FASCIA = 0.075
    CUP = 0.0035
    NSEG = 6

    x = -hx
    for index, width in enumerate(widths):
        x0, x1 = x, x + width
        x = x1 + gap
        strip = bands[RNG.randrange(len(bands))]
        offset = RNG.uniform(0.0, 1.0)
        # Cupped across the board and sagging a hair towards the fascia. Both
        # only ever take the surface DOWN: every millimetre upward is spent out
        # of a 50mm ceiling that is also the plane the player lands on.
        rows_top, rows_bottom = [], []
        for j in range(NSEG + 1):
            tv = j / NSEG
            y = -hy + (2.0 * hy - FASCIA) * tv
            row_top, row_bottom = [], []
            for i in range(NSEG + 1):
                tu = i / NSEG
                cup = CUP * (1.0 - (2.0 * tu - 1.0) ** 2)
                sag = 0.0022 * tv * tv
                row_top.append(Vector((x0 + (x1 - x0) * tu, y, thick - cup - sag)))
                row_bottom.append(Vector((x0 + (x1 - x0) * tu, y, BOARD_BASE)))
            rows_top.append(row_top)
            rows_bottom.append(row_bottom)

        def hood_uv(point, strip=strip, offset=offset, x0=x0, x1=x1):
            across = (point[0] - x0) / max(x1 - x0, 1e-6)
            return (strip[0] + across * (strip[1] - strip[0]),
                    point[1] / TILE_M["plank"] + offset)

        for rows, flip in ((rows_top, False), (rows_bottom, True)):
            verts = [[mesh.verts.new(point) for point in row] for row in rows]
            for j in range(len(rows) - 1):
                for i in range(len(rows[0]) - 1):
                    loop = [verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]]
                    if flip:
                        loop.reverse()
                    face = mesh.faces.new(loop)
                    face.material_index = PLANK
                    for vertex_loop in face.loops:
                        vertex_loop[uv_layer].uv = hood_uv(vertex_loop.vert.co)
        # The four sawn edges, so a probe ray cannot fall down the side of a board.
        for side in ("x0", "x1", "y0", "y1"):
            if side in ("y0", "y1"):
                j = 0 if side == "y0" else NSEG
                pairs = [(rows_top[j][i], rows_bottom[j][i]) for i in range(NSEG + 1)]
            else:
                i = 0 if side == "x0" else NSEG
                pairs = [(rows_top[j][i], rows_bottom[j][i]) for j in range(NSEG + 1)]
            ring = pairs if side in ("y1", "x0") else list(reversed(pairs))
            for a, b in zip(ring, ring[1:]):
                face = mesh.faces.new([
                    mesh.verts.new(a[0]), mesh.verts.new(b[0]),
                    mesh.verts.new(b[1]), mesh.verts.new(a[1]),
                ])
                face.material_index = PLANK
                for vertex_loop in face.loops:
                    vertex_loop[uv_layer].uv = hood_uv(vertex_loop.vert.co)

    # The fascia along the front edge, flush with the boarding's top so the hood
    # measures its full 1.4m and the runner meets one surface rather than a lip.
    add_box(mesh, uv_layer, (-hx, hy - FASCIA, BOARD_BASE), (hx, hy, thick), BOARD,
            TILE_M["board-ropewalk"])

    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    return finish(mesh, key, [plank, board], box, exact_z=True, out_name=f"{key}.glb")


# ---------------------------------------------------------------------------
# 8. bldg-scaffold-run — eleven metres of staging on the Town House's west front
# ---------------------------------------------------------------------------
# SCAFFOLD_D1 and SCAFFOLD_D2 share a footprint exactly, so the level's own
# clusterer makes them one object and `drawBox` takes the several-entry branch:
# the box is the DECLARED 2.5 x 5.6 x 11.3 and the base is the top plane less the
# height, which puts the scaffold on the street at y=0. Both staging planes are
# therefore inside one mesh, at 2.90 and at 5.60, and 5.60 is also the top of the
# bounding box — so the upper boards are the last thing in the object and nothing
# may be built over them. That is why there is no guard rail on the top lift.
#
# Where the bounding box is pinned matters here more than usual, because the
# obvious answer is wrong. Pinning the 2.5m width with the STANDARDS would need
# an octagonal pole's silhouette to land exactly on a coordinate, which depends
# on its rotation; the PUTLOGS are square-ended and span the full width by
# definition, so they pin it exactly and the standards stay comfortably inboard.
# The boards then run between the standards, with the gap a scaffold board really
# does leave where a standard passes it.


def build_scaffold_run():
    key = "bldg-scaffold-run"
    box = draw_box(key)
    across, height, run = box[0], box[1], box[2]
    new_scene()
    plank, plank_image = load_material("plank", 1024)
    board, _ = load_material("board-ropewalk", 1024)
    bands = plank_bands(plank_image)
    PLANK, BOARD = 0, 1
    pole_tile = TILE_M["board-ropewalk"]

    mesh = bmesh.new()
    uv_layer = mesh.loops.layers.uv.new("UVMap")
    hx, hy = across / 2.0, run / 2.0

    # The two authored planes, read off the hull rather than transcribed.
    decks = sorted(deck["y"] for deck in HULL[key]["decks"])
    assert len(decks) == 2, f"{key}: expected two staging planes, got {decks}"
    assert abs(decks[-1] - height) < 1e-6, (
        f"{key}: the top staging is at {decks[-1]:.3f} but the box top is "
        f"{height:.3f}; the upper boards have to BE the top of the mesh"
    )
    log(f"{key}: staging at {', '.join(f'{d:.2f}' for d in decks)}m over a "
        f"{run:.2f}m run, {across:.2f}m out from the wall")

    BOARD_T = 0.045
    STANDARD_R = 0.052
    LEDGER_R = 0.045
    PUTLOG_R = 0.050
    # Standards inboard of the box by their own radius plus a hair, so the pole
    # cannot be what decides the width whichever way its octagon happens to sit.
    row_x = hx - STANDARD_R - 0.010
    bays = 6
    # Inset by the standard's own radius at both ends, for the same reason the
    # rows are: a pole centred ON the boundary reaches half its girth past it,
    # and `finish` would then shrink the whole scaffold by that much to fit.
    end = STANDARD_R + 0.010
    bay_y = [-hy + end + (run - 2.0 * end) * i / bays for i in range(bays + 1)]

    # Sole boards under each row of standards. A scaffold on a street stood on
    # timber, not on the cobbles, and it also puts something at ground level for
    # the eye to end on. CLAMPED to the box: a 0.28m board centred on a standard
    # 0.062m inside the edge reaches 0.078m past it, and `finish` answers an
    # overrun by shrinking the whole scaffold — the first build of this came out
    # trued by 0.94127 on x for exactly that, which is 150mm of staging width
    # lost to a sole board nobody would have looked at.
    for sign in (-1.0, 1.0):
        add_box(mesh, uv_layer,
                (max(sign * row_x - 0.14, -hx), -hy, 0.0),
                (min(sign * row_x + 0.14, hx), hy, 0.05),
                BOARD, pole_tile)

    for y in bay_y:
        for sign in (-1.0, 1.0):
            add_strut(mesh, uv_layer, (sign * row_x, y, 0.02), (sign * row_x, y, height),
                      STANDARD_R, BOARD, pole_tile)

    # Lifts of ledgers along the run, inside the standards. Two carry staging and
    # two are the intermediate lifts that make it read as a frame rather than as
    # two shelves on posts.
    ledger_z = []
    for plane in decks:
        ledger_z.append(plane - BOARD_T - 2.0 * PUTLOG_R - LEDGER_R)
    ledger_z.append(decks[0] / 2.0)
    ledger_z.append((decks[0] + decks[1]) / 2.0 + 0.15)
    for z in ledger_z:
        for sign in (-1.0, 1.0):
            add_strut(mesh, uv_layer, (sign * row_x, -hy, z), (sign * row_x, hy, z),
                      LEDGER_R, BOARD, pole_tile)

    # Putlogs across the width at every standard, carrying the boards. These are
    # the members that reach the full 2.5m, and the assertion in `finish` is what
    # proves they did.
    for plane in decks:
        z = plane - BOARD_T - PUTLOG_R
        for y in bay_y:
            add_strut(mesh, uv_layer, (-hx, y, z), (hx, y, z), PUTLOG_R, BOARD, pole_tile)
        # One extra putlog mid-bay: a 1.9m span of nine-inch board on its own
        # bounces, and a bouncing board is not a thing a level walks on.
        for index in range(bays):
            y = (bay_y[index] + bay_y[index + 1]) / 2.0
            add_strut(mesh, uv_layer, (-hx, y, z), (hx, y, z), PUTLOG_R, BOARD, pole_tile)

    # Ledger braces on the street face, zig-zagging the length of the run. This
    # is the single detail that separates scaffolding from a pile of poles.
    #
    # Held clear of the box top by the brace's own girth. `add_strut` caps a
    # timber square to its RUN, so a diagonal one ending exactly on 5.60 puts
    # half its thickness through the plane — 22mm of pole standing over the
    # staging, and 22mm that `finish` would take off the whole scaffold's height.
    BRACE_R = LEDGER_R * 0.85
    for index in range(0, bays, 2):
        y0, y1 = bay_y[index], bay_y[min(index + 2, bays)]
        add_strut(mesh, uv_layer, (-row_x, y0, 0.07), (-row_x, y1, decks[0]),
                  BRACE_R, BOARD, pole_tile, sides=6)
        add_strut(mesh, uv_layer, (-row_x, y1, decks[0]), (-row_x, y0, height - 2.0 * BRACE_R),
                  BRACE_R, BOARD, pole_tile, sides=6)

    # The staging. Boards between the standards, so the gap a standard needs is
    # where a standard is; the putlogs under them already reach the box edge.
    field = row_x - STANDARD_R - 0.015
    count = 5
    gap = 0.010
    width = (2.0 * field - gap * (count - 1)) / count
    for plane in decks:
        for index in range(count):
            x0 = -field + index * (width + gap)
            x1 = x0 + width
            strip = bands[RNG.randrange(len(bands))]
            offset = RNG.uniform(0.0, 1.0)
            before = len(mesh.faces)
            add_box(mesh, uv_layer, (x0, -hy, plane - BOARD_T), (x1, hy, plane),
                    PLANK, TILE_M["plank"])
            mesh.faces.ensure_lookup_table()
            for face in list(mesh.faces)[before:]:
                for vertex_loop in face.loops:
                    point = vertex_loop.vert.co
                    across_board = (point[0] - x0) / max(x1 - x0, 1e-6)
                    vertex_loop[uv_layer].uv = (
                        strip[0] + across_board * (strip[1] - strip[0]),
                        point[1] / TILE_M["plank"] + offset,
                    )

    # The ladders, at the end of the run the route actually climbs.
    # C_SCAFF_FOOT, C_SCAFF_1 and C_SCAFF_2 all stand at world z = -6.4, which is
    # 4.35m from the object's centre — and the exporter maps Blender Y to game Z
    # with the sign flipped, so that end of the run is +y HERE. Getting that
    # backwards would have put the only way up at the wrong end of eleven metres
    # of staging, which the probe cannot see and the player cannot miss.
    #
    # Each ladder stops FLUSH with the staging it serves rather than projecting
    # the metre a real one would: a stile standing proud of SCAFFOLD_D1 is a pole
    # through the plane the player walks on.
    ladder_y = bay_y[bays] - (bay_y[bays] - bay_y[bays - 1]) * 0.62
    for base, top in ((0.02, decks[0]), (decks[0], decks[1])):
        lean = -row_x + STANDARD_R + 0.09
        for sign in (-1.0, 1.0):
            # Stopped 5mm under the landing. A leaning stile's cap is square to
            # its own run, so its far corner sits a millimetre above the end
            # point — and a millimetre over 5.60 is a millimetre `finish` takes
            # off the whole scaffold, which moves the staging off its plane.
            add_strut(mesh, uv_layer,
                      (lean + 0.10, ladder_y + sign * 0.22, base),
                      (lean, ladder_y + sign * 0.22, top - 0.005),
                      0.030, BOARD, pole_tile, sides=6)
        rungs = max(3, int((top - base) / 0.30))
        for index in range(1, rungs):
            t = index / rungs
            z = base + (top - base) * t
            x = lean + 0.10 * (1.0 - t)
            add_strut(mesh, uv_layer, (x, ladder_y - 0.22, z), (x, ladder_y + 0.22, z),
                      0.021, BOARD, pole_tile, sides=6)

    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    return finish(mesh, key, [plank, board], box, exact_z=True, out_name=f"{key}.glb")


# ---------------------------------------------------------------------------
# 9. yard-kerb-stone — the kerb round the Dock Square pump yard
# ---------------------------------------------------------------------------
# 0.34m of dressed granite, and the one asset in this wave whose predecessor was
# not merely the wrong shape: `colonial-yard-perimeter` is a road-kit GROUND
# PLATE of 226.00 x 0.08 x 20.00, so the contain-fit came out at 0.0248 and drew
# two millimetres of paving lying in the road where the level says there is a
# step. Nothing about a ground plate can be a raised edge.
#
# PUMP_KERB is a landable MASS, so what matters is that the top is flat AT 0.34
# over essentially the whole footprint. The arris is chamfered, which is what a
# dressed kerb has and is also free: a chamfer only ever takes the surface down,
# and 22mm is two orders inside the 0.35m the probe and the reader both allow.


def build_kerb_stone():
    key = "yard-kerb-stone"
    box = draw_box(key)
    length, height, depth = box[0], box[1], box[2]
    new_scene()
    stone, _ = load_material("stone", 1024)
    tile = TILE_M["stone"]
    STONE = 0

    mesh = bmesh.new()
    uv_layer = mesh.loops.layers.uv.new("UVMap")
    hx, hy = length / 2.0, depth / 2.0

    # The bedding course, full plan: it pins the bounding box on both horizontals
    # and it is the horizontal joint line that makes the kerb read as two courses
    # of stone rather than as one extruded block.
    BED_Z = 0.095
    add_box(mesh, uv_layer, (-hx, -hy, 0.0), (hx, hy, BED_Z), STONE, tile, skip=("-z",))

    # Four kerbstones on it, 1.4m apiece, which is the length one team could set.
    # Jointed rather than butted: the joints are cut back to the bedding course,
    # 0.245m down, which is well inside the step-down and is a shadow line the
    # eye reads as masonry at any distance.
    stones = 4
    JOINT = 0.014
    CHAMFER = 0.022
    width = (length - JOINT * (stones - 1)) / stones

    # The joints, RAKED rather than open. An open joint is a 14mm slot straight
    # down to the bedding course, and the probe's 21-sample column at x=0 lands
    # exactly on the middle one: it would still count, because 245mm is inside
    # the 350mm step-down, but a slot the width of a finger through a kerb is
    # not what a jointed kerb looks like either. 18mm of rake reads as a joint
    # and measures as the stone.
    for index in range(stones - 1):
        x0 = -hx + (index + 1) * width + index * JOINT
        add_box(mesh, uv_layer, (x0, -hy, BED_Z - 0.01), (x0 + JOINT, hy, height - 0.018),
                STONE, tile, skip=("-z",))

    for index in range(stones):
        x0 = -hx + index * (width + JOINT)
        x1 = x0 + width
        # A hand-set stone settles. Only ever downwards, and by a couple of
        # millimetres: this is the difference between granite and an extrusion,
        # and it costs nothing against a 0.35m tolerance. The two END stones do
        # not settle, because they are what pins the mesh's height to 0.34.
        settle = 0.0 if index in (0, stones - 1) else RNG.uniform(0.0, 0.004)
        top = height - settle
        add_box(mesh, uv_layer, (x0, -hy, BED_Z - 0.01), (x1, hy, top - CHAMFER),
                STONE, tile, skip=("+z", "-z"))
        # The weathered arris: a real chamfer, cut by pulling the cap's top pair
        # of edges in off its bottom pair. Both long edges, because the pump yard
        # is walked from the square on one side and from the well on the other.
        corners = {}
        for i in (0, 1):
            for j in (0, 1):
                for k in (0, 1):
                    corners[(i, j, k)] = Vector((
                        x0 if i == 0 else x1,
                        (-hy if j == 0 else hy) + (CHAMFER if j == 0 else -CHAMFER) * k,
                        top - CHAMFER if k == 0 else top,
                    ))
        add_solid(mesh, uv_layer, corners, STONE, tile, uv_axes=(0, 1))

    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    return finish(mesh, key, [stone], box, exact_z=True, out_name=f"{key}.glb")


BUILDERS = {
    "roof-plank-gantry": build_gantry,
    "roof-ridge-walk": build_ridge_walk,
    "roof-ridge-monitor": build_ridge_monitor,
    "roof-chimney-stack": build_chimney,
    "service-wall-end": build_pier,
    "int-shell-ropewalk-a": build_ropewalk_shell,
    "printshop-sign-hood": build_sign_hood,
    "bldg-scaffold-run": build_scaffold_run,
    "yard-kerb-stone": build_kerb_stone,
}

for name, builder in BUILDERS.items():
    if WANTED and name not in WANTED:
        continue
    # A key the level has stopped drawing has no box to fit to, and `draw_box`
    # would reduce an empty list of sizes to a silent nan rather than to an
    # error. `roof-ridge-walk` is in exactly that state since MEETING_RIDGE was
    # re-keyed to `roof-ridge-monitor`: still declared, still shipped, drawn
    # nowhere. Skipping it loudly is the honest reading of that.
    if not HULL.get(name, {}).get("draws"):
        log(f"--- {name}: nothing in the level draws this key any more; skipped")
        continue
    log(f"--- {name}")
    builder()
log("done")
