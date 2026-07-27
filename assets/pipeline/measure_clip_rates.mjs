// Measure, off the baked rig, the three numbers the mixer needs to play a clip
// at the rate it was authored for:
//
//   1. LENGTH. `clip.duration`, at the scale the renderer actually draws. This
//      is the input to every "authored ms / mechanical window" playback rate in
//      the presentation layer, and half of those rates were fitted to a window
//      with no measurement of the clip on the other side of the division.
//
//   2. CONTENT. Where inside that length the performance actually happens.
//      Several of these clips open or close on dead air — `leapOfFaithLand`
//      lies motionless for its first 2.5 seconds and stands motionless for its
//      last 2.2 — and a rate computed from the FILE length spends the window on
//      the dead air. Reported as lead / content / tail, gated at 8% of the
//      clip's own peak pose speed, where pose speed is the mean bone
//      displacement per second across the whole skeleton.
//
//   3. STANCE SPEED, for a locomotion cycle. A root-motion-stripped clip does
//      not travel, so the only thing that says how fast it was authored to move
//      is the planted foot: while a foot is on the ground it must sweep
//      backward at exactly the ground speed, or the foot slides. So the
//      authored speed is the SLOPE OF THE PLANTED FOOT'S BACKWARD SWEEP, fitted
//      over the frames it is planted.
//
// Point 3 is where `verify_clip_contacts.py` goes wrong and why the numbers in
// CLIP_AUTHORED_SPEED_MPS are all too low. It measures the same sweep, then
// divides it by HALF THE CYCLE rather than by the time the foot was down:
//
//     implied = stanceSweep / (cycleSeconds / 2)
//
// Those are only the same number for a gait with no flight and no double
// support. A run is airborne for a third of its cycle, so the denominator is
// half again too large and the authored speed comes out a third too low — which
// the mixer then "corrects" by playing the clip a third too fast. Dividing the
// sweep by its own duration is the measurement that has no gait assumption in
// it at all.
//
// It also measures the SOURCE rig rather than the drawn one. Every loader fits
// a rig to STAND_HEIGHT, and this cast is authored at 1.80m, so a speed
// measured on the source is 16% faster than the speed the audience sees. This
// script fits first, exactly as `RiggedCharacter` does, so what it prints is
// what is on screen.
//
// Usage:
//   node assets/pipeline/measure_clip_rates.mjs [rig.glb] [--clip name ...] [--json]
globalThis.self = globalThis;
import { readFileSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const threeRoot = join(repoRoot, "apps", "web", "node_modules", "three");
const THREE = await import(pathToFileURL(join(threeRoot, "build", "three.module.js")));
const { GLTFLoader } = await import(
  pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js"))
);

/** engine-world STAND_HEIGHT. Every rig is drawn fitted to this. */
const STAND_HEIGHT = 1.55;
/** Samples per second of clip time. Well above the 30fps bake. */
const SAMPLE_HZ = 240;

const argv = process.argv.slice(2);
const wantJson = argv.includes("--json");
const only = new Set();
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--clip" && argv[i + 1]) only.add(argv[++i]);
}
const files = argv.filter((a) => !a.startsWith("--") && a.endsWith(".glb"));
if (files.length === 0) {
  files.push(join(repoRoot, "apps/web/public/world/characters/playerboy-rigged.glb"));
}

/** Cyclic locomotion clips: the ones a stance speed is meaningful for. */
const LOCOMOTION = new Set([
  "walk", "run", "sprint", "crouchWalk", "aimWalk", "aimRun", "blendWalk",
]);

const TOES = ["LeftToeBase", "RightToeBase"];
const HEELS = ["LeftFoot", "RightFoot"];

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

/** RiggedCharacter's fit, verbatim: skinned bounds, feet on 0, height matched. */
function fit(root, height) {
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

/**
 * Least-squares slope of `values` against `times`, in units per second.
 *
 * A fit rather than an endpoint difference because the first and last samples
 * of a stance are the two least trustworthy ones: they straddle the contact
 * threshold, so an endpoint measurement inherits the whole error of wherever
 * that threshold happened to fall.
 */
function slope(times, values) {
  const n = times.length;
  if (n < 3) return 0;
  let st = 0, sv = 0;
  for (let i = 0; i < n; i++) { st += times[i]; sv += values[i]; }
  const mt = st / n, mv = sv / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (times[i] - mt) * (values[i] - mv);
    den += (times[i] - mt) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Stance speed of a locomotion cycle, in m/s.
 *
 * A foot is "planted" while its toe sits within `contactBand` of the lowest
 * height that toe reaches in the clip. Over each planted run the toe's
 * horizontal position is fitted against time; the magnitude of that slope is
 * the speed the ground must move at for the foot not to slide. Runs shorter
 * than 60ms are ignored — they are the threshold flickering at toe-off, not a
 * stance.
 */
function stanceSpeed(samples, contactBand = 0.02) {
  const out = [];
  for (const foot of samples.feet) {
    const lowest = Math.min(...foot.y);
    const planted = foot.y.map((y) => y <= lowest + contactBand);
    let start = null;
    for (let i = 0; i <= planted.length; i++) {
      if (i < planted.length && planted[i]) {
        if (start === null) start = i;
        continue;
      }
      if (start === null) continue;
      const end = i;
      const times = samples.t.slice(start, end);
      if (times.length >= 3 && times[times.length - 1] - times[0] >= 0.06) {
        // Fit both horizontal axes and take the resultant, so the measurement
        // does not depend on which way the rig happens to face.
        const vx = slope(times, foot.x.slice(start, end));
        const vz = slope(times, foot.z.slice(start, end));
        out.push({
          speed: Math.hypot(vx, vz),
          seconds: times[times.length - 1] - times[0],
          sweep: Math.hypot(vx, vz) * (times[times.length - 1] - times[0]),
        });
      }
      start = null;
    }
  }
  if (out.length === 0) return null;
  // The longest stance is the cleanest one: a clip that loops mid-stance splits
  // one contact across the seam and both halves read short.
  out.sort((a, b) => b.seconds - a.seconds);
  const best = out[0];
  const total = out.reduce((sum, s) => sum + s.sweep, 0);
  const totalSeconds = out.reduce((sum, s) => sum + s.seconds, 0);
  return {
    speed: best.speed,
    pooled: totalSeconds > 0 ? total / totalSeconds : 0,
    stances: out.length,
    stanceSeconds: best.seconds,
    sweepM: best.sweep,
  };
}

/**
 * Where the performance is inside the file, in ms.
 *
 * `speeds` is mean bone displacement per second, one entry per sample step. A
 * clip is "doing something" while that is above 8% of its own peak; the lead
 * and tail outside that are dead air. The gate is relative to the clip's own
 * peak rather than absolute because a get-up and a roll differ by an order of
 * magnitude in how fast the body moves, and a fixed threshold would call the
 * whole of the slow one dead.
 */
function contentWindow(speeds, stepMs) {
  const peak = Math.max(...speeds);
  if (!(peak > 0)) return { leadMs: 0, contentMs: speeds.length * stepMs, tailMs: 0 };
  const gate = peak * 0.08;
  let first = speeds.findIndex((v) => v > gate);
  let last = speeds.length - 1;
  while (last > 0 && speeds[last] <= gate) last--;
  if (first < 0) first = 0;
  const leadMs = first * stepMs;
  const tailMs = (speeds.length - 1 - last) * stepMs;
  return {
    leadMs,
    tailMs,
    contentMs: Math.max(stepMs, speeds.length * stepMs - leadMs - tailMs),
  };
}

/**
 * How much of a clip's rotation is above the hips, 0..1.
 *
 * The number that decides whether a clip can be layered additively over
 * locomotion. An additive overlay adds its rotation to whatever the base clip is
 * doing, so a clip that drives the leg chains hard cannot be one: added to a run
 * it scissors the legs. `throwLight` reads 0.76 and is a real candidate;
 * `landRun` reads 0.52 despite its contract note saying it was authored
 * upper-body-weighted, and is not.
 */
const LOWER_BODY = /(UpLeg|Leg|Foot|ToeBase|Hips)/;
function upperBodyShare(clip) {
  let lower = 0;
  let upper = 0;
  const a = new THREE.Quaternion();
  const b = new THREE.Quaternion();
  for (const track of clip.tracks) {
    if (!track.name.endsWith(".quaternion")) continue;
    let travel = 0;
    for (let i = 0; i + 4 <= track.values.length; i += 4) {
      a.fromArray(track.values, i);
      if (i > 0) travel += (b.angleTo(a) * 180) / Math.PI;
      b.copy(a);
    }
    const bone = track.name.replace(/\.quaternion$/, "").replace(/^mixamorig:?/, "");
    if (LOWER_BODY.test(bone)) lower += travel;
    else upper += travel;
  }
  return lower + upper > 0 ? upper / (lower + upper) : 0;
}

const rows = [];
const loader = new GLTFLoader();
for (const file of files) {
  const data = readFileSync(resolve(file));
  const gltf = await new Promise((res, rej) =>
    loader.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", res, rej),
  );
  const root = gltf.scene;
  const natural = fit(root, STAND_HEIGHT);
  const rig = basename(file).replace(/\.glb$/, "");

  const feetBones = [...TOES, ...HEELS].map((n) => boneNamed(root, n)).filter(Boolean);
  const toeBones = TOES.map((n) => boneNamed(root, n)).filter(Boolean);
  const hips = boneNamed(root, "Hips");
  const allBones = [];
  root.traverse((o) => {
    if (o.isBone) allBones.push(o);
  });

  for (const clip of gltf.animations) {
    if (only.size > 0 && !only.has(clip.name)) continue;
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.play();
    // A repeating action wraps `setTime(duration)` back to zero, so the last
    // sample is deliberately one step short of the end. Including it reads as a
    // whole-skeleton teleport and puts a 100 m/s spike in every pose profile.
    const steps = Math.max(8, Math.round(clip.duration * SAMPLE_HZ));
    const samples = {
      t: [],
      feet: (toeBones.length ? toeBones : feetBones).map(() => ({ x: [], y: [], z: [] })),
    };
    const p = new THREE.Vector3();
    let hipsMin = Infinity, hipsMax = -Infinity;
    let hipsTravel = 0;
    let prevHips = null;
    let prevPose = null;
    const poseSpeeds = [];
    for (let s = 0; s < steps; s++) {
      const t = (clip.duration * s) / steps;
      mixer.setTime(t);
      root.updateMatrixWorld(true);
      samples.t.push(t);
      const probes = toeBones.length ? toeBones : feetBones;
      for (let f = 0; f < probes.length; f++) {
        probes[f].getWorldPosition(p);
        samples.feet[f].x.push(p.x);
        samples.feet[f].y.push(p.y);
        samples.feet[f].z.push(p.z);
      }
      const pose = allBones.map((b) => b.getWorldPosition(new THREE.Vector3()));
      if (prevPose) {
        let sum = 0;
        for (let b = 0; b < pose.length; b++) sum += pose[b].distanceTo(prevPose[b]);
        poseSpeeds.push((sum / pose.length) * (steps / clip.duration));
      }
      prevPose = pose;
      if (hips) {
        hips.getWorldPosition(p);
        hipsMin = Math.min(hipsMin, p.y);
        hipsMax = Math.max(hipsMax, p.y);
        if (prevHips) hipsTravel += Math.hypot(p.x - prevHips.x, p.z - prevHips.z);
        prevHips = { x: p.x, z: p.z };
      }
    }
    mixer.stopAllAction();
    mixer.uncacheClip(clip);

    const stance = LOCOMOTION.has(clip.name) ? stanceSpeed(samples) : null;
    const window = contentWindow(poseSpeeds, (clip.duration * 1000) / steps);
    rows.push({
      rig,
      clip: clip.name,
      durationMs: Math.round(clip.duration * 1000),
      leadMs: Math.round(window.leadMs),
      contentMs: Math.round(window.contentMs),
      tailMs: Math.round(window.tailMs),
      upperShare: Number(upperBodyShare(clip).toFixed(2)),
      naturalHeight: Number(natural.toFixed(4)),
      hipsBobCm: hips ? Number(((hipsMax - hipsMin) * 100).toFixed(2)) : null,
      hipsDriftM: hips ? Number(hipsTravel.toFixed(4)) : null,
      stanceSpeed: stance ? Number(stance.speed.toFixed(3)) : null,
      pooledSpeed: stance ? Number(stance.pooled.toFixed(3)) : null,
      stances: stance?.stances ?? null,
      stanceSeconds: stance ? Number(stance.stanceSeconds.toFixed(3)) : null,
      sweepM: stance ? Number(stance.sweepM.toFixed(3)) : null,
    });
  }
}

// ASSERTION-BASED EXIT. The header defines what a good measurement is; until now
// the script printed it and exited 0 even when it had measured nothing. Two
// thresholds are load-bearing: at least one clip must have been read (an empty
// run is a missing rig or a rig with no animations, not a clean pass), and every
// LOCOMOTION clip must yield a stance speed — point 3 of the header is that a
// locomotion cycle's authored speed IS its planted-foot sweep, so a null there is
// a measurement that failed on exactly the number the mixer needs.
const clipFailures = [];
if (rows.length === 0) {
  clipFailures.push("no clips were measured (missing rig, or a rig with no animations)");
}
for (const row of rows) {
  if (LOCOMOTION.has(row.clip) && row.stanceSpeed === null) {
    clipFailures.push(
      `${row.clip} is a locomotion cycle but no stance speed could be measured ` +
        "(no planted-foot sweep found); the mixer has no authored rate for it",
    );
  }
}

if (wantJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log(
    "clip".padEnd(18) + "len".padStart(7) + "lead".padStart(7) + "content".padStart(9) +
      "tail".padStart(7) + "upper".padStart(7) + "stance".padStart(9) + "pooled".padStart(8) +
      "n".padStart(3) + "sweep".padStart(8) + "bob(cm)".padStart(9) + "drift".padStart(8),
  );
  for (const row of rows.sort((a, b) => a.clip.localeCompare(b.clip))) {
    console.log(
      row.clip.padEnd(18) +
        String(row.durationMs).padStart(7) +
        String(row.leadMs).padStart(7) +
        String(row.contentMs).padStart(9) +
        String(row.tailMs).padStart(7) +
        row.upperShare.toFixed(2).padStart(7) +
        (row.stanceSpeed === null ? "-" : row.stanceSpeed.toFixed(3)).padStart(9) +
        (row.pooledSpeed === null ? "-" : row.pooledSpeed.toFixed(3)).padStart(8) +
        String(row.stances ?? "-").padStart(3) +
        (row.sweepM === null ? "-" : row.sweepM.toFixed(3)).padStart(8) +
        (row.hipsBobCm === null ? "-" : row.hipsBobCm.toFixed(2)).padStart(9) +
        (row.hipsDriftM === null ? "-" : row.hipsDriftM.toFixed(4)).padStart(8),
    );
  }
}

if (clipFailures.length > 0) {
  console.error(`\nFAILED: ${clipFailures.length} clip measurement problem(s):`);
  for (const problem of clipFailures) console.error(`  - ${problem}`);
  process.exit(1);
}
