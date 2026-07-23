import { test } from "node:test";
import assert from "node:assert/strict";
import type { FieldRuntimeView, InputRequest } from "@pa/contracts";
import {
  M1_QA_CONTRACT,
  qaChaseEligibility,
  qaChaseStartEvents,
} from "../qaChaseContract.js";

const roam = {
  kind: "FREE_ROAM",
  targets: [],
  canProceed: false,
} as InputRequest;

const field = {
  heat: { band: "CALM" },
  activeChase: null,
  activeInterrupt: null,
} as unknown as FieldRuntimeView;

test("QA browser selectors name stable mounted roots", () => {
  assert.equal(M1_QA_CONTRACT.playRootSelector, '[data-game-root="play"]');
  assert.equal(M1_QA_CONTRACT.worldRootSelector, '[data-game-root="world"]');
  assert.equal(M1_QA_CONTRACT.shortcutCode, "KeyL");
});

test("QA chase eligibility reports precise bootstrap failures", () => {
  assert.equal(
    qaChaseEligibility({
      request: null,
      field: null,
      busy: false,
      error: null,
      choreographyReady: true,
    })?.status,
    "UNAVAILABLE",
  );
  assert.equal(
    qaChaseEligibility({
      request: { kind: "CONTINUE" },
      field,
      busy: false,
      error: null,
      choreographyReady: true,
    })?.status,
    "NOT_FREE_ROAM",
  );
  assert.equal(
    qaChaseEligibility({
      request: roam,
      field,
      busy: true,
      error: null,
      choreographyReady: true,
    })?.status,
    "BUSY",
  );
  assert.equal(
    qaChaseEligibility({
      request: roam,
      field,
      busy: false,
      error: null,
      choreographyReady: true,
    }),
    null,
  );
});

test("QA start event envelope is deterministic and complete", () => {
  const built = qaChaseStartEvents({ suffix: "SEED_7", heatBand: "CALM" });
  assert.equal(built.interruptId, "M1_QA_INTERRUPT_SEED_7");
  assert.equal(built.chaseId, "M1_QA_CHASE_SEED_7");
  assert.deepEqual(
    built.events.map((event) => event.type),
    [
      "FIELD_WATCHER_CHALLENGE",
      "FIELD_CHASE_STARTED",
      "FIELD_HEAT_TRANSITION",
    ],
  );
  assert.equal(
    qaChaseStartEvents({ suffix: "SEED_7", heatBand: "HUNTED" }).events.length,
    2,
  );
});
