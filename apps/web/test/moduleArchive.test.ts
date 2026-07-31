import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { M1_CONTENT } from "../src/module/m1Module.js";
import { loadAuthoredModule } from "../src/module/moduleContent.js";
import {
  moduleRequiredCheckIds,
  videoDefects,
  type LearningModuleDefinition,
  type ModuleVideo,
} from "../src/module/moduleFormat.js";
import { completeModuleRun } from "../src/module/moduleGate.js";
import {
  allFilesResolved,
  archiveFileStatuses,
  archiveIsComplete,
  deriveArchiveLayout,
  nextReadyFileIndex,
  unansweredQuestionIds,
} from "../src/module/archiveLayout.js";

// The Archive layer, tested where it is pure: how a deck splits into case files,
// what unlocks when, that the completion gate is the SAME one under its new
// framing, and that the video variant tolerates a pending source without ever
// dropping the provenance a generated clip must carry.

if (!M1_CONTENT.ok) {
  throw new Error(`content/m1/module.json did not load: ${M1_CONTENT.defects.join("; ")}`);
}
const M1 = M1_CONTENT.definition;
const AT = "2026-07-29T00:00:00.000Z";

// ---------------------------------------------------------------------------
// The video variant: provenance kept, source tolerated absent.
// ---------------------------------------------------------------------------

/** A generated clip authored before the MP4 exists: full record, no source. */
const PENDING_VIDEO: ModuleVideo = {
  id: "vid-pending",
  alt: "A generated reconstruction of the shut harbour.",
  title: "The closed harbour (reconstruction)",
  caption: "Project reconstruction: a generated cutscene, pending production.",
  attribution: "Project Archive",
  sourceUrl: "internal:cutscenes/m1/closure",
  date: "reconstruction (pending)",
  rights: "Project asset (in-game reconstruction)",
  classification: "PROJECT_RECONSTRUCTION",
};

/** Rebuild a loadable envelope from M1 and let a test mutate the first card's scene. */
function reloadWithVideo(video: unknown): ReturnType<typeof loadAuthoredModule> {
  const module = JSON.parse(JSON.stringify(M1)) as LearningModuleDefinition;
  const card = module.cards[0] as { scene?: { video?: unknown } };
  card.scene = { ...(card.scene ?? { beats: [{ id: "b", text: "x" }] }), video };
  return loadAuthoredModule({
    contentId: "BOS.MD01.CONTENT.MODULE.v1",
    reviewStatus: "AUTHOR_DRAFT",
    budget: {},
    module,
  });
}

test("videoDefects accepts a fully-provenanced pending reconstruction", () => {
  assert.deepEqual(videoDefects("card", PENDING_VIDEO), []);
});

test("a pending video (no src) loads, keeping its provenance", () => {
  const loaded = reloadWithVideo(PENDING_VIDEO);
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    const video = loaded.definition.cards[0]!.scene!.video!;
    assert.equal(video.src, undefined, "the source is pending, not fabricated");
    assert.equal(video.classification, "PROJECT_RECONSTRUCTION");
    assert.equal(video.attribution, "Project Archive");
  }
});

test("a produced video with a local src loads", () => {
  const loaded = reloadWithVideo({ ...PENDING_VIDEO, src: "/cutscenes/m1/closure.mp4" });
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.definition.cards[0]!.scene!.video!.src, "/cutscenes/m1/closure.mp4");
  }
});

test("a video missing its provenance is refused, not half-rendered", () => {
  const { sourceUrl: _drop, ...missingSource } = PENDING_VIDEO;
  const loaded = reloadWithVideo(missingSource);
  assert.equal(loaded.ok, false);
  assert.ok(!loaded.ok && loaded.defects.some((d) => /video/i.test(d)));
});

test("a video source must be a LOCAL asset, never an external hotlink", () => {
  assert.ok(
    videoDefects("card", { ...PENDING_VIDEO, src: "https://example.com/clip.mp4" }).some((d) =>
      /local asset path/.test(d),
    ),
  );
  const loaded = reloadWithVideo({ ...PENDING_VIDEO, src: "https://example.com/clip.mp4" });
  assert.equal(loaded.ok, false);
});

test("a reconstruction video may not caption itself 'actual'", () => {
  const lying: ModuleVideo = { ...PENDING_VIDEO, title: "The actual harbour closing" };
  assert.ok(videoDefects("card", lying).some((d) => /actual/i.test(d)));
});

test("image visuals are unaffected: they still require a source", () => {
  // The image path keeps its src obligation; only the video relaxes it. A visual
  // (still) with no src is a defect exactly as before.
  const module = JSON.parse(JSON.stringify(M1)) as LearningModuleDefinition;
  const postwar = module.cards.find((c) => c.scene?.visuals.length)!;
  delete (postwar.scene!.visuals[0] as Record<string, unknown>).src;
  const loaded = loadAuthoredModule({
    contentId: "BOS.MD01.CONTENT.MODULE.v1",
    reviewStatus: "AUTHOR_DRAFT",
    budget: {},
    module,
  });
  assert.equal(loaded.ok, false);
});

// ---------------------------------------------------------------------------
// The Archive layout: files, framing, and sequential unlock.
// ---------------------------------------------------------------------------

test("a deck splits into an opening, one file per question, and a handoff brief", () => {
  const layout = deriveArchiveLayout(M1);
  // M1: identity(frame) · [closure, acts, consent, answer](checks) · brief(frame).
  assert.equal(layout.opening.length, 1);
  assert.equal(layout.files.length, 4);
  assert.equal(layout.brief.length, 1);
  // Every file poses a question and carries its 1-based ordinal.
  layout.files.forEach((file, index) => {
    assert.ok(file.card.check, `file ${index} poses a question`);
    assert.equal(file.ordinal, index + 1);
  });
  // The files are the concept cards, in deck order.
  assert.deepEqual(
    layout.files.map((f) => f.card.check!.id),
    moduleRequiredCheckIds(M1),
  );
});

test("files unlock in order: the first is ready, the rest locked until it is done", () => {
  const layout = deriveArchiveLayout(M1);
  const [f0, f1, , f3] = layout.files;

  // Nothing played: only the first file is ready.
  assert.deepEqual(archiveFileStatuses(layout, [], []), ["READY", "LOCKED", "LOCKED", "LOCKED"]);
  assert.equal(nextReadyFileIndex(layout, [], []), 0);

  // Playing file 0's clip alone does not finish it — its question is unanswered,
  // so it is not DONE and file 1 stays locked.
  assert.deepEqual(
    archiveFileStatuses(layout, [f0!.card.cueId], []),
    ["READY", "LOCKED", "LOCKED", "LOCKED"],
  );

  // File 0 played AND answered → DONE, and file 1 unlocks.
  const afterF0Cues = [f0!.card.cueId];
  const afterF0Checks = [f0!.card.check!.id];
  assert.deepEqual(
    archiveFileStatuses(layout, afterF0Cues, afterF0Checks),
    ["DONE", "READY", "LOCKED", "LOCKED"],
  );
  assert.equal(nextReadyFileIndex(layout, afterF0Cues, afterF0Checks), 1);

  // Skipping ahead is impossible: answering the last file out of order cannot unlock it.
  assert.deepEqual(
    archiveFileStatuses(layout, [f3!.card.cueId], [f3!.card.check!.id]),
    ["READY", "LOCKED", "LOCKED", "DONE"],
  );
  assert.equal(f1!.ordinal, 2);
});

test("allFilesResolved is true only when every file is played and answered", () => {
  const layout = deriveArchiveLayout(M1);
  const cues = layout.files.map((f) => f.card.cueId);
  const checks = layout.files.map((f) => f.card.check!.id);
  assert.equal(allFilesResolved(layout, [], []), false);
  assert.equal(allFilesResolved(layout, cues, checks.slice(0, 2)), false, "a question still owed");
  assert.equal(allFilesResolved(layout, cues, checks), true);
});

test("unansweredQuestionIds lists exactly the checks still owed", () => {
  const checks = moduleRequiredCheckIds(M1);
  assert.deepEqual(unansweredQuestionIds(M1, []), checks);
  assert.deepEqual(unansweredQuestionIds(M1, checks.slice(0, 2)), checks.slice(2));
  assert.deepEqual(unansweredQuestionIds(M1, checks), []);
});

// ---------------------------------------------------------------------------
// The gate did not move: "every file played and every question answered" is the
// same condition completeModuleRun mints its receipt from.
// ---------------------------------------------------------------------------

test("archiveIsComplete is exactly the gate completeModuleRun enforces", () => {
  const allCues = M1.cards.map((c) => c.cueId);
  const allChecks = moduleRequiredCheckIds(M1);

  // Every cue but a question still owed: incomplete, and completeModuleRun refuses.
  assert.equal(archiveIsComplete(M1, allCues, allChecks.slice(0, 2)), false);
  assert.equal(
    completeModuleRun({
      definition: M1,
      attemptOrdinal: 1,
      acknowledgedCueIds: allCues,
      acknowledgedCheckIds: allChecks.slice(0, 2),
      observedSeconds: 180,
      at: AT,
    }),
    null,
  );

  // A framing cue unplayed (deck not covered): incomplete both ways too.
  assert.equal(archiveIsComplete(M1, allCues.slice(0, -1), allChecks), false);

  // Every file played and every question answered: complete, and it mints the
  // authored deck's completion — same cues, same checks, zero XP.
  assert.equal(archiveIsComplete(M1, allCues, allChecks), true);
  const completion = completeModuleRun({
    definition: M1,
    attemptOrdinal: 1,
    acknowledgedCueIds: allCues,
    acknowledgedCheckIds: allChecks,
    observedSeconds: 180,
    at: AT,
  });
  assert.ok(completion);
  assert.equal(completion?.awardedXp, 0);
  assert.deepEqual([...completion!.acknowledgedCheckIds].sort(), [...allChecks].sort());
});

// ---------------------------------------------------------------------------
// The opening framing is not played, and its cues are still reported.
// ---------------------------------------------------------------------------

test("the opening framing's cue is load-bearing for the completion receipt", () => {
  // The Archive no longer PLAYS its opening framing: the lesson is entered
  // through the intake cutscene, which does that job, and a second IRIS
  // monologue over a still put two briefings back to back. The card stays in
  // the deck, because the server checks a completion cue-for-cue against a
  // hand-transcribed copy of it (MODULE_DECKS in apps/api/src/progression/
  // content.ts, pinned by apps/api/test/module-deck-parity.test.ts).
  //
  // This asserts the consequence: a run that reports only the files and the
  // handoff — everything the player now actually sees — does NOT complete. So
  // skipping the screen without acknowledging its cue would take the mission
  // out of reach, which is why ModuleArchive seeds those cues at mount.
  const layout = deriveArchiveLayout(M1);
  assert.ok(layout.opening.length > 0, "M1 still authors an opening framing card");

  const openingCues = layout.opening.map((framing) => framing.card.cueId);
  const seenCues = M1.cards
    .map((card) => card.cueId)
    .filter((cueId) => !openingCues.includes(cueId));
  const allChecks = moduleRequiredCheckIds(M1);

  assert.equal(
    archiveIsComplete(M1, seenCues, allChecks),
    false,
    "without the opening cue the deck is not covered and the run cannot complete",
  );
  assert.equal(archiveIsComplete(M1, [...openingCues, ...seenCues], allChecks), true);
});

test("the Archive opens on its index, and seeds the framing it skipped", () => {
  // Pinned against the source because ModuleArchive cannot be rendered here (it
  // pulls in CSS and the 3D room). Both halves matter and they fail together:
  // re-adding the opening screen brings back the double briefing, and dropping
  // the seeding silently breaks the server's module gate.
  const src = readFileSync(new URL("../src/module/ModuleArchive.tsx", import.meta.url), "utf8");
  assert.match(
    src,
    /useState<ArchiveView>\(\{ kind: "INDEX" \}\)/,
    "the Archive must open on its index, not on an opening framing screen",
  );
  assert.match(
    src,
    /useState<readonly string\[\]>\(\s*\(\) => layout\.opening\.map\(\(framing\) => framing\.card\.cueId\),?\s*\)/,
    "the skipped opening framing's cues must still be acknowledged",
  );
  assert.doesNotMatch(
    src,
    /kind: "OPENING"/,
    "there is no opening view left to fall back into",
  );
});
