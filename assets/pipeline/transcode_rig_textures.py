# Re-encode a rigged character GLB's PNG albedo as JPEG in place, without
# touching the rig.
#
# Why this exists rather than optimize_rigged.py: that script is a Blender
# round-trip that decimates meshes and exports with export_animations=False,
# which is why sync_web.mjs refuses to deploy characters-opt at all. For a cast
# member whose bulk is a texture, the mesh and the clips are not the problem and
# must come out the far side bit-identical. So this rewrites the container: every
# bufferView that is not the transcoded image is copied byte-for-byte, and the
# accessors keep their view-relative offsets.
#
# The defect this targets is a Meshy bake returning a 2048x2048 RGBA albedo whose
# alpha is opaque apart from a few stray pixels. PNG then costs 4MB where JPEG
# costs 0.7MB, and an alphaMode of BLEND additionally buys a sorted transparent
# draw for every body wearing it. Alpha is MEASURED first (see
# probe_glb_textures.py); a rig with real cutout geometry is left alone.
#
# Run:
#   python3 assets/pipeline/transcode_rig_textures.py --quality 90 \
#       --out OUTDIR character.glb [more.glb ...]
import argparse
import json
import os
import struct
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_glb_textures import NOISE_SHARE, png_alpha_stats  # noqa: E402

OPAQUE_FACTOR = 0.996


def read_glb(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:4] != b"glTF":
        raise ValueError(f"{path} is not a binary glTF")
    json_length = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20 : 20 + json_length].decode("utf-8").strip())
    binary = b""
    cursor = 20 + json_length
    while cursor + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, cursor)
        if kind == 0x004E4942:
            binary = data[cursor + 8 : cursor + 8 + length]
        cursor += 8 + length
    return document, binary


def write_glb(path, document, binary):
    json_bytes = json.dumps(document, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * (-len(json_bytes) % 4)
    binary = binary + b"\x00" * (-len(binary) % 4)
    total = 12 + 8 + len(json_bytes) + (8 + len(binary) if binary else 0)
    with open(path, "wb") as handle:
        handle.write(b"glTF")
        handle.write(struct.pack("<II", 2, total))
        handle.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        handle.write(json_bytes)
        if binary:
            handle.write(struct.pack("<II", len(binary), 0x004E4942))
            handle.write(binary)
    return total


def to_jpeg(png_bytes, quality):
    with tempfile.TemporaryDirectory() as workdir:
        source = os.path.join(workdir, "albedo.png")
        target = os.path.join(workdir, "albedo.jpg")
        with open(source, "wb") as handle:
            handle.write(png_bytes)
        subprocess.run(
            ["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(quality), source, "--out", target],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        with open(target, "rb") as handle:
            return handle.read()


def transcodable_images(document, binary, force):
    """Which embedded PNGs are safe to re-encode? Decided by measuring alpha."""
    views = document.get("bufferViews", [])
    chosen = {}
    for index, image in enumerate(document.get("images", [])):
        view_index = image.get("bufferView")
        if view_index is None or "png" not in (image.get("mimeType") or ""):
            continue
        view = views[view_index]
        start = view.get("byteOffset", 0)
        blob = binary[start : start + view["byteLength"]]
        stats = png_alpha_stats(blob)
        alpha = stats["alpha"]
        if alpha is None:
            reason = "no alpha channel"
        elif alpha["below"] == 0:
            reason = "alpha fully opaque"
        elif alpha["share"] < NOISE_SHARE:
            reason = f"alpha is bake noise ({alpha['below']} stray px)"
        elif force:
            reason = f"FORCED over real alpha ({alpha['share'] * 100:.3f}% non-opaque)"
        else:
            print(
                f"    img[{index}] KEEP_ALPHA: {alpha['share'] * 100:.3f}% non-opaque "
                f"({alpha['below']} px) - skipping, this texture needs its alpha"
            )
            continue
        chosen[index] = {"blob": blob, "reason": reason, "view": view_index}
    return chosen


def repack(document, binary, replacements):
    """Rebuild the BIN chunk. Every view except the replaced ones is copied verbatim."""
    views = document.get("bufferViews", [])
    out = bytearray()
    for index, view in enumerate(views):
        if index in replacements:
            payload = replacements[index]
        else:
            start = view.get("byteOffset", 0)
            payload = binary[start : start + view["byteLength"]]
        out += b"\x00" * (-len(out) % 4)  # keep every view 4-byte aligned
        view["byteOffset"] = len(out)
        view["byteLength"] = len(payload)
        out += payload
    document["buffers"] = [{"byteLength": len(out)}]
    for view in views:
        view["buffer"] = 0
    return bytes(out)


def relax_alpha_mode(document, transcoded):
    """A BLEND material whose only alpha came from a now-opaque texture is OPAQUE.

    Left as BLEND it would keep paying for a sorted transparent draw and, worse,
    read the JPEG's absent alpha as garbage on some drivers.
    """
    changed = []
    textures = document.get("textures", [])
    for index, material in enumerate(document.get("materials", [])):
        if material.get("alphaMode", "OPAQUE") == "OPAQUE":
            continue
        pbr = material.get("pbrMetallicRoughness", {})
        reference = pbr.get("baseColorTexture", {}).get("index")
        if reference is None or reference >= len(textures):
            continue
        source = textures[reference].get("source")
        if source not in transcoded:
            continue
        factor = pbr.get("baseColorFactor", [1, 1, 1, 1])
        if len(factor) > 3 and factor[3] < OPAQUE_FACTOR:
            continue
        material["alphaMode"] = "OPAQUE"
        material.pop("alphaCutoff", None)
        changed.append(index)
    return changed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("glbs", nargs="+")
    parser.add_argument("--out", required=True, help="output directory")
    parser.add_argument("--quality", type=int, default=90)
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-encode even when alpha carries real coverage (do not use casually)",
    )
    parser.add_argument("--keep-alpha-mode", action="store_true", help="do not relax BLEND to OPAQUE")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    for path in args.glbs:
        name = os.path.basename(path)
        before = os.path.getsize(path)
        document, binary = read_glb(path)
        print(f"=== {name} {before / 1048576:.2f}MB")

        chosen = transcodable_images(document, binary, args.force)
        if not chosen:
            print("    nothing transcodable; leaving untouched")
            continue

        replacements = {}
        for index, info in sorted(chosen.items()):
            jpeg = to_jpeg(info["blob"], args.quality)
            saved = len(info["blob"]) - len(jpeg)
            print(
                f"    img[{index}] png {len(info['blob']) / 1048576:.2f}MB -> "
                f"jpeg q{args.quality} {len(jpeg) / 1048576:.2f}MB "
                f"(-{saved / 1048576:.2f}MB)  [{info['reason']}]"
            )
            replacements[info["view"]] = jpeg
            document["images"][index]["mimeType"] = "image/jpeg"

        if not args.keep_alpha_mode:
            for index in relax_alpha_mode(document, set(chosen)):
                print(f"    material[{index}] alphaMode BLEND -> OPAQUE (alpha was noise)")

        rebuilt = repack(document, binary, replacements)
        destination = os.path.join(args.out, name)
        after = write_glb(destination, document, rebuilt)
        print(
            f"    WROTE {destination} {after / 1048576:.2f}MB "
            f"(was {before / 1048576:.2f}MB, -{(before - after) / 1048576:.2f}MB, "
            f"-{(before - after) / before * 100:.1f}%)"
        )


if __name__ == "__main__":
    main()
