#!/usr/bin/env python3
# Paint a period meeting-house clock face (stone surround, pale dial, Roman
# numerals, hands) for the steeple tower — iconic Boston landmark detail as a
# texture on a proud stone panel (no fragile geometry).
# Usage: python3 clock_texture.py <out.png> [size]
import sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
S = int(sys.argv[2]) if len(sys.argv) > 2 else 768

FONTS = ["/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
         "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
         "/System/Library/Fonts/Supplemental/Georgia.ttf"]


def font(sz):
    for p in FONTS:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            continue
    return ImageFont.load_default()


rng = np.random.default_rng(5)
stone = np.array([0.60, 0.57, 0.51])[None, None, :] * (0.85 + 0.3 * rng.random((S, S, 1)))
img = Image.fromarray((np.clip(stone, 0, 1) * 255).astype(np.uint8))
d = ImageDraw.Draw(img)
c = S / 2
R = S * 0.40
d.ellipse([c - R, c - R, c + R, c + R], fill=(238, 234, 222), outline=(40, 35, 28), width=max(3, S // 90))
rin = R * 0.86
nums = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"]
f = font(int(S * 0.072))
for i, n in enumerate(nums):
    ang = math.radians(i * 30 - 90)
    x = c + rin * math.cos(ang); y = c + rin * math.sin(ang)
    bb = d.textbbox((0, 0), n, font=f)
    d.text((x - (bb[2] - bb[0]) / 2, y - (bb[3] - bb[1]) / 2 - bb[1]), n, font=f, fill=(30, 26, 20))
    # minute ticks
for i in range(60):
    ang = math.radians(i * 6 - 90)
    r0 = R * (0.93 if i % 5 else 0.88)
    d.line([c + r0 * math.cos(ang), c + r0 * math.sin(ang),
            c + R * 0.98 * math.cos(ang), c + R * 0.98 * math.sin(ang)],
           fill=(60, 52, 42), width=1 if i % 5 else 2)
# hands ~ 10:10 (classic)
for ang_deg, ln, w in ((-60, R * 0.5, max(4, S // 90)), (30, R * 0.72, max(3, S // 120))):
    a = math.radians(ang_deg)
    d.line([c, c, c + ln * math.cos(a), c + ln * math.sin(a)], fill=(20, 17, 12), width=w)
d.ellipse([c - S * 0.02, c - S * 0.02, c + S * 0.02, c + S * 0.02], fill=(20, 17, 12))
Image.fromarray(np.asarray(img)).save(out)
print("CLOCK", out)
