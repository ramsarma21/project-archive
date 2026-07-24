// Engine standalone proof: the generic runtime runs a SYNTHETIC chapter with
// zero Boston imports. This is the architectural gate for "a new chapter is a
// content package only" — if the engine ever grows a content dependency, this
// package's typecheck/test breaks first. It also pins the injection seams:
// initial world/learner seeding, cue defaults, field vocabulary validation,
// deterministic replay, and the chapter registry.
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ConceptId,
  MicroConceptId,
  OptionalActivityId,
  ThreadId,
  WorldState,
} from "@pa/contracts";
import {
  Session,
  buildMasteryReport,
  createChapterRegistry,
  createChapterSession,
  waitContinue,
  freeRoam,
  type ChapterDefinition,
  type Ctx,
  type Flow,
} from "../src/index.js";

const CONCEPT_A = "TEST.CONCEPT.ALPHA.v1" as ConceptId;
const THREAD_T = "TEST.THREAD.TESTER.v1" as ThreadId;
const FLAG_MET = "MET";
const ACTIVITY_X = "TEST-activity-x" as OptionalActivityId;
const MICRO_M = "MICRO.TEST_SAMPLE" as MicroConceptId;

function testWorld(): WorldState {
  return {
    revision: "0",
    locationId: "TEST_START",
    controlState: "ARCHIVE",
    clock: {
      spentUnits: 0,
      fixedEventBoundary: 6,
      warningAt: { first: 2, second: 4, final: 5 },
      warningStage: "NONE",
      phase: "MORNING",
    },
    currentInteractionOrdinal: 0,
    lastSyncCompletionInteractionOrdinal: null,
    firstErrandCompletionRecorded: false,
    fixedEvent: "NOT_STARTED",
    objectives: { FIRST_STOP: "ACTIVE" },
    jobObjects: {
      PARCEL: { custody: "PLAYER", condition: "INTACT" },
    },
    printJobs: {},
    printWorkshop: {
      sheetsPulled: 0,
      sheetsBeforeBell: 0,
      bestQuality: null,
      bestAverage: 0,
      bestPromptId: null,
    },
    relationships: { TESTER_TRUST: 10 },
    routes: {},
    attention: {
      watcherHeat: 0,
      clarkeInformed: false,
      recognized: false,
    },
    pendingContingentEffects: [],
    realizedHiddenEffects: [],
  };
}

function* syntheticFlow(ctx: Ctx): Flow {
  ctx.narrate("A synthetic chapter begins.");
  yield* waitContinue(ctx, "Begin");
  ctx.world.controlState = "FREE_ROAM";
  ctx.spendTime(3); // crosses first (2) then stays before second (4)
  yield* freeRoam(
    ctx,
    [{ targetId: "FIRST_STOP", label: "First stop", marker: "GOLD" }],
    false,
  );
  ctx.countSpacing();
  ctx.world.objectives.FIRST_STOP = "COMPLETED";
}

const SYNTHETIC_CHAPTER: ChapterDefinition = {
  chapterId: "PA.TEST.CH01.SYNTH.v1",
  packageId: "PA.TEST.CH01.PKG.v1",
  flowVersion: 1,
  createFlow: syntheticFlow,
  content: {
    createInitialWorldState: testWorld,
    learnerConceptIds: [CONCEPT_A],
    conceptShortNames: { [CONCEPT_A]: "Alpha" },
    minimumInteractionsBetweenSyncs: 2,
    defaultHeadline: "TEST HEADLINE",
    clockWarningLines: {
      FIRST: "test first warning",
      SECOND: "test second warning",
      FINAL: "test final warning",
    },
    loreMacroSupport: {},
    reactiveOutcomeResolver: (input) => ({
      interactionId: input.interactionId,
      sourceId: input.sourceId,
      outcomeId: input.outcomeId,
    }),
    authorDraftSourcePrefix: "TEST.DLG.",
    cues: {
      continueCue: (label) => `TEST.CUE.CONTINUE.${label ?? "DEFAULT"}`,
      ackCue: () => "TEST.CUE.ACK",
      dayEndCue: () => "TEST.CUE.DAY_END",
      readCue: (objectId) => `TEST.CUE.READ.${objectId}`,
      roamCue: (ids) => `TEST.CUE.ROAM.${ids.join("_")}`,
    },
    openResponse: {
      eligible: () => [],
      package: () => undefined,
      npcFollowups: () => [],
      eligibleNpcFollowupsForField: () => [],
      archiveConnections: () => [],
      sourcePacketBackingRefs: () => [],
    },
    canonicalSourceIds: () => [],
  },
  assessment: {
    checkpoint: {
      checkpointId: "TEST.CP1.v1",
      requiredMacroConceptIds: ["TEST.MACRO.ALPHA"],
      microConceptIds: [MICRO_M],
      formIdPrefix: "TEST.CP1.FORM.",
    },
    banks: new Map(),
    productionBankVersion: "test-bank-v1",
    qaDraftBankVersion: "test-bank-v1",
    gateMaps: { assessmentToLearner: {}, microSourceLabels: {} },
    legacyRubricIds: [],
  },
  fieldVocabulary: {
    microConceptIds: [MICRO_M],
    threadIds: [THREAD_T],
    threadFlags: [FLAG_MET],
    activityIds: [ACTIVITY_X],
    initialThreads: () => ({
      [THREAD_T]: {
        threadId: THREAD_T,
        flags: {},
        status: "UNMET",
        trust: 0,
        breadcrumb: null,
      },
    }),
    initialActivities: () => ({
      [ACTIVITY_X]: {
        activityId: ACTIVITY_X,
        stage: "AVAILABLE",
        breadcrumb: null,
      },
    }),
    repositionAnchors: {},
    citedDefenses: [],
    confrontationMicro: null,
    sourceEngagement: {
      canonicalSourceIds: () => [],
      contentPackageHash: "sha256:test",
    },
  },
  report: {
    conceptNames: { [CONCEPT_A]: "Alpha" },
    conceptTeks: {},
    conceptMeta: {},
    microLabels: { [MICRO_M]: "Sample micro" },
  },
};

const SEED = "ab".repeat(32);

test("engine runs a synthetic chapter end to end (no Boston imports)", () => {
  const session = createChapterSession(SYNTHETIC_CHAPTER, {
    variationRootSeedHex: SEED,
  });
  assert.equal(session.plan?.cueId, "TEST.CUE.CONTINUE.Begin");
  session.advance({ type: "CONTINUE" });
  assert.equal(session.plan?.request.kind, "FREE_ROAM");
  assert.equal(session.plan?.cueId, "TEST.CUE.ROAM.FIRST_STOP");
  // Chapter clock tuning drove the warning: threshold 2 crossed by spendTime(3).
  assert.equal(session.ctx.world.clock.warningStage, "FIRST");
  assert.ok(
    session.transcript.some(
      (d) => d.kind === "ARCHIVE" && d.text === "test first warning",
    ),
    "chapter-supplied warning line is voiced",
  );
  session.advance({ type: "FREE_ROAM_GOTO", targetId: "FIRST_STOP" });
  assert.equal(session.isDone, true);
  assert.equal(session.ctx.world.objectives.FIRST_STOP, "COMPLETED");
});

test("field vocabulary validation is chapter-supplied", () => {
  const session = createChapterSession(SYNTHETIC_CHAPTER, {
    variationRootSeedHex: SEED,
    priorEvents: [{ type: "CONTINUE" }],
  });
  // Known thread + flag commits.
  session.emitFieldEvent({
    type: "FIELD_THREAD_PATCH",
    eventId: "t1",
    threadId: THREAD_T,
    flags: { [FLAG_MET]: true },
  });
  assert.equal(session.ctx.field.threads[THREAD_T]!.flags[FLAG_MET], true);
  // Unknown thread id (valid in Boston, unknown here) is rejected.
  assert.throws(
    () =>
      session.emitFieldEvent({
        type: "FIELD_THREAD_PATCH",
        eventId: "t2",
        threadId: "BOS.THREAD.NED.v1" as ThreadId,
        flags: { [FLAG_MET]: true },
      }),
    /unknown threadId/,
  );
});

test("replay determinism and report labeling flow from the chapter", () => {
  const run = createChapterSession(SYNTHETIC_CHAPTER, {
    variationRootSeedHex: SEED,
  });
  run.advance({ type: "CONTINUE" });
  run.advance({ type: "FREE_ROAM_GOTO", targetId: "FIRST_STOP" });
  const replay = createChapterSession(SYNTHETIC_CHAPTER, {
    variationRootSeedHex: SEED,
    priorEvents: [...run.committedEvents],
  });
  assert.equal(replay.isDone, true);
  assert.equal(
    JSON.stringify(replay.ctx.view()),
    JSON.stringify(run.ctx.view()),
    "replayed view must be byte-identical",
  );
  const report = buildMasteryReport(
    replay.ctx.learner,
    {
      profileId: "p",
      packageId: SYNTHETIC_CHAPTER.packageId,
      chapterId: SYNTHETIC_CHAPTER.chapterId,
      variationRootSeedHex: SEED,
      committedEventCount: replay.committedEvents.length,
      generatedAt: "2026-07-23T00:00:00.000Z",
    },
    replay.ctx.checkpoint,
    replay.ctx.field.engagedMicroIds,
    SYNTHETIC_CHAPTER.report,
  );
  assert.equal(report.concepts[0]?.conceptName, "Alpha");
  assert.equal(report.chapterId, SYNTHETIC_CHAPTER.chapterId);
});

test("chapter registry: lookup, unknown id, duplicates", () => {
  const registry = createChapterRegistry([SYNTHETIC_CHAPTER]);
  assert.equal(registry.get(SYNTHETIC_CHAPTER.chapterId), SYNTHETIC_CHAPTER);
  assert.equal(registry.get("PA.UNKNOWN.v1"), undefined);
  assert.throws(() => registry.require("PA.UNKNOWN.v1"), /CHAPTER_UNKNOWN/);
  assert.throws(
    () => createChapterRegistry([SYNTHETIC_CHAPTER, SYNTHETIC_CHAPTER]),
    /CHAPTER_REGISTRY_INVALID/,
  );
  assert.ok(new Session(
    createChapterSession(SYNTHETIC_CHAPTER, { variationRootSeedHex: SEED }).ctx,
    syntheticFlow,
  ));
});
