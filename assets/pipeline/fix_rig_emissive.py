# Un-glow a rigged character whose whole-body albedo was wired in as EMISSIVE.
#
# THE DEFECT. Seven of the fifteen character rigs ship with
#
#     "emissiveFactor": [1, 1, 1],
#     "emissiveTexture": { "index": 0 },      // the same image as baseColorTexture
#     "pbrMetallicRoughness": { "baseColorTexture": { "index": 1 } }
#                                             // metallic/roughness omitted => 1.0 / 1.0
#
# Emissive is light-independent, so those seven render at full albedo brightness no
# matter what the scene lighting does. Played live, that reads as "all the npcs glow
# BRIGHT, but you literally cannot see anything else at all": the rigs are the only
# lit thing on screen and they blow out everything around them.
#
# Two further costs follow from the same wiring, and neither errors:
#
#   * Crowd tinting silently stops working. RiggedCharacter.tsx clones the material
#     and multiplies `.color` by the tint - it never touches `.emissive` or
#     `.emissiveMap` - so the tint applies to a diffuse term that is invisible
#     underneath the emissive one, and 2-4 shared ambient GLBs that are supposed to
#     read as different townsfolk read as identical.
#   * The omitted metallicFactor defaults to 1.0, which removes most of the diffuse
#     response the tint is colouring in the first place.
#
# THE TARGET IS NOT A GUESS. Eight rigs in the same cast are already correct -
# clarke, officer, pike, playerboy, rider, thomas, townsman, townswoman - and every
# one of them has no emissive at all plus an explicit metallicFactor 0 and
# roughnessFactor 0.5. This writes exactly that.
#
# WHAT IT DELIBERATELY WILL NOT DO. It only rewrites a material whose emissive
# texture resolves to the SAME IMAGE as its base colour. A lantern-carrying NPC with
# a dedicated emissive mask is a legitimate light source, and a tool that stripped
# emissive on sight would break it; such a material is reported for human review and
# left alone. It also leaves KHR_materials_specular alone - specularColorFactor
# [2,2,2] on these seven is a non-physical 2x boost and differs from the clean
# eight, but it is LIGHT-DEPENDENT, so it cannot cause the blackout being fixed here,
# and the mission light rig is being changed concurrently by someone else. Changing
# it now would confound that work. It is reported instead.
#
# Only the JSON chunk is touched: the emissive texture is the same image as the base
# colour, so nothing is orphaned and the BIN chunk comes out byte-identical. That is
# what makes "nothing but the material changed" checkable rather than arguable.
#
# Run:
#   python3 assets/pipeline/fix_rig_emissive.py in.glb out.glb
#   python3 assets/pipeline/fix_rig_emissive.py --selftest
import argparse
import copy
import json
import struct
import sys

GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

# What the eight already-correct rigs carry.
TARGET_METALLIC = 0
TARGET_ROUGHNESS = 0.5


def read_glb(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if len(data) < 20 or struct.unpack_from("<I", data, 0)[0] != GLB_MAGIC:
        raise SystemExit(f"{path}: not a binary glTF")
    json_length, json_kind = struct.unpack_from("<II", data, 12)
    if json_kind != JSON_CHUNK:
        raise SystemExit(f"{path}: first chunk is not JSON")
    document = json.loads(data[20 : 20 + json_length].decode("utf-8").strip())
    binary = b""
    cursor = 20 + json_length
    while cursor + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, cursor)
        if kind == BIN_CHUNK:
            binary = data[cursor + 8 : cursor + 8 + length]
        cursor += 8 + length
    return document, binary


def write_glb(path, document, binary):
    json_blob = json.dumps(document, separators=(",", ":")).encode("utf-8")
    json_blob += b" " * (-len(json_blob) % 4)
    binary = binary + b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(json_blob) + (8 + len(binary) if binary else 0)
    out = bytearray()
    out += struct.pack("<III", GLB_MAGIC, 2, total)
    out += struct.pack("<II", len(json_blob), JSON_CHUNK)
    out += json_blob
    if binary:
        out += struct.pack("<II", len(binary), BIN_CHUNK)
        out += binary
    with open(path, "wb") as handle:
        handle.write(out)
    return total


def texture_image(document, reference):
    """The IMAGE a material's texture reference ultimately resolves to."""
    if not isinstance(reference, dict):
        return None
    index = reference.get("index")
    if index is None:
        return None
    textures = document.get("textures") or []
    if index >= len(textures):
        return None
    return textures[index].get("source")


def fix_materials(document):
    """Rewrite whole-body-albedo-as-emissive materials. Returns a report list."""
    report = []
    for index, material in enumerate(document.get("materials") or []):
        factor = material.get("emissiveFactor")
        emissive = material.get("emissiveTexture")
        lit = factor is not None and max(factor) > 0
        if not lit and emissive is None:
            report.append({"material": index, "action": "already-correct"})
            continue

        pbr = material.setdefault("pbrMetallicRoughness", {})
        emissive_image = texture_image(document, emissive)
        base_image = texture_image(document, pbr.get("baseColorTexture"))

        if emissive is not None and emissive_image != base_image:
            report.append(
                {
                    "material": index,
                    "action": "left-alone",
                    "why": f"emissive image {emissive_image} differs from base colour "
                    f"{base_image}; this may be a real light source",
                }
            )
            continue
        if emissive is None:
            # A non-zero factor with no texture still glows a flat colour.
            report.append({"material": index, "action": "cleared-factor-only"})
        else:
            report.append(
                {
                    "material": index,
                    "action": "cleared",
                    "why": f"emissive texture resolved to image {emissive_image}, "
                    "the same image as the base colour",
                }
            )

        material.pop("emissiveTexture", None)
        # Removed rather than set to [0,0,0]: glTF's default IS [0,0,0] and the eight
        # correct rigs omit the key entirely, so removing it matches them exactly.
        material.pop("emissiveFactor", None)
        # Written explicitly because their ABSENCE is half the defect: the glTF
        # defaults are 1.0/1.0, and metallic 1.0 removes the diffuse response that
        # crowd tinting colours.
        pbr["metallicFactor"] = TARGET_METALLIC
        pbr["roughnessFactor"] = TARGET_ROUGHNESS

        specular = (material.get("extensions") or {}).get("KHR_materials_specular")
        if specular:
            report[-1]["note"] = (
                f"KHR_materials_specular specularColorFactor="
                f"{specular.get('specularColorFactor')} left untouched (light-dependent; "
                "the clean rigs have no specular extension)"
            )
    return report


# ---------------------------------------------------------------- self-test
def synthetic_glb(material, textures, images):
    binary = b"\x01\x02\x03\x04"
    document = {
        "asset": {"version": "2.0"},
        "materials": [material],
        "textures": textures,
        "images": images,
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(binary)}],
    }
    return document, binary


def selftest():
    failures = []

    def check(label, ok, detail=""):
        print(f"  {'PASS' if ok else 'FAIL'}  {label:56} {detail}")
        if not ok:
            failures.append(label)

    print(
        "fix-rig-emissive selftest: does it separate a glowing BODY from a real LIGHT?\n"
        "  Both inputs are emissive at factor 1; only the image wiring differs."
    )

    # The defect: emissive texture and base colour are the same image.
    document, _ = synthetic_glb(
        {
            "name": "body-as-emissive",
            "emissiveFactor": [1, 1, 1],
            "emissiveTexture": {"index": 0},
            "pbrMetallicRoughness": {"baseColorTexture": {"index": 1}},
        },
        [{"source": 0}, {"source": 0}],
        [{"name": "albedo"}],
    )
    report = fix_materials(document)
    material = document["materials"][0]
    check(
        "whole-body albedo as emissive is cleared",
        "emissiveFactor" not in material
        and "emissiveTexture" not in material
        and report[0]["action"] == "cleared",
        f"action={report[0]['action']}",
    )
    check(
        "and metallic/roughness are written to the clean-rig target",
        material["pbrMetallicRoughness"]["metallicFactor"] == 0
        and material["pbrMetallicRoughness"]["roughnessFactor"] == 0.5,
        f"metallic={material['pbrMetallicRoughness']['metallicFactor']} "
        f"roughness={material['pbrMetallicRoughness']['roughnessFactor']}",
    )
    check(
        "base colour wiring is untouched",
        material["pbrMetallicRoughness"]["baseColorTexture"] == {"index": 1},
    )

    # The legitimate case: a dedicated emissive mask on a different image.
    document, _ = synthetic_glb(
        {
            "name": "lantern",
            "emissiveFactor": [1, 1, 1],
            "emissiveTexture": {"index": 0},
            "pbrMetallicRoughness": {"baseColorTexture": {"index": 1}},
        },
        [{"source": 0}, {"source": 1}],
        [{"name": "lantern-mask"}, {"name": "albedo"}],
    )
    report = fix_materials(document)
    material = document["materials"][0]
    check(
        "a lantern with its own emissive mask is LEFT ALONE",
        material.get("emissiveFactor") == [1, 1, 1]
        and material.get("emissiveTexture") == {"index": 0}
        and report[0]["action"] == "left-alone",
        f"action={report[0]['action']}",
    )

    # An already-correct material must not be rewritten at all.
    clean = {
        "name": "clean",
        "alphaMode": "OPAQUE",
        "pbrMetallicRoughness": {
            "baseColorTexture": {"index": 1},
            "metallicFactor": 0,
            "roughnessFactor": 0.5,
        },
    }
    document, _ = synthetic_glb(copy.deepcopy(clean), [{"source": 0}, {"source": 1}], [{}, {}])
    report = fix_materials(document)
    check(
        "an already-correct material is not rewritten",
        document["materials"][0] == clean and report[0]["action"] == "already-correct",
        f"action={report[0]['action']}",
    )

    # A flat glow with no texture at all still has to be cleared.
    document, _ = synthetic_glb(
        {"name": "flat-glow", "emissiveFactor": [0.5, 0.5, 0.5], "pbrMetallicRoughness": {}},
        [],
        [],
    )
    report = fix_materials(document)
    check(
        "a textureless non-zero emissiveFactor is cleared",
        "emissiveFactor" not in document["materials"][0]
        and report[0]["action"] == "cleared-factor-only",
        f"action={report[0]['action']}",
    )

    print(
        "fix-rig-emissive selftest: OK (emissive held constant; only the wiring changed the verdict)"
        if not failures
        else f"fix-rig-emissive selftest: FAIL {failures}"
    )
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?")
    parser.add_argument("output", nargs="?")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    if not args.input or not args.output:
        parser.error("input and output are required")

    document, binary = read_glb(args.input)
    before = len(binary)
    report = fix_materials(document)
    size = write_glb(args.output, document, binary)
    changed = [row for row in report if row["action"].startswith("cleared")]
    print(f"fix-emissive {args.input} -> {args.output}")
    for row in report:
        line = f"  material[{row['material']}] {row['action']}"
        if row.get("why"):
            line += f": {row['why']}"
        print(line)
        if row.get("note"):
            print(f"      note: {row['note']}")
    print(f"  {len(changed)} material(s) changed; BIN chunk {before} bytes, unchanged; wrote {size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
