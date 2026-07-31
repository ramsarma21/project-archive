#!/usr/bin/env python3
# Crop tileable, lighting-flattened, seamless PBR-ish tiles from a concept photo,
# so a clean procedural mesh can wear the concept's real materials (brick/slate/
# timber/stone) and read PHOTOREAL while staying weld-clean + box-accurate.
# Meshy's own baked atlas is a shattered UV collage (unusable as a tile); the
# concept PNG is the real source.
#
# Usage: python3 make_photoreal_tiles.py <concept.png> <outdir>
import sys, os
import numpy as np
from PIL import Image, ImageFilter

CONCEPT = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
N = 1024

# (x0,y0,x1,y1) source rects in the 1536x1024 concept, chosen fronto-parallel and
# clear of windows/features where possible.
REGIONS = {
    "brick":  (1086, 196, 1176, 372),   # clean front-corner brick pier (front face)
    "slate":  (360, 60, 640, 150),      # main roof pitch behind the dormers
    "timber": (300, 838, 760, 905),     # weathered dock planking (horizontal)
    "stone":  (905, 150, 1180, 176),    # stone coping / string course band
}


def flatten_lighting(a, radius):
    """Divide out the low-frequency lighting gradient so the tile reads flat-lit."""
    img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    blur = np.asarray(img.filter(ImageFilter.GaussianBlur(radius)), np.float32) / 255.0
    blur = np.clip(blur, 1e-3, None)
    mean = blur.reshape(-1, 3).mean(0)[None, None, :]
    return np.clip(a / blur * mean, 0, 1)


def make_seamless(a, f):
    """Seamless via edge/interior blend: a is continuous in the interior, its
    half-rolled copy is continuous at the edges; blend by distance-to-edge."""
    n = a.shape[0]
    b = np.roll(np.roll(a, n // 2, 0), n // 2, 1)
    yy, xx = np.mgrid[0:n, 0:n]
    de = np.minimum(np.minimum(xx, n - 1 - xx), np.minimum(yy, n - 1 - yy)).astype(np.float32)
    w = np.clip(de / f, 0, 1)[..., None]
    return a * w + b * (1 - w)


def to_square(a):
    img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).resize((N, N), Image.LANCZOS)
    return np.asarray(img, np.float32) / 255.0


def normal_from(a, strength=3.0):
    g = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).convert("L"), np.float32) / 255.0
    gx = (np.roll(g, -1, 1) - np.roll(g, 1, 1)) * 0.5
    gy = (np.roll(g, -1, 0) - np.roll(g, 1, 0)) * 0.5
    nx, ny, nz = -gx * strength, -gy * strength, np.ones_like(g)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5], 2)


def rough_from(a, lo=0.72, hi=0.98):
    g = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).convert("L"), np.float32) / 255.0
    r = hi - (hi - lo) * (g - g.min()) / (g.max() - g.min() + 1e-6)
    return np.repeat(r[..., None], 3, 2)


src = Image.open(CONCEPT).convert("RGB")
for name, (x0, y0, x1, y1) in REGIONS.items():
    crop = np.asarray(src.crop((x0, y0, x1, y1)), np.float32) / 255.0
    a = to_square(crop)
    a = flatten_lighting(a, radius=N // 5)
    a = make_seamless(a, f=N // 6)
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, f"{name}.png"))
    Image.fromarray((normal_from(a, 3.0 if name in ("brick", "slate") else 2.0) * 255).astype(np.uint8)).save(
        os.path.join(OUT, f"{name}_n.png"))
    Image.fromarray((rough_from(a) * 255).astype(np.uint8)).save(os.path.join(OUT, f"{name}_r.png"))
    print("TILE", name, "from", (x1 - x0, y1 - y0))
print("DONE", OUT)
