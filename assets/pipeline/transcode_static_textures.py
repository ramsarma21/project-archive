# Re-encode a STATIC prop or interior GLB's PNG textures as JPEG, without
# touching the mesh.
#
# Why this exists rather than transcode_rig_textures.py: that script is right for
# a rigged character, where every embedded PNG is the albedo of a skinned body
# and the only question is whether alpha carries anything. The interior shells,
# floors and prop kits are a different shape of problem:
#
#   * Their waste is not an unused alpha channel. Every image measured on the
#     published tree is an 8-bit *RGB* PNG (colorType 2) - no alpha channel at
#     all - and every material is already alphaMode OPAQUE. So the whole cost is
#     the format: lossless PNG for a photographic bake.
#   * They carry more than one kind of image. colonial-door-kit.glb embeds three
#     albedos AND three tangent-space normal maps, and a normal map is not an
#     albedo: its RGB encodes a direction, so the error that matters is angular,
#     not photometric. Transcoding every PNG at one quality would be deciding
#     that question by accident.
#
# So each image's ROLE is read out of the material wiring (baseColorTexture vs
# normalTexture vs metallicRoughness/occlusion), and each role gets its own
# policy and its own measurement. Data textures - metallicRoughness, occlusion -
# are never transcoded: their channels are looked up numerically, and JPEG's
# chroma handling is not defensible there at any quality.
#
# Like the rig transcoder, this rewrites the container rather than round-tripping
# through Blender: every bufferView that is not a replaced image is copied
# byte-for-byte. verify_static_transcode.py proves that claim.
#
# Measure before choosing a quality. --sweep encodes each candidate at several
# qualities and reports bytes plus error, so the plateau is visible rather than
# assumed:
#   python3 assets/pipeline/transcode_static_textures.py --sweep 80,85,90,95 a.glb
#
# Then write:
#   python3 assets/pipeline/transcode_static_textures.py \
#       --quality 90 --normal-quality 95 --out OUTDIR a.glb [more.glb ...]
import argparse
import math
import os
import subprocess
import sys
import tempfile
from collections import Counter
from operator import sub

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from probe_glb_textures import NOISE_SHARE, png_alpha_stats, png_decode  # noqa: E402
from transcode_rig_textures import (  # noqa: E402
    read_glb,
    relax_alpha_mode,
    repack,
    write_glb,
)

# Roles whose pixels are looked at, not looked up. Only these are transcodable.
VISUAL_ROLES = ("baseColor", "normal", "emissive")
# Below this an image is not worth touching: the 4x4 flat normal maps the
# interior factory attaches are ~100 bytes and are genuinely lossless data.
# Matches the report-only floor in scripts/check-world-textures.mjs.
MIN_BYTES = 128 * 1024


# ---------------------------------------------------------------- roles
def image_roles(document):
    """image index -> {role: [material references]}, read from material wiring.

    Deliberately not read from image names. colonial-door-kit.glb happens to name
    its normal maps "normal", but int-shell-*.glb names its albedo
    "int-texture-board", and a factory is free to name an image anything.
    """
    textures = document.get("textures", [])
    roles = {}

    def note(reference, role, label):
        if not reference:
            return
        index = reference.get("index")
        if index is None or index >= len(textures):
            return
        source = textures[index].get("source")
        if source is None:
            return
        roles.setdefault(source, {}).setdefault(role, []).append(label)

    for index, material in enumerate(document.get("materials", [])):
        pbr = material.get("pbrMetallicRoughness", {})
        note(pbr.get("baseColorTexture"), "baseColor", f"material[{index}]")
        note(pbr.get("metallicRoughnessTexture"), "metallicRoughness", f"material[{index}]")
        note(material.get("normalTexture"), "normal", f"material[{index}]")
        note(material.get("occlusionTexture"), "occlusion", f"material[{index}]")
        note(material.get("emissiveTexture"), "emissive", f"material[{index}]")
    return roles


def candidates(document, binary, min_bytes=MIN_BYTES):
    """Which embedded PNGs may be re-encoded, and why or why not.

    Returns a list of dicts; `skip` is set with a reason when the answer is no,
    so the caller can print the whole picture rather than a filtered one.
    """
    views = document.get("bufferViews", [])
    roles = image_roles(document)
    out = []
    for index, image in enumerate(document.get("images", [])):
        view_index = image.get("bufferView")
        if view_index is None:
            continue
        view = views[view_index]
        start = view.get("byteOffset", 0)
        blob = binary[start : start + view["byteLength"]]
        entry = {
            "index": index,
            "name": image.get("name", f"image{index}"),
            "mime": image.get("mimeType", "?"),
            "view": view_index,
            "blob": blob,
            "roles": sorted(roles.get(index, {})),
            "role": None,
            "skip": None,
        }
        out.append(entry)

        if "png" not in (entry["mime"] or ""):
            entry["skip"] = "already " + (entry["mime"] or "unknown")
            continue
        if not entry["roles"]:
            entry["skip"] = "unreferenced by any material; not ours to reinterpret"
            continue
        visual = [role for role in entry["roles"] if role in VISUAL_ROLES]
        data_roles = [role for role in entry["roles"] if role not in VISUAL_ROLES]
        if data_roles:
            entry["skip"] = f"data texture ({'+'.join(data_roles)}); channels are read numerically"
            continue
        if len(visual) > 1:
            entry["skip"] = f"serves several roles ({'+'.join(visual)}); inspect by hand"
            continue
        entry["role"] = visual[0]
        if len(blob) < min_bytes:
            entry["skip"] = f"{len(blob)} bytes, below the {min_bytes} floor"
            continue

        stats = png_alpha_stats(blob)
        entry["width"], entry["height"] = stats["width"], stats["height"]
        alpha = stats["alpha"]
        if alpha is None:
            entry["why"] = "no alpha channel; PNG is pure format overhead"
        elif alpha["below"] == 0:
            entry["why"] = "alpha channel present but fully opaque"
        elif alpha["share"] < NOISE_SHARE:
            entry["why"] = f"alpha is bake noise ({alpha['below']} stray px)"
        else:
            entry["skip"] = (
                f"alpha carries real coverage ({alpha['share'] * 100:.3f}% non-opaque); "
                "this texture needs it"
            )
    return out


# ---------------------------------------------------------------- codec
def _sips(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def to_jpeg(png_bytes, quality):
    with tempfile.TemporaryDirectory() as workdir:
        source = os.path.join(workdir, "image.png")
        target = os.path.join(workdir, "image.jpg")
        with open(source, "wb") as handle:
            handle.write(png_bytes)
        _sips(["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(quality), source, "--out", target])
        with open(target, "rb") as handle:
            return handle.read()


def jpeg_to_samples(jpeg_bytes):
    """Decode a JPEG back to raw samples through the same reader the PNG uses."""
    with tempfile.TemporaryDirectory() as workdir:
        source = os.path.join(workdir, "image.jpg")
        target = os.path.join(workdir, "image.png")
        with open(source, "wb") as handle:
            handle.write(jpeg_bytes)
        _sips(["sips", "-s", "format", "png", source, "--out", target])
        with open(target, "rb") as handle:
            return png_decode(handle.read())


# ---------------------------------------------------------------- error metrics
def rgb_planes(image):
    """The R, G, B sample streams of a decoded image, as bytes."""
    channels = image["channels"]
    pixels = image["pixels"]
    if channels == 1:
        return [pixels, pixels, pixels]
    if channels == 2:
        plane = pixels[0::2]
        return [plane, plane, plane]
    return [bytes(pixels[channel::channels]) for channel in range(3)]


def photometric_error(before, after):
    """Mean/max absolute error and PSNR over RGB.

    Counted from a histogram of per-sample deltas, which keeps this to one
    C-level pass per channel; a 1024x1024 albedo is 3.1M samples and a
    Python-level loop over it is the difference between a second and a minute.
    """
    total = 0
    absolute = 0
    squared = 0
    worst = 0
    for plane_a, plane_b in zip(rgb_planes(before), rgb_planes(after)):
        for delta, count in Counter(map(sub, plane_a, plane_b)).items():
            magnitude = abs(delta)
            total += count
            absolute += magnitude * count
            squared += magnitude * magnitude * count
            worst = max(worst, magnitude)
    mse = squared / total
    psnr = float("inf") if mse == 0 else 10 * math.log10(255 * 255 / mse)
    return {"mean": absolute / total, "max": worst, "rmse": mse ** 0.5, "psnr": psnr}


def angular_error(before, after):
    """Mean/95th/max angle between the decoded normals, in degrees.

    The right question for a tangent-space normal map. A 2/255 photometric wobble
    is invisible in an albedo but tilts a surface normal, and it is the tilt that
    shows up as shading, so this measures the tilt directly.
    """
    planes_a = rgb_planes(before)
    planes_b = rgb_planes(after)
    histogram = Counter()
    for ax, ay, az, bx, by, bz in zip(*planes_a, *planes_b):
        # Same decode three.js does: sample*2-1, then normalise.
        vax, vay, vaz = ax / 127.5 - 1.0, ay / 127.5 - 1.0, az / 127.5 - 1.0
        vbx, vby, vbz = bx / 127.5 - 1.0, by / 127.5 - 1.0, bz / 127.5 - 1.0
        la = math.sqrt(vax * vax + vay * vay + vaz * vaz)
        lb = math.sqrt(vbx * vbx + vby * vby + vbz * vbz)
        if la < 1e-6 or lb < 1e-6:
            continue
        dot = (vax * vbx + vay * vby + vaz * vbz) / (la * lb)
        dot = 1.0 if dot > 1.0 else (-1.0 if dot < -1.0 else dot)
        # Bucketed to 0.01 degrees; exact enough to read a plateau and cheap
        # enough to hold a million pixels.
        histogram[round(math.degrees(math.acos(dot)), 2)] += 1
    total = sum(histogram.values())
    if total == 0:
        return None
    ordered = sorted(histogram.items())
    mean = sum(angle * count for angle, count in ordered) / total
    cutoff = total * 0.95
    seen = 0
    p95 = ordered[-1][0]
    for angle, count in ordered:
        seen += count
        if seen >= cutoff:
            p95 = angle
            break
    return {"mean": mean, "p95": p95, "max": ordered[-1][0]}


def measure(png_bytes, jpeg_bytes, role):
    before = png_decode(png_bytes)
    after = jpeg_to_samples(jpeg_bytes)
    if (before["width"], before["height"]) != (after["width"], after["height"]):
        return {"error": f"resolution changed {before['width']}x{before['height']} -> "
                         f"{after['width']}x{after['height']}"}
    result = photometric_error(before, after)
    if role == "normal":
        result["angle"] = angular_error(before, after)
    return result


def format_measurement(result):
    if "error" in result:
        return result["error"]
    text = (
        f"meanErr={result['mean']:.3f}/255 maxErr={result['max']}/255 "
        f"PSNR={result['psnr']:.2f}dB"
    )
    angle = result.get("angle")
    if angle:
        text += f"  angle mean={angle['mean']:.3f}deg p95={angle['p95']:.2f}deg max={angle['max']:.2f}deg"
    return text


# ---------------------------------------------------------------- commands
def sweep(paths, qualities, min_bytes):
    for path in paths:
        document, binary = read_glb(path)
        print(f"=== {os.path.basename(path)} {os.path.getsize(path) / 1048576:.2f}MB")
        for entry in candidates(document, binary, min_bytes):
            label = (
                f"  img[{entry['index']}] {entry['name']} "
                f"{entry['mime'].replace('image/', '')} {len(entry['blob']) / 1048576:.2f}MB "
                f"roles={entry['roles'] or ['-']}"
            )
            if entry["skip"]:
                print(f"{label}\n      SKIP {entry['skip']}")
                continue
            print(f"{label} {entry['width']}x{entry['height']} [{entry['why']}]")
            previous = None
            for quality in qualities:
                jpeg = to_jpeg(entry["blob"], quality)
                result = measure(entry["blob"], jpeg, entry["role"])
                gain = ""
                if previous is not None and "psnr" in result and math.isfinite(result["psnr"]):
                    gain = f"  (+{result['psnr'] - previous:.2f}dB over the step below)"
                if "psnr" in result:
                    previous = result["psnr"]
                print(
                    f"      q{quality}: {len(jpeg) / 1048576:.3f}MB "
                    f"({len(jpeg) / len(entry['blob']) * 100:.0f}% of png)  "
                    f"{format_measurement(result)}{gain}"
                )


def transcode(paths, out_dir, quality, normal_quality, skip_normals, min_bytes, keep_alpha_mode):
    os.makedirs(out_dir, exist_ok=True)
    saved_total = 0
    for path in paths:
        name = os.path.basename(path)
        before_size = os.path.getsize(path)
        document, binary = read_glb(path)
        print(f"=== {name} {before_size / 1048576:.2f}MB")

        replacements = {}
        transcoded = set()
        for entry in candidates(document, binary, min_bytes):
            if entry["skip"]:
                if len(entry["blob"]) >= min_bytes:
                    print(f"    img[{entry['index']}] {entry['name']}: SKIP {entry['skip']}")
                continue
            if entry["role"] == "normal" and skip_normals:
                print(f"    img[{entry['index']}] {entry['name']}: SKIP normal map (--skip-normals)")
                continue
            chosen = normal_quality if entry["role"] == "normal" else quality
            jpeg = to_jpeg(entry["blob"], chosen)
            if len(jpeg) >= len(entry["blob"]):
                print(
                    f"    img[{entry['index']}] {entry['name']}: SKIP jpeg q{chosen} is not smaller "
                    f"({len(jpeg)} >= {len(entry['blob'])})"
                )
                continue
            result = measure(entry["blob"], jpeg, entry["role"])
            print(
                f"    img[{entry['index']}] {entry['name']} ({entry['role']}) "
                f"png {len(entry['blob']) / 1048576:.2f}MB -> jpeg q{chosen} "
                f"{len(jpeg) / 1048576:.2f}MB (-{(len(entry['blob']) - len(jpeg)) / 1048576:.2f}MB)"
            )
            print(f"        {format_measurement(result)}  [{entry['why']}]")
            replacements[entry["view"]] = jpeg
            document["images"][entry["index"]]["mimeType"] = "image/jpeg"
            transcoded.add(entry["index"])

        if not replacements:
            print("    nothing transcodable; leaving untouched")
            continue

        if not keep_alpha_mode:
            for index in relax_alpha_mode(document, transcoded):
                print(f"    material[{index}] alphaMode BLEND -> OPAQUE (alpha was not real)")

        rebuilt = repack(document, binary, replacements)
        destination = os.path.join(out_dir, name)
        after_size = write_glb(destination, document, rebuilt)
        saved_total += before_size - after_size
        print(
            f"    WROTE {destination} {after_size / 1048576:.2f}MB "
            f"(was {before_size / 1048576:.2f}MB, "
            f"-{(before_size - after_size) / 1048576:.2f}MB, "
            f"-{(before_size - after_size) / before_size * 100:.1f}%)"
        )
    if len(paths) > 1:
        print(f"\ntotal reclaimed across {len(paths)} file(s): {saved_total / 1048576:.2f}MB")


def relax_opaque_blend(document, binary):
    """Every material whose base colour is not actually transparent becomes OPAQUE.

    transcode_rig_textures.relax_alpha_mode only relaxes materials whose image was
    just transcoded, which is the right scope for a re-encode. A factory needs the
    wider question answered: a Meshy source material can arrive with a BLEND blend
    mode over an albedo that is already JPEG, and then no transcode happens and the
    sorted transparent draw is paid forever. Alpha is measured here too, so a real
    cutout keeps its BLEND.
    """
    views = document.get("bufferViews", [])
    textures = document.get("textures", [])
    changed = []
    for index, material in enumerate(document.get("materials", [])):
        if material.get("alphaMode", "OPAQUE") == "OPAQUE":
            continue
        pbr = material.get("pbrMetallicRoughness", {})
        factor = pbr.get("baseColorFactor", [1, 1, 1, 1])
        if len(factor) > 3 and factor[3] < 0.996:
            continue  # deliberately translucent
        reference = pbr.get("baseColorTexture", {}).get("index")
        if reference is None or reference >= len(textures):
            # BLEND with an opaque factor and no texture has nothing to blend.
            material["alphaMode"] = "OPAQUE"
            material.pop("alphaCutoff", None)
            changed.append(index)
            continue
        source = textures[reference].get("source")
        image = (document.get("images") or [])[source] if source is not None else None
        if image is None or image.get("bufferView") is None:
            continue
        if "png" not in (image.get("mimeType") or ""):
            real_alpha = False  # JPEG cannot carry alpha at all
        else:
            view = views[image["bufferView"]]
            start = view.get("byteOffset", 0)
            alpha = png_alpha_stats(binary[start : start + view["byteLength"]])["alpha"]
            real_alpha = alpha is not None and alpha["share"] >= NOISE_SHARE
        if real_alpha:
            continue
        material["alphaMode"] = "OPAQUE"
        material.pop("alphaCutoff", None)
        changed.append(index)
    return changed


def enforce_texture_policy(path, quality=95, skip_normals=True, min_bytes=MIN_BYTES, verbose=True):
    """Bring one exported GLB up to the published-texture policy, in place.

    This is the entry point the asset factories call immediately after
    bpy.ops.export_scene.gltf, which is what stops the debt regenerating. It runs
    the same code that re-encoded the twelve published files rather than a
    Blender-side approximation of it, for two reasons: the exporter's own format
    choice is keyed on source-image format and varies by version, and
    Image.save_render() pushes pixels through the scene's colour management, which
    is a good way to shift an albedo without noticing.

    Returns a summary dict; safe and cheap to call when there is nothing to do.
    """
    document, binary = read_glb(path)
    replacements = {}
    transcoded = set()
    reencoded = []
    for entry in candidates(document, binary, min_bytes):
        if entry["skip"] or (entry["role"] == "normal" and skip_normals):
            continue
        jpeg = to_jpeg(entry["blob"], quality)
        if len(jpeg) >= len(entry["blob"]):
            continue
        replacements[entry["view"]] = jpeg
        document["images"][entry["index"]]["mimeType"] = "image/jpeg"
        transcoded.add(entry["index"])
        reencoded.append((entry["name"], len(entry["blob"]), len(jpeg)))

    relaxed = relax_opaque_blend(document, binary)
    if not replacements and not relaxed:
        if verbose:
            print(f"[texture-policy] {os.path.basename(path)}: already compliant")
        return {"path": path, "reencoded": [], "relaxed": [], "saved": 0}

    before_size = os.path.getsize(path)
    rebuilt = repack(document, binary, replacements)
    after_size = write_glb(path, document, rebuilt)
    if verbose:
        for name, before, after in reencoded:
            print(
                f"[texture-policy] {os.path.basename(path)}: {name} "
                f"png {before / 1048576:.2f}MB -> jpeg q{quality} {after / 1048576:.2f}MB"
            )
        for index in relaxed:
            print(f"[texture-policy] {os.path.basename(path)}: material[{index}] alphaMode -> OPAQUE")
        print(
            f"[texture-policy] {os.path.basename(path)}: "
            f"{before_size / 1048576:.2f}MB -> {after_size / 1048576:.2f}MB "
            f"(-{(before_size - after_size) / 1048576:.2f}MB)"
        )
    return {
        "path": path,
        "reencoded": reencoded,
        "relaxed": relaxed,
        "saved": before_size - after_size,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("glbs", nargs="+")
    parser.add_argument("--out", help="output directory (required unless --sweep)")
    parser.add_argument("--quality", type=int, default=90, help="JPEG quality for albedo/emissive")
    parser.add_argument(
        "--normal-quality",
        type=int,
        default=None,
        help="JPEG quality for tangent-space normal maps (defaults to --quality)",
    )
    parser.add_argument("--skip-normals", action="store_true", help="leave normal maps as PNG")
    parser.add_argument(
        "--sweep",
        help="comma-separated qualities to measure without writing anything, e.g. 80,85,90,95",
    )
    parser.add_argument("--min-bytes", type=int, default=MIN_BYTES)
    parser.add_argument("--keep-alpha-mode", action="store_true", help="do not relax BLEND to OPAQUE")
    args = parser.parse_args()

    if args.sweep:
        sweep(args.glbs, [int(q) for q in args.sweep.split(",")], args.min_bytes)
        return 0
    if not args.out:
        parser.error("--out is required unless --sweep is given")
    transcode(
        args.glbs,
        args.out,
        args.quality,
        args.normal_quality if args.normal_quality is not None else args.quality,
        args.skip_normals,
        args.min_bytes,
        args.keep_alpha_mode,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
