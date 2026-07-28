import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as THREE from "three";
import {
  nearestSurfacePoint,
  exitFaceToward,
  handTarget,
  footTarget,
  solveTwoBoneIk,
  solveTwoBoneIkGuarded,
  type IkBox,
} from "../parkourIk.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const unit: IkBox = { min: [-1, 0, 0], max: [1, 1, 1] };

// ---- geometry, both directions ------------------------------------------

test("nearestSurfacePoint clamps an outside point and projects an inside one", () => {
  // Outside: nearest point is the clamp onto the box.
  const out = nearestSurfacePoint({ x: 3, y: 0.5, z: 0.5 }, unit);
  assert.deepEqual(out, { x: 1, y: 0.5, z: 0.5 });
  // Inside: smallest-exit face. y=0.9 is 0.1 from the top, the nearest face.
  const inside = nearestSurfacePoint({ x: 0, y: 0.9, z: 0.5 }, unit);
  assert.equal(inside.y, 1);
  assert.equal(inside.x, 0);
  assert.equal(inside.z, 0.5);
});

test("exitFaceToward leaves the box on the body's side, keeping the other axes", () => {
  const p = { x: 0, y: 0.5, z: 0.5 };
  // Body below -> exit the bottom face (y-min), x and z unchanged.
  const down = exitFaceToward(p, unit, { x: 0, y: -5, z: 0.5 }, 0.01);
  assert.ok(down.y < 0, `expected exit below the box, got ${down.y}`);
  assert.equal(down.x, 0);
  assert.equal(down.z, 0.5);
  // Body in front (-z) -> exit the near face (z-min), keeping height.
  const front = exitFaceToward(p, unit, { x: 0, y: 0.5, z: -5 }, 0.01);
  assert.ok(front.z < 0, `expected exit in front of the box, got ${front.z}`);
  assert.equal(front.y, 0.5);
});

test("handTarget projects a buried hand out and snaps a near hand to the hold", () => {
  const opts = { boxes: [unit], gripHands: true, gripReachM: 0.45, skinM: 0.01 };
  // Buried: pulled out through the nearest face.
  const buried = handTarget({ x: 0, y: 0.9, z: 0.5 }, opts);
  assert.ok(buried && buried.y > 1, "a hand inside the solid is pushed proud of it");
  // Near (0.1m above the top): snapped down onto the surface.
  const near = handTarget({ x: 0, y: 1.1, z: 0.5 }, opts);
  assert.ok(near, "a hand within reach of the hold snaps to it");
  assert.ok(Math.abs(near.y - 1) < 1e-9, `snapped onto the top plane, got ${near?.y}`);
  // Far and clear: left alone.
  const far = handTarget({ x: 0, y: 3, z: 0.5 }, opts);
  assert.equal(far, null, "a clear hand out of reach is not moved");
  // Grip disabled: a clear hand is never snapped.
  const noGrip = handTarget({ x: 0, y: 1.1, z: 0.5 }, { ...opts, gripHands: false });
  assert.equal(noGrip, null);
});

test("footTarget prefers a pin, else projects a buried foot out, else null", () => {
  const opts = { boxes: [unit], gripHands: false, gripReachM: 0.45, skinM: 0.01 };
  const pin = { x: 9, y: 9, z: 9 };
  assert.deepEqual(footTarget({ x: 0, y: 0.9, z: 0.5 }, pin, opts), pin, "a pin wins");
  const buried = footTarget({ x: 0, y: 0.9, z: 0.5 }, null, opts);
  assert.ok(buried && buried.y > 1, "a buried foot is pushed out");
  assert.equal(footTarget({ x: 0, y: 3, z: 0.5 }, null, opts), null, "a clear foot is left alone");
});

// ---- the solver, both directions ----------------------------------------

function twoBoneChain(): { root: THREE.Bone; mid: THREE.Bone; end: THREE.Bone; holder: THREE.Object3D } {
  // A straight limb pointing down: root at origin, mid 0.4 below, end 0.8 below.
  const holder = new THREE.Object3D();
  const root = new THREE.Bone();
  const mid = new THREE.Bone();
  const end = new THREE.Bone();
  root.position.set(0, 0, 0);
  mid.position.set(0, -0.4, 0); // local to root
  end.position.set(0, -0.4, 0); // local to mid
  root.add(mid);
  mid.add(end);
  holder.add(root);
  holder.updateMatrixWorld(true);
  return { root, mid, end, holder };
}

test("solveTwoBoneIk drives the tip onto a reachable target", () => {
  const { root, mid, end, holder } = twoBoneChain();
  const target = { x: 0.3, y: -0.5, z: 0.2 }; // within the 0.8 reach
  const acted = solveTwoBoneIk(root, mid, end, target);
  assert.equal(acted, true);
  holder.updateMatrixWorld(true);
  const tip = new THREE.Vector3();
  end.getWorldPosition(tip);
  const err = tip.distanceTo(new THREE.Vector3(target.x, target.y, target.z));
  assert.ok(err < 0.02, `tip reached the target within 2cm (err ${err.toFixed(4)}m)`);
});

test("solveTwoBoneIk refuses a target inside the limb's minimum fold", () => {
  // Equal bones fold to zero, so make them unequal: reach 0.8, min fold 0.0 here
  // is not useful; build an unequal chain so minReach is meaningful.
  const holder = new THREE.Object3D();
  const root = new THREE.Bone();
  const mid = new THREE.Bone();
  const end = new THREE.Bone();
  mid.position.set(0, -0.2, 0);
  end.position.set(0, -0.6, 0); // bones 0.2 and 0.6 -> minReach 0.4
  root.add(mid); mid.add(end); holder.add(root);
  holder.updateMatrixWorld(true);
  const before = new THREE.Vector3();
  end.getWorldPosition(before);
  // Target 0.1m from the root: closer than the 0.4 minimum fold.
  const acted = solveTwoBoneIk(root, mid, end, { x: 0.05, y: -0.05, z: 0 });
  assert.equal(acted, false, "an unreachably-close target is refused");
  const after = new THREE.Vector3();
  end.getWorldPosition(after);
  assert.ok(before.distanceTo(after) < 1e-9, "and the pose is untouched");
});

test("solveTwoBoneIkGuarded reverts a solve that would fling the tip", () => {
  const { root, mid, end, holder } = twoBoneChain();
  const before = new THREE.Vector3();
  end.getWorldPosition(before);
  // A reachable target moves the tip a little and is kept.
  const kept = solveTwoBoneIkGuarded(root, mid, end, { x: 0.2, y: -0.6, z: 0.1 }, 0.4);
  assert.equal(kept, true);
  // A tiny correction cap makes even a modest move "too far" and is reverted.
  const chain2 = twoBoneChain();
  const b2 = new THREE.Vector3();
  chain2.end.getWorldPosition(b2);
  const reverted = solveTwoBoneIkGuarded(
    chain2.root, chain2.mid, chain2.end, { x: 0.5, y: -0.2, z: 0.3 }, 0.001,
  );
  assert.equal(reverted, false, "a move beyond the correction cap is refused");
  chain2.holder.updateMatrixWorld(true);
  const a2 = new THREE.Vector3();
  chain2.end.getWorldPosition(a2);
  assert.ok(b2.distanceTo(a2) < 1e-6, "and the clip pose is restored");
  void holder; void before;
});

// ---- presentation-only: it can feed nothing hashed ----------------------

test("parkourIk imports only three, and the sim never imports it", () => {
  const src = readFileSync(join(HERE, "..", "parkourIk.ts"), "utf8");
  // Only RUNTIME imports matter: `import type` is erased at build and can carry
  // no value into a hash. The sole runtime import must be three.
  const runtimeImports = src
    .split("\n")
    .filter((l) => /^\s*import\b/.test(l) && /from\s+["']/.test(l) && !/^\s*import\s+type\b/.test(l));
  for (const line of runtimeImports) {
    const from = line.match(/from\s+["']([^"']+)["']/)?.[1] ?? "";
    assert.equal(from, "three", `parkourIk may import only three at runtime, found "${from}"`);
  }
  // Nothing on the simulation / hash path may import the IK, or its output could
  // reach a digest. These are the modules that produce hashed state.
  for (const rel of ["../playerMotion.ts", "../parkour/flow.ts", "../fieldSimulation.ts"]) {
    const p = join(HERE, "..", rel.replace("../", ""));
    const text = readFileSync(p, "utf8");
    assert.ok(!text.includes("parkourIk"), `${rel} must not import parkourIk`);
  }
});
