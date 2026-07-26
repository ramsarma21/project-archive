// The three.js half of the M1 placement instruments: load a mesh, put it where
// the renderer puts it, and cast rays at it.
//
// `placement_lib.mjs` holds the arithmetic and is pure. This holds the part that
// needs a scene graph, and it exists for the same reason: both verifiers had
// their own copy of "reproduce FittedGlb exactly", and one of the two copies
// carried the bug that made three of `roof-chimney-stack`'s four draws read 0%.
//
// The rule this file enforces
// --------------------------
// ONE SCENE, ONE MEASUREMENT. `verify_roofline_kit.mjs` loaded a scene per asset
// and reused it across that asset's draws. Its fit recomputed the bounding box
// from the scene it had already moved, so the first draw landed and every later
// one was positioned against a box that had already been translated — reported,
// not as an error, but as a confident 0.0%.
//
// The cure here is structural rather than careful: `sceneSource` hands out a
// freshly parsed scene per draw, and `placeInto` refuses a scene it has already
// placed. Resetting the transform between draws would work too, and is cheaper,
// but it is the same discipline that failed the first time — it asks a future
// editor to remember every field that has to be put back, and the cost of
// forgetting is a plausible wrong number rather than a crash. A scene that has
// never been touched cannot be measured against a stale box.
//
// Placement is reproduced OPERATION FOR OPERATION from
// `packages/engine-world/src/ImportedAssets.tsx` and
// `apps/web/src/chapter/M1Scenery.tsx`, in their order, rather than derived. The
// order matters: `FittedGlb` re-centres in the object's own frame and the SCENE
// then turns that frame by `yaw`, so deriving a single world offset happens to
// agree at the quarter turns this level uses and disagrees at every other angle.

import { containFitScale, fillScale, rotateXZ, shellFit } from "./placement_lib.mjs";

/** How much of a collision axis a draw may fail to cover. */
export const FOOTPRINT_TOL = 0.15;
/** A walked surface a little low is hidden by the boot; high is walked through. */
export const TOL_BELOW = 0.35;
export const TOL_ABOVE = 0.05;
/** Fraction of a walked DECK that must have wood under the foot. */
export const DECK_MIN_PCT = 95;
/**
 * Fraction of a landable MASS top that must be at the height the player lands on.
 *
 * Lower than the deck gate on purpose: corbels and copings oversail and then step
 * back in, so the outer ring of a stack legitimately reads lower than its cap.
 * 70% is a cap that is there; 12% is a pilaster pretending to be a buttress.
 */
export const MASS_TOP_MIN_PCT = 70;

/** Per-axis amount of a collision box the draw fails to reach. */
export const shortfallOf = (want, drawn) => want.map((value, axis) => value - drawn[axis]);

/**
 * A source of pristine scenes for one GLB, plus the natural size measured once.
 *
 * The bytes are read once and re-parsed per draw. Parsing a few hundred KB is
 * cheaper than the ray casts that follow it, and it is the only way to be sure
 * nothing survives from the previous measurement — not a transform, not a
 * material flag, not a cached matrix.
 */
export async function sceneSource(THREE, GLTFLoader, bytes, { doubleSide = true } = {}) {
  const parse = async () => {
    const gltf = await new Promise((resolve, reject) =>
      new GLTFLoader().parse(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        "",
        resolve,
        reject,
      ),
    );
    const scene = gltf.scene;
    let tris = 0;
    scene.traverse((object) => {
      if (!object.isMesh) return;
      if (doubleSide) {
        // A probe ray must be stopped by whatever it hits, including anything
        // whose winding came out inward.
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if (material) material.side = THREE.DoubleSide;
      }
      const index = object.geometry.index;
      tris += (index ? index.count : object.geometry.attributes.position.count) / 3;
    });
    scene.updateMatrixWorld(true);
    return { scene, tris: Math.round(tris) };
  };

  const first = await parse();
  const naturalBox = new THREE.Box3().setFromObject(first.scene);
  const naturalSize = naturalBox.getSize(new THREE.Vector3());
  return {
    tris: first.tris,
    natural: [naturalSize.x, naturalSize.y, naturalSize.z],
    naturalMinY: naturalBox.min.y,
    next: async () => (await parse()).scene,
  };
}

/** Every mesh under an object, in the order a raycaster wants them. */
export function meshTargets(root) {
  const list = [];
  root.traverse((object) => {
    if (object.isMesh) list.push(object);
  });
  return list;
}

/**
 * Put a pristine scene where `M1Scenery` puts it, and report what it draws.
 *
 * `fit` is the placement's own: PROP contain-fits, MODULE fills per axis, SHELL
 * fills per axis and may turn a quarter to face its room. The returned `group`
 * is the world-space object; `targets` are its meshes; `box` is what it actually
 * occupies, which is the number a collision box is judged against.
 */
export function placeInto(THREE, scene, placement, natural) {
  if (scene.userData.__m1Placed) {
    throw new Error(
      "placeInto: this scene has already been placed. Every draw needs its own " +
        "scene — measuring a second draw against a scene that has been moved is " +
        "the defect this guard exists to make impossible.",
    );
  }
  scene.userData.__m1Placed = true;

  const fit = placement.fit ?? "PROP";
  let innerYaw = 0;
  let turned = false;
  let scale;
  if (fit === "SHELL") {
    const shell = shellFit(natural, placement.size, placement.rotateShell);
    scale = shell.scale;
    innerYaw = shell.innerYaw;
    turned = shell.turn;
  } else if (fit === "MODULE") {
    scale = fillScale(natural, placement.size);
  } else {
    const uniform = containFitScale(natural, placement.size);
    scale = [uniform, uniform, uniform];
  }
  scene.scale.set(scale[0], scale[1], scale[2]);
  scene.updateMatrixWorld(true);

  // Both importers re-centre X/Z and ground Y on the SCALED, UNROTATED bounds.
  const scaled = new THREE.Box3().setFromObject(scene);
  const centre = scaled.getCenter(new THREE.Vector3());
  if (fit === "SHELL") {
    scene.position.set(-centre.x, -scaled.min.y, -centre.z);
    scene.rotation.y = innerYaw;
  } else {
    scene.position.x -= centre.x;
    scene.position.z -= centre.z;
    scene.position.y -= scaled.min.y;
  }

  // ...and M1Scenery's group is what carries the placement into the world.
  const group = new THREE.Group();
  group.position.set(placement.pos[0], placement.pos[1], placement.pos[2]);
  group.rotation.set(0, placement.yaw ?? 0, 0);
  group.add(scene);
  group.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(group);
  return {
    group,
    targets: meshTargets(group),
    box,
    drawn: box.getSize(new THREE.Vector3()),
    scale,
    uniformScale: fit === "PROP" ? scale[0] : null,
    turned,
  };
}

// ---------------------------------------------------------------------------
// surveys
// ---------------------------------------------------------------------------

/**
 * A grid of sample points over a collision part's own footprint.
 *
 * Laid out in the part's frame and turned into the world, so a yawed mass is
 * sampled where its collision actually is rather than over the axis-aligned box
 * that contains it. A round footprint samples its bounding square and drops the
 * corners, which is what makes the count honest for a bole.
 */
export function footprintSamples(part, grid) {
  const cx = (part.rect.minX + part.rect.maxX) / 2;
  const cz = (part.rect.minZ + part.rect.maxZ) / 2;
  const halfX = part.round ? part.round.radius : (part.rect.maxX - part.rect.minX) / 2;
  const halfZ = part.round ? part.round.radius : (part.rect.maxZ - part.rect.minZ) / 2;
  const yaw = part.yaw ?? 0;
  const out = [];
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const lx = -halfX + ((i + 0.5) / grid) * halfX * 2;
      const lz = -halfZ + ((j + 0.5) / grid) * halfZ * 2;
      if (part.round && Math.hypot(lx, lz) > part.round.radius) continue;
      const [rx, rz] = rotateXZ(lx, lz, yaw);
      out.push([cx + rx, cz + rz]);
    }
  }
  return out;
}

/** A rect in the shape `footprintSamples` wants, for a bare rectangle. */
export const asPart = (rect, extra = {}) => ({ rect, ...extra });

/**
 * The height of the first thing a falling foot meets, over a grid.
 *
 * The roofline kit's question. Anything more than `tolAbove` over the plane is a
 * boot sunk into the prop; anything under `tolBelow` is a foot on air.
 */
export function surveyFirstHit(
  THREE,
  targets,
  part,
  plane,
  { grid = 21, tolBelow = TOL_BELOW, tolAbove = TOL_ABOVE, from = 1.0, far = 200 } = {},
) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = far;
  const down = new THREE.Vector3(0, -1, 0);
  const samples = footprintSamples(part, grid);
  let covered = 0;
  let air = 0;
  let above = 0;
  let dyMin = Infinity;
  let dyMax = -Infinity;
  let dySum = 0;
  for (const [x, z] of samples) {
    raycaster.set(new THREE.Vector3(x, plane + from, z), down);
    const hits = raycaster.intersectObjects(targets, false);
    const hitY = hits.length > 0 ? hits[0].point.y : null;
    if (hitY === null || hitY < plane - tolBelow) {
      air++;
      continue;
    }
    if (hitY > plane + tolAbove) {
      above++;
      continue;
    }
    covered++;
    const dy = hitY - plane;
    dyMin = Math.min(dyMin, dy);
    dyMax = Math.max(dyMax, dy);
    dySum += dy;
  }
  const total = samples.length;
  return {
    total,
    covered,
    air,
    above,
    pct: total ? (covered / total) * 100 : 0,
    dyMin: dyMin === Infinity ? null : dyMin,
    dyMax: dyMax === -Infinity ? null : dyMax,
    dyMean: covered ? dySum / covered : null,
  };
}

/**
 * Does ANY drawn surface sit within `tol` of the plane, over a grid?
 *
 * The placement verifier's question, and deliberately not the one above: a roof
 * deck may have a chimney standing on it, so the FIRST thing a ray meets is not
 * always the surface being asked about. What matters is whether something drawn
 * is at the height the player's feet are.
 */
export function surveyNearPlane(
  THREE,
  targets,
  part,
  plane,
  { grid = 5, tol = 0.35, from = 3.0, far = 120 } = {},
) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = far;
  const down = new THREE.Vector3(0, -1, 0);
  const samples = footprintSamples(part, grid);
  let hit = 0;
  for (const [x, z] of samples) {
    raycaster.set(new THREE.Vector3(x, plane + from, z), down);
    if (raycaster.intersectObjects(targets, false).some((h) => Math.abs(h.point.y - plane) < tol)) {
      hit++;
    }
  }
  return { total: samples.length, hit, fraction: samples.length ? hit / samples.length : 1 };
}
