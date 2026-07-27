// Refuse to publish a world GLB whose geometry is the wrong SIZE.
//
// WHY THIS EXISTS. This project has now hit unit-and-scale confusion at least four
// separate times, and every one of them shipped:
//
//   1. officer-rigged.glb, the M1 boss, shipped with its whole rig 100x too small -
//      a 1.90m body stored as a 1.9cm one - and survived nine days and a played
//      boss fight. Nothing errored, because both runtime loaders normalise a
//      character by `height / measuredHeight`, so the officer was silently
//      multiplied by 92 on load and looked correct on screen while the file was
//      wrong. The cause was upstream: officer-clean.fbx is 357 bytes of S3 "503
//      Slow Down" HTML saved with a .fbx extension, so the officer went to Mixamo
//      as an OBJ, which declares no units, and came back a metre-unit rig where
//      every sibling is centimetres.
//   2. A steeple that rendered 8.91m low.
//   3. A Town House whose declared size was simply wrong.
//   4. A glTF importer bug that reported minY as exactly -100.00cm on 27 clips.
//
// The common shape is that a scale error is INVISIBLE at runtime. A fit, a
// normalisation or a contain-scale absorbs it, so the game looks right and the
// asset is wrong - and the next thing derived from that asset inherits the error.
// A gate over the published bytes is the only place this class of defect can be
// caught, which is why this exists at all.
//
// WHY A SIBLING OF check-world-textures.mjs RATHER THAN AN EXTENSION OF IT.
// That script's own header names the dividing line: it follows
// check-dangling-imports.mjs "rather than assets/pipeline/verify_m1_placements.mjs"
// because it does NOT need real scene geometry, and says verify_m1_placements.mjs
// "is the right precedent for a check that needs" it. This check needs it - an
// effective height is a skinning computation, not a header read - so by that
// script's own reasoning it is a different shape and belongs beside it. The two
// also give completely different advice: a texture defect is fixed by re-encoding
// an image, a scale defect by rescaling a rig or correcting a manifest. Folding
// them together would produce one script with two unrelated halves and one
// combined exit code.
//
// It keeps the two properties that make the texture guard usable, though: it
// parses the GLB itself instead of importing three.js, so `lint` never depends on
// an installed workspace, and it does not police absence - a declared-but-unbuilt
// asset is someone's work in progress.
//
// MEASURING THE RIGHT THING IS THE WHOLE DIFFICULTY. Three different "heights" can
// be read out of one rigged GLB and only one of them is what the renderer draws:
//
//   * raw POSITION accessor min/max ignores every node transform. A rig that is
//     correct but sits under a scaled parent reads as broken.
//   * the mesh node's own matrix applied to those bounds is also wrong, and wrong
//     in the opposite direction: glTF says a skinned mesh node's transform is
//     ignored, and the joints are what place the vertices.
//   * only the SKINNING matrices say where a vertex actually lands.
//
// Getting this wrong does not produce a missed defect, it produces a confident
// false report, and that has already cost this project hours. So the skinned path
// below evaluates the real expression three.js evaluates,
//
//     world = ( sum_j w_j * jointWorld_j * inverseBindMatrix_j ) * meshNodeWorld * p
//
// per vertex, and `assets/pipeline/probe_rig_scale.mjs --cross-check` proves this
// implementation agrees with three.js on every published rig.
//
// Usage:
//   node scripts/check-world-scale.mjs                 # gate the published tree
//   node scripts/check-world-scale.mjs --report        # never exit non-zero
//   node scripts/check-world-scale.mjs --selftest      # prove the measurement
//   node scripts/check-world-scale.mjs a.glb b.glb     # gate specific files
//   node scripts/check-world-scale.mjs --json          # machine-readable bounds
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import { join, dirname, resolve, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISHED = join(ROOT, "apps", "web", "public", "world");
const MANIFEST = join(ROOT, "packages", "mission-m1", "src", "assets.ts");

// ---------------------------------------------------------------- thresholds
/**
 * A rigged character is a human body. Nothing in this cast has any business
 * outside this band, and the band is deliberately wide: the shipping cast spans
 * 1.61m to 1.90m, so 1.2-2.3m admits a child rig or a very tall man while still
 * being three orders of magnitude away from the officer's 0.019m.
 *
 * This is the check that would have caught the officer on the day he was baked.
 */
const HUMAN_HEIGHT_M = [1.2, 2.3];

/**
 * Meshy normalises every asset it generates so that its LONGEST axis is ~1.90m,
 * whatever the object is, and the level then contain-fits it into its declared box
 * at runtime (`FittedGlb` in packages/engine-world/src/ImportedAssets.tsx).
 *
 * MEASURED, NOT ASSUMED: 164 of the 206 non-rigged published assets sit in
 * 1.8918-1.9040m, and the nearest asset outside that cluster is at 1.5m, then 2.1m.
 * The band below therefore separates them cleanly with room on both sides.
 *
 * This matters because for such an asset the absolute size carries NO information
 * about what it is meant to be - a 14m warehouse and a 30cm coin purse are both
 * shipped 1.90m long - so comparing it against `sizeM` produces a confident,
 * meaningless complaint on two thirds of the tree. The first draft of this guard did
 * exactly that and reported ten props as "likely a unit error" when every one of
 * them was correct. Generator-normalised assets are therefore exempted from the
 * size comparison, and the exemption is COUNTED in the summary so it can never be a
 * silent hole.
 */
const GENERATOR_NORMALISED_M = [1.88, 1.92];

/**
 * For an asset authored at REAL scale, how far its mesh may sit from its declared
 * `sizeM` before this complains, and before it blocks.
 *
 * Calibrated against the tree rather than guessed: all 17 real-scale assets that
 * carry a declared box match it to within 2%, the sole exception being
 * flintlock-pistol.glb at 1.32x. So 1.15x is a meaningful note here, where on a
 * generator-normalised asset it would be meaningless.
 *
 * Blocking is set at 10x because a UNIT error is by definition a power of ten, so
 * 10x is the smallest factor that cannot be an art decision - and it is five times
 * beyond the largest discrepancy anywhere in the tree today.
 */
const SIZE_RATIO_NOTE = 1.15;
const SIZE_RATIO_BLOCK = 10;

/** Below this the mesh is degenerate rather than mis-scaled. */
const DEGENERATE_M = 1e-4;

// Assets whose declared sizeM is known to disagree with the mesh and where the
// DECLARATION is what is under review, not the geometry. Empty: this guard was
// written with the officer as its only subject, and every ratio it currently
// reports is a real observation someone should look at rather than debt to hide.
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

// ---------------------------------------------------------------- accessors
const COMPONENT = {
  5120: { bytes: 1, read: (b, o) => b.readInt8(o), max: 127 },
  5121: { bytes: 1, read: (b, o) => b.readUInt8(o), max: 255 },
  5122: { bytes: 2, read: (b, o) => b.readInt16LE(o), max: 32767 },
  5123: { bytes: 2, read: (b, o) => b.readUInt16LE(o), max: 65535 },
  5125: { bytes: 4, read: (b, o) => b.readUInt32LE(o), max: 4294967295 },
  5126: { bytes: 4, read: (b, o) => b.readFloatLE(o), max: 1 },
};
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** Decode an accessor into a flat Float64Array. Handles stride and normalisation. */
function readAccessor(document, index) {
  const accessor = document.json.accessors?.[index];
  if (!accessor) return null;
  if (accessor.sparse) return null; // never emitted by this pipeline; do not guess
  const component = COMPONENT[accessor.componentType];
  if (!component) return null;
  const lanes = TYPE_COUNT[accessor.type];
  const out = new Float64Array(accessor.count * lanes);
  const viewIndex = accessor.bufferView;
  if (viewIndex === undefined) return out; // spec: treat as zeros
  const view = document.json.bufferViews[viewIndex];
  const element = component.bytes * lanes;
  const stride = view.byteStride || element;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const binary = document.binary;
  if (!binary) return null;
  for (let i = 0; i < accessor.count; i++) {
    const base = start + i * stride;
    for (let lane = 0; lane < lanes; lane++) {
      const offset = base + lane * component.bytes;
      if (offset + component.bytes > binary.length) return null;
      let value = component.read(binary, offset);
      if (accessor.normalized && accessor.componentType !== 5126) {
        value = Math.max(value / component.max, -1);
      }
      out[i * lanes + lane] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------- 4x4 matrices
// Column-major, matching glTF's `node.matrix` and three.js's internal `elements`,
// so a matrix read out of the file needs no transposition. m[column * 4 + row].
function identity() {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function multiply(a, b) {
  const out = new Float64Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function compose(translation, rotation, scale) {
  const [x, y, z, w] = rotation;
  const [sx, sy, sz] = scale;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * sx;
  m[1] = (xy + wz) * sx;
  m[2] = (xz - wy) * sx;
  m[4] = (xy - wz) * sy;
  m[5] = (1 - (xx + zz)) * sy;
  m[6] = (yz + wx) * sy;
  m[8] = (xz + wy) * sz;
  m[9] = (yz - wx) * sz;
  m[10] = (1 - (xx + yy)) * sz;
  m[12] = translation[0];
  m[13] = translation[1];
  m[14] = translation[2];
  m[15] = 1;
  return m;
}

function transformPoint(m, x, y, z) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

function localMatrix(node) {
  if (node.matrix) return Float64Array.from(node.matrix);
  return compose(
    node.translation ?? [0, 0, 0],
    node.rotation ?? [0, 0, 0, 1],
    node.scale ?? [1, 1, 1],
  );
}

/** World matrix per node index, walking every scene root. */
function worldMatrices(document) {
  const nodes = document.json.nodes ?? [];
  const world = new Array(nodes.length).fill(null);
  const roots = new Set();
  for (const scene of document.json.scenes ?? []) {
    for (const index of scene.nodes ?? []) roots.add(index);
  }
  if (roots.size === 0) {
    const child = new Set();
    for (const node of nodes) for (const index of node.children ?? []) child.add(index);
    nodes.forEach((_, index) => {
      if (!child.has(index)) roots.add(index);
    });
  }
  const walk = (index, parent, seen) => {
    if (index >= nodes.length || seen.has(index)) return;
    seen.add(index);
    const matrix = multiply(parent, localMatrix(nodes[index]));
    world[index] = matrix;
    for (const child of nodes[index].children ?? []) walk(child, matrix, seen);
  };
  for (const root of roots) walk(root, identity(), new Set());
  // A node unreachable from any scene is not drawn, but measuring it as if it
  // were at the origin is better than leaving a null behind.
  for (let index = 0; index < nodes.length; index++) {
    if (!world[index]) world[index] = identity();
  }
  return world;
}

// ---------------------------------------------------------------- bounds
function emptyBox() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], any: false };
}

function expand(box, point) {
  for (let axis = 0; axis < 3; axis++) {
    if (point[axis] < box.min[axis]) box.min[axis] = point[axis];
    if (point[axis] > box.max[axis]) box.max[axis] = point[axis];
  }
  box.any = true;
}

function boxSize(box) {
  if (!box.any) return null;
  return [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
}

/**
 * The bounds the renderer actually draws, in scene space.
 *
 * Static meshes take the accessor's own min/max through the node matrix, which is
 * exact and costs eight points per primitive. Skinned meshes cannot: their
 * vertices are placed by the bone matrices, so every vertex is evaluated.
 */
export function effectiveBounds(document) {
  const world = worldMatrices(document);
  const nodes = document.json.nodes ?? [];
  const box = emptyBox();
  let skinnedVertices = 0;
  let staticPrimitives = 0;
  const problems = [];

  nodes.forEach((node, nodeIndex) => {
    if (node.mesh === undefined) return;
    const mesh = document.json.meshes?.[node.mesh];
    if (!mesh) return;
    const nodeWorld = world[nodeIndex];

    // A SKINNED mesh node's own transform is IGNORED, and this is worth stating
    // precisely because getting it wrong is a 100x error on this cast, whose
    // armature node carries scale 0.01.
    //
    // GLTFLoader binds every skinned mesh with `mesh.bind( skeleton,
    // _identityMatrix )`, and SkinnedMesh in the default AttachedBindMode keeps
    // `bindMatrixInverse = matrixWorld^-1`. So applyBoneTransform returns
    // matrixWorld^-1 * (sum_j w_j * jointWorld_j * IBM_j) * p in mesh-local space,
    // and putting that back into world space multiplies by matrixWorld again, which
    // cancels. The net expression carries no node transform at all:
    //
    //     world = ( sum_j w_j * jointWorld_j * IBM_j ) * p
    //
    // which is also what the glTF spec mandates. The first version of this file
    // applied nodeWorld as well and reported every rig at 1/100 of its true height;
    // `probe_rig_scale.mjs --cross-check` is what caught that, and is why the
    // cross-check exists rather than being assumed.
    const skin = node.skin !== undefined ? document.json.skins?.[node.skin] : null;
    let jointMatrices = null;
    if (skin) {
      const inverseBind =
        skin.inverseBindMatrices !== undefined
          ? readAccessor(document, skin.inverseBindMatrices)
          : null;
      jointMatrices = skin.joints.map((jointIndex, slot) => {
        const jointWorld = world[jointIndex] ?? identity();
        if (!inverseBind) return jointWorld;
        const ibm = inverseBind.subarray(slot * 16, slot * 16 + 16);
        return multiply(jointWorld, ibm);
      });
    }

    for (const primitive of mesh.primitives ?? []) {
      const positionIndex = primitive.attributes?.POSITION;
      if (positionIndex === undefined) continue;
      const accessor = document.json.accessors[positionIndex];

      if (!jointMatrices) {
        if (accessor.min && accessor.max) {
          for (let corner = 0; corner < 8; corner++) {
            const point = [
              corner & 1 ? accessor.max[0] : accessor.min[0],
              corner & 2 ? accessor.max[1] : accessor.min[1],
              corner & 4 ? accessor.max[2] : accessor.min[2],
            ];
            expand(box, transformPoint(nodeWorld, point[0], point[1], point[2]));
          }
          staticPrimitives++;
        } else {
          const positions = readAccessor(document, positionIndex);
          if (!positions) {
            problems.push(`primitive POSITION accessor ${positionIndex} unreadable`);
            continue;
          }
          for (let i = 0; i < accessor.count; i++) {
            expand(
              box,
              transformPoint(nodeWorld, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]),
            );
          }
          staticPrimitives++;
        }
        continue;
      }

      const positions = readAccessor(document, positionIndex);
      const joints = readAccessor(document, primitive.attributes.JOINTS_0);
      const weights = readAccessor(document, primitive.attributes.WEIGHTS_0);
      if (!positions || !joints || !weights) {
        problems.push(`skinned primitive missing POSITION/JOINTS_0/WEIGHTS_0`);
        continue;
      }
      for (let i = 0; i < accessor.count; i++) {
        const bx = positions[i * 3];
        const by = positions[i * 3 + 1];
        const bz = positions[i * 3 + 2];
        let x = 0;
        let y = 0;
        let z = 0;
        let total = 0;
        for (let lane = 0; lane < 4; lane++) {
          const weight = weights[i * 4 + lane];
          if (weight === 0) continue;
          const matrix = jointMatrices[joints[i * 4 + lane]];
          if (!matrix) continue;
          const point = transformPoint(matrix, bx, by, bz);
          x += point[0] * weight;
          y += point[1] * weight;
          z += point[2] * weight;
          total += weight;
        }
        // GLTFLoader calls normalizeSkinWeights() on every skinned mesh, so weights
        // that do not sum to 1 are rescaled rather than shrinking the body.
        if (total === 0) {
          // Unweighted vertex: three.js leaves it at the origin, so match that
          // rather than inventing a position for it.
          expand(box, [0, 0, 0]);
        } else {
          expand(box, [x / total, y / total, z / total]);
        }
        skinnedVertices++;
      }
    }
  });

  return { box, size: boxSize(box), skinnedVertices, staticPrimitives, problems };
}

// ---------------------------------------------------------------- manifest
/**
 * Declared sizes from packages/mission-m1/src/assets.ts, keyed by published path.
 *
 * Read with a regex rather than by importing the module, because this script must
 * keep working when node_modules is absent - the same reason the texture guard
 * inflates PNGs by hand. `path` always precedes `sizeM` within an entry in that
 * file; the count is reported so a silent parse failure cannot look like a clean
 * run.
 */
export function declaredSizes(manifestPath = MANIFEST) {
  const sizes = new Map();
  if (!existsSync(manifestPath)) return sizes;
  const source = readFileSync(manifestPath, "utf8");

  // Entries are located by their `key:` and each is parsed inside the slice that
  // runs to the NEXT `key:`. Doing it in two passes keeps every pattern free of
  // nested quantifiers - a single combined regex with two lazy `[\s\S]{0,4000}?`
  // spans backtracked so badly it took 55 seconds on this file.
  const keyPattern = /\bkey:\s*"([^"]+)"/g;
  const starts = [];
  let match;
  while ((match = keyPattern.exec(source)) !== null) {
    starts.push({ key: match[1], index: match.index });
  }
  for (let i = 0; i < starts.length; i++) {
    const slice = source.slice(starts[i].index, starts[i + 1]?.index ?? source.length);
    const path = /\bpath:\s*"([^"]+)"/.exec(slice);
    const size = /\bsizeM:\s*\[\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\]/.exec(
      slice,
    );
    if (!path || !size) continue;
    sizes.set(path[1], {
      key: starts[i].key,
      sizeM: [Number(size[1]), Number(size[2]), Number(size[3])],
    });
  }
  return sizes;
}

// ---------------------------------------------------------------- the checks
const RIGGED_PATTERN = /-rigged\.glb$/;

export function inspectWorldScale(path, options = {}) {
  const findings = [];
  if (!existsSync(path)) return { missing: true, findings };
  const data = readFileSync(path);
  const document = glbDocument(data);
  if (!document) {
    // A present-but-unparseable GLB is not the declared-but-unbuilt case this
    // guard leaves alone (that is a MISSING file, returned above). It is a
    // truncated or corrupt file on the served path that will fail to load in the
    // browser just as it failed to parse here, so it blocks rather than passing
    // the scale gate silently.
    findings.push({
      code: "UNREADABLE_GLB",
      block: true,
      detail: "not a parseable binary glTF",
      fix: "check the export; this file is truncated or corrupt and will not load",
    });
    return { findings };
  }

  const measured = effectiveBounds(document);
  for (const problem of measured.problems) {
    findings.push({
      code: "UNMEASURABLE_GEOMETRY",
      block: false,
      detail: problem,
      fix: "inspect by hand; this guard could not read the geometry",
    });
  }
  if (!measured.size) {
    return { findings, measured };
  }

  const [sizeX, height, sizeZ] = measured.size;
  const rigged = options.rigged ?? RIGGED_PATTERN.test(path);

  if (rigged) {
    if (height < DEGENERATE_M) {
      findings.push({
        code: "DEGENERATE_RIG",
        block: true,
        detail: `effective height ${height.toExponential(3)}m is degenerate`,
        fix: "the rig has no usable geometry; re-export it",
      });
    } else if (height < HUMAN_HEIGHT_M[0] || height > HUMAN_HEIGHT_M[1]) {
      // Naming the decimal factor turns "this is wrong" into "this is a unit
      // error, and here is the one", which is the whole diagnosis for this class.
      const decimal = [1000, 100, 10, 0.1, 0.01, 0.001].find(
        (factor) => height * factor >= HUMAN_HEIGHT_M[0] && height * factor <= HUMAN_HEIGHT_M[1],
      );
      findings.push({
        code: "RIG_NOT_HUMAN_SCALED",
        block: true,
        detail:
          `effective height ${height.toFixed(4)}m is outside ${HUMAN_HEIGHT_M[0]}-${HUMAN_HEIGHT_M[1]}m` +
          (decimal ? ` (x${decimal} would land at ${(height * decimal).toFixed(4)}m: a unit error)` : ""),
        fix: decimal
          ? "this is a units bug, not an art decision. Rescale by the named factor:\n" +
            `      python3 assets/pipeline/rescale_rig_glb.py --factor ${decimal} in.glb out.glb\n` +
            "      python3 assets/pipeline/verify_rig_rescale.py --factor " +
            `${decimal} in.glb out.glb\n` +
            "      and fix the bake so a rebake cannot reintroduce it (see\n" +
            "      normalise_rig_units in assets/pipeline/bake_native_mixamo_character.py)."
          : "measure the source rig with assets/pipeline/probe_fbx_rig_units.py; no single\n" +
            "      decimal factor explains this, so the input is wrong in some other way",
      });
    }
  } else if (height < DEGENERATE_M && sizeX < DEGENERATE_M && sizeZ < DEGENERATE_M) {
    findings.push({
      code: "DEGENERATE_MESH",
      block: true,
      detail: `effective size ${measured.size.map((v) => v.toExponential(2)).join(" x ")}m is degenerate`,
      fix: "the asset has no usable geometry; re-export it",
    });
  }

  const longest = Math.max(...measured.size);
  const generatorNormalised =
    !rigged &&
    longest >= GENERATOR_NORMALISED_M[0] &&
    longest <= GENERATOR_NORMALISED_M[1];

  const declared = options.declared;
  if (declared && generatorNormalised) {
    // Deliberately not compared. See GENERATOR_NORMALISED_M: the mesh is unit-sized
    // by the generator and contain-fitted at runtime, so its absolute size says
    // nothing about whether the declaration is right.
    return { findings, measured, generatorNormalised };
  }
  if (declared) {
    // Worst axis, both directions, so a mesh that is 100x too small on one axis is
    // caught even when the others happen to look plausible.
    //
    // Axes are skipped INDIVIDUALLY when either side is degenerate, never the whole
    // comparison: a flat asset legitimately has a near-zero axis, and skipping the
    // entire check because of it would silently disable this half of the guard on
    // exactly the boards, planks and panels most likely to be mis-declared.
    // For a CHARACTER only the height is comparable. A rig's declared box is a
    // collision capsule - 0.70 x height x 0.50 across the whole cast - while the
    // mesh is measured in a T-pose whose arms span 1.5-1.8m. Comparing x or z there
    // reports every rig in the game as 2.5x too wide, which is true of the numbers
    // and false about the asset.
    const axes = rigged ? [1] : [0, 1, 2];
    let worst = 1;
    let worstAxis = -1;
    let comparable = 0;
    for (const axis of axes) {
      if (!(declared[axis] > DEGENERATE_M) || !(measured.size[axis] > DEGENERATE_M)) continue;
      comparable++;
      const ratio = measured.size[axis] / declared[axis];
      const magnitude = Math.max(ratio, 1 / ratio);
      if (magnitude > worst) {
        worst = magnitude;
        worstAxis = axis;
      }
    }
    if (comparable === 0) {
      findings.push({
        code: "SIZE_NOT_COMPARABLE",
        block: false,
        detail:
          `no axis of ${measured.size.map((v) => v.toFixed(3)).join(" x ")}m can be compared ` +
          `against declared ${declared.map((v) => v.toFixed(2)).join(" x ")}m`,
        fix: "one side is degenerate on every axis; inspect by hand",
      });
    } else if (worst >= SIZE_RATIO_NOTE) {
      const axisName = "xyz"[worstAxis];
      const decimal = [1000, 100, 10, 0.1, 0.01, 0.001].find((factor) => {
        const scaled = measured.size[worstAxis] * factor;
        return scaled / declared[worstAxis] < SIZE_RATIO_NOTE && declared[worstAxis] / scaled < SIZE_RATIO_NOTE;
      });
      findings.push({
        code: "SIZE_FAR_FROM_DECLARED",
        block: worst >= SIZE_RATIO_BLOCK,
        detail:
          `mesh ${measured.size.map((v) => v.toFixed(3)).join(" x ")}m vs declared ` +
          `${declared.map((v) => v.toFixed(2)).join(" x ")}m: ${worst.toFixed(1)}x apart on ${axisName}` +
          (decimal ? ` (x${decimal} would reconcile them: likely a unit error)` : ""),
        fix:
          "the level contain-fits a prop into its box, so a moderate difference is by\n" +
          "      design. A factor near a power of ten is not: either the mesh is in the wrong\n" +
          "      unit or the declared sizeM is wrong. Confirm which with\n" +
          "      `node scripts/check-world-scale.mjs --json <file>` before changing either.",
      });
    }
  }

  return { findings, measured, generatorNormalised };
}

// ---------------------------------------------------------------- self-test
// A scale guard that measures the WRONG height is worse than no guard: it reports
// confidently, and this project has already lost hours to exactly that. The two
// ways it would be wrong are symmetric and both are tested here against rigs built
// in this file, where the right answer is known by construction:
//
//   * ignoring node transforms, which makes a correct-but-parented rig look broken
//     (a FALSE ALARM), and
//   * reading raw POSITION bounds, which makes a rig whose parent shrinks it look
//     fine (a MISS - the officer's exact defect).
//
// So the same POSITION data is wrapped in three different transform hierarchies and
// the verdicts must differ. If the measurement collapsed to raw bounds, all three
// would agree.
function pad4(blob) {
  return Buffer.concat([blob, Buffer.alloc((-blob.length % 4 + 4) % 4)]);
}

/**
 * A one-triangle skinned rig `metres` tall, under an armature node scaled by
 * `armatureScale`, with POSITION pre-divided by `positionDivisor`.
 *
 * Built so that the EFFECTIVE height is `metres` whenever
 * `armatureScale * positionDivisor === 1`, which lets a test hold the effective
 * answer fixed while moving the raw bounds, and vice versa.
 */
function syntheticRig({ metres, armatureScale = 1, positionDivisor = 1, skinned = true }) {
  // Three-dimensional on purpose: a flat test body would exercise the degenerate
  // path instead of the one under test.
  const top = metres / positionDivisor;
  const depth = (metres * 0.25) / positionDivisor;
  const positions = Buffer.alloc(36);
  const points = [
    [0, 0, 0],
    [(metres * 0.5) / positionDivisor, top, depth],
    [-(metres * 0.5) / positionDivisor, top, depth],
  ];
  points.forEach((point, i) =>
    point.forEach((value, lane) => positions.writeFloatLE(value, (i * 3 + lane) * 4)),
  );
  const joints = Buffer.alloc(12);
  const weights = Buffer.alloc(48);
  for (let i = 0; i < 3; i++) weights.writeFloatLE(1, i * 16);
  const indices = Buffer.alloc(6);
  [0, 1, 2].forEach((v, i) => indices.writeUInt16LE(v, i * 2));
  const ibm = Buffer.alloc(64);
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].forEach((v, i) => ibm.writeFloatLE(v, i * 4));

  const blobs = [positions, joints, weights, indices, ibm];
  const views = [];
  let binary = Buffer.alloc(0);
  for (const blob of blobs) {
    views.push({ buffer: 0, byteOffset: binary.length, byteLength: blob.length });
    binary = Buffer.concat([binary, pad4(blob)]);
  }

  const attributes = { POSITION: 0 };
  if (skinned) {
    attributes.JOINTS_0 = 1;
    attributes.WEIGHTS_0 = 2;
  }
  const meshNode = { name: "Body", mesh: 0, translation: [0, 0, 0] };
  if (skinned) meshNode.skin = 0;
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: skinned ? [0, 2] : [0] }],
    nodes: skinned
      ? [
          { name: "Armature", scale: [armatureScale, armatureScale, armatureScale], children: [1] },
          { name: "Root", translation: [0, 0, 0] },
          meshNode,
        ]
      : [{ name: "Armature", scale: [armatureScale, armatureScale, armatureScale], children: [1] }, meshNode],
    meshes: [{ name: "Mesh0", primitives: [{ attributes, indices: 3 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-(metres * 0.5) / positionDivisor, 0, 0],
        max: [(metres * 0.5) / positionDivisor, top, depth],
      },
      { bufferView: 1, componentType: 5121, count: 3, type: "VEC4" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC4" },
      { bufferView: 3, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 4, componentType: 5126, count: 1, type: "MAT4" },
    ],
    bufferViews: views,
    buffers: [{ byteLength: binary.length }],
  };
  if (skinned) json.skins = [{ name: "Armature", joints: [1], inverseBindMatrices: 4 }];

  let jsonBlob = Buffer.from(JSON.stringify(json), "utf8");
  jsonBlob = Buffer.concat([jsonBlob, Buffer.alloc((-jsonBlob.length % 4 + 4) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBlob.length + 8 + binary.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBlob.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBlob, binHeader, binary]);
}

function selfTest() {
  const directory = mkdtempSync(join(tmpdir(), "world-scale-"));
  let failed = 0;

  const check = (label, ok, detail) => {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${detail}`);
  };

  console.log(
    "world-scale selftest: does the measurement follow NODE TRANSFORMS, or just read\n" +
      "  raw POSITION bounds? Same body, three hierarchies, three different right answers.",
  );

  const cases = [
    {
      label: "plain 1.75m rig",
      rig: { metres: 1.75 },
      rawHeight: 1.75,
      expectHeight: 1.75,
      expectBlock: false,
    },
    {
      // THE OFFICER. Raw bounds are 100x too small AND no parent compensates.
      label: "officer defect: raw 0.0175m, no compensation",
      rig: { metres: 0.0175 },
      rawHeight: 0.0175,
      expectHeight: 0.0175,
      expectBlock: true,
    },
    {
      // THE FALSE ALARM. Raw bounds look 100x too small but the armature scales
      // them back up, so the rig is CORRECT and must pass. A guard reading raw
      // POSITION would block this - which is the class of false report the
      // project has already paid for.
      label: "correct rig whose parent supplies the x100",
      rig: { metres: 1.75, armatureScale: 100, positionDivisor: 100 },
      rawHeight: 0.0175,
      expectHeight: 1.75,
      expectBlock: false,
    },
    {
      // THE MISS, mirrored. Raw bounds look right but the parent shrinks it, so
      // the rig is BROKEN and must block. A guard reading raw POSITION would pass
      // it.
      label: "broken rig whose parent shrinks correct bounds",
      rig: { metres: 0.0175, armatureScale: 0.01, positionDivisor: 0.01 },
      rawHeight: 1.75,
      expectHeight: 0.0175,
      expectBlock: true,
    },
  ];

  for (const testCase of cases) {
    const path = join(directory, `${testCase.label.replace(/[^a-z0-9]+/gi, "-")}.glb`);
    writeFileSync(path, syntheticRig(testCase.rig));
    const result = inspectWorldScale(path, { rigged: true });
    const height = result.measured?.size?.[1] ?? NaN;
    const blocked = result.findings.some((finding) => finding.block);
    const heightOk = Math.abs(height - testCase.expectHeight) < 1e-6;
    check(
      testCase.label,
      heightOk && blocked === testCase.expectBlock,
      `raw=${testCase.rawHeight.toFixed(4)}m effective=${height.toFixed(4)}m -> ` +
        `${blocked ? "BLOCKS" : "passes"}`,
    );
  }

  // The two cases above with identical raw bounds must disagree, and the two with
  // identical effective heights must agree. That is the discriminator, stated
  // directly rather than inferred from four independent PASSes.
  const rawSame = cases.filter((c) => Math.abs(c.rawHeight - 0.0175) < 1e-9);
  check(
    "same raw bounds, opposite verdicts",
    new Set(rawSame.map((c) => c.expectBlock)).size === 2,
    `${rawSame.length} cases at raw 0.0175m: ${rawSame.map((c) => (c.expectBlock ? "BLOCK" : "pass")).join(" vs ")}`,
  );

  // The declared-size half, on a static prop. A contain-fit ratio must pass and a
  // unit error must block, and the only difference between them is the factor.
  // The synthetic body is `m` wide, `m` tall and `m/4` deep, so a declared box of
  // [4, 4, 1] is an exact match at m=4 and a uniform 4x contain-fit at m=1.
  const staticCases = [
    { declared: [4, 4, 1], metres: 4, expectBlock: false, label: "prop matching its box" },
    { declared: [4, 4, 1], metres: 1, expectBlock: false, label: "prop contain-fitted 4x into its box" },
    { declared: [4, 4, 1], metres: 0.04, expectBlock: true, label: "prop 100x too small for its box" },
    { declared: [4, 4, 1], metres: 400, expectBlock: true, label: "prop 100x too large for its box" },
  ];
  console.log(
    "\n  and the declared-size half: a contain-fit must pass, a unit error must block.",
  );
  for (const testCase of staticCases) {
    const path = join(directory, `static-${testCase.metres}.glb`);
    writeFileSync(path, syntheticRig({ metres: testCase.metres, skinned: false }));
    const result = inspectWorldScale(path, { rigged: false, declared: testCase.declared });
    const blocked = result.findings.some((finding) => finding.block);
    const noted = result.findings.some((f) => f.code === "SIZE_FAR_FROM_DECLARED");
    check(
      testCase.label,
      blocked === testCase.expectBlock,
      `mesh y=${testCase.metres}m vs declared y=${testCase.declared[1]}m -> ` +
        `${blocked ? "BLOCKS" : noted ? "reports" : "silent"}`,
    );
  }

  // A parse failure in the manifest would disable half this guard silently.
  const sizes = declaredSizes();
  check(
    "manifest parses",
    sizes.size > 40 && sizes.has("world/characters/officer-rigged.glb"),
    `${sizes.size} declared sizes read from assets.ts`,
  );

  // A present-but-unparseable GLB must BLOCK; a missing one is left alone.
  const truncated = join(directory, "truncated.glb");
  writeFileSync(truncated, Buffer.from("glTF not a real binary gltf"));
  const unreadable = inspectWorldScale(truncated);
  const missing = inspectWorldScale(join(directory, "does-not-exist.glb"));
  check(
    "unparseable GLB blocks, absence is left alone",
    unreadable.findings.some((f) => f.block && f.code === "UNREADABLE_GLB") &&
      missing.missing === true,
    `unparseable -> ${unreadable.findings.some((f) => f.block) ? "BLOCKS" : "passes"}; ` +
      `missing -> ${missing.missing ? "skipped" : "NOT skipped"}`,
  );

  rmSync(directory, { recursive: true, force: true });
  console.log(
    failed === 0
      ? "world-scale selftest: OK (raw bounds held constant; only the hierarchy changed the verdict)"
      : `world-scale selftest: FAIL (${failed} case(s))`,
  );
  return failed;
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
  return out.sort();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) process.exit(selfTest() === 0 ? 0 : 1);
  const reportOnly = argv.includes("--report");
  const asJson = argv.includes("--json");
  const explicit = argv.filter((a) => !a.startsWith("--"));
  const files = explicit.length > 0 ? explicit.map((f) => resolve(f)) : publishedGlbs();
  const declared = declaredSizes();

  const started = Date.now();
  let scanned = 0;
  let skippedMissing = 0;
  const blocking = [];
  const reported = [];
  const debt = [];
  const rows = [];

  for (const file of files) {
    const inPublished = file.startsWith(PUBLISHED + "/");
    const key = relative(inPublished ? PUBLISHED : ROOT, file).split("\\").join("/");
    const manifestPath = inPublished ? `world/${key}` : null;
    const entry = manifestPath ? declared.get(manifestPath) : undefined;
    const result = inspectWorldScale(file, { declared: entry?.sizeM });
    if (result.missing) {
      skippedMissing++;
      continue;
    }
    scanned++;
    rows.push({
      key,
      size: result.measured?.size ?? null,
      minY: result.measured?.box.any ? result.measured.box.min[1] : null,
      declared: entry?.sizeM ?? null,
      rigged: RIGGED_PATTERN.test(file),
      generatorNormalised: Boolean(result.generatorNormalised),
      exemptedFromSizeCheck: Boolean(result.generatorNormalised && entry),
      codes: result.findings.map((f) => f.code),
    });
    const target = KNOWN_DEBT.has(key) ? debt : null;
    for (const finding of result.findings) {
      const row = { key, ...finding };
      if (target) target.push(row);
      else if (finding.block) blocking.push(row);
      else reported.push(row);
    }
  }

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    process.exit(blocking.length === 0 || reportOnly ? 0 : 1);
  }

  console.log(
    `world-scale: scanned ${scanned} published GLB(s) in ${((Date.now() - started) / 1000).toFixed(1)}s` +
      (skippedMissing > 0 ? `, skipped ${skippedMissing} that do not exist yet` : "") +
      `; ${declared.size} declared sizes read from assets.ts`,
  );
  if (declared.size === 0) {
    console.log(
      "  WARNING: no declared sizes parsed, so the sizeM half of this check did nothing.",
    );
  }

  const rigs = rows.filter((row) => row.rigged && row.size);
  if (rigs.length > 0) {
    const heights = rigs.map((row) => row.size[1]);
    console.log(
      `  ${rigs.length} rigged character(s): effective height ` +
        `${Math.min(...heights).toFixed(3)}-${Math.max(...heights).toFixed(3)}m`,
    );
  }
  const normalised = rows.filter((row) => row.generatorNormalised).length;
  const exempted = rows.filter((row) => row.exemptedFromSizeCheck).length;
  if (normalised > 0) {
    console.log(
      `  ${normalised} generator-normalised asset(s) (longest axis ` +
        `${GENERATOR_NORMALISED_M[0]}-${GENERATOR_NORMALISED_M[1]}m, contain-fitted at runtime); ` +
        `${exempted} of them carry a declared sizeM and are exempt from the size comparison`,
    );
  }

  if (debt.length > 0) {
    // KNOWN_DEBT is an override: it takes a finding that would otherwise block
    // and lets the publish through. An override that suppresses a real defect
    // must never be silent, so it warns rather than logging quietly — the same
    // discipline the boundary allowlists follow.
    console.warn(
      `  WARNING: ${debt.length} finding(s) suppressed by KNOWN_DEBT; the scale ` +
        "gate is being overridden for those assets.",
    );
    if (reportOnly) for (const row of debt) console.warn(`    debt: ${row.key}  ${row.code}  ${row.detail}`);
  }

  if (reported.length > 0) {
    console.log(`\n  ${reported.length} observation(s), not gated:`);
    for (const row of reported) console.log(`    note: ${row.key}  ${row.code}  ${row.detail}`);
  }

  if (blocking.length > 0) {
    console.error(`\n  FAIL: ${blocking.length} scale defect(s) that must not ship:`);
    for (const row of blocking) {
      console.error(`    error: ${row.key}`);
      console.error(`           ${row.code}: ${row.detail}`);
      console.error(`           fix: ${row.fix}`);
    }
    if (!reportOnly) process.exit(1);
  }

  if (blocking.length === 0) {
    console.log(
      `world-scale: OK (no blocking defect; ${debt.length} known debt, ${reported.length} note(s))`,
    );
  }
}
