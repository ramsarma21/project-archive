import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type FreeJumpContext,
  freeLocomotionClip,
  freeMoveSpeed,
  resolveFreeJump,
} from "../playerInput.js";
import { CROUCH_SPEED, RUN_SPEED, WALK_SPEED } from "../playerMotion.js";

function context(over: Partial<FreeJumpContext> = {}): FreeJumpContext {
  return {
    nowMs: 1000,
    pressedAtMs: 1000,
    releasedSinceAction: true,
    cooldownUntilMs: 0,
    enabled: true,
    uiFocused: false,
    actionActive: false,
    grounded: true,
    falling: false,
    airtimeMs: 0,
    shiftHeld: false,
    forwardInput: false,
    crouched: false,
    speed: 0,
    velX: 0,
    velZ: 0,
    facingX: 0,
    facingZ: 1,
    ...over,
  };
}

test("Space idle/walking is always normal jump", () => {
  assert.equal(resolveFreeJump(context()), "STANDING_JUMP");
  assert.equal(
    resolveFreeJump(context({ speed: 1.8, velZ: 1.8, forwardInput: true })),
    "STANDING_JUMP",
  );
});

test("speed alone never selects running jump without Shift", () => {
  assert.equal(
    resolveFreeJump(
      context({ speed: 4.6, velZ: 4.6, forwardInput: true, shiftHeld: false }),
    ),
    "STANDING_JUMP",
  );
});

test("Shift+Space selects running jump only in forward sprint state", () => {
  assert.equal(
    resolveFreeJump(
      context({ speed: 4.6, velZ: 4.6, forwardInput: true, shiftHeld: true }),
    ),
    "RUNNING_JUMP",
  );
  assert.equal(
    resolveFreeJump(
      context({ speed: 4.6, velX: 4.6, forwardInput: false, shiftHeld: true }),
    ),
    "STANDING_JUMP",
  );
  assert.equal(
    resolveFreeJump(
      context({ speed: 0.8, velZ: 0.8, forwardInput: true, shiftHeld: true }),
    ),
    "STANDING_JUMP",
  );
});

test("free jump policy is independent of nearby affordances", () => {
  // There is intentionally no affordance/object field in FreeJumpContext.
  // Space always resolves physically; collision decides whether it clears.
  assert.equal(
    resolveFreeJump(context({ speed: 2, velZ: 2, forwardInput: true })),
    "STANDING_JUMP",
  );
});

test("jump input gates repeat, cooldown, UI, busy/action, crouch, and stale press", () => {
  assert.equal(resolveFreeJump(context({ releasedSinceAction: false })), "NONE");
  assert.equal(resolveFreeJump(context({ cooldownUntilMs: 1100 })), "NONE");
  assert.equal(resolveFreeJump(context({ uiFocused: true })), "NONE");
  assert.equal(resolveFreeJump(context({ enabled: false })), "NONE");
  assert.equal(resolveFreeJump(context({ actionActive: true })), "NONE");
  assert.equal(resolveFreeJump(context({ crouched: true })), "NONE");
  assert.equal(resolveFreeJump(context({ nowMs: 1201, pressedAtMs: 1000 })), "NONE");
});

test("Space coyote grace applies only to a recent fall", () => {
  assert.equal(
    resolveFreeJump(
      context({ grounded: false, falling: true, airtimeMs: 80 }),
    ),
    "STANDING_JUMP",
  );
  assert.equal(
    resolveFreeJump(
      context({ grounded: false, falling: true, airtimeMs: 150 }),
    ),
    "NONE",
  );
});

test("Shift is the explicit sprint speed/clip modifier; release returns to walk", () => {
  const moving = { moving: true, crouched: false, actionActive: false };
  assert.equal(freeMoveSpeed({ ...moving, shiftHeld: false }), WALK_SPEED);
  assert.equal(freeMoveSpeed({ ...moving, shiftHeld: true }), RUN_SPEED);
  assert.equal(
    freeLocomotionClip({ ...moving, speed: RUN_SPEED, shiftHeld: true }),
    "run",
  );
  assert.equal(
    freeLocomotionClip({ ...moving, speed: RUN_SPEED, shiftHeld: false }),
    "walk",
  );
  assert.equal(
    freeMoveSpeed({ ...moving, crouched: true, shiftHeld: true }),
    CROUCH_SPEED,
  );
});
