# Correct the UNIT SCALE of a rigged character GLB, in place in the container.
#
# WHY THIS EXISTS. officer-rigged.glb shipped 100x too small: a 1.90m body stored
# as a 1.9cm one. Rebaking it from source would fix the size, but it would also
# re-encode every texture and re-sample every curve, so "did the thirteen duel
# clips survive?" would become an argument about tolerances instead of a fact. A
# byte-level rescale keeps that question answerable: everything except the four
# quantities that MUST move is left untouched, so verify_rig_rescale.py can hash
# the rest and prove it did not move.
#
# WHAT A UNIFORM SCALE ACTUALLY IS, in glTF terms. Multiplying every node
# translation by k (leaving rotations and node scales alone) makes each node's
# local matrix
#
#     L' = T(k*t) R S = S_k T(t) S_k^-1 R S = S_k (T R S) S_k^-1 = S_k L S_k^-1
#
# because a UNIFORM scale commutes with rotation and with scale. The S_k^-1 and
# S_k cancel between adjacent factors along a chain, so every world matrix
# transforms the same way, W' = S_k W S_k^-1, and therefore
#
#     inverseBindMatrix' = (S_k W_bind S_k^-1)^-1 = S_k IBM S_k^-1
#
# which for a 4x4 means: leave the 3x3 linear block alone, multiply the
# translation column by k. Feed that through three.js's skinning expression,
#
#     world = ( sum_j w_j * jointWorld_j * IBM_j ) * bindMatrix * position
#
# and every S_k^-1 cancels against the next S_k, leaving exactly S_k * world.
# So the complete set of things to scale is:
#
#     1. mesh POSITION accessors (and their min/max)
#     2. node translations
#     3. inverseBindMatrices translation columns
#     4. animation channels whose target path is "translation" (and their min/max)
#
# and the complete set of things that must NOT change is everything else:
# rotations, node scales, NORMAL/TEXCOORD/JOINTS/WEIGHTS/indices, keyframe times,
# rotation and scale channels, images, materials, and the node hierarchy.
#
# Node SCALES are deliberately left alone, including the Blender armature node's
# 0.01. That 0.01 is not the defect - every healthy rig in this cast carries it
# too - so removing it would be a second, unrequested change. The defect was that
# the spatial magnitudes were 100x too small GIVEN that scale.
#
# Run:
#   python3 assets/pipeline/rescale_rig_glb.py --factor 100 in.glb out.glb
#   python3 assets/pipeline/rescale_rig_glb.py --target-height 1.8974 in.glb out.glb
#   python3 assets/pipeline/rescale_rig_glb.py --selftest
import argparse
import json
import struct
import sys

GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
FLOAT = 5126


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
    return document, bytearray(binary)


def write_glb(path, document, binary):
    json_blob = json.dumps(document, separators=(",", ":")).encode("utf-8")
    json_blob += b" " * (-len(json_blob) % 4)
    binary = bytes(binary)
    binary += b"\0" * (-len(binary) % 4)
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


COMPONENT_BYTES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def accessor_span(document, index):
    """Byte range an accessor's elements occupy, plus its element layout."""
    accessor = document["accessors"][index]
    if "sparse" in accessor:
        raise SystemExit(f"accessor {index} is sparse; unsupported")
    if accessor["componentType"] != FLOAT:
        raise SystemExit(
            f"accessor {index} is componentType {accessor['componentType']}, not float32. "
            "A quantised rig needs a different tool; refusing to guess."
        )
    view_index = accessor.get("bufferView")
    if view_index is None:
        raise SystemExit(f"accessor {index} has no bufferView")
    view = document["bufferViews"][view_index]
    components = TYPE_COUNT[accessor["type"]]
    element = COMPONENT_BYTES[FLOAT] * components
    stride = view.get("byteStride") or element
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return start, stride, element, components, accessor["count"]


def scale_accessor(document, binary, index, factor, lanes, touched):
    """Multiply selected float lanes of every element of `index` by `factor`.

    `lanes` is the set of component indices to touch, so a MAT4 can have only its
    translation column scaled. Every byte written is recorded in `touched`, which
    makes double-scaling through a shared or overlapping accessor impossible
    rather than merely unlikely.
    """
    start, stride, element, components, count = accessor_span(document, index)
    for i in range(count):
        base = start + i * stride
        for lane in lanes:
            offset = base + lane * 4
            if offset in touched:
                raise SystemExit(
                    f"accessor {index} element {i} lane {lane} at byte {offset} "
                    "was already scaled through another accessor; refusing to double-scale"
                )
            touched.add(offset)
            value = struct.unpack_from("<f", binary, offset)[0]
            struct.pack_into("<f", binary, offset, value * factor)
    accessor = document["accessors"][index]
    for key in ("min", "max"):
        if key in accessor:
            accessor[key] = [
                v * factor if lane in lanes else v for lane, v in enumerate(accessor[key])
            ]
    return count


# MAT4 is column-major in glTF, so the translation column is components 12..14.
TRANSLATION_LANES = frozenset({12, 13, 14})
VEC3_LANES = frozenset({0, 1, 2})


def rescale(document, binary, factor):
    """Apply a uniform spatial scale. Returns a report dict."""
    touched = set()
    report = {"factor": factor}

    position_accessors = []
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            attributes = primitive.get("attributes") or {}
            if "POSITION" in attributes:
                position_accessors.append(attributes["POSITION"])
            for target in primitive.get("targets") or []:
                if "POSITION" in target:
                    position_accessors.append(target["POSITION"])
    for index in dict.fromkeys(position_accessors):
        scale_accessor(document, binary, index, factor, VEC3_LANES, touched)
    report["positionAccessors"] = len(dict.fromkeys(position_accessors))

    ibm_accessors = [
        skin["inverseBindMatrices"]
        for skin in document.get("skins", [])
        if skin.get("inverseBindMatrices") is not None
    ]
    for index in dict.fromkeys(ibm_accessors):
        scale_accessor(document, binary, index, factor, TRANSLATION_LANES, touched)
    report["ibmAccessors"] = len(dict.fromkeys(ibm_accessors))

    # A node may carry `matrix` instead of TRS; scale its translation column.
    nodes_scaled = 0
    matrices_scaled = 0
    for node in document.get("nodes", []):
        if "matrix" in node:
            node["matrix"] = [
                v * factor if lane in TRANSLATION_LANES else v
                for lane, v in enumerate(node["matrix"])
            ]
            matrices_scaled += 1
        if "translation" in node:
            node["translation"] = [v * factor for v in node["translation"]]
            nodes_scaled += 1
    report["nodeTranslations"] = nodes_scaled
    report["nodeMatrices"] = matrices_scaled

    channel_accessors = []
    for animation in document.get("animations", []):
        for channel in animation.get("channels", []):
            if channel["target"].get("path") != "translation":
                continue
            sampler = animation["samplers"][channel["sampler"]]
            channel_accessors.append(sampler["output"])
    unique_channels = dict.fromkeys(channel_accessors)
    keys = 0
    for index in unique_channels:
        keys += scale_accessor(document, binary, index, factor, VEC3_LANES, touched)
    report["translationChannels"] = len(unique_channels)
    report["translationKeyframes"] = keys
    return report


# ---------------------------------------------------------------- self-test
# A rescale tool that silently scales the wrong set of things produces a file
# that still loads and still animates, just wrongly - which is exactly how the
# defect being fixed here survived for nine days. So the invariant is asserted
# against a rig built here, where the right answer is known by construction: a
# two-bone skinned chain under an armature node carrying the same 0.01 scale the
# real cast carries, posed by a translation channel.
def synthetic_rig():
    import base64  # noqa: PLC0415  (self-test only)

    def pad(blob):
        return blob + b"\0" * (-len(blob) % 4)

    positions = struct.pack("<9f", 0, 0, 0, 0, 1.0, 0, 0, 2.0, 0)
    joints = struct.pack("<12B", *([0, 0, 0, 0] * 3))
    weights = struct.pack("<12f", *([1.0, 0.0, 0.0, 0.0] * 3))
    indices = struct.pack("<3H", 0, 1, 2)
    identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    # Two joints, the second offset 1.0 up, so its IBM has a real translation.
    ibm = struct.pack("<16f", *identity) + struct.pack(
        "<16f", *(identity[:12] + [0, -1.0, 0, 1])
    )
    times = struct.pack("<2f", 0.0, 1.0)
    translations = struct.pack("<6f", 0, 0, 0, 0, 0.5, 0)

    blobs = [positions, joints, weights, indices, ibm, times, translations]
    binary = bytearray()
    views = []
    for blob in blobs:
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(blob)})
        binary += pad(blob)

    document = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0, 3]}],
        "nodes": [
            {"name": "Armature", "scale": [0.01, 0.01, 0.01], "children": [1]},
            {"name": "j0", "translation": [0.0, 0.0, 0.0], "children": [2]},
            {"name": "j1", "translation": [0.0, 1.0, 0.0]},
            {"name": "Mesh0", "mesh": 0, "skin": 0, "translation": [0.0, 0.25, 0.0]},
        ],
        "meshes": [
            {
                "name": "Mesh0",
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "JOINTS_0": 1, "WEIGHTS_0": 2},
                        "indices": 3,
                    }
                ],
            }
        ],
        "skins": [{"name": "Armature", "joints": [1, 2], "inverseBindMatrices": 4}],
        "animations": [
            {
                "name": "shuffle",
                "samplers": [
                    {"input": 5, "output": 6, "interpolation": "LINEAR"},
                    {"input": 5, "output": 5, "interpolation": "LINEAR"},
                ],
                "channels": [
                    {"sampler": 0, "target": {"node": 1, "path": "translation"}},
                    # A rotation channel sharing an accessor with the time input
                    # would be pathological; this one points at its own scalar
                    # data purely so a non-translation path exists to be left
                    # alone. Its values are meaningless and must stay meaningless.
                    {"sampler": 1, "target": {"node": 1, "path": "rotation"}},
                ],
            }
        ],
        "accessors": [
            {"bufferView": 0, "componentType": FLOAT, "count": 3, "type": "VEC3",
             "min": [0.0, 0.0, 0.0], "max": [0.0, 2.0, 0.0]},
            {"bufferView": 1, "componentType": 5121, "count": 3, "type": "VEC4"},
            {"bufferView": 2, "componentType": FLOAT, "count": 3, "type": "VEC4"},
            {"bufferView": 3, "componentType": 5123, "count": 3, "type": "SCALAR"},
            {"bufferView": 4, "componentType": FLOAT, "count": 2, "type": "MAT4"},
            {"bufferView": 5, "componentType": FLOAT, "count": 2, "type": "SCALAR"},
            {"bufferView": 6, "componentType": FLOAT, "count": 2, "type": "VEC3",
             "min": [0.0, 0.0, 0.0], "max": [0.0, 0.5, 0.0]},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    return document, binary


def selftest():
    factor = 100.0
    document, binary = synthetic_rig()
    before_json = json.loads(json.dumps(document))
    before_bin = bytes(binary)
    report = rescale(document, binary, factor)

    failures = []

    def check(label, ok, detail=""):
        print(f"  {'PASS' if ok else 'FAIL'}  {label}{('  ' + detail) if detail else ''}")
        if not ok:
            failures.append(label)

    print("rescale selftest: does a uniform scale touch exactly the four right things?")
    # Three VEC3 vertices; vertex 2's y is float lane 7, i.e. byte 28.
    check(
        "POSITION scaled",
        struct.unpack_from("<f", binary, document["bufferViews"][0]["byteOffset"] + 28)[0] == 200.0,
        "vertex 2 y 2.0 -> 200.0",
    )
    check(
        "POSITION min/max scaled",
        document["accessors"][0]["max"] == [0.0, 200.0, 0.0],
    )
    check(
        "node translation scaled",
        document["nodes"][2]["translation"] == [0.0, 100.0, 0.0]
        and document["nodes"][3]["translation"] == [0.0, 25.0, 0.0],
    )
    check(
        "node scale untouched (the armature's 0.01 is not the defect)",
        document["nodes"][0]["scale"] == [0.01, 0.01, 0.01],
    )
    ibm_offset = document["bufferViews"][4]["byteOffset"]
    second = struct.unpack_from("<16f", binary, ibm_offset + 64)
    check(
        "IBM translation column scaled, 3x3 block untouched",
        second[13] == -100.0 and second[:12] == tuple(float(v) for v in
            [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
        f"m[13] -1.0 -> {second[13]}",
    )
    translation_offset = document["bufferViews"][6]["byteOffset"]
    check(
        "translation channel scaled",
        struct.unpack_from("<f", binary, translation_offset + 16)[0] == 50.0,
        "0.5 -> 50.0",
    )
    times_offset = document["bufferViews"][5]["byteOffset"]
    check(
        "keyframe times untouched",
        struct.unpack_from("<2f", binary, times_offset) == (0.0, 1.0),
    )
    check(
        "JOINTS_0 / WEIGHTS_0 / indices untouched",
        bytes(binary[document["bufferViews"][1]["byteOffset"] : document["bufferViews"][1]["byteOffset"] + 12])
        == before_bin[document["bufferViews"][1]["byteOffset"] : document["bufferViews"][1]["byteOffset"] + 12]
        and bytes(binary[document["bufferViews"][2]["byteOffset"] : document["bufferViews"][2]["byteOffset"] + 48])
        == before_bin[document["bufferViews"][2]["byteOffset"] : document["bufferViews"][2]["byteOffset"] + 48],
    )
    check(
        "hierarchy unchanged",
        [n.get("children") for n in document["nodes"]]
        == [n.get("children") for n in before_json["nodes"]],
    )
    check(
        "report counts the work",
        report["positionAccessors"] == 1
        and report["ibmAccessors"] == 1
        and report["nodeTranslations"] == 3
        and report["translationChannels"] == 1,
        str(report),
    )

    # The double-scale guard is the one that protects a real rig, where an
    # accessor can legitimately be referenced twice.
    document2, binary2 = synthetic_rig()
    document2["meshes"][0]["primitives"].append(
        {"attributes": {"POSITION": 0, "JOINTS_0": 1, "WEIGHTS_0": 2}, "indices": 3}
    )
    try:
        rescale(document2, binary2, factor)
        shared_ok = struct.unpack_from(
            "<f", binary2, document2["bufferViews"][0]["byteOffset"] + 28
        )[0] == 200.0
    except SystemExit:
        shared_ok = False
    check("an accessor shared by two primitives is scaled once", shared_ok)

    print(
        "rescale selftest: OK"
        if not failures
        else f"rescale selftest: FAIL ({len(failures)}) {failures}"
    )
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?")
    parser.add_argument("output", nargs="?")
    parser.add_argument("--factor", type=float, default=None)
    parser.add_argument(
        "--target-height",
        type=float,
        default=None,
        help="derive the factor from the raw POSITION Y span instead of stating it",
    )
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()

    if args.selftest:
        return selftest()
    if not args.input or not args.output:
        parser.error("input and output are required")
    if (args.factor is None) == (args.target_height is None):
        parser.error("give exactly one of --factor or --target-height")

    document, binary = read_glb(args.input)

    span = None
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            index = (primitive.get("attributes") or {}).get("POSITION")
            if index is None:
                continue
            accessor = document["accessors"][index]
            if "min" in accessor and "max" in accessor:
                height = accessor["max"][1] - accessor["min"][1]
                span = height if span is None else max(span, height)
    factor = args.factor
    if factor is None:
        if not span:
            raise SystemExit("no POSITION min/max to derive a factor from")
        factor = args.target_height / span

    report = rescale(document, binary, factor)
    size = write_glb(args.output, document, binary)
    print(f"rescale {args.input} -> {args.output}")
    print(f"  factor              {factor:.10g}")
    print(f"  raw POSITION Y span {span:.6f} -> {span * factor:.6f}" if span else "")
    print(f"  POSITION accessors  {report['positionAccessors']}")
    print(f"  inverseBindMatrices {report['ibmAccessors']}")
    print(f"  node translations   {report['nodeTranslations']} (matrices {report['nodeMatrices']})")
    print(
        f"  translation channels {report['translationChannels']} "
        f"({report['translationKeyframes']} keyframes)"
    )
    print(f"  wrote {size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
