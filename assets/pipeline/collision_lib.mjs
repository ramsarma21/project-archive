// Shared helpers for the collision-metadata foundation (build + validate).
//
// This module is deliberately runtime-free: it never imports the shipping web
// source, never mutates apps/web/src/world/manifest.ts, and only READS the
// deployed/optimized GLB set plus authored collision sidecars. Everything it
// emits lands under assets/build/collision (a generated location), so it can be
// developed in parallel with active runtime/collision work without racing it.
//
// Coordinate model (see assets/source/collision/README.md for the full spec):
//   Authored colliders live in a FIT-NORMALIZED, ASSET-LOCAL frame, in METERS:
//     - origin is centered on the asset footprint in X/Z,
//     - y = 0 is the asset's feet (grounded), +y is up,
//     - the frame matches what FittedGlb produces just before world placement
//       (uniform min-axis fit to the manifest target size, recenter XZ, drop to
//       ground). Placement yaw + world position are applied LATER at
//       integration time; sidecars never bake yaw/position in.
//   This is exactly the pre-rotation, pre-translation box the runtime builds in
//   Character.tsx > FittedGlbInner, so a later integration step is a pure
//   rotate+translate with no re-derivation of scale.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const PATHS = {
  repoRoot: REPO_ROOT,
  manifest: join(REPO_ROOT, "apps", "web", "src", "world", "manifest.ts"),
  // The deployed set Vite actually serves (FittedGlb loads /world/props/<key>.glb).
  deployedProps: join(REPO_ROOT, "apps", "web", "public", "world", "props"),
  sidecars: join(REPO_ROOT, "assets", "source", "collision"),
  outDir: join(REPO_ROOT, "assets", "build", "collision"),
};

// Margin any collider may exceed the measured fitted visual bounds by without a
// documented reason (Day-1 authoring rule: <=10cm or carry an explicit reason).
export const DEFAULT_MARGIN_M = 0.10;

export const SHAPES = new Set(["box", "capsule", "support", "hazard", "none"]);
// Reserved composition references: recorded but never authored into final
// leaves/openings until the door + traversal contracts land.
export const RESERVED_SHAPES = new Set(["door", "traversal"]);

export const CATEGORIES = new Set([
  "building", // BUILDINGS row/civic/wharf/church shells
  "prop", // major outdoor street furniture / working dressing
  "ship", // moored vessels + boats with measurable decks/hulls
  "interior", // interior kit / hero-room dressing (final profile pending placement)
  "surface", // walkable ground planes (roads, aprons, yards)
  "clutter", // tiny non-blocking loose objects
  "firstperson", // first-person arm/grip rigs (never world collision)
  "skyline", // distant backdrop clusters
]);

// Categories that MUST carry a real collision profile (missing => hard error).
export const SUBSTANTIAL_CATEGORIES = new Set(["building", "prop", "ship"]);

// ---- three.js (read-only GLB measurement) ----------------------------------

let _three = null;
export async function loadThree() {
  if (_three) return _three;
  const threeRoot = join(REPO_ROOT, "apps", "web", "node_modules", "three");
  const mod = await import(pathToFileURL(join(threeRoot, "build", "three.module.js")));
  const loaderMod = await import(
    pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js"))
  );
  _three = { Box3: mod.Box3, Vector3: mod.Vector3, GLTFLoader: loaderMod.GLTFLoader };
  return _three;
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// Parse the GLB JSON chunk header to count declared nodes without a full load.
function glbNodeCount(data) {
  if (data.readUInt32LE(0) !== 0x46546c67) return null; // not binary glTF
  const jsonLength = data.readUInt32LE(12);
  if (data.readUInt32LE(16) !== 0x4e4f534a) return null; // first chunk not JSON
  try {
    const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8").trim());
    return {
      nodes: json.nodes?.length ?? 0,
      meshes: json.meshes?.length ?? 0,
      materials: json.materials?.length ?? 0,
    };
  } catch {
    return null;
  }
}

// Measure one GLB: content hash, raw local bounds (native units, y-up), plus
// node/mesh/triangle counts. Bounds mirror THREE.Box3().setFromObject(scene) so
// they match exactly what FittedGlb measures at runtime.
export async function measureGlb(filePath) {
  const { Box3, Vector3, GLTFLoader } = await loadThree();
  const bytes = readFileSync(filePath);
  const hash = sha256(bytes);
  const counts = glbNodeCount(bytes) ?? { nodes: 0, meshes: 0, materials: 0 };
  const loader = new GLTFLoader();
  // Node has no blob URL fetch, so GLTFLoader logs a benign "Couldn't load
  // texture" line per embedded image. Bounds come from geometry, not textures,
  // so mute that specific noise while parsing.
  const origError = console.error;
  console.error = (...args) => {
    if (typeof args[0] === "string" && args[0].includes("Couldn't load texture")) return;
    origError(...args);
  };
  let gltf;
  try {
    gltf = await new Promise((res, rej) =>
      loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", res, rej),
    );
  } finally {
    console.error = origError;
  }
  const box = new Box3().setFromObject(gltf.scene);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  let meshCount = 0;
  let triangles = 0;
  gltf.scene.traverse((node) => {
    if (node.isMesh) {
      meshCount++;
      const index = node.geometry.index;
      triangles += (index ? index.count : node.geometry.attributes.position.count) / 3;
    }
  });
  return {
    hash,
    rawMin: [box.min.x, box.min.y, box.min.z],
    rawMax: [box.max.x, box.max.y, box.max.z],
    rawSize: [size.x, size.y, size.z],
    rawCenter: [center.x, center.y, center.z],
    nodeCount: counts.nodes,
    meshCount: meshCount || counts.meshes,
    triangles: Math.round(triangles),
  };
}

// ---- manifest.ts array extraction (read-only, no TS toolchain) -------------

// Pull `export const NAME ... = [ ... ];` out of the manifest and evaluate the
// (pure data) array literal. The literals only reference Math.*, so a scoped
// Function keeps the eval bounded and deterministic.
export function extractArray(src, name) {
  const marker = `export const ${name}`;
  const start = src.indexOf(marker);
  if (start < 0) return null;
  // Skip the type annotation (e.g. `: BuildingDef[]`) by anchoring on the
  // assignment `=`, then take the first `[` of the value literal.
  const eq = src.indexOf("=", start);
  if (eq < 0) return null;
  const open = src.indexOf("[", eq);
  if (open < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  const body = src.slice(open, end + 1);
  // eslint-disable-next-line no-new-func
  return Function("Math", `"use strict"; return (${body});`)(Math);
}

export function loadManifest() {
  const src = readFileSync(PATHS.manifest, "utf8");
  return {
    buildings: extractArray(src, "BUILDINGS") ?? [],
    props: extractArray(src, "PROPS") ?? [],
    gates: extractArray(src, "GATES") ?? [],
  };
}

// ---- fit math (mirrors Character.tsx > FittedGlbInner) ---------------------

// Uniform scale used to fit a raw GLB into a placement. When a target size is
// given, the runtime picks the MIN per-axis ratio so the model fits inside the
// slot on its most constraining axis; otherwise it uses the raw scale (default
// 1). This is why nominal slots and visual footprints diverge so hard.
export function fitScale(rawSize, targetSize, scale = 1) {
  if (!targetSize) return scale ?? 1;
  const sx = targetSize[0] / (rawSize[0] || 1);
  const sy = targetSize[1] / (rawSize[1] || 1);
  const sz = targetSize[2] / (rawSize[2] || 1);
  return Math.min(sx, sy, sz);
}

export function fittedSize(rawSize, s) {
  return [rawSize[0] * s, rawSize[1] * s, rawSize[2] * s];
}

// Map a raw GLB-space point into the fit-normalized meter frame (centered XZ,
// grounded y=0) at fit scale s. rawCenter/rawMin come from measureGlb.
export function rawToFitLocal(rawPoint, rawCenter, rawMin, s) {
  return [
    s * (rawPoint[0] - rawCenter[0]),
    s * (rawPoint[1] - rawMin[1]),
    s * (rawPoint[2] - rawCenter[2]),
  ];
}

// Rotate a point about +Y (yaw in radians). Used by the transform test and the
// eventual integration step; sidecars are authored pre-rotation.
export function rotateY(point, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [point[0] * c + point[2] * s, point[1], -point[0] * s + point[2] * c];
}

// Fit-normalized local point -> world (rotate about Y by placement yaw, then
// translate by placement position). Local is already in fitted meters.
export function localToWorld(point, pos, rotY) {
  const r = rotateY(point, rotY);
  return [r[0] + pos[0], r[1] + pos[1], r[2] + pos[2]];
}

// ---- sidecar loading + shape geometry --------------------------------------

export function loadSidecars() {
  const out = new Map();
  if (!existsSync(PATHS.sidecars)) return out;
  for (const f of readdirSync(PATHS.sidecars)) {
    if (!f.endsWith(".collision.json")) continue;
    const full = join(PATHS.sidecars, f);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(full, "utf8"));
    } catch (err) {
      out.set(basename(f), { __parseError: String(err?.message ?? err), __file: f });
      continue;
    }
    const key = parsed.assetKey ?? basename(f).replace(/\.collision\.json$/, "");
    out.set(key, { ...parsed, __file: f });
  }
  return out;
}

// Local-frame AABB of a single collider, in fitted meters. Returns null for
// `none` and reserved composition placeholders (they carry no measurable box).
export function colliderAabb(c) {
  switch (c.shape) {
    case "box": {
      const [cx, cy, cz] = c.center ?? [0, 0, 0];
      const [hx, hy, hz] = c.half ?? [0, 0, 0];
      // Authored yaw only spins the box in XZ; take the rotated footprint's
      // enclosing extent so validation stays conservative.
      const yaw = c.yaw ?? 0;
      const ex = Math.abs(hx * Math.cos(yaw)) + Math.abs(hz * Math.sin(yaw));
      const ez = Math.abs(hx * Math.sin(yaw)) + Math.abs(hz * Math.cos(yaw));
      return { minX: cx - ex, maxX: cx + ex, minY: cy - hy, maxY: cy + hy, minZ: cz - ez, maxZ: cz + ez };
    }
    case "capsule": {
      const a = c.a ?? [0, 0, 0];
      const b = c.b ?? [0, 0, 0];
      const r = c.radius ?? 0;
      return {
        minX: Math.min(a[0], b[0]) - r,
        maxX: Math.max(a[0], b[0]) + r,
        minY: Math.min(a[1], b[1]) - r,
        maxY: Math.max(a[1], b[1]) + r,
        minZ: Math.min(a[2], b[2]) - r,
        maxZ: Math.max(a[2], b[2]) + r,
      };
    }
    case "support":
    case "hazard": {
      const poly = c.polygon ?? [];
      if (!poly.length) return null;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of poly) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      const y = c.shape === "support" ? (c.y ?? 0) : (c.minY ?? 0);
      const topY = c.shape === "support" ? (c.y ?? 0) : (c.maxY ?? c.y ?? 0);
      return { minX, maxX, minY: y, maxY: Math.max(topY, y), minZ, maxZ };
    }
    default:
      return null;
  }
}

// Measured fitted visual bounds in the authored local frame (centered XZ,
// grounded), for a given raw size + fit scale.
export function fittedLocalBounds(rawSize, s) {
  const [fx, fy, fz] = fittedSize(rawSize, s);
  return { minX: -fx / 2, maxX: fx / 2, minY: 0, maxY: fy, minZ: -fz / 2, maxZ: fz / 2, fittedSize: [fx, fy, fz] };
}

export function round(n, p = 3) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

// ---- manifest usage + fit resolution ---------------------------------------

// The effective visual fit target FittedGlb uses for a PROP placement (mirrors
// District.tsx > Props3D): explicit size wins; the liberty elm and generic
// clutter fall back to authored defaults; bldg-* props keep raw scale.
export function effectivePropFit(p) {
  if (p.size) return { targetSize: p.size, scale: p.scale ?? 1 };
  if (p.glb === "liberty-elm") return { targetSize: [14, 16, 14], scale: p.scale ?? 1 };
  if (typeof p.glb === "string" && p.glb.startsWith("bldg")) return { targetSize: null, scale: p.scale ?? 1 };
  return { targetSize: [2.6, 2.6, 2.6], scale: p.scale ?? 1 };
}

// Aggregate manifest placements per GLB key so the report can show every
// nominal slot / fit / collide tuple an asset is used at.
export function buildUsage(manifest) {
  const usage = new Map();
  const ensure = (key) => {
    if (!usage.has(key)) usage.set(key, { buildings: [], props: [], gates: [] });
    return usage.get(key);
  };
  for (const b of manifest.buildings) {
    if (!b.glb) continue;
    ensure(b.glb).buildings.push({ id: b.id, pos: b.pos, rotY: b.rotY, slot: b.size });
  }
  for (const p of manifest.props) {
    const fit = effectivePropFit(p);
    ensure(p.glb).props.push({ pos: p.pos, rotY: p.rotY, fit, collide: p.collide ?? null, gate: p.gate ?? null });
  }
  for (const g of manifest.gates) {
    ensure(g.glb).gates.push({ x: g.x, halfOpening: g.halfOpening, halfSpan: g.halfSpan });
  }
  return usage;
}

// A single representative fit for an asset (first building slot, else first prop
// fit, else raw scale 1). Used when a sidecar omits its `fit` context and for
// the primary row of the audit report.
export function representativeFit(usageEntry) {
  if (!usageEntry) return { targetSize: null, scale: 1, source: "raw" };
  if (usageEntry.buildings.length) {
    return { targetSize: usageEntry.buildings[0].slot, scale: 1, source: `building:${usageEntry.buildings[0].id}` };
  }
  if (usageEntry.props.length) {
    const f = usageEntry.props[0].fit;
    return { targetSize: f.targetSize, scale: f.scale, source: "prop" };
  }
  return { targetSize: null, scale: 1, source: "raw" };
}

// ---- assembly (measured + authored + derived) ------------------------------

function nearlyEqual(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

// Build the full collision-metadata model. Both build_collision_manifest and
// validate_collision_manifest call this so they see identical data.
export async function assemble() {
  const manifest = loadManifest();
  const usage = buildUsage(manifest);
  const sidecars = loadSidecars();

  const deployed = new Map();
  if (existsSync(PATHS.deployedProps)) {
    for (const f of readdirSync(PATHS.deployedProps)) {
      if (f.endsWith(".glb")) deployed.set(f.replace(/\.glb$/, ""), join(PATHS.deployedProps, f));
    }
  }

  const keys = new Set([...deployed.keys(), ...sidecars.keys(), ...usage.keys()]);
  const assets = {};
  const issues = [];
  const addIssue = (severity, category, assetKey, message) =>
    issues.push({ severity, category, assetKey, message });

  for (const key of [...keys].sort()) {
    const file = deployed.get(key) ?? null;
    const sidecar = sidecars.get(key) ?? null;
    const usageEntry = usage.get(key) ?? null;
    const referenced = Boolean(usageEntry);

    const record = {
      assetKey: key,
      file: file ? `apps/web/public/world/props/${key}.glb` : null,
      fileExists: Boolean(file),
      referencedInManifest: referenced,
      hasSidecar: Boolean(sidecar),
      measured: null,
      category: sidecar?.category ?? null,
      profile: sidecar?.profile ?? null,
      frontAxis: sidecar?.frontAxis ?? null,
      pendingDoorContract: Boolean(sidecar?.pendingDoorContract),
      pendingInteriorPlacement: Boolean(sidecar?.pendingInteriorPlacement),
      note: sidecar?.note ?? null,
      fit: null,
      colliders: sidecar?.colliders ?? [],
      compose: sidecar?.compose ?? [],
      usage: usageEntry,
      derived: {},
    };

    if (sidecar?.__parseError) {
      addIssue("error", "invalid-sidecar", key, `sidecar ${sidecar.__file} failed to parse: ${sidecar.__parseError}`);
      assets[key] = record;
      continue;
    }

    // Measure the GLB when present.
    if (file) {
      try {
        record.measured = await measureGlb(file);
      } catch (err) {
        addIssue("error", "unreadable-glb", key, `GLB failed to parse: ${err?.message ?? err}`);
      }
    }

    // Resolve fit context: sidecar-declared wins; else representative manifest
    // fit; else raw. Compute measured fitted bounds from the real GLB.
    const declaredFit = sidecar?.fit ?? null;
    const repFit = representativeFit(usageEntry);
    const fitCtx = declaredFit
      ? { targetSize: declaredFit.targetSize ?? null, scale: declaredFit.scale ?? 1, source: "sidecar" }
      : repFit;
    record.fit = fitCtx;

    if (record.measured) {
      const s = fitScale(record.measured.rawSize, fitCtx.targetSize, fitCtx.scale);
      const fb = fittedLocalBounds(record.measured.rawSize, s);
      record.derived.fitScale = round(s, 5);
      record.derived.fittedSize = fb.fittedSize.map((n) => round(n));
      record.derived.fittedFootprint = [round(fb.fittedSize[0]), round(fb.fittedSize[2])];
      record.derived.fittedBounds = {
        minX: round(fb.minX), maxX: round(fb.maxX),
        minY: round(fb.minY), maxY: round(fb.maxY),
        minZ: round(fb.minZ), maxZ: round(fb.maxZ),
      };
      // Per-placement footprints (audit deltas): nominal slot vs fitted, and
      // recommended footprint vs the existing collide tuple where parseable.
      if (usageEntry) {
        record.derived.placements = [];
        for (const b of usageEntry.buildings) {
          const bs = fitScale(record.measured.rawSize, b.slot, 1);
          const bf = fittedSize(record.measured.rawSize, bs);
          record.derived.placements.push({
            kind: "building", id: b.id,
            nominalSlot: [b.slot[0], b.slot[2]],
            fittedFootprint: [round(bf[0]), round(bf[2])],
            deltaX: round(b.slot[0] - bf[0]), deltaZ: round(b.slot[2] - bf[2]),
          });
        }
        for (const p of usageEntry.props) {
          const ps = fitScale(record.measured.rawSize, p.fit.targetSize, p.fit.scale);
          const pf = fittedSize(record.measured.rawSize, ps);
          record.derived.placements.push({
            kind: "prop", pos: p.pos,
            fittedFootprint: [round(pf[0]), round(pf[2])],
            collide: p.collide,
            recommendedVsCollide: p.collide
              ? [round(pf[0] - p.collide[0]), round(pf[2] - p.collide[1])]
              : null,
          });
        }
      }
    }

    assets[key] = record;
  }

  collectIssues(assets, addIssue);
  const summary = summarize(assets, issues);
  return { assets, issues, summary, manifest, generatedAt: new Date().toISOString() };
}

// Apply the validation rule-set to the assembled model. Pure over `assets`.
export function collectIssues(assets, addIssue) {
  for (const [key, a] of Object.entries(assets)) {
    // Unknown asset key: a sidecar that points at a GLB which does not exist in
    // the deployed set (typo / stale key).
    if (a.hasSidecar && !a.fileExists) {
      addIssue("error", "unknown-asset-key", key, "sidecar references a GLB not present in apps/web/public/world/props");
      continue;
    }

    // Category sanity.
    if (a.hasSidecar && a.category && !CATEGORIES.has(a.category)) {
      addIssue("error", "invalid-category", key, `unknown category "${a.category}"`);
    }

    const substantial =
      a.hasSidecar && a.category
        ? SUBSTANTIAL_CATEGORIES.has(a.category)
        : // Infer: a building/prop referenced by the manifest with a collide
          // tuple or building slot is substantial even without a sidecar.
          Boolean(a.usage && (a.usage.buildings.length || a.usage.props.some((p) => p.collide)));

    // Missing substantial-asset profile.
    if (!a.hasSidecar) {
      if (substantial) {
        addIssue("error", "missing-substantial-profile", key, "referenced substantial asset has no collision sidecar");
      } else if (a.referencedInManifest) {
        addIssue("warning", "missing-profile", key, "referenced asset has no sidecar yet (migration)");
      } else if (a.fileExists) {
        addIssue("warning", "untracked-glb", key, "deployed GLB is neither referenced nor profiled");
      }
      continue;
    }

    const isPending = a.pendingDoorContract || a.pendingInteriorPlacement;
    const authored = (a.colliders?.length ?? 0) > 0;
    const isNoneProfile = a.profile === "none";

    // A substantial asset must resolve to a real profile: authored colliders,
    // an explicit `none` with reason, or an explicit pending flag.
    if (substantial && !authored && !isNoneProfile && !isPending) {
      addIssue("error", "missing-substantial-profile", key, "substantial sidecar has no colliders, no `none`, and no pending flag");
    }

    if (isNoneProfile && !a.note) {
      addIssue("error", "none-without-reason", key, "`none` profile must document a reason in `note`");
    }

    if (isPending) {
      const reason = a.pendingDoorContract ? "pendingDoorContract" : "pendingInteriorPlacement";
      addIssue("warning", "pending", key, `profile deferred: ${reason}`);
    }

    // Per-collider checks.
    const ids = new Set();
    const fb = a.derived?.fittedBounds ?? null;
    for (const c of a.colliders ?? []) {
      if (c.id) {
        if (ids.has(c.id)) addIssue("error", "duplicate-id", key, `duplicate collider id "${c.id}"`);
        ids.add(c.id);
      } else {
        addIssue("error", "invalid-dimensions", key, "collider missing id");
      }

      if (RESERVED_SHAPES.has(c.shape)) {
        addIssue("warning", "reserved-shape", key, `collider "${c.id}" uses reserved shape "${c.shape}" (pending contract)`);
        continue;
      }
      if (!SHAPES.has(c.shape)) {
        addIssue("error", "unsupported-shape", key, `collider "${c.id}" has unsupported shape "${c.shape}"`);
        continue;
      }
      if (c.shape === "none") continue;

      // Dimension validity.
      if (!validDimensions(c)) {
        addIssue("error", "invalid-dimensions", key, `collider "${c.id}" (${c.shape}) has invalid dimensions`);
      }

      // Support / hazard must link to the obstacle/contract they belong to.
      if ((c.shape === "support" || c.shape === "hazard") && !hasSupportLink(c, ids, a)) {
        addIssue("error", "missing-support-link", key, `${c.shape} collider "${c.id}" has no support/obstacle link`);
      }

      // Beyond measured bounds without a documented margin.
      const box = colliderAabb(c);
      if (fb && box) {
        const over = boundsOverrun(box, fb);
        if (over > DEFAULT_MARGIN_M && !c.marginReason) {
          addIssue(
            "error",
            "beyond-measured-bounds",
            key,
            `collider "${c.id}" exceeds measured fitted bounds by ${round(over)}m without marginReason`,
          );
        }
      }

      // Accidental default-slot collider on a visible building.
      if (c.shape === "box" && a.usage?.buildings?.length && box) {
        const footX = box.maxX - box.minX;
        const footZ = box.maxZ - box.minZ;
        for (const b of a.usage.buildings) {
          const slotX = b.slot[0];
          const slotZ = b.slot[2];
          const fitX = a.derived?.fittedFootprint?.[0] ?? footX;
          const fitZ = a.derived?.fittedFootprint?.[1] ?? footZ;
          const matchesSlot = nearlyEqual(footX, slotX, 0.15 * slotX) && nearlyEqual(footZ, slotZ, 0.15 * slotZ);
          const slotMuchBigger = slotX > fitX * 1.25 || slotZ > fitZ * 1.25;
          if (matchesSlot && slotMuchBigger && !c.marginReason) {
            addIssue(
              "error",
              "accidental-default-slot",
              key,
              `collider "${c.id}" matches nominal slot ${slotX}x${slotZ} (fitted ~${round(fitX)}x${round(fitZ)}) — invisible barrier`,
            );
            break;
          }
        }
      }
    }

    // Multi-fit note (author against one, others differ).
    if (a.usage) {
      const fits = new Set();
      for (const b of a.usage.buildings) fits.add(`b:${b.slot.join("x")}`);
      for (const p of a.usage.props) fits.add(`p:${p.fit.targetSize ? p.fit.targetSize.join("x") : `scale${p.fit.scale}`}`);
      if (fits.size > 1) {
        addIssue("warning", "multi-fit", key, `used at ${fits.size} distinct fits; sidecar authored against one`);
      }
    }
  }
}

function validDimensions(c) {
  const finite = (n) => typeof n === "number" && Number.isFinite(n);
  const arr3 = (v) => Array.isArray(v) && v.length === 3 && v.every(finite);
  if (c.shape === "box") {
    return arr3(c.center) && arr3(c.half) && c.half.every((h) => h > 0);
  }
  if (c.shape === "capsule") {
    if (!arr3(c.a) || !arr3(c.b) || !finite(c.radius) || c.radius <= 0) return false;
    const len = Math.hypot(c.a[0] - c.b[0], c.a[1] - c.b[1], c.a[2] - c.b[2]);
    return len >= 0; // zero-length capsule == sphere, allowed
  }
  if (c.shape === "support" || c.shape === "hazard") {
    if (!Array.isArray(c.polygon) || c.polygon.length < 3) return false;
    if (!c.polygon.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every(finite))) return false;
    const y = c.shape === "support" ? c.y : c.minY;
    return finite(y);
  }
  return false;
}

function hasSupportLink(c, ids, asset) {
  const link = c.link;
  if (!link) return false;
  const links = Array.isArray(link) ? link : [link];
  if (links.length === 0) return false;
  return links.every((l) => {
    if (typeof l !== "string") return false;
    if (ids.has(l)) return true; // sibling collider id already seen
    if ((asset.colliders ?? []).some((o) => o.id === l)) return true; // sibling defined later
    if (l.startsWith("world:")) return true; // documented external anchor (deck/apron)
    if (RESERVED_SHAPES.has(l)) return true; // door/traversal contract
    return false;
  });
}

// How far (meters) a collider AABB pokes outside the fitted visual bounds on
// its worst axis. Ground (minY < 0) is allowed a small dig via the same margin.
function boundsOverrun(box, fb) {
  const overs = [
    fb.minX - box.minX,
    box.maxX - fb.maxX,
    fb.minZ - box.minZ,
    box.maxZ - fb.maxZ,
    box.maxY - fb.maxY,
    fb.minY - box.minY,
  ];
  return Math.max(0, ...overs);
}

export function summarize(assets, issues) {
  const list = Object.values(assets);
  const byCat = {};
  for (const a of list) {
    const c = a.category ?? (a.fileExists ? "unprofiled" : "missing-file");
    byCat[c] = (byCat[c] ?? 0) + 1;
  }
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const byIssueCat = {};
  for (const i of issues) {
    byIssueCat[i.category] = byIssueCat[i.category] ?? { error: 0, warning: 0 };
    byIssueCat[i.category][i.severity]++;
  }
  return {
    scanned: list.length,
    withGlb: list.filter((a) => a.fileExists).length,
    profiled: list.filter((a) => a.hasSidecar && (a.colliders?.length ?? 0) > 0 && a.profile !== "none").length,
    explicitNone: list.filter((a) => a.profile === "none").length,
    pending: list.filter((a) => a.pendingDoorContract || a.pendingInteriorPlacement).length,
    unprofiledReferenced: list.filter((a) => !a.hasSidecar && a.referencedInManifest).length,
    byCategory: byCat,
    errors: errors.length,
    warnings: warnings.length,
    byIssueCategory: byIssueCat,
  };
}
