import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ExecutionPlan,
  FieldCommittedEvent,
  MasteryReport,
  PresenterEvent,
  RuntimeSnapshot,
  RuntimeView,
} from "@pa/contracts";
import {
  createOnEvent,
  createOnFieldEvent,
  createPersist,
  type CommitClient,
  type CommitDeps,
  type PersistDeps,
} from "../../pages/play/commitPipeline.js";

// ---------------------------------------------------------------------------
// Concurrency/acceptance invariants of the Play commit pipeline
// (feel-audit-1 P0-3/4/5/6 classes):
//   - single-flight: one runtime commit at a time,
//   - guard drops return false (retryable) without touching the event log,
//   - rollback only when the runtime did NOT advance,
//   - acceptance (true) propagates only after advance + persist both land.
// ---------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const SNAPSHOT = {
  view: { locationId: "BOSTON_STREET" } as unknown as RuntimeView,
  report: {} as MasteryReport,
  done: false,
} as unknown as RuntimeSnapshot;

const STEP = {
  plan: null,
  newDirectives: [],
  done: false,
  committedEventCount: 1,
};

function fakeClient(overrides: Partial<CommitClient> = {}): CommitClient {
  return {
    advance: async () => ({ ...STEP }),
    submitFieldEvent: async () => ({ ...STEP }),
    snapshot: async () => SNAPSHOT,
    ...overrides,
  };
}

interface Recorded {
  persistCalls: ("IN_PROGRESS" | "COMPLETE")[];
  errors: (string | null)[];
  busyStates: boolean[];
  originWrites: (string | null)[];
  locationWrites: (string | null)[];
  waits: number[];
  animations: (unknown | null)[];
}

function makeDeps(
  overrides: Partial<CommitDeps<{ durationMs: number }>> = {},
): { deps: CommitDeps<{ durationMs: number }>; recorded: Recorded } {
  const recorded: Recorded = {
    persistCalls: [],
    errors: [],
    busyStates: [],
    originWrites: [],
    locationWrites: [],
    waits: [],
    animations: [],
  };
  const deps: CommitDeps<{ durationMs: number }> = {
    clientRef: { current: fakeClient() },
    inFlightRef: { current: false },
    eventsRef: { current: [] },
    busy: false,
    error: null,
    plan: null,
    readyCueId: null,
    presentationLocationId: null,
    viewLocationId: "BOSTON_STREET",
    activeInterruptKind: undefined,
    reducedMotion: false,
    choiceAnimationFor: () => ({ durationMs: 120 }),
    waitMs: async (ms) => {
      recorded.waits.push(ms);
    },
    setChoiceAnimation: (animation) => recorded.animations.push(animation),
    setBusy: (busy) => recorded.busyStates.push(busy),
    setError: (error) => recorded.errors.push(error),
    setTranscript: () => {},
    setView: () => {},
    setPresentationOriginLocation: (id) => recorded.originWrites.push(id),
    setPresentationLocationId: (id) => recorded.locationWrites.push(id),
    setPlan: () => {},
    setReport: () => {},
    setDone: () => {},
    persist: async (status) => {
      recorded.persistCalls.push(status);
    },
    ...overrides,
  };
  return { deps, recorded };
}

const CONTINUE: PresenterEvent = { type: "CONTINUE" };
const FIELD_EVENT = {
  type: "FIELD_STANDING_DELTA",
  eventId: "E1",
  delta: 1,
  causeId: "TEST",
} as FieldCommittedEvent;
const REPOSITION_APPLIED = {
  type: "FIELD_REPOSITION_APPLIED",
  eventId: "R1_APPLIED",
  interruptId: "R1",
  intentEventId: "R1",
} as FieldCommittedEvent;

test("acceptance: onEvent returns true only after advance + persist land", async () => {
  const { deps, recorded } = makeDeps();
  const onEvent = createOnEvent(deps);
  assert.equal(await onEvent(CONTINUE), true);
  assert.deepEqual(deps.eventsRef.current, [CONTINUE]);
  assert.deepEqual(recorded.persistCalls, ["IN_PROGRESS"]);
  assert.deepEqual(recorded.errors, []);
  // Presentation origin propagation: falls back to the view location.
  assert.deepEqual(recorded.originWrites, ["BOSTON_STREET"]);
  assert.deepEqual(recorded.locationWrites, ["BOSTON_STREET"]);
  // Busy toggled on then off; in-flight released.
  assert.deepEqual(recorded.busyStates, [true, false]);
  assert.equal(deps.inFlightRef.current, false);
});

test("a done advance persists COMPLETE", async () => {
  const { deps, recorded } = makeDeps({
    clientRef: {
      current: fakeClient({
        advance: async () => ({ ...STEP, done: true }),
      }),
    },
  });
  const onEvent = createOnEvent(deps);
  assert.equal(await onEvent(CONTINUE), true);
  assert.deepEqual(recorded.persistCalls, ["COMPLETE"]);
});

test("single-flight: a second commit while one is in flight is dropped", async () => {
  const gate = deferred<typeof STEP>();
  const { deps } = makeDeps({
    clientRef: {
      current: fakeClient({ advance: () => gate.promise }),
    },
  });
  const onEvent = createOnEvent(deps);
  const onFieldEvent = createOnFieldEvent(deps);
  const first = onEvent(CONTINUE);
  // Both pipelines share the in-flight ref: each is dropped while one runs.
  assert.equal(await onEvent(CONTINUE), false);
  assert.equal(await onFieldEvent(FIELD_EVENT), false);
  gate.resolve({ ...STEP });
  assert.equal(await first, true);
  assert.deepEqual(deps.eventsRef.current, [CONTINUE]);
});

test("guard drops: busy / error / choreography-not-ready return false untouched", async () => {
  const plan = { cueId: "CUE_A", request: { kind: "CONTINUE" }, present: [] } as unknown as ExecutionPlan;
  for (const overrides of [
    { busy: true },
    { error: "boom" },
    { plan, readyCueId: null },
    { clientRef: { current: null } },
  ] as Partial<CommitDeps<{ durationMs: number }>>[]) {
    const { deps, recorded } = makeDeps(overrides);
    const onEvent = createOnEvent(deps);
    assert.equal(await onEvent(CONTINUE), false);
    assert.deepEqual(deps.eventsRef.current, []);
    assert.deepEqual(recorded.persistCalls, []);
    assert.deepEqual(recorded.busyStates, []); // guard drop never toggles busy
  }
});

test("CHECKPOINT_DEBRIEF requests are exempt from the choreography gate", async () => {
  const plan = {
    cueId: "CUE_A",
    request: { kind: "CHECKPOINT_DEBRIEF" },
    present: [],
  } as unknown as ExecutionPlan;
  const { deps } = makeDeps({ plan, readyCueId: null });
  const onEvent = createOnEvent(deps);
  assert.equal(await onEvent(CONTINUE), true);
});

test("rollback: a rejected advance restores the event log and reports", async () => {
  const prior = [{ type: "ACK" } as PresenterEvent];
  const { deps, recorded } = makeDeps({
    eventsRef: { current: prior },
    clientRef: {
      current: fakeClient({
        advance: async () => {
          throw new Error("worker crashed");
        },
      }),
    },
  });
  const onEvent = createOnEvent(deps);
  assert.equal(await onEvent(CONTINUE), false);
  assert.equal(deps.eventsRef.current, prior); // rolled back, same array
  assert.deepEqual(recorded.persistCalls, []);
  assert.match(recorded.errors[0] ?? "", /could not be completed/);
  assert.equal(deps.inFlightRef.current, false);
  assert.deepEqual(recorded.busyStates, [true, false]);
});

test("no rollback once the runtime advanced: a persist failure keeps the event", async () => {
  const { deps, recorded } = makeDeps({
    persist: async () => {
      throw new Error("Cloud progress changed in another session.");
    },
  });
  const onEvent = createOnEvent(deps);
  assert.equal(await onEvent(CONTINUE), false);
  // The runtime accepted the event; the log must keep it (replay authority).
  assert.deepEqual(deps.eventsRef.current, [CONTINUE]);
  assert.match(recorded.errors[0] ?? "", /newer cloud progress/);
});

test("CHOICE_SELECTED plays the animation delay unless reduced motion", async () => {
  const choice: PresenterEvent = {
    type: "CHOICE_SELECTED",
    promptId: "P",
    choiceId: "C",
  };
  const animated = makeDeps();
  await createOnEvent(animated.deps)(choice);
  assert.deepEqual(animated.recorded.waits, [120]);
  // Animation set during commit, cleared in finally.
  assert.equal(animated.recorded.animations.length, 2);
  assert.equal(animated.recorded.animations.at(-1), null);
  const reduced = makeDeps({ reducedMotion: true });
  await createOnEvent(reduced.deps)(choice);
  assert.deepEqual(reduced.recorded.waits, []);
});

test("onFieldEvent envelope exemptions: system cleanup and reactive exchange", async () => {
  // Plain field event while busy: dropped.
  const busyPlain = makeDeps({ busy: true });
  assert.equal(await createOnFieldEvent(busyPlain.deps)(FIELD_EVENT), false);
  // FIELD_REPOSITION_APPLIED is system cleanup: commits through busy AND
  // through a not-ready choreography gate.
  const plan = { cueId: "CUE_A", request: { kind: "CONTINUE" }, present: [] } as unknown as ExecutionPlan;
  const cleanup = makeDeps({ busy: true, plan, readyCueId: null });
  assert.equal(await createOnFieldEvent(cleanup.deps)(REPOSITION_APPLIED), true);
  // A live REACTIVE_EXCHANGE interrupt commits inside the busy envelope.
  const reactive = makeDeps({
    busy: true,
    plan,
    readyCueId: null,
    activeInterruptKind: "REACTIVE_EXCHANGE",
  });
  assert.equal(await createOnFieldEvent(reactive.deps)(FIELD_EVENT), true);
});

test("onFieldEvent rollback and error surface", async () => {
  const prior: PresenterEvent[] = [];
  const { deps, recorded } = makeDeps({
    eventsRef: { current: prior },
    clientRef: {
      current: fakeClient({
        submitFieldEvent: async () => {
          throw new Error("context-inappropriate");
        },
      }),
    },
  });
  assert.equal(await createOnFieldEvent(deps)(FIELD_EVENT), false);
  assert.equal(deps.eventsRef.current, prior);
  assert.match(recorded.errors[0] ?? "", /context-inappropriate/);
  assert.match(recorded.errors[0] ?? "", /Save & exit, then resume/);
});

// ---- persist: revision + cloud conflict handling ----------------------------

function makePersistDeps(overrides: Partial<PersistDeps> = {}): {
  deps: PersistDeps;
  saved: unknown[];
  pushed: unknown[];
  cloudUpdates: number[];
  reports: MasteryReport[];
} {
  const saved: unknown[] = [];
  const pushed: unknown[] = [];
  const cloudUpdates: number[] = [];
  const reports: MasteryReport[] = [];
  const deps: PersistDeps = {
    profileId: "PROFILE",
    chapterId: "BOS.ACT01",
    packageId: "PKG",
    flowVersion: 5,
    variationRootSeedHex: "SEED",
    cloudEnabled: false,
    eventsRef: { current: [{ type: "CONTINUE" } as PresenterEvent] },
    revisionRef: { current: 4 },
    cloudRevisionRef: { current: 4 },
    presenterSpatialRef: { current: null },
    putSave: async (save) => {
      saved.push(save);
    },
    pushSave: async (_profileId, body) => {
      pushed.push(body);
      return { ok: true };
    },
    updateProfileCloudRevision: async (revision) => {
      cloudUpdates.push(revision);
    },
    setReport: (report) => reports.push(report),
    ...overrides,
  };
  return { deps, saved, pushed, cloudUpdates, reports };
}

test("persist increments the local revision; cloud push is skipped when disabled", async () => {
  const { deps, saved, pushed } = makePersistDeps();
  await createPersist(deps)("IN_PROGRESS");
  assert.equal(deps.revisionRef.current, 5);
  assert.equal((saved[0] as { revision: number }).revision, 5);
  assert.deepEqual(pushed, []);
});

test("persist surfaces a cloud conflict and leaves the cloud revision alone", async () => {
  const { deps, cloudUpdates } = makePersistDeps({
    cloudEnabled: true,
    pushSave: async () => ({ ok: false, conflict: true }),
  });
  await assert.rejects(
    createPersist(deps)("IN_PROGRESS"),
    /Cloud progress changed in another session/,
  );
  // Local save already landed (revision advanced) but cloud state is untouched.
  assert.equal(deps.revisionRef.current, 5);
  assert.equal(deps.cloudRevisionRef.current, 4);
  assert.deepEqual(cloudUpdates, []);
});

test("persist propagates cloud acceptance: revision, profile, mastery report", async () => {
  const mastery = {} as MasteryReport;
  const pushed: unknown[] = [];
  const { deps, cloudUpdates, reports } = makePersistDeps({
    cloudEnabled: true,
    pushSave: async (_profileId, body) => {
      pushed.push(body);
      return { ok: true, mastery };
    },
  });
  await createPersist(deps)("COMPLETE");
  assert.equal(deps.cloudRevisionRef.current, 5);
  assert.deepEqual(cloudUpdates, [5]);
  assert.equal(reports[0], mastery);
  const body = pushed[0] as { baseRevision: number; record: { saveId: string; variationRootSeedHex: string } };
  assert.equal(body.baseRevision, 4);
  assert.equal(body.record.saveId, "PROFILE");
  assert.equal(body.record.variationRootSeedHex, "SEED");
});
