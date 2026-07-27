// Refuse to publish a world GLB whose textures carry the Meshy bake defect.
//
// WHY THIS EXISTS. Seven of fifteen character rigs shipped with the same defect,
// which makes it a property of the generation pipeline rather than seven
// accidents. A Meshy bake returns a 2048x2048 RGBA albedo whose alpha channel is
// opaque apart from a handful of stray pixels - 5 to 74 out of 4.19 million on
// the cast measured so far. Two costs follow, and neither one errors:
//
//   1. The alpha forces PNG over JPEG. That is 2.35-4.45MB per rig where JPEG
//      costs 0.45-0.71MB at a PSNR of 46-49dB, i.e. visually lossless.
//   2. The bake also sets alphaMode BLEND, which buys a sorted transparent draw
//      for every instance. On a market crowd of 36 bodies that costs more than
//      the bytes, and it was invisible to everybody for months.
//
// Genuine transparency has to keep working - a hair card, a lace cuff, a window,
// a net all need their alpha - so nothing here is decided by format. The alpha is
// DECODED and counted, and an image whose alpha carries real coverage passes.
//
// SECOND FINDING (2026-07-26, interior/prop factories). Surveying the rest of the
// published tree turned up ~32MB of the same waste with a different cause: 8-bit
// *RGB* PNGs - no alpha channel at all - already on OPAQUE materials. There the
// whole cost is the format, and re-encoding the albedo to JPEG q95 recovered
// 21.36MB at 40.4-45.7dB. But that survey also found the one case where a big
// opaque PNG is CORRECT: a tangent-space normal map. Its RGB is a direction, and
// JPEG below q100 subsamples chroma 4:2:0, which is exactly the R/G channels
// holding X and Y. Measured on colonial-door-kit.glb's three normal maps, that
// costs 2.1-4.1deg of mean angular error (p95 up to 21deg) and the quality knob
// cannot buy it back: q85 to q97 moved PSNR by 0.05dB. The one quality that does
// avoid subsampling, q100, encodes 4:4:4 and comes out at 109-121% of the PNG.
// So a normal map has no JPEG win at any quality, and this guard must not demand
// one. Role is therefore read from the material wiring: an albedo blocks, a
// normal/metallicRoughness/occlusion map reports.
//
// SHAPE. This follows scripts/check-dangling-imports.mjs rather than
// assets/pipeline/verify_m1_placements.mjs: it is a repo-wide gate over published
// output, it must run in `lint` and in CI, and it must work when node_modules is
// absent or mid-install. So it parses the GLB container and inflates the PNG
// itself with node:zlib instead of loading three.js. verify_m1_placements.mjs is
// the right precedent for a check that needs real scene geometry; this one does
// not, and paying a three.js import for it would make `lint` depend on an
// installed workspace.
//
// It does NOT police absence. A declared-but-unbuilt asset is another agent's
// work in progress, not a texture defect, so only files that exist are read.
//
// Usage:
//   node scripts/check-world-textures.mjs                 # gate the published tree
//   node scripts/check-world-textures.mjs --report        # never exit non-zero
//   node scripts/check-world-textures.mjs a.glb b.glb     # gate specific files
import {
  readdirSync,
  readFileSync,
  existsSync,
  statSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { inflateSync, deflateSync } from "node:zlib";
import { join, dirname, resolve, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISHED = join(ROOT, "apps", "web", "public", "world");

// ---------------------------------------------------------------- thresholds
/**
 * Above this share of non-opaque pixels the alpha is doing real work and the
 * image is left alone. The cast's defective bakes sit four orders of magnitude
 * below it (0.0001%-0.0018%); a real cutout is percent-scale.
 */
const REAL_ALPHA_SHARE = 0.001;
/** Of 255. Matches the 0.996 float threshold the Blender-side probes use. */
const OPAQUE = 254;
/**
 * A PNG this big with an unused alpha channel is the multi-megabyte defect and
 * blocks. Smaller ones are still waste but are not worth refusing a publish over,
 * so they report. 1MB is comfortably below the smallest real case (2.35MB) and
 * comfortably above the incidental masks in the interior kit.
 */
const BLOCK_PNG_BYTES = 1024 * 1024;
/** Report-only floor: below this a PNG is not worth mentioning at all. */
const NOTE_PNG_BYTES = 128 * 1024;

// Pre-existing debt, recorded so this guard can block NEW defects without
// rewriting assets that other agents own. Every entry is a real finding that
// someone should fix; none of it is a false positive. Adding a line here is a
// deliberate edit, which is the point - the ledger cannot grow by accident.
//
// EMPTY as of 2026-07-26. It held twelve files carrying ~32MB of PNG from the
// interior/prop factories. Eleven were re-encoded to JPEG q95 (21.36MB
// recovered; see the SECOND FINDING note above), and the twelfth,
// colonial-door-kit.glb, turned out not to be debt at all: what remained in it
// was three tangent-space normal maps, for which PNG is the correct format. That
// is now expressed as a rule this guard understands rather than as a line in a
// ledger, because a file listed as debt reads as a file someone still owes work
// on, and nobody owes work on those.
const KNOWN_DEBT = new Set([]);

// ---------------------------------------------------------------- GLB container
function glbDocument(data) {
  if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67) return null;
  const jsonLength = data.readUInt32LE(12);
  let json;
  try {
    json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8").trim());
  } catch {
    return null;
  }
  let binary = null;
  let cursor = 20 + jsonLength;
  while (cursor + 8 <= data.length) {
    const length = data.readUInt32LE(cursor);
    const type = data.readUInt32LE(cursor + 4);
    if (type === 0x004e4942) {
      binary = data.subarray(cursor + 8, cursor + 8 + length);
      break;
    }
    cursor += 8 + length;
  }
  return { json, binary };
}

function embeddedImages(document) {
  const { json, binary } = document;
  const views = json.bufferViews ?? [];
  return (json.images ?? []).map((image, index) => {
    const viewIndex = image.bufferView;
    let bytes = null;
    if (Number.isInteger(viewIndex) && binary) {
      const view = views[viewIndex];
      const start = view.byteOffset ?? 0;
      bytes = binary.subarray(start, start + view.byteLength);
    }
    return { index, name: image.name ?? `image${index}`, mime: image.mimeType ?? "", bytes };
  });
}

// ---------------------------------------------------------------- roles
/**
 * Which material slot does each image serve? Returns Map<imageIndex, Set<role>>.
 *
 * Read from the wiring, never from the image name. colonial-door-kit.glb happens
 * to name its normal maps "normal", but int-shell-*.glb names its albedo
 * "int-texture-board", and press-common-operable-v2.glb names its albedo
 * "...-frame-atlas". A factory is free to name an image anything, so a check that
 * keyed on the name would be guessing.
 */
function imageRoles(document) {
  const textures = document.json.textures ?? [];
  const roles = new Map();
  const note = (reference, role) => {
    const index = reference?.index;
    if (index === undefined) return;
    const source = textures[index]?.source;
    if (source === undefined) return;
    if (!roles.has(source)) roles.set(source, new Set());
    roles.get(source).add(role);
  };
  for (const material of document.json.materials ?? []) {
    const pbr = material.pbrMetallicRoughness ?? {};
    note(pbr.baseColorTexture, "baseColor");
    note(pbr.metallicRoughnessTexture, "metallicRoughness");
    note(material.normalTexture, "normal");
    note(material.occlusionTexture, "occlusion");
    note(material.emissiveTexture, "emissive");
  }
  return roles;
}

/**
 * Roles whose pixels are a colour a camera sees, so JPEG's error budget applies
 * and a multi-megabyte lossless PNG is waste. Everything else is a direction or a
 * coefficient that is read numerically, where JPEG is the wrong tool at any
 * quality - see the SECOND FINDING note at the top.
 */
const PHOTOMETRIC_ROLES = new Set(["baseColor", "emissive"]);

// ---------------------------------------------------------------- PNG
const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function pngChunks(blob) {
  const out = [];
  let cursor = 8;
  while (cursor + 8 <= blob.length) {
    const length = blob.readUInt32BE(cursor);
    out.push({ type: blob.subarray(cursor + 4, cursor + 8).toString("latin1"), start: cursor + 8, length });
    cursor += 12 + length;
  }
  return out;
}

/**
 * What does this PNG's alpha channel actually carry?
 *
 * Returns { supported, hasAlpha, share, nonOpaque, width, height }. `supported`
 * is false for the encodings this pipeline never emits (interlaced, 16-bit);
 * those are reported rather than blocked, because guessing about an image this
 * guard cannot read is how a gate earns a reputation for lying.
 */
function pngAlpha(blob) {
  let header = null;
  let hasTransparencyChunk = false;
  const idat = [];
  for (const chunk of pngChunks(blob)) {
    if (chunk.type === "IHDR") {
      header = {
        width: blob.readUInt32BE(chunk.start),
        height: blob.readUInt32BE(chunk.start + 4),
        depth: blob[chunk.start + 8],
        colorType: blob[chunk.start + 9],
        interlace: blob[chunk.start + 12],
      };
    } else if (chunk.type === "tRNS") hasTransparencyChunk = true;
    else if (chunk.type === "IDAT") idat.push(blob.subarray(chunk.start, chunk.start + chunk.length));
    else if (chunk.type === "IEND") break;
  }
  if (!header) return { supported: false, reason: "no IHDR" };
  const { width, height, depth, colorType, interlace } = header;
  const channels = PNG_CHANNELS[colorType];

  // No alpha channel at all: the format itself is the whole waste. This is what
  // the interior/prop factories emit, as opposed to the character bake's RGBA.
  if (colorType === 0 || colorType === 2) {
    return { supported: true, hasAlpha: false, nonOpaque: 0, share: 0, width, height, channels };
  }
  if (colorType === 3) {
    // Palette images are small and their transparency lives in tRNS.
    return {
      supported: true,
      hasAlpha: hasTransparencyChunk,
      nonOpaque: hasTransparencyChunk ? 1 : 0,
      share: hasTransparencyChunk ? 1 : 0,
      width,
      height,
      channels,
    };
  }
  if (depth !== 8 || interlace !== 0) {
    return { supported: false, reason: `depth=${depth} interlace=${interlace}`, width, height };
  }

  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (error) {
    return { supported: false, reason: `inflate failed: ${String(error).slice(0, 40)}` };
  }

  const stride = width * channels;
  const alphaOffset = channels - 1;
  let previous = Buffer.alloc(stride);
  let line = Buffer.alloc(stride);
  let nonOpaque = 0;
  let cursor = 0;
  for (let row = 0; row < height; row++) {
    if (cursor >= raw.length) break;
    const filter = raw[cursor++];
    raw.copy(line, 0, cursor, cursor + stride);
    cursor += stride;
    // Unfiltering has to run over every channel: the predictors are byte-wise
    // and reference the pixel to the left, so alpha cannot be isolated first.
    if (filter === 1) {
      for (let i = channels; i < stride; i++) line[i] = (line[i] + line[i - channels]) & 0xff;
    } else if (filter === 2) {
      for (let i = 0; i < stride; i++) line[i] = (line[i] + previous[i]) & 0xff;
    } else if (filter === 3) {
      for (let i = 0; i < stride; i++) {
        const left = i >= channels ? line[i - channels] : 0;
        line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xff;
      }
    } else if (filter === 4) {
      for (let i = 0; i < stride; i++) {
        const left = i >= channels ? line[i - channels] : 0;
        const up = previous[i];
        const upperLeft = i >= channels ? previous[i - channels] : 0;
        const estimate = left + up - upperLeft;
        const da = Math.abs(estimate - left);
        const db = Math.abs(estimate - up);
        const dc = Math.abs(estimate - upperLeft);
        const nearest = da <= db && da <= dc ? left : db <= dc ? up : upperLeft;
        line[i] = (line[i] + nearest) & 0xff;
      }
    } else if (filter !== 0) {
      return { supported: false, reason: `unknown filter ${filter}` };
    }
    for (let i = alphaOffset; i < stride; i += channels) {
      if (line[i] < OPAQUE) nonOpaque++;
    }
    const swap = previous;
    previous = line;
    line = swap;
  }
  const total = width * height;
  return {
    supported: true,
    hasAlpha: nonOpaque > 0,
    nonOpaque,
    share: total > 0 ? nonOpaque / total : 0,
    width,
    height,
    channels,
  };
}

/** JPEG cannot carry alpha at all, so its dimensions are all that is needed. */
function jpegSize(blob) {
  let cursor = 2;
  while (cursor + 9 < blob.length) {
    if (blob[cursor] !== 0xff) {
      cursor++;
      continue;
    }
    const marker = blob[cursor + 1];
    const length = blob.readUInt16BE(cursor + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: blob.readUInt16BE(cursor + 5), width: blob.readUInt16BE(cursor + 7) };
    }
    cursor += 2 + length;
  }
  return { width: 0, height: 0 };
}

// ---------------------------------------------------------------- the checks
/**
 * Inspect one GLB. Returns { findings: [{ code, block, detail, fix }] }.
 *
 * Exported so sync_web.mjs can gate a single file at the moment it publishes it,
 * which is the only place a NEW defect can be stopped before it ships.
 */
export function inspectWorldGlb(path) {
  const findings = [];
  if (!existsSync(path)) {
    return { missing: true, findings };
  }
  const data = readFileSync(path);
  const document = glbDocument(data);
  if (!document) {
    // A file that EXISTS but does not parse is not the "work in progress" case
    // this guard declines to police — that is a missing file, handled above. A
    // present-but-unparseable GLB is a truncated or corrupt publish that will
    // fail to load in the browser exactly as it failed to parse here, and
    // shipping it is the defect. Absence is someone's unfinished work; a broken
    // file on the served path is not, so it blocks.
    findings.push({
      code: "UNREADABLE_GLB",
      block: true,
      detail: "not a parseable binary glTF",
      fix: "check the export; this file is truncated or corrupt and will not load",
    });
    return { findings };
  }

  const images = embeddedImages(document);
  const roles = imageRoles(document);
  const alphaByImage = new Map();
  const duplicates = new Map();

  for (const image of images) {
    if (!image.bytes) continue;
    const key = `${image.bytes.length}`;
    if (!duplicates.has(key)) duplicates.set(key, []);
    duplicates.get(key).push(image);

    const isPng = /png/i.test(image.mime);
    if (!isPng) {
      // A JPEG has no alpha channel by construction.
      alphaByImage.set(image.index, { supported: true, hasAlpha: false, share: 0, nonOpaque: 0 });
      continue;
    }
    const alpha = pngAlpha(image.bytes);
    alphaByImage.set(image.index, alpha);

    if (!alpha.supported) {
      findings.push({
        code: "PNG_UNREADABLE",
        block: false,
        detail: `img[${image.index}] ${image.name}: ${alpha.reason}`,
        fix: "unusual PNG encoding; inspect by hand",
      });
      continue;
    }
    const bytes = image.bytes.length;
    const mb = (bytes / 1048576).toFixed(2);
    const real = alpha.hasAlpha && alpha.share >= REAL_ALPHA_SHARE;
    if (real) continue; // genuine transparency; leave it alone

    if (bytes < NOTE_PNG_BYTES) continue;

    const imageRoleSet = roles.get(image.index) ?? new Set();
    const photometric = [...imageRoleSet].filter((role) => PHOTOMETRIC_ROLES.has(role));
    const dataRoles = [...imageRoleSet].filter((role) => !PHOTOMETRIC_ROLES.has(role));
    // A direction/coefficient map has no JPEG win at any quality, so demanding
    // one would be asking for a regression. Reported, never blocked - if one of
    // these is genuinely too big the answer is resolution, not format.
    if (imageRoleSet.size > 0 && photometric.length === 0) {
      findings.push({
        code: "PNG_DATA_TEXTURE",
        block: false,
        detail:
          `img[${image.index}] ${image.name} ${alpha.width}x${alpha.height} png ${mb}MB ` +
          `serves ${dataRoles.join("+")} only`,
        fix:
          "leave as PNG. JPEG below q100 subsamples chroma 4:2:0, which is the R/G\n" +
          "      channels a tangent-space normal map stores X and Y in; q100 avoids that but\n" +
          "      encodes larger than the PNG. Shrink it by resolution if it must shrink.",
      });
      continue;
    }

    const why = !alpha.hasAlpha
      ? alpha.channels === 4 || alpha.channels === 2
        ? "alpha channel present but fully opaque"
        : "no alpha channel at all; the format alone is the waste"
      : `alpha is bake noise (${alpha.nonOpaque} stray px of ${alpha.width * alpha.height}, ${(alpha.share * 100).toFixed(4)}%)`;
    findings.push({
      code: "PNG_WITHOUT_REAL_ALPHA",
      block: bytes >= BLOCK_PNG_BYTES,
      detail: `img[${image.index}] ${image.name} ${alpha.width}x${alpha.height} png ${mb}MB - ${why}`,
      fix:
        "re-encode to JPEG; the albedo loses nothing measurable at q95. For a rigged character:\n" +
        `      python3 assets/pipeline/transcode_rig_textures.py --quality 95 --out OUTDIR ${basename(path)}\n` +
        "      python3 assets/pipeline/verify_rig_transcode.py before.glb after.glb\n" +
        "      python3 assets/pipeline/measure_texture_error.py before.glb after.glb\n" +
        "      For a static interior or prop (role-aware; leaves normal maps alone):\n" +
        `      python3 assets/pipeline/transcode_static_textures.py --sweep 85,90,95 ${basename(path)}\n` +
        `      python3 assets/pipeline/transcode_static_textures.py --quality 95 --skip-normals --out OUTDIR ${basename(path)}\n` +
        "      python3 assets/pipeline/verify_static_transcode.py --measure before.glb after.glb",
    });
  }

  // A byte-identical image embedded twice is pure duplication.
  for (const [, group] of duplicates) {
    if (group.length < 2) continue;
    const identical = group.filter((image) => image.bytes.equals(group[0].bytes));
    if (identical.length < 2 || group[0].bytes.length < NOTE_PNG_BYTES) continue;
    findings.push({
      code: "DUPLICATE_IMAGE",
      block: false,
      detail:
        `img[${identical.map((i) => i.index).join(",")}] are byte-identical ` +
        `(${(group[0].bytes.length / 1048576).toFixed(2)}MB each)`,
      fix: "point both textures at one image index",
    });
  }

  // alphaMode BLEND with nothing transparent behind it. This is the per-instance
  // sorted-draw cost, and it is why the check is not just about bytes.
  const textures = document.json.textures ?? [];
  (document.json.materials ?? []).forEach((material, index) => {
    const mode = material.alphaMode ?? "OPAQUE";
    if (mode === "OPAQUE") return;
    const pbr = material.pbrMetallicRoughness ?? {};
    const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
    if (factor.length > 3 && factor[3] < 0.996) return; // deliberately translucent
    const reference = pbr.baseColorTexture?.index;
    if (reference === undefined) {
      findings.push({
        code: "BLEND_WITHOUT_TRANSPARENCY",
        block: false,
        detail: `material[${index}] ${material.name ?? "?"} alphaMode=${mode} with an opaque factor and no base texture`,
        fix: 'set "alphaMode": "OPAQUE"',
      });
      return;
    }
    const source = textures[reference]?.source;
    const alpha = alphaByImage.get(source);
    if (!alpha || !alpha.supported) return;
    if (alpha.hasAlpha && alpha.share >= REAL_ALPHA_SHARE) return; // earns its BLEND
    findings.push({
      code: "BLEND_WITHOUT_TRANSPARENCY",
      block: true,
      detail:
        `material[${index}] ${material.name ?? "?"} alphaMode=${mode} but its base colour ` +
        `texture is effectively opaque${alpha.nonOpaque ? ` (${alpha.nonOpaque} stray px)` : ""}`,
      fix:
        'set "alphaMode": "OPAQUE". Every instance of this material currently pays for a\n' +
        "      sorted transparent draw; M1's market draws 36 of them.",
    });
  });

  // A whole-body albedo wired into the EMISSIVE slot.
  //
  // WHY THIS LIVES HERE. Seven of the fifteen rigs shipped with
  // emissiveFactor [1,1,1] and an emissiveTexture pointing at the SAME image as
  // their base colour. Emissive is light-independent, so those seven rendered at
  // full albedo brightness whatever the scene lighting did: played live it read as
  // "all the npcs glow BRIGHT, but you literally cannot see anything else at all".
  // It also silently defeats crowd tinting, because RiggedCharacter.tsx clones the
  // material and multiplies `.color` only, never `.emissive`/`.emissiveMap`.
  //
  // This is the same KIND of defect as the alphaMode check above - a material
  // property the generator set wrongly, which costs real render behaviour and
  // errors nowhere - so it belongs in the same gate rather than in a new script.
  // Geometry SIZE went to scripts/check-world-scale.mjs because that needs real
  // scene evaluation; this needs nothing but the material wiring, which is already
  // parsed here.
  //
  // Emissive is NOT policed in general. A lantern, a forge or a lit window is a
  // legitimate light source, so the block is narrow on purpose: it fires only when
  // the emissive texture resolves to the very same image as the base colour, which
  // is a whole object glowing rather than a lamp. Anything else is reported.
  (document.json.materials ?? []).forEach((material, index) => {
    const factor = material.emissiveFactor;
    const emissive = material.emissiveTexture;
    if (!factor || Math.max(...factor) <= 0) return;
    const pbr = material.pbrMetallicRoughness ?? {};
    const emissiveImage =
      emissive?.index !== undefined ? textures[emissive.index]?.source : undefined;
    const baseImage =
      pbr.baseColorTexture?.index !== undefined
        ? textures[pbr.baseColorTexture.index]?.source
        : undefined;
    if (emissive === undefined) {
      findings.push({
        code: "EMISSIVE_WITHOUT_TEXTURE",
        block: false,
        detail:
          `material[${index}] ${material.name ?? "?"} emissiveFactor=[${factor.join(", ")}] ` +
          "with no emissive texture, so the whole surface glows a flat colour",
        fix: 'remove "emissiveFactor" unless this surface is meant to emit light',
      });
      return;
    }
    if (emissiveImage !== undefined && emissiveImage === baseImage) {
      findings.push({
        code: "ALBEDO_WIRED_AS_EMISSIVE",
        block: true,
        detail:
          `material[${index}] ${material.name ?? "?"} emissiveFactor=[${factor.join(", ")}] and its ` +
          `emissive texture is image[${emissiveImage}], the same image as its base colour`,
        fix:
          "the object lights itself, so it stays at full brightness in an unlit scene and\n" +
          "      ignores any runtime tint. Clear it and match the already-correct rigs\n" +
          "      (no emissive, metallicFactor 0, roughnessFactor 0.5):\n" +
          `      python3 assets/pipeline/fix_rig_emissive.py ${basename(path)} out.glb\n` +
          "      python3 assets/pipeline/verify_rig_transcode.py before.glb out.glb\n" +
          "      A real light source needs its OWN emissive mask, not the body albedo.",
      });
      return;
    }
    findings.push({
      code: "EMISSIVE_TEXTURE_PRESENT",
      block: false,
      detail:
        `material[${index}] ${material.name ?? "?"} emits light from image[${emissiveImage}] ` +
        `(base colour is image[${baseImage}])`,
      fix: "a dedicated emissive mask is legitimate; confirm this surface is meant to glow",
    });
  });

  return { findings };
}

// ---------------------------------------------------------------- self-test
// A guard that passes everything is indistinguishable from a guard that is
// broken, and the way this one would break silently is by flagging PNG rather
// than flagging opaque alpha - which would also make it refuse the hair cards and
// lace it is supposed to allow. So the discriminator is tested against images
// built here, where the right answer is known by construction.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), payload])), 0);
  return Buffer.concat([head, payload, crc]);
}

/** A real RGBA PNG whose alpha is set by `alphaAt(x, y)`. */
function syntheticPng(size, alphaAt) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let cursor = 0;
  for (let y = 0; y < size; y++) {
    raw[cursor++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      raw[cursor++] = (x * 7) & 0xff;
      raw[cursor++] = (y * 11) & 0xff;
      raw[cursor++] = 128;
      raw[cursor++] = alphaAt(x, y);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An RGB PNG (colorType 2, no alpha channel) - the interior/prop defect shape. */
function syntheticRgbPng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // depth
  ihdr[9] = 2; // RGB, no alpha
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let cursor = 0;
  let state = 0x2545f491;
  for (let y = 0; y < size; y++) {
    raw[cursor++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      // Deterministic noise, so the image cannot deflate below the block
      // threshold and the size half of the rule is actually exercised.
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      raw[cursor++] = state & 0xff;
      raw[cursor++] = (state >>> 8) & 0xff;
      raw[cursor++] = (state >>> 16) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A minimal one-image, one-material GLB wiring that image into `slot`. */
function syntheticGlb(png, slot) {
  const pbr = {};
  const material = { name: `wired-as-${slot}`, pbrMetallicRoughness: pbr };
  if (slot === "baseColor") pbr.baseColorTexture = { index: 0 };
  else if (slot === "metallicRoughness") pbr.metallicRoughnessTexture = { index: 0 };
  else if (slot === "normal") material.normalTexture = { index: 0 };
  const binary = Buffer.concat([png, Buffer.alloc((-png.length % 4 + 4) % 4)]);
  let json = Buffer.from(
    JSON.stringify({
      asset: { version: "2.0" },
      images: [{ name: "synthetic", mimeType: "image/png", bufferView: 0 }],
      textures: [{ source: 0 }],
      materials: [material],
      buffers: [{ byteLength: binary.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
    }),
    "utf8",
  );
  json = Buffer.concat([json, Buffer.alloc((-json.length % 4 + 4) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binary.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binHeader, binary]);
}

/**
 * Does the role rule hold the image constant and let only the WIRING decide?
 *
 * The way the role exemption would go wrong is by letting an albedo through -
 * either because the wiring was misread or because the exemption was written too
 * broadly - and that failure looks exactly like success from the outside: a green
 * lint run. So the same PNG bytes are wired three ways and the verdicts must
 * differ.
 */
function roleSelfTest() {
  const png = syntheticRgbPng(1024);
  const directory = mkdtempSync(join(tmpdir(), "world-textures-"));
  const cases = [
    { slot: "baseColor", expectBlock: true, expectCode: "PNG_WITHOUT_REAL_ALPHA" },
    { slot: "normal", expectBlock: false, expectCode: "PNG_DATA_TEXTURE" },
    { slot: "metallicRoughness", expectBlock: false, expectCode: "PNG_DATA_TEXTURE" },
  ];
  let failed = 0;
  console.log(
    `\nworld-textures selftest: does the ROLE rule read the wiring? ` +
      `(one ${(png.length / 1048576).toFixed(2)}MB opaque RGB png, wired three ways)`,
  );
  for (const testCase of cases) {
    const path = join(directory, `${testCase.slot}.glb`);
    writeFileSync(path, syntheticGlb(png, testCase.slot));
    const findings = inspectWorldGlb(path).findings;
    const blocked = findings.some((finding) => finding.block);
    const codes = findings.map((finding) => finding.code);
    const ok = blocked === testCase.expectBlock && codes.includes(testCase.expectCode);
    if (!ok) failed++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  wired as ${testCase.slot.padEnd(18)} -> ` +
        `${blocked ? "BLOCKS" : "reports"} [${codes.join(",") || "no findings"}]`,
    );
  }
  rmSync(directory, { recursive: true, force: true });
  console.log(
    failed === 0
      ? "world-textures selftest: OK (image held constant; only the wiring changed the verdict)"
      : `world-textures selftest: FAIL (${failed} role case(s))`,
  );
  return failed;
}

/**
 * A GLB with two textures over `images`, wired into one material verbatim.
 * Lets the emissive self-test move only the WIRING between cases.
 */
function syntheticMaterialGlb(images, material) {
  const views = [];
  let binary = Buffer.alloc(0);
  for (const png of images) {
    views.push({ buffer: 0, byteOffset: binary.length, byteLength: png.length });
    binary = Buffer.concat([binary, png, Buffer.alloc((-png.length % 4 + 4) % 4)]);
  }
  let json = Buffer.from(
    JSON.stringify({
      asset: { version: "2.0" },
      images: images.map((_, index) => ({
        name: `image${index}`,
        mimeType: "image/png",
        bufferView: index,
      })),
      textures: images.map((_, index) => ({ source: index })),
      materials: [material],
      buffers: [{ byteLength: binary.length }],
      bufferViews: views,
    }),
    "utf8",
  );
  json = Buffer.concat([json, Buffer.alloc((-json.length % 4 + 4) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binary.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binHeader, binary]);
}

/**
 * Does the emissive rule distinguish a glowing BODY from a real LIGHT?
 *
 * The way this rule would go wrong is by policing emissive in general, which would
 * block the lanterns and lit windows the game legitimately needs - and that failure
 * only shows up when somebody adds one, long after the rule was written. So the
 * emissive factor is held at [1,1,1] in every case below and only the IMAGE WIRING
 * moves. If the rule keyed on emissive being present, all three would block.
 */
function emissiveSelfTest() {
  const albedo = syntheticPng(64, () => 255);
  const mask = syntheticPng(32, (x) => (x < 4 ? 255 : 0));
  const directory = mkdtempSync(join(tmpdir(), "world-emissive-"));
  const cases = [
    {
      name: "body albedo as emissive",
      images: [albedo],
      material: {
        name: "body-glow",
        emissiveFactor: [1, 1, 1],
        emissiveTexture: { index: 0 },
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
      },
      expectBlock: true,
      expectCode: "ALBEDO_WIRED_AS_EMISSIVE",
    },
    {
      name: "lantern with its own mask",
      images: [mask, albedo],
      material: {
        name: "lantern",
        emissiveFactor: [1, 1, 1],
        emissiveTexture: { index: 0 },
        pbrMetallicRoughness: { baseColorTexture: { index: 1 } },
      },
      expectBlock: false,
      expectCode: "EMISSIVE_TEXTURE_PRESENT",
    },
    {
      name: "flat glow, no texture",
      images: [albedo],
      material: {
        name: "flat",
        emissiveFactor: [0.5, 0.5, 0.5],
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
      },
      expectBlock: false,
      expectCode: "EMISSIVE_WITHOUT_TEXTURE",
    },
    {
      name: "no emissive at all",
      images: [albedo],
      material: {
        name: "clean",
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.5,
        },
      },
      expectBlock: false,
      expectCode: null,
    },
  ];
  let failed = 0;
  console.log(
    "\nworld-textures selftest: does the EMISSIVE rule tell a glowing body from a lamp?\n" +
      "  (emissiveFactor held at [1,1,1]; only which image it points at changes)",
  );
  for (const testCase of cases) {
    const path = join(directory, `${testCase.name.replace(/[^a-z0-9]+/gi, "-")}.glb`);
    writeFileSync(path, syntheticMaterialGlb(testCase.images, testCase.material));
    const findings = inspectWorldGlb(path).findings;
    const blocked = findings.some((finding) => finding.block);
    const codes = findings.map((finding) => finding.code);
    const ok =
      blocked === testCase.expectBlock &&
      (testCase.expectCode === null
        ? !codes.some((code) => code.startsWith("EMISSIVE") || code === "ALBEDO_WIRED_AS_EMISSIVE")
        : codes.includes(testCase.expectCode));
    if (!ok) failed++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${testCase.name.padEnd(28)} -> ` +
        `${blocked ? "BLOCKS" : "reports"} [${codes.join(",") || "no findings"}]`,
    );
  }
  rmSync(directory, { recursive: true, force: true });
  console.log(
    failed === 0
      ? "world-textures selftest: OK (a dedicated emissive mask is still allowed)"
      : `world-textures selftest: FAIL (${failed} emissive case(s))`,
  );
  return failed;
}

/**
 * A file that exists but does not parse must BLOCK, not pass. Absence is left
 * alone (that is another agent's unfinished work), but a truncated file on the
 * served path will fail to load in the browser exactly as it fails to parse
 * here, and letting it through was the defect this case pins.
 */
function unreadableSelfTest() {
  const directory = mkdtempSync(join(tmpdir(), "world-textures-unreadable-"));
  const path = join(directory, "truncated.glb");
  writeFileSync(path, Buffer.from("glTF not really a binary gltf"));
  const result = inspectWorldGlb(path);
  const blocked = result.findings.some((finding) => finding.block);
  const isUnreadable = result.findings.some((finding) => finding.code === "UNREADABLE_GLB");
  const missingHandled = inspectWorldGlb(join(directory, "does-not-exist.glb")).missing === true;
  rmSync(directory, { recursive: true, force: true });
  const ok = blocked && isUnreadable && missingHandled;
  console.log(
    `\nworld-textures selftest: does a present-but-unparseable GLB block, while absence is left alone?`,
  );
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  unparseable file -> ${blocked ? "BLOCKS" : "passes"}` +
      ` [${result.findings.map((f) => f.code).join(",") || "no findings"}]; ` +
      `missing file -> ${missingHandled ? "skipped" : "NOT skipped"}`,
  );
  console.log(
    ok
      ? "world-textures selftest: OK (a corrupt publish is refused; an unbuilt one is not)"
      : "world-textures selftest: FAIL (unparseable-GLB gate)",
  );
  return ok ? 0 : 1;
}

function selfTest() {
  const SIZE = 256;
  const total = SIZE * SIZE;
  const cases = [
    {
      name: "fully opaque alpha",
      png: syntheticPng(SIZE, () => 255),
      expectRealAlpha: false,
    },
    {
      name: "bake noise (20 stray px)",
      png: syntheticPng(SIZE, (x, y) => (y === 0 && x < 20 ? 140 : 255)),
      expectRealAlpha: false,
    },
    {
      // Just under the threshold, to pin which side of the line it lands on.
      name: `just below the ${REAL_ALPHA_SHARE * 100}% line`,
      png: syntheticPng(SIZE, (x, y) => (y * SIZE + x < Math.floor(total * REAL_ALPHA_SHARE) - 1 ? 0 : 255)),
      expectRealAlpha: false,
    },
    {
      name: "genuine cutout (10% transparent)",
      png: syntheticPng(SIZE, (x, y) => (y * SIZE + x < total * 0.1 ? 0 : 255)),
      expectRealAlpha: true,
    },
    {
      name: "hair-card style soft edge (30% partial)",
      png: syntheticPng(SIZE, (x) => (x < SIZE * 0.3 ? 90 : 255)),
      expectRealAlpha: true,
    },
  ];

  let failed = 0;
  console.log("world-textures selftest: does the discriminator separate alpha from format?");
  for (const testCase of cases) {
    const alpha = pngAlpha(testCase.png);
    const real = alpha.supported && alpha.hasAlpha && alpha.share >= REAL_ALPHA_SHARE;
    const ok = real === testCase.expectRealAlpha;
    if (!ok) failed++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${testCase.name.padEnd(38)} ` +
        `nonOpaque=${String(alpha.nonOpaque).padStart(6)} share=${(alpha.share * 100).toFixed(4)}% ` +
        `-> ${real ? "REAL ALPHA (allowed)" : "opaque (flagged)"}`,
    );
  }

  // Every PNG above is the same size and format; only the alpha differs. If the
  // check were keyed on format, all five would come out the same way.
  console.log(
    failed === 0
      ? "world-textures selftest: OK (format held constant; only alpha changed the verdict)"
      : `world-textures selftest: FAIL (${failed} case(s))`,
  );
  return failed + roleSelfTest() + emissiveSelfTest() + unreadableSelfTest();
}

// ---------------------------------------------------------------- CLI
function publishedGlbs() {
  const out = [];
  for (const group of ["props", "structures", "characters", "anims"]) {
    const dir = join(PUBLISHED, group);
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(".glb")) out.push(join(dir, entry));
    }
  }
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) process.exit(selfTest() === 0 ? 0 : 1);
  const reportOnly = argv.includes("--report");
  const explicit = argv.filter((a) => !a.startsWith("--"));
  const files = explicit.length > 0 ? explicit.map((f) => resolve(f)) : publishedGlbs();

  const started = Date.now();
  let scanned = 0;
  let skippedMissing = 0;
  const blocking = [];
  const reported = [];
  const debt = [];

  for (const file of files) {
    // Published files read as props/x.glb; anything else (a build candidate being
    // checked before it ships) reads relative to the repo root.
    const inPublished = file.startsWith(PUBLISHED + "/");
    const key = relative(inPublished ? PUBLISHED : ROOT, file).split("\\").join("/");
    const result = inspectWorldGlb(file);
    if (result.missing) {
      skippedMissing++;
      continue;
    }
    scanned++;
    if (result.findings.length === 0) continue;
    const target = KNOWN_DEBT.has(key) ? debt : null;
    for (const finding of result.findings) {
      const row = { key, ...finding };
      if (target) target.push(row);
      else if (finding.block) blocking.push(row);
      else reported.push(row);
    }
  }

  console.log(
    `world-textures: scanned ${scanned} published GLB(s) in ${((Date.now() - started) / 1000).toFixed(1)}s` +
      (skippedMissing > 0 ? `, skipped ${skippedMissing} that do not exist yet` : ""),
  );
  if (skippedMissing > 0) {
    console.log(
      "  (a declared-but-unbuilt asset is someone's work in progress, not a texture defect)",
    );
  }

  if (debt.length > 0) {
    // Summarised, because this runs on every `pnpm lint` and a wall of known debt
    // trains people to skim past the part that matters. `--report` prints it all.
    const files = [...new Set(debt.map((row) => row.key))];
    const wasted = debt.reduce((sum, row) => {
      const match = /png (\d+\.\d+)MB/.exec(row.detail);
      return sum + (match ? Number(match[1]) : 0);
    }, 0);
    // KNOWN_DEBT overrides the gate: these findings would otherwise block. An
    // override that lets a real defect ship must announce itself, so this warns.
    console.warn(
      `  WARNING: ${debt.length} finding(s) across ${files.length} file(s) suppressed by KNOWN_DEBT` +
        ` (~${wasted.toFixed(0)}MB of PNG); the texture gate is being overridden for them.` +
        ` These belong to the interior/prop factories, not the character bake.`,
    );
    if (reportOnly) {
      for (const row of debt) console.log(`    debt: ${row.key}  ${row.code}  ${row.detail}`);
    } else {
      console.log("  Run `node scripts/check-world-textures.mjs --report` to list them.");
    }
  }

  if (reported.length > 0) {
    console.log(`\n  ${reported.length} observation(s), not gated:`);
    for (const row of reported) console.log(`    note: ${row.key}  ${row.code}  ${row.detail}`);
  }

  if (blocking.length > 0) {
    console.error(`\n  FAIL: ${blocking.length} texture defect(s) that must not ship:`);
    for (const row of blocking) {
      console.error(`    error: ${row.key}`);
      console.error(`           ${row.code}: ${row.detail}`);
      console.error(`           fix: ${row.fix}`);
    }
    if (!reportOnly) process.exit(1);
  }

  if (blocking.length === 0) {
    console.log(
      `world-textures: OK (no blocking defect; ${debt.length} known debt, ${reported.length} note(s))`,
    );
  }
}
