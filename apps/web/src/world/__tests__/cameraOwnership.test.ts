import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCameraOwnership,
  cameraTransition,
  movementYawForPolicy,
  type CameraClaims,
} from "../cameraOwnership.js";

const NONE: CameraClaims = { firstPerson: false, choreography: false, chase: false };

test("free roam (no claims) -> PLAYER owns camera and movement", () => {
  const s = resolveCameraOwnership(NONE);
  assert.equal(s.owner, "PLAYER");
  assert.equal(s.cameraControlledExternally, false);
  assert.equal(s.inputLocked, false);
  assert.deepEqual(s.externalMovementYaw, { mode: "PLAYER" });
});

test("choreography locks BOTH camera and movement (preserves cameraOverride today)", () => {
  const s = resolveCameraOwnership({ ...NONE, choreography: true });
  assert.equal(s.owner, "CHOREOGRAPHY");
  assert.equal(s.cameraControlledExternally, true);
  assert.equal(s.inputLocked, true);
  assert.deepEqual(s.externalMovementYaw, { mode: "LOCKED" });
});

test("first-person locks both and wins the owner label over choreography", () => {
  const s = resolveCameraOwnership({ firstPerson: true, choreography: true, chase: false });
  assert.equal(s.owner, "FIRST_PERSON");
  assert.equal(s.cameraControlledExternally, true);
  assert.equal(s.inputLocked, true);
  assert.deepEqual(s.externalMovementYaw, { mode: "LOCKED" });
});

test("chase: external camera WITH live movement; WASD basis = chase camera yaw", () => {
  const s = resolveCameraOwnership({ ...NONE, chase: true, chaseCameraYaw: 1.57 });
  assert.equal(s.owner, "CHASE");
  assert.equal(s.cameraControlledExternally, true, "chase drives the camera");
  assert.equal(s.inputLocked, false, "chase keeps movement live");
  assert.deepEqual(s.externalMovementYaw, { mode: "CAMERA", yaw: 1.57 });
  assert.equal(
    movementYawForPolicy(s.externalMovementYaw, -0.75),
    1.57,
    "live movement must use the external camera yaw",
  );
});

test("movement-yaw policy preserves player follow and locks staged movement", () => {
  assert.equal(
    movementYawForPolicy({ mode: "PLAYER" }, 0.42),
    0.42,
  );
  assert.equal(
    movementYawForPolicy({ mode: "LOCKED" }, 0.42),
    null,
  );
});

test("chase without an explicit yaw defaults the movement basis to 0", () => {
  const s = resolveCameraOwnership({ ...NONE, chase: true });
  assert.deepEqual(s.externalMovementYaw, { mode: "CAMERA", yaw: 0 });
});

test("precedence: choreography/FP outrank chase which outranks player", () => {
  // FP + chase -> FP.
  assert.equal(
    resolveCameraOwnership({ firstPerson: true, choreography: false, chase: true }).owner,
    "FIRST_PERSON",
  );
  // choreography + chase -> choreography (both lock; chase never steals a beat).
  const cs = resolveCameraOwnership({ firstPerson: false, choreography: true, chase: true });
  assert.equal(cs.owner, "CHOREOGRAPHY");
  assert.equal(cs.inputLocked, true);
  // chase alone over player.
  assert.equal(resolveCameraOwnership({ ...NONE, chase: true }).owner, "CHASE");
});

test("entering external camera control cancels an in-progress pointer drag", () => {
  const player = resolveCameraOwnership(NONE);
  const chase = resolveCameraOwnership({ ...NONE, chase: true });
  const t = cameraTransition(player, chase);
  assert.equal(t.ownerChanged, true);
  assert.equal(t.from, "PLAYER");
  assert.equal(t.to, "CHASE");
  assert.equal(t.cancelPointerDrag, true, "held drag must not leak into chase cam");
  assert.equal(t.resetFollowCamera, false);

  // Player -> choreography also cancels the drag.
  const chor = resolveCameraOwnership({ ...NONE, choreography: true });
  assert.equal(cameraTransition(player, chor).cancelPointerDrag, true);
});

test("returning to free roam re-snaps the follow camera and does not re-cancel drag", () => {
  const chase = resolveCameraOwnership({ ...NONE, chase: true });
  const player = resolveCameraOwnership(NONE);
  const t = cameraTransition(chase, player);
  assert.equal(t.ownerChanged, true);
  assert.equal(t.resetFollowCamera, true);
  assert.equal(t.cancelPointerDrag, false, "player is not an external owner");
});

test("chase -> choreography (both external) does not re-cancel an already-external drag", () => {
  const chase = resolveCameraOwnership({ ...NONE, chase: true });
  const chor = resolveCameraOwnership({ ...NONE, choreography: true });
  const t = cameraTransition(chase, chor);
  assert.equal(t.ownerChanged, true);
  assert.equal(t.cancelPointerDrag, false, "was already external; nothing new to cancel");
  assert.equal(t.resetFollowCamera, false);
});

test("no owner change yields no signals", () => {
  const chaseA = resolveCameraOwnership({ ...NONE, chase: true, chaseCameraYaw: 0.1 });
  const chaseB = resolveCameraOwnership({ ...NONE, chase: true, chaseCameraYaw: 0.9 });
  const t = cameraTransition(chaseA, chaseB);
  assert.equal(t.ownerChanged, false);
  assert.equal(t.cancelPointerDrag, false);
  assert.equal(t.resetFollowCamera, false);
});
