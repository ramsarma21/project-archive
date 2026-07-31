#!/usr/bin/env python3
# Paint a weathered painted sign board (period serif, gilt-ish lettering on a dark
# board) for a warehouse/shop facade. Real signage the concept calls for, as a
# texture on a thin projecting board (no extra geometry risk).
# Usage: python3 sign_texture.py <out.png> "LINE 1" ["LINE 2"] [w] [h]
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
lines = [a for a in sys.argv[2:4] if not a.isdigit()]
W = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4].isdigit() else 1024
H = int(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5].isdigit() else 384

FONTS = [
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
    "/System/Library/Fonts/Supplemental/Baskerville.ttc",
    "/Library/Fonts/Georgia.ttf",
]


def load_font(size):
    for p in FONTS:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


# dark green-black board with grain
rng = np.random.default_rng(11)
board = np.array([0.06, 0.08, 0.06])[None, None, :] * (0.7 + 0.6 * rng.random((H, W, 1)))
board = np.clip(board + (rng.random((H, W, 1)) - 0.5) * 0.03, 0, 1)
img = Image.fromarray((board * 255).astype(np.uint8))
d = ImageDraw.Draw(img)
n = max(1, len(lines))
fs = int(H / (n * 1.7))
font = load_font(fs)
# shrink to fit the widest line within 86% of the board width
longest = max(lines, key=len) if lines else ""
for _ in range(40):
    bb = d.textbbox((0, 0), longest, font=font)
    if bb[2] - bb[0] <= 0.86 * W or fs <= 8:
        break
    fs = int(fs * 0.94); font = load_font(fs)
gilt = (206, 178, 108)
for i, line in enumerate(lines):
    bb = d.textbbox((0, 0), line, font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    x = (W - tw) / 2 - bb[0]
    y = (H * (i + 0.5) / n) - th / 2 - bb[1]
    d.text((x + 3, y + 3), line, font=font, fill=(0, 0, 0))          # shadow
    d.text((x, y), line, font=font, fill=gilt)                        # gilt letters
# a thin framing bead
d.rectangle([6, 6, W - 7, H - 7], outline=(150, 128, 78), width=4)
# weather: darken edges
arr = np.asarray(img, np.float32) / 255.0
yy, xx = np.mgrid[0:H, 0:W]
edge = np.minimum(np.minimum(xx, W - 1 - xx), np.minimum(yy, H - 1 - yy)) / (0.18 * min(W, H))
arr *= np.clip(0.6 + 0.4 * edge, 0, 1)[..., None]
Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).save(out)
print("SIGN", out, lines)
