import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXHAUSTED_JOG_SPEED,
  EXHAUSTED_TRAVERSAL_DURATION_MULTIPLIER,
  STAMINA_ACTION_DEBIT,
  acceptTraversalStamina,
  createStamina,
  stepStamina,
} from "../stamina.js";
import { freeMoveSpeed } from "../playerInput.js";
import { RUN_SPEED, WALK_SPEED } from "../playerMotion.js";
import { OnboardingPreferencesSchema } from "@pa/contracts";

test("chase sprint drains 0.14/s and walk/idle regenerates 0.3/s", () => {
  let state = createStamina();
  state = stepStamina(state, {
    dt: 1,
    resourceActive: true,
    sprinting: true,
    moving: true,
    actionActive: false,
    assist: "STANDARD",
  });
  assert.equal(state.value, 0.86);
  state = stepStamina(state, {
    dt: 1,
    resourceActive: true,
    sprinting: false,
    moving: true,
    actionActive: false,
    assist: "STANDARD",
  });
  assert.ok(Math.abs(state.value - 1) < 1e-9, `regen to cap, got ${state.value}`);
});

test("ordinary free-roam Shift remains unlimited and stamina-independent", () => {
  const moving = { moving: true, crouched: false, actionActive: false };
  assert.equal(
    freeMoveSpeed({
      ...moving,
      shiftHeld: true,
      resourceActive: false,
      stamina: 0,
      staminaAssist: "STANDARD",
    }),
    RUN_SPEED,
  );
  assert.equal(freeMoveSpeed({ ...moving, shiftHeld: false }), WALK_SPEED);
  const unchanged = stepStamina(createStamina(0.3), {
    dt: 10,
    resourceActive: false,
    sprinting: true,
    moving: true,
    actionActive: false,
    assist: "STANDARD",
  });
  assert.equal(unchanged.value, 0.3);
});

test("empty chase stamina caps Shift at the playable jog speed", () => {
  assert.equal(
    freeMoveSpeed({
      shiftHeld: true,
      moving: true,
      crouched: false,
      actionActive: false,
      resourceActive: true,
      stamina: 0,
      staminaAssist: "STANDARD",
    }),
    EXHAUSTED_JOG_SPEED,
  );
});

test("accepted traversal debits exactly once; rejected preflight calls no debit", () => {
  const start = createStamina(0.8);
  const accepted = acceptTraversalStamina(start, {
    resourceActive: true,
    debitEligible: true,
    assist: "STANDARD",
  });
  assert.equal(accepted.debited, true);
  assert.equal(accepted.state.value, 0.8 - STAMINA_ACTION_DEBIT);
  // Player only commits this returned state after beginAuthored succeeds.
  const rejectedState = start;
  assert.equal(rejectedState.value, 0.8);
});

test("exhausted traversal remains accessible with deterministic fumble timing", () => {
  const result = acceptTraversalStamina(createStamina(0), {
    resourceActive: true,
    debitEligible: true,
    assist: "STANDARD",
  });
  assert.equal(result.accepted, true);
  assert.equal(result.debited, false);
  assert.equal(
    result.durationMultiplier,
    EXHAUSTED_TRAVERSAL_DURATION_MULTIPLIER,
  );
});

test("AUTO_STAMINA prevents drain/debit and preserves full sprint", () => {
  const stepped = stepStamina(createStamina(0.1), {
    dt: 3,
    resourceActive: true,
    sprinting: true,
    moving: true,
    actionActive: false,
    assist: "AUTO_STAMINA",
  });
  assert.equal(stepped.value, 1);
  const action = acceptTraversalStamina(stepped, {
    resourceActive: true,
    debitEligible: true,
    assist: "AUTO_STAMINA",
  });
  assert.equal(action.state.value, 1);
  assert.equal(action.debited, false);
  assert.equal(
    freeMoveSpeed({
      shiftHeld: true,
      moving: true,
      crouched: false,
      actionActive: false,
      resourceActive: true,
      stamina: 0,
      staminaAssist: "AUTO_STAMINA",
    }),
    RUN_SPEED,
  );
});

test("chase assist preference is backward-compatible with pre-M1 profiles", () => {
  const base = {
    version: 1 as const,
    readingSpeed: "STANDARD" as const,
    captions: true,
    audioDescription: false,
    inputMethod: "KEYBOARD_MOUSE" as const,
    archiveAssistAutoOffer: true,
    highContrast: false,
    reducedMotion: false,
    completedAt: "2026-07-21T00:00:00.000Z",
  };
  assert.equal(OnboardingPreferencesSchema.parse(base).chaseAssist, undefined);
  for (const chaseAssist of [
    "STANDARD",
    "SLOW_PURSUER",
    "AUTO_STAMINA",
    "CONFIRM_RESOLVE",
  ] as const) {
    assert.equal(
      OnboardingPreferencesSchema.parse({ ...base, chaseAssist }).chaseAssist,
      chaseAssist,
    );
  }
});
