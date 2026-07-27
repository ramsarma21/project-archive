# Reproducible albedo white-balance for the System presenter atlas.
#
# WHY THIS EXISTS
#   The Meshy-generated presenter atlas is heavily blue-cast (mean RGB ~88/140/167,
#   blue ~1.9x red). Warm scene/hologram lighting cannot rescue a blue albedo
#   (warm light x blue albedo = grey), so the face reads as a cyan-white wash with
#   no skin tone. This pass neutralises the cast on the *texture* so the baked
#   face/skin/lip detail survives under neutral or warm light, leaving the runtime
#   shader free to add cyan only at the rim/halo/room.
#
#   It is a pure image transform (sRGB bytes in, sRGB bytes out) so the correction
#   is easy to reason about and fully reproducible. No geometry or UV change.
#
# Method (per channel, von Kries gray-world + warm bias + highlight rolloff):
#   1. Scale R,G,B so their means match the overall mean (removes the global cast).
#   2. Apply a small warm bias (R up, B down) for skin warmth without going orange.
#   3. Soft-compress highlights so bright skin/hair does not hard-clip to 255.
#   4. Gentle S-curve for a little tonal dimension.
#
# Run:
#   python3 correct_presenter_albedo.py in.jpg out.jpg
import sys
import numpy as np
from PIL import Image

SRC = sys.argv[1]
DST = sys.argv[2]

# Warm bias applied on top of gray-world neutralisation. >1 warms, <1 cools.
WARM_R = float(sys.argv[3]) if len(sys.argv) > 3 else 1.06
WARM_B = float(sys.argv[4]) if len(sys.argv) > 4 else 0.93
# Highlight knee: values above this (0..1) get compressed toward 1 to avoid clip.
KNEE = float(sys.argv[5]) if len(sys.argv) > 5 else 0.80
CONTRAST = float(sys.argv[6]) if len(sys.argv) > 6 else 1.06
# Residual cool-cast suppression: how far to pull still-blue pixels (B>G) toward
# neutral after white balance. 0 = off, 1 = fully clamp B down to G. This removes
# the teal that survives in hair shadows and face/neck UV seams (which otherwise
# read as broken shards) without touching already-warm skin.
COOL_SUPPRESS = float(sys.argv[7]) if len(sys.argv) > 7 else 0.7

img = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float64) / 255.0

means = img.reshape(-1, 3).mean(axis=0)
target = float(means.mean())
scale = np.array([
    (target / means[0]) * WARM_R,
    (target / means[1]),
    (target / means[2]) * WARM_B,
])
out = img * scale

# Gentle S-curve contrast around mid grey for tonal dimension.
out = np.clip(out, 0.0, 4.0)
out = (out - 0.5) * CONTRAST + 0.5

# Soft highlight rolloff: smoothly compress the top end so bright skin/white hair
# rolls off instead of clipping to a flat 255.
def rolloff(x, knee):
    x = np.clip(x, 0.0, None)
    hi = x > knee
    # map [knee, inf) -> [knee, 1) with a smooth 1/(1+t) knee
    t = (x[hi] - knee) / (1.0 - knee)
    x[hi] = knee + (1.0 - knee) * (t / (1.0 + t))
    return x

out = rolloff(out, KNEE)
out = np.clip(out, 0.0, 1.0)

# Suppress residual teal/blue: where blue exceeds green (a cool pixel), pull blue
# down toward green. Skin/warm pixels (B<=G) are untouched, so this only cleans
# the cold shadow/seam pixels that read as broken shards under the hologram.
if COOL_SUPPRESS > 0.0:
    b = out[..., 2]
    g = out[..., 1]
    cool = b > g
    out[..., 2] = np.where(cool, b - (b - g) * COOL_SUPPRESS, b)

res = (out * 255.0 + 0.5).astype(np.uint8)
Image.fromarray(res, "RGB").save(DST, quality=92)

m2 = res.reshape(-1, 3).mean(axis=0)
clip = float((res >= 254).mean() * 100.0)
print("IN mean RGB  %.1f %.1f %.1f" % tuple(means * 255.0))
print("OUT mean RGB %.1f %.1f %.1f" % tuple(m2))
print("scale %.3f %.3f %.3f  clip%%=%.3f" % (scale[0], scale[1], scale[2], clip))
print("WROTE", DST)
