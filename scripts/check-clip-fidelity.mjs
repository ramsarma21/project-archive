// Does the PLAYED ANIMATION put hands on holds and feet on surfaces during each
// authored traversal verb — or does a validated teleport arrive with the body
// doing something else?
//
// WHY THIS EXISTS. Every traversability guard in this repo, and the affordance
// verifier beside it, certifies GEOMETRY: the collision hulls, the delivered
// mesh under an authored plane, the envelope arithmetic. The exhaustive M1
// traversal audit measured all 61 moments against human plausibility and then
// said the one thing it could not reach:
//
//   "whether the ANIMATION puts hands on holds and feet on surfaces during each
//    move ... needs a clip-vs-collision sampler that does not yet exist, and
//    until it does, every 'OK' certifies the geometry, not the performance."
//
// No instrument here compares the played clip against the world, so a move can
// be geometrically perfect and still look like a body teleported up a wall. The
// codebase already admits this in two places, and this script turns both from
// prose into numbers:
//
//   * parkour/tuning.ts says the vault clip overran its window and the mantle
//     did too, producing a vault that "arrives without a leg ever leaving the
//     ground". That is a TIMING failure — the clip is time-compressed past a
//     ceiling and faded out mid-performance.
//   * docs/design/Physics-Audit.md (Q4) established that authored verbs assign
//     position from a smoothstep-eased anchor path — a validated teleport, not
//     a travelled/collided path — while the clip plays ROOT-NEUTRAL and
//     un-retargeted (clips.ts: "Motion owns displacement; every clip is
//     root-neutral"). That is a SPATIAL failure: nothing makes the clip's hands
//     and feet land where the anchor path puts the body.
//
// THE STRUCTURAL FACT THIS MEASURES. The runtime (RiggedCharacter.tsx) fits the
// rig to STAND_HEIGHT, places its ROOT at the mover's foot position each frame,
// rotates it by the travel yaw, and plays the verb's clip at a mixer timeScale
// (characterAnimation.verbTimeScale, capped at MAX_VERB_TIME_SCALE). There is
// NO inverse kinematics and NO space-scaling: the clip's end-effectors are in
// the rig's own local frame, and the world position of a hand is exactly
//
//     world_hand(t) = sampleAuthoredPath(action, t)  +  R_yaw · local_hand(clipTime)
//
// where the first term is the engine's own exported path sampler and the second
// is the baked clip evaluated by three.js — the same GLTFLoader + AnimationMixer
// the renderer uses. So this reconstructs precisely what is drawn and asks, per
// frame: where is each hand/foot relative to the surface the move acts on; is a
// supporting foot planted and world-stationary; does any limb enter geometry;
// and how much of the clip's performance actually fits inside the motion window.
//
// WHAT IS TRUSTWORTHY AND WHAT IS LABELLED. See the header block on TOLERANCES
// and the per-verb notes:
//   * TIMING (clip-vs-motion duration ratio) is pure arithmetic over measured
//     clip lengths and the published windows; it is exact.
//   * FOOT SLIDING is structural: authored verbs are NOT stride-matched (unlike
//     locomotion, which is), so a clip-planted foot cannot be world-stationary
//     except by coincidence. Measured as world foot motion during a clip plant.
//   * CONTACT / CLIPPING are measured against a CANONICAL obstacle built to the
//     verb's own published envelope (tuning.ts) and placed exactly where the
//     anchor chain (select.planVerb) puts it. The number is a property of
//     (clip x that canonical move); it is labelled as such and NOT presented as
//     a route-specific measurement, because the route/climbs are being
//     re-authored by another lane.
//   * BALLISTIC / PASSIVE verbs (JUMP_GAP, RUN_OFF, LEAP_OF_FAITH) travel a real
//     collided path and legitimately leave every surface; their contact is
//     labelled N/A and only their timing is reported.
//
// This is a DIAGNOSTIC, not a gate. It is expected to be unflattering — the
// vault and mantle overruns are already documented — and an honest bad result
// is the deliverable. It never adjusts a tolerance to make a number look
// better. See the footer for what wiring it in would take.
//
// Usage:
//   node --import tsx scripts/check-clip-fidelity.mjs            # the report
//   node --import tsx scripts/check-clip-fidelity.mjs --selftest # prove it
//   node --import tsx scripts/check-clip-fidelity.mjs --json     # machine-readable
//   node --import tsx scripts/check-clip-fidelity.mjs --rig <glb>

globalThis.self = globalThis;
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------- three.js
// The animated rig is evaluated with the SAME three.js path the renderer
// (RiggedCharacter) and assets/pipeline/measure_clip_rates.mjs use. That is the
// deliberate reuse: clip interpolation + skinning is not re-implemented on top
// of the static GLB decoder in check-world-scale.mjs (which reads bind pose and
// cannot animate), because a second, hand-rolled clip evaluator is exactly the
// confident-false-report risk that file's header warns about. The static
// decoder IS imported below, and used for what it is proven at — a bind-pose
// skinned-height cross-check that the three.js fit agrees with it.
const threeRoot = join(ROOT, "apps", "web", "node_modules", "three");
const THREE = await import(pathToFileURL(join(threeRoot, "build", "three.module.js")));
const { GLTFLoader } = await import(
  pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js"))
);

// ---------------------------------------------------------------- engine imports
// Imported from source (never re-stated) so a change to a window, a clip length
// table, the playback ceiling or the path easing moves this measurement with
// it. Specific files rather than the package barrel, which pulls in React/R3F.
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const tuning = await imp("packages/engine-world/src/parkour/tuning.ts");
const clips = await imp("packages/engine-world/src/parkour/clips.ts");
const charAnim = await imp("packages/engine-world/src/characterAnimation.ts");
const flow = await imp("packages/engine-world/src/parkour/flow.ts");
const motion = await imp("packages/engine-world/src/playerMotion.ts");
const collision = await imp("packages/engine-world/src/collision.ts");
const fieldSim = await imp("packages/engine-world/src/fieldSimulation.ts");
const parkourIk = await imp("packages/engine-world/src/parkourIk.ts");
const worldScale = await imp("./scripts/check-world-scale.mjs");

const { PARKOUR_TUNING, AUTHORABLE_VERBS } = tuning;
const { VERB_CLIP, LANDING_CLIP, PARKOUR_CLIP_TARGET_MS, HANG_STAGE_CLIP } = clips;
const { HANG_CATCH_MS, HANG_HOLD_MS, HANG_PULL_MS } = motion;
const {
  verbTimeScale,
  playerClipFor,
  CLIP_CONTENT_MS,
  CLIP_AUTHORED_MS,
  CLIP_CONTENT_START_MS,
  MAX_VERB_TIME_SCALE,
  CYCLIC_VERB_CLIPS,
} = charAnim;
const { LANDING_RECOVERY_TICKS } = flow;
const { sampleAuthoredPath } = motion;
const { CAPSULE_RADIUS, STAND_HEIGHT, CROUCH_HEIGHT } = collision;
const { FIELD_DT } = fieldSim;
const { glbDocument, effectiveBounds } = worldScale;

const DEFAULT_RIG = join(ROOT, "apps/web/public/world/characters/playerboy-rigged.glb");

// ---------------------------------------------------------------- TOLERANCES
// Fixed up front and JUSTIFIED, never tuned until the numbers look better —
// tuning a fidelity tolerance to pass is the exact false-green this instrument
// exists to remove. Every number below is tied to an engine constant or a
// stated physical argument, not to what the current clips happen to score.

// GRIP BAND. How far a limb that is supposed to be ON a hold (a hand on a ledge
// top, a foot on a rung/face) may sit from that surface and still read as
// gripping it. CONTACT_EPS (collision.ts) is the engine's 1cm "on the surface"
// band; a hand wrapping a hold sits within roughly a hand's depth of it. 0.15m
// is a hand-span: comfortably wider than the 1cm the solver uses, tight enough
// that beyond it the hand is visibly off the thing it grips.
const GRIP_BAND_M = 0.15;

// PLANT-SLIDE BUDGET. A supporting foot the clip has planted should be
// world-stationary. Locomotion achieves this by stride-matching (a run's
// planted foot sweeps backward at exactly ground speed); authored verbs do NOT
// stride-match, so any residual is a slide. 0.5 m/s is ~11% of RUN_SPEED (4.6)
// and about a fifth of a walk — below it a scuffed plant is arguable, above it
// the foot is skating on screen. Reported as a raw speed regardless; this is
// only the flag threshold.
const PLANT_SLIDE_MPS = 0.5;

// FOOT-CONTACT BAND for detecting a plant WITHIN the clip's own local frame: a
// foot is "down" while its local height is within this of the lowest that foot
// reaches in the clip. Matches the 0.02m contact band measure_clip_rates.mjs
// uses for the same job, so the two agree on what "planted" means.
const CLIP_CONTACT_BAND_M = 0.02;
// A plant shorter than this is the threshold flickering at toe-off, not a
// stance. Matches measure_clip_rates.mjs.
const MIN_PLANT_S = 0.06;

// CLIP-THROUGH SKIN. Penetration deeper than this into a solid the move acts on
// is the body clipping geometry, not float noise. sweepXZ keeps a 1e-5 skin;
// 0.05m is four thousand times that and a visible poke-through, well clear of
// re-decimation jitter.
const CLIP_THROUGH_M = 0.05;

// A "leg leaving the ground" during a vault/climb-over means a foot rising this
// far above the start foot height. Below it the clip never lifts the foot — the
// exact "arrives without a leg ever leaving the ground" the tuning note names.
const FOOT_LIFT_M = 0.1;

// Sampling rate: the fixed simulation tick. The runtime advances the motion in
// whole FIELD_DT steps, so sampling the reconstruction at the same rate reads
// exactly the frames the player is shown.
const SAMPLE_DT = FIELD_DT;

// ---------------------------------------------------------------- rig + clips
const TRACKED = {
  hands: ["LeftHand", "RightHand"],
  toes: ["LeftToeBase", "RightToeBase"],
  heels: ["LeftFoot", "RightFoot"],
  pelvis: ["Hips"],
};

function boneNamed(root, name) {
  let found = null;
  root.traverse((o) => {
    if (found) return;
    if (o.name === name || o.name === `mixamorig${name}` || o.name === `mixamorig:${name}`) {
      found = o;
    }
  });
  return found;
}

/** RiggedCharacter's fit, verbatim: skinned bounds, feet on y=0, height matched. */
function fitRig(root, height) {
  const measure = () => {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let any = false;
    root.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.computeBoundingBox();
        if (!o.boundingBox) return;
        tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
      } else if (o.isMesh) {
        tmp.setFromObject(o);
      } else return;
      any ? box.union(tmp) : box.copy(tmp);
      any = true;
    });
    return box;
  };
  const natural = measure().getSize(new THREE.Vector3()).y;
  root.scale.setScalar(natural > 0.01 ? height / natural : 1);
  root.position.y -= measure().min.y;
  return natural;
}

async function loadRig(file) {
  const data = readFileSync(file);
  const loader = new GLTFLoader();
  const gltf = await new Promise((res, rej) =>
    loader.parse(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      "",
      res,
      rej,
    ),
  );
  const root = gltf.scene;
  const naturalHeight = fitRig(root, STAND_HEIGHT);
  const bones = {};
  for (const [group, names] of Object.entries(TRACKED)) {
    bones[group] = names.map((n) => boneNamed(root, n)).filter(Boolean);
  }
  // The exact chains the renderer's IK drives (RiggedCharacter → applyParkourIkToRig).
  const parkourLimbs = parkourIk.resolveParkourLimbs(root);
  return { gltf, root, bones, parkourLimbs, naturalHeight, clips: gltf.animations };
}

/**
 * Pose the rig at absolute clip time (seconds) and read every tracked bone's
 * world position in the FITTED rig frame — feet on y=0, body centred on x/z,
 * facing the rig's native forward. This IS the local pose the runtime overlays
 * on the motion path; the caller adds the path position and yaw.
 */
function poseBones(rig, clip, clipTimeS, ik) {
  const mixer = new THREE.AnimationMixer(rig.root);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(Math.max(0, Math.min(clipTimeS, clip.duration)));
  rig.root.updateMatrixWorld(true);
  // IK LIVE: run the SAME engine call the renderer runs each frame, on the posed
  // rig, before reading — so this instrument measures what is actually drawn.
  if (ik && rig.parkourLimbs) {
    parkourIk.applyParkourIkToRig(rig.parkourLimbs, {
      boxes: ik.boxes,
      gripHands: ik.gripHands,
      gripReachM: 0.45,
      skinM: 0.01,
      footPins: ik.footPins,
    });
    rig.root.updateMatrixWorld(true);
  }
  const read = (arr) => arr.map((b) => {
    const p = new THREE.Vector3();
    b.getWorldPosition(p);
    return { x: p.x, y: p.y, z: p.z };
  });
  const out = {
    hands: read(rig.bones.hands),
    feet: read(rig.bones.toes.length ? rig.bones.toes : rig.bones.heels),
    pelvis: read(rig.bones.pelvis),
  };
  mixer.stopAllAction();
  mixer.uncacheClip(clip);
  return out;
}

// ---------------------------------------------------------------- canonical moves
// Each surface verb, built exactly as select.planVerb builds it, over a
// synthetic obstacle at the TOP of the verb's own published envelope band
// (tuning.ts) — the hardest case, and the one level design budgets against.
// Travel is +Z from the origin, so the travel yaw is atan2(0,1)=0 and the rig
// (native forward +Z, per the engine's yaw convention) needs no rotation: the
// overlay is the charitable best case for the animation. faceDist is the commit
// distance (centre-to-near-face at the tick the verb fires). Anchors reproduce
// the CAPSULE_RADIUS insets planVerb applies.
const r = CAPSULE_RADIUS;
const FACE = PARKOUR_TUNING.commitDistanceM; // 0.55m, centre-to-near-face at commit
const INSET = PARKOUR_TUNING.topLandingInsetM; // 0.5m past the lip

/** An axis-aligned solid the move acts on, in the canonical +Z frame. */
function box(minX, maxX, minY, maxY, minZ, maxZ, role) {
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], role };
}

function canonicalMove(verb) {
  const start = { x: 0, y: 0, z: 0, yaw: 0 };
  const wide = 1.5; // obstacle half-width in X, so X never limits contact
  switch (verb) {
    case "STEP_UP": {
      const h = PARKOUR_TUNING.stepUpMaxHeightM; // 0.5
      const lip = { x: 0, y: h, z: Math.max(0, FACE - r) };
      const land = { x: 0, y: h, z: FACE + INSET, yaw: 0 };
      return {
        kind: "CLIMB_UP", arcHeight: 0, capsule: STAND_HEIGHT,
        anchors: [start, lip, land],
        boxes: [box(-wide, wide, 0, h, FACE, FACE + INSET + 1.0, "ledge")],
        gripHands: false, plantFeetOnTop: true, expectFootLift: false,
        note: `step onto a ${h.toFixed(2)}m ledge`,
      };
    }
    case "CLIMB_UP": {
      const h = PARKOUR_TUNING.mantleMaxHeightM; // 1.9 (folded mantle band top)
      const lip = { x: 0, y: h, z: Math.max(0, FACE - r) };
      const land = { x: 0, y: h, z: FACE + INSET, yaw: 0 };
      return {
        kind: "CLIMB_UP", arcHeight: 0, capsule: STAND_HEIGHT,
        anchors: [start, lip, land],
        boxes: [box(-wide, wide, 0, h, FACE, FACE + INSET + 1.0, "ledge")],
        gripHands: true, plantFeetOnTop: false, expectFootLift: true,
        note: `mantle/climb onto a ${h.toFixed(2)}m ledge`,
      };
    }
    case "VAULT": {
      const h = PARKOUR_TUNING.vaultMaxHeightM; // 1.15
      const d = PARKOUR_TUNING.vaultMaxDepthM; // 1.2
      const nearTop = { x: 0, y: h, z: Math.max(0, FACE - r) };
      const farTop = { x: 0, y: h, z: FACE + d + r };
      const farSide = { x: 0, y: 0, z: FACE + d + r, yaw: 0 };
      return {
        kind: "VAULT", arcHeight: PARKOUR_TUNING.vaultArcHeightM, capsule: STAND_HEIGHT,
        anchors: [start, nearTop, farTop, farSide],
        boxes: [box(-wide, wide, 0, h, FACE, FACE + d, "obstacle")],
        gripHands: true, plantFeetOnTop: false, expectFootLift: true,
        note: `vault a ${h.toFixed(2)}m / ${d.toFixed(2)}m obstacle`,
      };
    }
    case "CLIMB_OVER": {
      const h = PARKOUR_TUNING.climbOverMaxHeightM; // 1.9
      const d = PARKOUR_TUNING.climbOverMaxDepthM; // 0.9 (thin, no standable top)
      const nearTop = { x: 0, y: h, z: Math.max(0, FACE - r) };
      const farTop = { x: 0, y: h, z: FACE + d + r };
      const farSide = { x: 0, y: 0, z: FACE + d + r, yaw: 0 };
      return {
        kind: "VAULT", arcHeight: PARKOUR_TUNING.vaultArcHeightM, capsule: STAND_HEIGHT,
        anchors: [start, nearTop, farTop, farSide],
        boxes: [box(-wide, wide, 0, h, FACE, FACE + d, "wall")],
        gripHands: true, plantFeetOnTop: false, expectFootLift: true,
        note: `climb over a ${h.toFixed(2)}m / ${d.toFixed(2)}m wall`,
      };
    }
    case "SLIDE": {
      const head = PARKOUR_TUNING.slideMinHeadroomM; // 1.0 (tightest)
      const d = PARKOUR_TUNING.slideMaxDepthM; // 2.6
      const far = { x: 0, y: 0, z: FACE + d + r, yaw: 0 };
      // The beam whose underside is at `head`: the body ducks under it. A slide
      // keeps the feet on the ground; the head/pelvis must clear the beam.
      return {
        kind: "DUCK_UNDER", arcHeight: 0, capsule: CROUCH_HEIGHT,
        anchors: [start, far],
        boxes: [box(-wide, wide, head, head + 1.0, FACE, FACE + d, "beam")],
        gripHands: false, plantFeetOnGround: true, expectFootLift: false,
        feetSlideExpected: true,
        note: `slide under ${head.toFixed(2)}m of headroom`,
      };
    }
    case "JUMP_HANG": {
      // The catch is measured at the TOP of its own envelope (the tallest
      // unladdered lip a standing body may be offered), on a ledge placed exactly
      // where select.planVerb's anchors put it. Three anchors, and the middle one
      // is the hang: feet `hangFeetBelowLipM` under the lip, a capsule radius
      // short of the face — the pinned hold.
      //
      // THE GRIP BOX IS A THIN SLAB AT THE LIP, not the whole ledge mass, because
      // that is what MissionStage hands the renderer: a caught deck has no solid
      // span, so the presentation layer synthesises the top few centimetres of the
      // moulding as the hold. Reproducing that here rather than a full-height box
      // is what makes the hand numbers below the ones that are actually drawn.
      const h = PARKOUR_TUNING.hangCatchMaxRiseM; // 2.5
      const lipDepth = 0.08; // MissionStage.GRIP_LIP_DEPTH_M
      const hangAlong = Math.max(0, FACE - r);
      const hang = { x: 0, y: h - PARKOUR_TUNING.hangFeetBelowLipM, z: hangAlong };
      const land = { x: 0, y: h, z: FACE + INSET, yaw: 0 };
      return {
        kind: "JUMP_HANG", arcHeight: 0, capsule: STAND_HEIGHT,
        anchors: [start, hang, land],
        boxes: [box(-wide, wide, h - lipDepth, h, FACE, FACE + INSET + 1.0, "lip")],
        gripHands: true, plantFeetOnTop: false, expectFootLift: true,
        note: `jump-catch and mantle a ${h.toFixed(2)}m unladdered lip`,
      };
    }
    case "HANG_DROP": {
      const drop = PARKOUR_TUNING.hangDropMaxDropM; // 3.2
      const contact = 0.1;
      const hang = { x: 0, y: Math.max(-drop, start.y - 1), z: contact + r };
      const below = { x: 0, y: -drop, z: contact + r, yaw: 0 };
      // A wall the body faces and lowers over: the lip is the ledge it leaves.
      return {
        kind: "CLIMB_DOWN", arcHeight: 0, capsule: STAND_HEIGHT,
        anchors: [start, hang, below],
        boxes: [box(-wide, wide, -drop - 0.5, 0, contact + r, contact + r + 0.6, "wall")],
        gripHands: true, plantFeetOnTop: false, expectFootLift: false,
        note: `hang-drop ${drop.toFixed(2)}m`,
      };
    }
    default:
      return null;
  }
}

/** The AuthoredAction shape samplePath/sampleAuthoredPath reads. */
function actionFor(move, windowMs) {
  const a = move.anchors;
  return {
    kind: move.kind,
    anchors: a.map((p) => ({ ...p })),
    durationMs: windowMs,
    elapsedMs: 0,
    arcHeight: move.arcHeight,
    faceObstacle: move.kind === "CLIMB_DOWN",
    startYaw: 0,
    startPos: { x: a[0].x, y: a[0].y, z: a[0].z },
    endPos: { x: a[a.length - 1].x, y: a[a.length - 1].y, z: a[a.length - 1].z },
    endYaw: 0,
    ignore: new Set(),
  };
}

// ---------------------------------------------------------------- geometry math
/** Distance from a point to an AABB (0 if inside). */
function distToBox(p, b) {
  const dx = Math.max(b.min[0] - p.x, 0, p.x - b.max[0]);
  const dy = Math.max(b.min[1] - p.y, 0, p.y - b.max[1]);
  const dz = Math.max(b.min[2] - p.z, 0, p.z - b.max[2]);
  return Math.hypot(dx, dy, dz);
}

/** Penetration depth of a point inside an AABB (0 if outside) = distance to the nearest face. */
function penetration(p, b) {
  if (p.x < b.min[0] || p.x > b.max[0]) return 0;
  if (p.y < b.min[1] || p.y > b.max[1]) return 0;
  if (p.z < b.min[2] || p.z > b.max[2]) return 0;
  return Math.min(
    p.x - b.min[0], b.max[0] - p.x,
    p.y - b.min[1], b.max[1] - p.y,
    p.z - b.min[2], b.max[2] - p.z,
  );
}

function nearestBox(p, boxes) {
  let best = Infinity;
  for (const b of boxes) best = Math.min(best, distToBox(p, b));
  return best;
}

function deepestPen(p, boxes) {
  let best = 0;
  for (const b of boxes) best = Math.max(best, penetration(p, b));
  return best;
}

// ---------------------------------------------------------------- timing
/**
 * The clip-vs-motion duration story for a verb, from the published tables
 * (never re-stated). `windowMs` is the authored motion window; `rate` is the
 * mixer timeScale the renderer will actually use; the performance is faded out
 * mid-move when the required rate exceeds the ceiling.
 */
function timingFor(verb, clipName, windowMs) {
  const content = CLIP_CONTENT_MS[clipName] ?? null;
  const file = CLIP_AUTHORED_MS[clipName] ?? null;
  const cyclic = CYCLIC_VERB_CLIPS.has(clipName);
  const rate = verbTimeScale(clipName, windowMs); // null for locomotion fallbacks
  const required = content && windowMs > 0 ? content / windowMs : null;
  const target = Math.max(windowMs, PARKOUR_CLIP_TARGET_MS[clipName] ?? 0);
  // Fraction of the clip's PERFORMANCE that plays inside the motion window at
  // the actual (capped) rate. <1 means the clip is cut off / faded mid-move.
  let contentShown = null;
  if (rate !== null && content) contentShown = Math.min(1, (rate * windowMs) / content);
  // Overrun: how much longer than the window the performance runs at the capped
  // rate. This is the "overran its window by N x" number, made exact.
  const overrun = required !== null && rate ? required / rate : null;
  return {
    clipName, content, file, cyclic, windowMs,
    requiredRate: required, actualRate: rate, targetMs: target,
    contentShownFrac: contentShown, overrun,
    cappedByCeiling: rate !== null && Math.abs(rate - MAX_VERB_TIME_SCALE) < 1e-9 && required !== null && required > MAX_VERB_TIME_SCALE + 1e-9,
    lengthenedByTarget: rate !== null && content ? content / target < (required ?? Infinity) - 1e-9 && target > windowMs + 1e-9 : false,
  };
}

// ---------------------------------------------------------------- the sampler
/**
 * Reconstruct the world trajectory of every tracked end-effector across an
 * authored verb and measure contact / sliding / clipping. Pure over (rig,
 * move, window, rate); reads the engine's own path sampler for the root.
 */
/**
 * A verb whose window is covered by SEVERAL clips in sequence — the jump-hang's
 * catch, hold and pull-up — as a per-frame resolver. Returns the clip, its own
 * stage window and the rate the renderer will play it at, so the reconstruction
 * switches performance exactly where `flow.verbClip` does.
 *
 * Returns null for the ordinary one-clip verbs, which keeps their sampling byte
 * for byte what it was.
 */
function stagesFor(verb) {
  if (verb !== "JUMP_HANG") return null;
  const stages = [
    { stage: "CATCH", ms: HANG_CATCH_MS },
    { stage: "HOLD", ms: HANG_HOLD_MS },
    { stage: "PULL", ms: HANG_PULL_MS },
  ];
  let at = 0;
  return stages.map((s) => {
    const from = at;
    at += s.ms;
    const requested = HANG_STAGE_CLIP[s.stage];
    const clipName = playerClipFor(requested);
    return {
      ...s,
      from,
      to: at,
      requested,
      clipName,
      rate: verbTimeScale(clipName, s.ms) ?? 1,
      startOffsetMs: CLIP_CONTENT_START_MS[clipName] ?? 0,
    };
  });
}

function sampleVerb(rig, move, clipName, windowMs, rate, startOffsetMs, useIk, plants, stages) {
  const clip = rig.clips.find((c) => c.name === clipName);
  if (!clip) return { error: `rig has no clip '${clipName}'` };
  // A staged verb resolves its clip per frame; a one-clip verb keeps the single
  // clip resolved above. Missing any stage's clip is an error, not a fallback:
  // silently sampling the wrong performance is what this instrument exists to
  // catch elsewhere.
  const staged = stages
    ? stages.map((s) => ({ ...s, clip: rig.clips.find((c) => c.name === s.clipName) }))
    : null;
  if (staged) {
    const absent = staged.filter((s) => !s.clip);
    if (absent.length) {
      return { error: `rig has no clip(s) ${absent.map((s) => `'${s.clipName}'`).join(", ")}` };
    }
  }
  const action = actionFor(move, windowMs);
  const frames = Math.max(2, Math.round(windowMs / 1000 / SAMPLE_DT));
  const isCyclic = CYCLIC_VERB_CLIPS.has(clipName);

  // Per-foot world tracks (both feet), plus per-frame hand/pelvis nearest-surface
  // and penetration, and a local-foot track to detect plants clip-intrinsically.
  const feetWorld = [[], []];
  const feetLocalY = [[], []];
  const times = [];
  let handMinDist = Infinity;      // closest a hand gets to the object over the move
  let handMinTopGap = Infinity;    // closest a hand gets to the object's TOP plane (float gap)
  let footMinDist = Infinity;
  let maxPen = 0; let maxPenLimb = null;
  let footPeakLift = 0;            // highest a foot rises above start foot height
  const topY = Math.max(...move.boxes.map((b) => b.max[1]));

  for (let i = 0; i < frames; i++) {
    const elapsedMs = (i / (frames - 1)) * windowMs;
    const t = Math.min(1, elapsedMs / windowMs);
    const root = sampleAuthoredPath(action, t); // engine's own eased path sample
    // Which performance is on screen, and how far into it. A staged verb restarts
    // its clip at each stage boundary — the renderer crossfades a new action in —
    // so the clip clock is measured from the stage's own start, not the verb's.
    const stage = staged
      ? staged.find((s) => elapsedMs < s.to) ?? staged[staged.length - 1]
      : null;
    const frameClip = stage ? stage.clip : clip;
    const frameRate = stage ? stage.rate : rate ?? 1;
    const frameOffset = stage ? stage.startOffsetMs : startOffsetMs;
    const intoStage = stage ? elapsedMs - stage.from : elapsedMs;
    const frameCyclic = CYCLIC_VERB_CLIPS.has(frameClip.name);
    // Clip time: the renderer advances the clip at `rate` from its content start;
    // a once-clip clamps at its end, a cyclic clip loops.
    let clipTimeS = (frameOffset + intoStage * frameRate) / 1000;
    if (frameCyclic) clipTimeS = frameClip.duration > 0 ? clipTimeS % frameClip.duration : 0;
    else clipTimeS = Math.min(clipTimeS, frameClip.duration);
    // In the fitted frame the posed bones ARE the local overlay, so the boxes and
    // plant pins are the world geometry minus this frame's root path.
    let ik = null;
    if (useIk && rig.parkourLimbs) {
      ik = {
        boxes: move.boxes.map((b) => ({
          min: [b.min[0] - root.x, b.min[1] - root.y, b.min[2] - root.z],
          max: [b.max[0] - root.x, b.max[1] - root.y, b.max[2] - root.z],
        })),
        gripHands: move.gripHands,
        footPins: [0, 1].map((k) => {
          const pw = plants?.[k]?.pinAt(i);
          return pw ? { x: pw.x - root.x, y: pw.y - root.y, z: pw.z - root.z } : null;
        }),
      };
    }
    const local = poseBones(rig, frameClip, clipTimeS, ik);
    // World = root path position + local bone offset (travel yaw is 0 here).
    const toWorld = (p) => ({ x: root.x + p.x, y: root.y + p.y, z: root.z + p.z });

    times.push(elapsedMs / 1000);
    for (const h of local.hands) {
      const w = toWorld(h);
      handMinDist = Math.min(handMinDist, nearestBox(w, move.boxes));
      // vertical gap to the object's top plane (only meaningful over the footprint)
      handMinTopGap = Math.min(handMinTopGap, Math.abs(w.y - topY));
      maxPenAcc(w, "hand");
    }
    local.feet.forEach((f, k) => {
      const w = toWorld(f);
      if (k < 2) feetWorld[k].push(w);
      feetLocalY[k].push(f.y);
      footMinDist = Math.min(footMinDist, nearestBox(w, move.boxes));
      maxPenAcc(w, "foot");
    });
    for (const pv of local.pelvis) maxPenAcc(toWorld(pv), "pelvis");
  }

  function maxPenAcc(w, limb) {
    const p = deepestPen(w, move.boxes);
    if (p > maxPen) { maxPen = p; maxPenLimb = limb; }
  }

  // Foot lift is measured in the LOCAL frame (does a leg leave the ground within
  // the clip, relative to the start foot height) — the tuning-note question.
  const startFootY = Math.min(...feetLocalY.map((t) => t[0] ?? Infinity));
  footPeakLift = Math.max(
    ...feetLocalY.flatMap((track) => track.map((y) => y - startFootY)),
    0,
  );

  // SLIDING: for each foot, find clip-planted runs (local height near this
  // foot's minimum, for >= MIN_PLANT_S) and measure the WORLD horizontal motion
  // during them. A planted foot that is not world-stationary is a slide.
  let plantSlidePeak = 0;
  let plantSlideMean = 0;
  let plantSamples = 0;
  for (let k = 0; k < 2; k++) {
    const ly = feetLocalY[k];
    if (!ly || ly.length < 3) continue;
    const low = Math.min(...ly);
    const planted = ly.map((y) => y <= low + CLIP_CONTACT_BAND_M);
    let s = null;
    for (let i = 0; i <= planted.length; i++) {
      if (i < planted.length && planted[i]) { if (s === null) s = i; continue; }
      if (s === null) continue;
      const e = i; // [s, e)
      if (times[e - 1] - times[s] >= MIN_PLANT_S && e - s >= 2) {
        for (let j = s + 1; j < e; j++) {
          const a = feetWorld[k][j - 1];
          const b = feetWorld[k][j];
          const dtS = times[j] - times[j - 1];
          if (dtS <= 0) continue;
          const v = Math.hypot(b.x - a.x, b.z - a.z) / dtS;
          plantSlidePeak = Math.max(plantSlidePeak, v);
          plantSlideMean += v;
          plantSamples++;
        }
      }
      s = null;
    }
  }
  plantSlideMean = plantSamples > 0 ? plantSlideMean / plantSamples : 0;

  return {
    frames,
    handMinDist: Number.isFinite(handMinDist) ? handMinDist : null,
    handMinTopGap: Number.isFinite(handMinTopGap) ? handMinTopGap : null,
    footMinDist: Number.isFinite(footMinDist) ? footMinDist : null,
    footPeakLift,
    maxPen, maxPenLimb,
    plantSlidePeak, plantSlideMean, plantSamples,
    rootTravelM: pathHorizontalLength(action),
  };
}

/** Total horizontal length the root path travels (for interpreting slide). */
function pathHorizontalLength(action) {
  let total = 0;
  const a = action.anchors;
  for (let i = 0; i < a.length - 1; i++) {
    total += Math.hypot(a[i + 1].x - a[i].x, a[i + 1].z - a[i].z);
  }
  return total;
}

// ---------------------------------------------------------------- verdicts
function verdictForSurfaceVerb(verb, move, timing, s) {
  const flags = [];
  if (s.error) return { rank: -1, label: "NO_CLIP", flags: [s.error] };

  // TIMING
  if (timing.actualRate === null) {
    flags.push(`timing: clip '${timing.clipName}' is a locomotion/substitute clip (stride-matched, not verb-fitted)`);
  } else if (timing.overrun !== null && timing.overrun > 1.01) {
    flags.push(`timing: performance overruns the ${timing.windowMs}ms window by ${timing.overrun.toFixed(2)}x at the ${timing.actualRate.toFixed(2)}x ceiling; only ${(timing.contentShownFrac * 100).toFixed(0)}% of the clip plays before the move ends`);
  }

  // CONTACT (hands on the hold)
  if (move.gripHands && s.handMinDist !== null && s.handMinDist > GRIP_BAND_M) {
    flags.push(`contact: the hands never come within ${GRIP_BAND_M}m of the ${move.boxes[0].role}; closest ${s.handMinDist.toFixed(2)}m (top-plane gap ${s.handMinTopGap.toFixed(2)}m)`);
  }
  // FOOT LEAVES THE GROUND (vault/climb-over/mantle)
  if (move.expectFootLift && s.footPeakLift < FOOT_LIFT_M) {
    flags.push(`contact: no leg leaves the ground — peak foot lift ${(s.footPeakLift * 100).toFixed(1)}cm within the shown window (the documented "arrives without a leg ever leaving the ground")`);
  }
  // FEET ON GROUND (slide)
  if (move.plantFeetOnGround && s.footMinDist !== null && s.footMinDist > GRIP_BAND_M) {
    // for a slide the feet should stay near y=0; footMinDist is to the beam, not the point
  }

  // SLIDING. A slide's feet are MEANT to travel along the ground, so a moving
  // down-foot there is expected (the open question is stride-match, not plant);
  // reported but not flagged as a defect.
  if (s.plantSamples > 0 && s.plantSlidePeak > PLANT_SLIDE_MPS && !move.feetSlideExpected) {
    flags.push(`sliding: a clip-planted foot slides in world space at up to ${s.plantSlidePeak.toFixed(2)} m/s (mean ${s.plantSlideMean.toFixed(2)}), over a ${s.rootTravelM.toFixed(2)}m root path — authored verbs are not stride-matched`);
  }

  // CLIPPING
  if (s.maxPen > CLIP_THROUGH_M) {
    flags.push(`clipping: the ${s.maxPenLimb} enters the ${move.boxes[0].role} by up to ${(s.maxPen * 100).toFixed(1)}cm`);
  }

  const rank = flags.length === 0 ? 0 : flags.some((f) => f.startsWith("clipping") || f.startsWith("contact")) ? 2 : 1;
  return { rank, label: rank === 0 ? "OK" : rank === 1 ? "FLAGGED" : "SEVERE", flags };
}

// Detect each foot's longest clip-planted run (pre-IK, off the clip itself) and
// record the world position where the plant begins, so the IK can hold the foot
// there and cancel the world slide — the same thing a stateful renderer latch
// does live, computed here from the whole clip because this tool has every frame.
function detectPlants(rig, move, clipName, windowMs, rate, startOffsetMs) {
  const clip = rig.clips.find((c) => c.name === clipName);
  if (!clip) return [null, null];
  const action = actionFor(move, windowMs);
  const frames = Math.max(2, Math.round(windowMs / 1000 / SAMPLE_DT));
  const isCyclic = CYCLIC_VERB_CLIPS.has(clipName);
  const localY = [[], []];
  const world = [[], []];
  for (let i = 0; i < frames; i++) {
    const elapsedMs = (i / (frames - 1)) * windowMs;
    const root = sampleAuthoredPath(action, Math.min(1, elapsedMs / windowMs));
    let clipTimeS = (startOffsetMs + elapsedMs * (rate ?? 1)) / 1000;
    if (isCyclic) clipTimeS = clip.duration > 0 ? clipTimeS % clip.duration : 0;
    else clipTimeS = Math.min(clipTimeS, clip.duration);
    // Read the pose from poseBones' RETURN (computed while the rig is still
    // posed); reading the bones afterward would see the pose stopAllAction left.
    const local = poseBones(rig, clip, clipTimeS);
    local.feet.forEach((f, k) => {
      localY[k].push(f.y);
      world[k].push({ x: root.x + f.x, y: root.y + f.y, z: root.z + f.z });
    });
  }
  const plants = [null, null];
  for (let k = 0; k < 2; k++) {
    const ly = localY[k];
    if (ly.length < 3) continue;
    const low = Math.min(...ly);
    const planted = ly.map((y) => y <= low + CLIP_CONTACT_BAND_M);
    let bestS = -1, bestE = -1, s = null;
    for (let i = 0; i <= planted.length; i++) {
      if (i < planted.length && planted[i]) { if (s === null) s = i; continue; }
      if (s !== null) { if (bestS < 0 || i - s > bestE - bestS) { bestS = s; bestE = i; } s = null; }
    }
    if (bestS >= 0 && bestE - bestS >= 2) {
      const anchor = world[k][bestS];
      plants[k] = { pinAt: (i) => (i >= bestS && i < bestE ? anchor : null) };
    }
  }
  return plants;
}

// ---------------------------------------------------------------- run
async function run(rigFile, useIk) {
  const rig = await loadRig(rigFile);
  const clipNames = new Set(rig.clips.map((c) => c.name));

  // CROSS-CHECK the two decoders agree on the rig's natural height, exactly as
  // probe_rig_scale --cross-check does for check-world-scale: the three.js fit
  // used here and the static skinned decoder imported from check-world-scale
  // must read the same bind-pose height, or one of them is measuring the wrong
  // body and every number below is suspect.
  let crossCheck = null;
  try {
    const doc = glbDocument(readFileSync(rigFile));
    const eff = effectiveBounds(doc);
    const staticH = eff.size ? eff.size[1] : null;
    crossCheck = { threeJsNaturalM: rig.naturalHeight, staticDecoderM: staticH };
  } catch (e) {
    crossCheck = { error: String(e) };
  }

  const rows = [];

  // Surface verbs — the full overlay.
  const SURFACE = ["STEP_UP", "SLIDE", "VAULT", "CLIMB_OVER", "CLIMB_UP", "JUMP_HANG", "HANG_DROP"];
  for (const verb of SURFACE) {
    const move = canonicalMove(verb);
    const stages = stagesFor(verb);
    const requested = VERB_CLIP[verb];
    const clipName = playerClipFor(requested);
    const onRig = stages
      ? stages.every((st) => clipNames.has(st.clipName))
      : clipNames.has(clipName);
    const windowMs = PARKOUR_TUNING.durationsMs[verb];
    // A staged verb has no single timing story: each stage is fitted to its own
    // window, so the row carries all three rather than pretending one clip covers
    // 1700ms. `timing` stays the FIRST stage so the existing verdict logic has
    // something honest to read; `stageTiming` is the whole picture.
    const timing = timingFor(verb, stages ? stages[0].clipName : clipName, stages ? stages[0].ms : windowMs);
    const stageTiming = stages
      ? stages.map((st) => ({ stage: st.stage, ...timingFor(verb, st.clipName, st.ms) }))
      : null;
    const rate = timing.actualRate ?? 1; // locomotion fallback plays ~stride; use 1 for the overlay
    const startOffset = CLIP_CONTENT_START_MS[clipName] ?? 0;
    const applyIk = useIk && rig.parkourLimbs && move.gripHands !== undefined;
    // Foot pins hold a genuinely PLANTED foot still (the vault/mantle push-off).
    // A slide's feet are MEANT to travel the ground (feetSlideExpected) and a
    // locomotion substitute has no authored plant, so those get no pin. A hang has
    // no plant at all — the feet are in the air for most of the window and the
    // live detector would latch whichever toe hangs lowest.
    const plants =
      applyIk && move.gripHands && !move.feetSlideExpected && !stages
        ? detectPlants(rig, move, clipName, windowMs, rate, startOffset)
        : null;
    const s = onRig
      ? sampleVerb(rig, move, clipName, windowMs, rate, startOffset, applyIk, plants, stages)
      : { error: `clip '${clipName}' (from ${requested}) not baked on rig` };
    const verdict = verdictForSurfaceVerb(verb, move, timing, s);
    rows.push({
      verb, requested, clipName, fallback: requested !== clipName,
      windowMs, kind: "SURFACE", move: move.note, timing, stageTiming, sample: s, verdict,
    });
  }

  // Ballistic / passive verbs — timing only; contact is N/A (they travel a real
  // collided path and legitimately leave every surface).
  const BALLISTIC = ["JUMP_GAP", "RUN_OFF", "LEAP_OF_FAITH"];
  for (const verb of BALLISTIC) {
    const requested = VERB_CLIP[verb];
    const clipName = playerClipFor(requested);
    rows.push({
      verb, requested, clipName, fallback: requested !== clipName,
      windowMs: null, kind: "BALLISTIC",
      note: "integrator-timed (ballistic/passive); no authored window and no surface to grip — contact/sliding/clipping N/A",
      verdict: { rank: -2, label: "N/A", flags: [] },
    });
  }

  // Landings — recovery ON a surface; timing + foot slide are meaningful.
  const LANDINGS = [["RUN", "run-off/jump absorb"], ["ROLL", "shoulder roll"], ["HARD", "heavy landing"], ["RECEIVED", "dive receiver"]];
  for (const [land, desc] of LANDINGS) {
    const clipName = playerClipFor(LANDING_CLIP[land]);
    const windowMs = LANDING_RECOVERY_TICKS[land] * FIELD_DT * 1000;
    const timing = timingFor(`LAND_${land}`, clipName, windowMs);
    rows.push({
      verb: `LAND_${land}`, requested: LANDING_CLIP[land], clipName,
      fallback: LANDING_CLIP[land] !== clipName, windowMs, kind: "LANDING",
      note: `${desc}: recovery clip fitted to a ${windowMs.toFixed(0)}ms window`,
      timing, verdict: landingVerdict(timing),
    });
  }

  return { rigFile, naturalHeight: rig.naturalHeight, crossCheck, rows,
    orphanClips: findOrphanClips(clipNames) };
}

function landingVerdict(timing) {
  const flags = [];
  if (timing.actualRate === null) {
    flags.push(`clip '${timing.clipName}' is a locomotion/substitute clip`);
  } else if (timing.overrun !== null && timing.overrun > 1.01) {
    flags.push(`overruns the ${timing.windowMs.toFixed(0)}ms window by ${timing.overrun.toFixed(2)}x at the ${timing.actualRate.toFixed(2)}x ceiling; ${(timing.contentShownFrac * 100).toFixed(0)}% of the clip shown`);
  }
  return { rank: flags.length ? 1 : 0, label: flags.length ? "FLAGGED" : "OK", flags };
}

/**
 * Baked performance clips no verb or landing actually plays (a bake nothing uses).
 *
 * THE CANDIDATE LIST IS DERIVED, NOT TYPED. It used to be a hand-written array of
 * clip names, which means a clip baked onto the rig and wired to nothing was
 * invisible to the one instrument whose job is to notice — the failure this check
 * exists to prevent, in the check itself. `CLIP_CONTENT_MS` is the rig's own list
 * of measured one-shot performances (a locomotion cycle has no entry), so every
 * baked performance is a candidate by construction and a new bake shows up here
 * the moment it lands without being played.
 */
function findOrphanClips(clipNames) {
  const used = new Set();
  for (const v of Object.values(VERB_CLIP)) used.add(playerClipFor(v));
  for (const v of Object.values(LANDING_CLIP)) used.add(playerClipFor(v));
  for (const v of Object.values(HANG_STAGE_CLIP)) used.add(playerClipFor(v));
  // Played by systems this instrument does not model, so their absence from the
  // traversal tables is not an orphan. Named individually rather than by a
  // pattern, so a clip that stops being played somewhere else still surfaces:
  // `dodge` is the duel's evade, `throwLight` the handbill toss (MissionStage's
  // THROW_CLIP), `land` the alias `landHard` resolves through.
  const playedElsewhere = new Set(["dodge", "throwLight", "land"]);
  return Object.keys(CLIP_CONTENT_MS)
    .filter((c) => clipNames.has(c) && !used.has(c) && !playedElsewhere.has(c))
    .sort();
}

// ---------------------------------------------------------------- report
function fmtTiming(t) {
  if (!t) return "";
  if (t.actualRate === null) return `clip ${t.clipName} (locomotion/substitute — stride-matched, not verb-fitted)`;
  if (t.cyclic) {
    return `clip ${t.clipName} (cyclic: played unscaled at 1.0x, looped to fill the ${t.windowMs.toFixed(0)}ms window)`;
  }
  if (t.content === null) {
    return `clip ${t.clipName}: no measured content length; plays ${t.actualRate.toFixed(2)}x over the ${t.windowMs.toFixed(0)}ms window`;
  }
  const parts = [
    `clip ${t.clipName}: content ${t.content}ms / window ${t.windowMs.toFixed(0)}ms`,
    `needs ${t.requiredRate.toFixed(2)}x, plays ${t.actualRate.toFixed(2)}x`,
  ];
  if (t.contentShownFrac !== null) parts.push(`${(t.contentShownFrac * 100).toFixed(0)}% shown`);
  if (t.cappedByCeiling) parts.push(`CAPPED at ${MAX_VERB_TIME_SCALE}x -> overrun ${t.overrun.toFixed(2)}x`);
  return parts.join("; ");
}

function report(data) {
  console.log("clip-fidelity: does the PLAYED CLIP put hands on holds and feet on surfaces during each authored verb?\n");
  console.log(`  rig: ${basename(data.rigFile)}  (fitted from natural ${data.naturalHeight.toFixed(4)}m to STAND_HEIGHT ${STAND_HEIGHT}m)`);
  console.log(`  limb IK: ${data.ikLive ? "LIVE (applyParkourIkToRig, as the renderer runs it) — pass --no-ik for the root-neutral baseline" : "OFF (root-neutral baseline)"}`);
  if (data.crossCheck?.staticDecoderM != null) {
    const d = Math.abs(data.crossCheck.threeJsNaturalM - data.crossCheck.staticDecoderM);
    console.log(`  decoder cross-check: three.js ${data.crossCheck.threeJsNaturalM.toFixed(4)}m vs static skinned ${data.crossCheck.staticDecoderM.toFixed(4)}m (${d < 0.02 ? "agree" : `DISAGREE by ${d.toFixed(3)}m`})`);
  }
  console.log("");

  const surface = data.rows.filter((r) => r.kind === "SURFACE");
  const landing = data.rows.filter((r) => r.kind === "LANDING");
  const ballistic = data.rows.filter((r) => r.kind === "BALLISTIC");

  console.log("  ===================== AUTHORED SURFACE VERBS =====================");
  console.log("  (clip overlaid on the smoothstep anchor path over a canonical envelope obstacle)\n");
  for (const r of surface) {
    console.log(`  ${r.verdict.label.padEnd(8)} ${r.verb.padEnd(11)} ${r.move}`);
    if (r.stageTiming) {
      for (const st of r.stageTiming) {
        console.log(`      ${st.stage.padEnd(5)} ${fmtTiming(st)}`);
      }
    } else {
      console.log(`      ${fmtTiming(r.timing)}`);
    }
    if (r.sample && !r.sample.error) {
      const s = r.sample;
      console.log(`      hands: closest ${s.handMinDist?.toFixed(2)}m to object (top-plane gap ${s.handMinTopGap?.toFixed(2)}m); foot lift ${(s.footPeakLift * 100).toFixed(1)}cm`);
      console.log(`      slide: peak ${s.plantSlidePeak.toFixed(2)} m/s (mean ${s.plantSlideMean.toFixed(2)}, ${s.plantSamples} planted samples) over ${s.rootTravelM.toFixed(2)}m path; clip-through max ${(s.maxPen * 100).toFixed(1)}cm ${s.maxPenLimb ? `(${s.maxPenLimb})` : ""}`);
    } else if (r.sample?.error) {
      console.log(`      ${r.sample.error}`);
    }
    for (const f of r.verdict.flags) console.log(`      -> ${f}`);
    console.log("");
  }

  console.log("  ===================== LANDINGS (recovery on a surface) =====================\n");
  for (const r of landing) {
    console.log(`  ${r.verdict.label.padEnd(8)} ${r.verb.padEnd(12)} ${fmtTiming(r.timing)}`);
    for (const f of r.verdict.flags) console.log(`      -> ${f}`);
  }
  console.log("");

  console.log("  ===================== BALLISTIC / PASSIVE (contact N/A) =====================\n");
  for (const r of ballistic) {
    console.log(`  ${r.verdict.label.padEnd(8)} ${r.verb.padEnd(12)} clip ${r.clipName}${r.fallback ? ` (from ${r.requested})` : ""} — ${r.note}`);
  }
  console.log("");

  if (data.orphanClips.length) {
    console.log("  ----- baked but unplayed performance clips (a bake no verb/landing uses) -----");
    console.log(`    ${data.orphanClips.join(", ")}`);
    console.log("");
  }

  // Ranked worst offenders.
  const scored = data.rows.filter((r) => r.verdict.rank >= 1)
    .sort((a, b) => b.verdict.rank - a.verdict.rank || b.verdict.flags.length - a.verdict.flags.length);
  console.log("  ===================== RANKED WORST OFFENDERS =====================");
  if (scored.length === 0) console.log("    (none flagged)");
  scored.forEach((r, i) => {
    console.log(`    ${i + 1}. ${r.verb} [${r.verdict.label}] — ${r.verdict.flags.length} issue(s)`);
    for (const f of r.verdict.flags) console.log(`         ${f}`);
  });
  console.log("");
}

// ---------------------------------------------------------------- selftest
// A fidelity sampler that cannot tell contact from a miss, a plant from a slide,
// or inside from outside is worse than none. Every assertion is BOTH DIRECTIONS:
// a check that can only pass is worthless.
function selfTest() {
  let failed = 0;
  const check = (label, ok, detail) => {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${detail}`);
  };
  console.log("clip-fidelity selftest: prove the sampler reads what it should, in both directions.\n");

  const b = box(-1, 1, 0, 1, 0, 1, "rung");

  // CONTACT: a point ON the rung reads contact; 0.5m off reads a violation.
  {
    const on = distToBox({ x: 0, y: 1.0, z: 0.5 }, b);
    const off = distToBox({ x: 0, y: 1.5, z: 0.5 }, b);
    check("hand exactly on the rung reads contact", on <= GRIP_BAND_M, `dist ${on.toFixed(3)}m <= ${GRIP_BAND_M}`);
    check("hand 0.5m off the rung reads a violation", off > GRIP_BAND_M, `dist ${off.toFixed(3)}m > ${GRIP_BAND_M}`);
  }

  // CLIPPING: a point inside reads penetration; outside reads none.
  {
    const inside = penetration({ x: 0, y: 0.5, z: 0.5 }, b);
    const outside = penetration({ x: 0, y: 1.3, z: 0.5 }, b);
    check("limb inside the box reads clipping", inside > CLIP_THROUGH_M, `pen ${inside.toFixed(3)}m > ${CLIP_THROUGH_M}`);
    check("limb outside the box reads no clipping", outside === 0, `pen ${outside.toFixed(3)}m`);
  }

  // SLIDING: a planted foot that translates in world reads sliding; one held
  // world-stationary reads none. Same detector the real path uses.
  {
    // Synthetic: foot local height flat (planted), local XZ constant, but the
    // ROOT path translates 1m over 10 frames at 60Hz -> world foot slides.
    const frames = 11;
    const times = [];
    const worldSlide = [];
    const worldStill = [];
    const localY = [];
    for (let i = 0; i < frames; i++) {
      const tt = i * SAMPLE_DT;
      times.push(tt);
      localY.push(0); // always planted
      const rootZ = (i / (frames - 1)) * 1.0; // 1m over the window
      worldSlide.push({ x: 0, z: rootZ + 0 });      // local foot fixed, root moves -> slides
      worldStill.push({ x: 0, z: 0 });              // local foot cancels root -> stationary
    }
    const measure = (world) => {
      const low = Math.min(...localY);
      const planted = localY.map((y) => y <= low + CLIP_CONTACT_BAND_M);
      let peak = 0, s = null;
      for (let i = 0; i <= planted.length; i++) {
        if (i < planted.length && planted[i]) { if (s === null) s = i; continue; }
        if (s === null) continue;
        if (times[i - 1] - times[s] >= MIN_PLANT_S) {
          for (let j = s + 1; j < i; j++) {
            const dt = times[j] - times[j - 1];
            peak = Math.max(peak, Math.hypot(world[j].x - world[j - 1].x, world[j].z - world[j - 1].z) / dt);
          }
        }
        s = null;
      }
      return peak;
    };
    const slide = measure(worldSlide);
    const still = measure(worldStill);
    check("planted foot that translates reads sliding", slide > PLANT_SLIDE_MPS, `peak ${slide.toFixed(2)} m/s > ${PLANT_SLIDE_MPS}`);
    check("planted foot held stationary reads no slide", still < 0.01, `peak ${still.toFixed(3)} m/s`);
  }

  // TIMING: a clip that fits reads no overrun; one twice too long overruns 2.0x.
  {
    // content 3000ms, window 750ms -> required 4.0x, ceiling 4 -> plays 4x, no overrun.
    const fits = timingFor("X", "vault", 750);
    // content 3000ms, window 375ms -> required 8.0x, ceiling 4 -> overrun 2.0x.
    const over = timingFor("X", "vault", 375);
    check("clip that fits the window reads no overrun", Math.abs((fits.overrun ?? 0) - 1) < 0.01, `overrun ${fits.overrun?.toFixed(2)}x`);
    check("clip twice too long reads a 2.0x overrun", over.overrun !== null && Math.abs(over.overrun - 2) < 0.01, `overrun ${over.overrun?.toFixed(2)}x`);
  }

  // GEOMETRY: distToBox both directions on the point-to-AABB helper.
  {
    check("distToBox is 0 inside, positive outside",
      distToBox({ x: 0, y: 0.5, z: 0.5 }, b) === 0 && distToBox({ x: 3, y: 0.5, z: 0.5 }, b) > 1.9,
      `inside 0, far ${distToBox({ x: 3, y: 0.5, z: 0.5 }, b).toFixed(2)}m`);
  }

  console.log(failed === 0
    ? "\nclip-fidelity selftest: OK (contact, clipping, sliding and timing each proven in both directions)"
    : `\nclip-fidelity selftest: FAIL (${failed} case(s))`);
  return failed;
}

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
if (argv.includes("--selftest")) {
  process.exit(selfTest() === 0 ? 0 : 1);
}
const rigArgIdx = argv.indexOf("--rig");
const rigFile = rigArgIdx >= 0 ? resolve(argv[rigArgIdx + 1]) : DEFAULT_RIG;
if (!existsSync(rigFile)) {
  console.error(`clip-fidelity: rig not found: ${rigFile}`);
  process.exit(2);
}
// IK is LIVE by default so this tool measures what the renderer draws; --no-ik
// gives the root-neutral baseline for a before/after comparison.
const useIk = !argv.includes("--no-ik");
const data = await run(rigFile, useIk);
data.ikLive = useIk;
if (argv.includes("--json")) {
  console.log(JSON.stringify(data, (k, v) => (v instanceof Set ? [...v] : v), 2));
  process.exit(0);
}
report(data);
// A diagnostic, not a gate: always exit 0 so it can never break a build for
// anyone until the clips/windows are reworked to satisfy it.
process.exit(0);

// ---------------------------------------------------------------- wiring it in
// HOW IT WOULD BE WIRED, and why it is NOT yet. This is red by construction: the
// vault/mantle overruns are documented in tuning.ts and the root-neutral
// overlay makes floating hands and sliding plants unavoidable until the clips
// are re-baked or retargeted. A red blocking gate would stop four active lanes,
// so — exactly as check-world-affordances staged itself before becoming
// assets:verify:affordances — this stays a report until:
//
//   1. It grows a `--gate` that self-tests first (refuses to gate with a broken
//      instrument) and then measures against an itemised, MEASURED KNOWN-DEBT
//      list (verb -> accepted overrun / slide / float / clip-through), failing
//      only on a NEW or WORSENED number, never requiring the whole list green.
//   2. The climb mechanic rebuild (mission-world, under the owner's ladder law)
//      and the asset lane's five ladder locations land, because those change
//      which verbs exist and what they act on.
//   3. A decision is taken on the two structural facts this surfaces, neither of
//      which a tolerance can hide: authored verbs teleport the root along a
//      smoothstep path while the clip is root-neutral and un-retargeted (no IK),
//      and the playback ceiling fades performances out mid-move. Passing means
//      either retargeting end-effectors onto the anchor geometry, or re-baking
//      clips to the windows — an animation/engine decision, not a gate knob.
//
// Until then: run it, read the ranked list, and treat every number as a
// statement about the PERFORMANCE, which nothing else in the tree measures.
