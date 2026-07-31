#!/usr/bin/env python3
"""Inject correct tangent-space normal maps into a GLB.

WHY THIS EXISTS: Blender 5.1's glTF exporter writes normal-slot textures as pure
BLACK (proven: base-color images embed correctly, but any image linked through a
Normal Map node exports 0,0,0 regardless of colorspace / pack / save+reload /
keep-originals / NormalMap strength). A black normal decodes to (-1,-1,-1) and
makes three.js light the brick as if it faces away -> dark/unlit in-engine.

Rather than fight the broken writer, builders export BASE-COLOR-ONLY (which the
writer handles correctly), and this post-processor derives a tangent-space normal
from each material's already-correct base-color atlas (mortar/plank grooves read
darker -> recessed) and injects it as a real glTF normalTexture. The result is a
correct, aligned normal map in the shipped GLB, verifiable by byte inspection and
by an engine-style render.

Run: python3 fix_glb_normals.py <in.glb> <out.glb> [--scale S] [--radius R] [--flip-y]
"""
import sys, os, json, struct, io, argparse
import numpy as np
from PIL import Image, ImageFilter

JSON_MAGIC = 0x4E4F534A
BIN_MAGIC = 0x004E4942


def read_glb(path):
    d = open(path, "rb").read()
    magic, ver, length = struct.unpack("<III", d[:12])
    assert magic == 0x46546C67, "not a GLB"
    off = 12
    js = None
    bn = b""
    while off < length:
        clen, ctype = struct.unpack("<II", d[off:off + 8])
        body = d[off + 8:off + 8 + clen]
        off += 8 + clen
        if ctype == JSON_MAGIC:
            js = json.loads(body.decode("utf-8"))
        elif ctype == BIN_MAGIC:
            bn = body
    return js, bytearray(bn)


def png_bytes(img_rgb_u8):
    b = io.BytesIO()
    Image.fromarray(img_rgb_u8, "RGB").save(b, format="PNG")
    return b.getvalue()


def load_image_from_bufferview(gltf, bn, img):
    bv = gltf["bufferViews"][img["bufferView"]]
    s = bv.get("byteOffset", 0)
    raw = bytes(bn[s:s + bv["byteLength"]])
    return Image.open(io.BytesIO(raw)).convert("RGB")


def normal_from_albedo(pil_rgb, scale, radius, flip_y):
    a = np.asarray(pil_rgb, np.float32) / 255.0
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    lum_img = Image.fromarray((lum * 255).astype(np.uint8))
    blur = np.asarray(lum_img.filter(ImageFilter.GaussianBlur(radius=radius)), np.float32) / 255.0
    detail = lum - blur                     # high-pass: keep mortar/plank grooves, drop broad shading
    height = detail * scale
    # gradients (wrap for seamless tiles)
    gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
    gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5
    ny_sign = 1.0 if flip_y else -1.0       # glTF/OpenGL green-up default
    nx = -gx
    ny = ny_sign * gy
    nz = np.ones_like(height)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx * inv, ny * inv, nz * inv], 2)
    enc = np.clip(n * 0.5 + 0.5, 0, 1)
    return (enc * 255).astype(np.uint8)


def add_bufferview(gltf, bn, data):
    while len(bn) % 4:
        bn.append(0)
    offset = len(bn)
    bn += data
    while len(bn) % 4:
        bn.append(0)
    bv = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
    gltf.setdefault("bufferViews", []).append(bv)
    return len(gltf["bufferViews"]) - 1


def get_sampler(gltf):
    samplers = gltf.setdefault("samplers", [])
    for i, s in enumerate(samplers):
        if s.get("wrapS", 10497) == 10497 and s.get("wrapT", 10497) == 10497:
            return i
    samplers.append({"wrapS": 10497, "wrapT": 10497, "magFilter": 9729, "minFilter": 9987})
    return len(samplers) - 1


def write_glb(path, gltf, bn):
    while len(bn) % 4:
        bn.append(0)
    gltf["buffers"][0]["byteLength"] = len(bn)
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(js) % 4:
        js += b"\x20"
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), JSON_MAGIC)); f.write(js)
        f.write(struct.pack("<II", len(bn), BIN_MAGIC)); f.write(bytes(bn))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp"); ap.add_argument("out")
    ap.add_argument("--scale", type=float, default=3.0)
    ap.add_argument("--radius", type=float, default=6.0)
    ap.add_argument("--nscale", type=float, default=0.8, help="glTF normalTexture.scale")
    ap.add_argument("--flip-y", action="store_true")
    args = ap.parse_args()

    gltf, bn = read_glb(args.inp)
    if gltf.get("buffers", [{}])[0].get("uri"):
        raise SystemExit("expected single embedded BIN buffer")

    src_to_normal_tex = {}   # base-color image index -> normal texture index
    done = 0
    for mat in gltf.get("materials", []):
        pbr = mat.get("pbrMetallicRoughness", {})
        bct = pbr.get("baseColorTexture")
        if bct is None:
            continue
        if mat.get("normalTexture") is not None:
            continue
        tex = gltf["textures"][bct["index"]]
        src = tex.get("source")
        if src is None:
            continue
        if src not in src_to_normal_tex:
            pil = load_image_from_bufferview(gltf, bn, gltf["images"][src])
            nrm_u8 = normal_from_albedo(pil, args.scale, args.radius, args.flip_y)
            nbv = add_bufferview(gltf, bn, png_bytes(nrm_u8))
            gltf.setdefault("images", []).append(
                {"name": gltf["images"][src].get("name", "img") + "_n",
                 "mimeType": "image/png", "bufferView": nbv})
            nimg = len(gltf["images"]) - 1
            ntex = {"sampler": get_sampler(gltf), "source": nimg}
            gltf.setdefault("textures", []).append(ntex)
            src_to_normal_tex[src] = len(gltf["textures"]) - 1
        nt = {"index": src_to_normal_tex[src]}
        if abs(args.nscale - 1.0) > 1e-6:
            nt["scale"] = args.nscale
        if bct.get("texCoord"):
            nt["texCoord"] = bct["texCoord"]
        mat["normalTexture"] = nt
        done += 1

    write_glb(args.out, gltf, bn)
    print(f"injected normals into {done} materials, {len(src_to_normal_tex)} unique atlases -> {args.out}")


if __name__ == "__main__":
    main()
