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


BUILDERS = {
    "roof-plank-gantry": build_gantry,
    "roof-ridge-walk": build_ridge_walk,
    "roof-chimney-stack": build_chimney,
    "service-wall-end": build_pier,
    "int-shell-ropewalk-a": build_ropewalk_shell,
}

for name, builder in BUILDERS.items():
    if WANTED and name not in WANTED:
        continue
    log(f"--- {name}")
    builder()
log("done")
