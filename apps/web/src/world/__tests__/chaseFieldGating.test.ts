import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contextualInteractionsAllowedDuringInterrupt,
  explorePortalsAllowedDuringChase,
} from "../chaseFieldGating.js";

// Regression for the M1 legacy-browser closure: the unified interaction surface
// (sole F handler) was disabled during ALL field interrupts, which made chase
// traversal — and its stamina action-debit path — unreachable during a chase
// even though the TraversalDirector stays active then.
test("contextual F interactions stay enabled during a CHASE, suppressed for other interrupts", () => {
  assert.equal(contextualInteractionsAllowedDuringInterrupt(null), true);
  assert.equal(contextualInteractionsAllowedDuringInterrupt(undefined), true);
  assert.equal(contextualInteractionsAllowedDuringInterrupt("CHASE"), true);
  assert.equal(contextualInteractionsAllowedDuringInterrupt("CONFRONTATION"), false);
  assert.equal(
    contextualInteractionsAllowedDuringInterrupt("REACTIVE_EXCHANGE"),
    false,
  );
  assert.equal(contextualInteractionsAllowedDuringInterrupt("OPEN_RESPONSE"), false);
});

// Regression for the M1 tagged-refuge closure: a casual explore portal fired
// during a chase and whisked the player into the tavern before the authored
// REFUGE hold could resolve the pursuit. Explore portals must be off mid-chase.
test("casual explore portals are disabled during an active chase", () => {
  assert.equal(explorePortalsAllowedDuringChase(false), true);
  assert.equal(explorePortalsAllowedDuringChase(true), false);
});
