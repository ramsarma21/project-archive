import { test } from "node:test";
import assert from "node:assert/strict";
import {
  presentationActionSurface,
  presentationCueReady,
  resolveGlobalPresentationLock,
} from "../../presenter/presentationHandoff.js";

test("Mercer ready handoff exposes primer once, then the authored choice", () => {
  assert.equal(
    presentationActionSurface({
      choreographyReady: false,
      presentationActive: false,
      primerPending: true,
    }),
    "BLOCKED",
  );
  assert.equal(
    presentationActionSurface({
      choreographyReady: true,
      presentationActive: true,
      primerPending: true,
    }),
    "BLOCKED",
  );
  assert.equal(
    presentationActionSurface({
      choreographyReady: true,
      presentationActive: false,
      primerPending: true,
    }),
    "PRIMER",
  );
  assert.equal(
    presentationActionSurface({
      choreographyReady: true,
      presentationActive: false,
      primerPending: false,
    }),
    "REQUEST",
  );
});

test("one blocking owner suppresses every underlying presentation surface", () => {
  const lock = resolveGlobalPresentationLock({
    openResponse: true,
    releaseCinematic: true,
    interiorInspect: true,
    fieldInterrupt: true,
    runtimeTimeline: true,
    archiveModal: true,
    manualModal: true,
    reportModal: false,
  });
  assert.equal(lock.owner, "OPEN_RESPONSE");
  assert.equal(lock.blocking, true);
  assert.equal(lock.hideUnderlyingControls, true);
  assert.equal(lock.disableArchiveAndSaveActions, true);
  assert.equal(lock.disableInteractionRegistry, true);
  assert.equal(lock.suppressAmbientNotices, true);
  assert.equal(
    resolveGlobalPresentationLock({
      openResponse: false,
      releaseCinematic: false,
      interiorInspect: false,
      fieldInterrupt: false,
      runtimeTimeline: false,
      archiveModal: false,
      manualModal: false,
      reportModal: false,
    }).owner,
    "NONE",
  );
});

test("ready state is idempotent across reduced motion and resumed presentation", () => {
  const ready = {
    choreographyReady: true,
    presentationActive: false,
    primerPending: false,
  } as const;
  assert.equal(presentationActionSurface(ready), "REQUEST");
  assert.equal(presentationActionSurface(ready), "REQUEST");
});

test("synthetic field interrupts inherit authored choreography readiness", () => {
  assert.equal(
    presentationCueReady(
      "PA.FIELD.INTERRUPT.M2_CHECKPOINT_1",
      "BOS.MD01.CUE.ROAM.v1",
    ),
    true,
  );
  assert.equal(
    presentationCueReady(
      "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1",
      "BOS.MD01.CUE.ROAM.v1",
    ),
    false,
  );
  assert.equal(
    presentationCueReady(
      "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1",
      "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1",
    ),
    true,
  );
});
