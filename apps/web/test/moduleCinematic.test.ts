import { test } from "node:test";
import assert from "node:assert/strict";
import { M1_CONTENT } from "../src/module/m1Module.js";
import { loadAuthoredModule } from "../src/module/moduleContent.js";
import {
  moduleDefinitionDefects,
  moduleRequiredCheckIds,
  sceneBeatSubtitle,
  sceneBeatVisual,
  type LearningModuleDefinition,
} from "../src/module/moduleFormat.js";
import {
  completeModuleRun,
  moduleRunChecksMastered,
  unmasteredCheckIds,
} from "../src/module/moduleGate.js";

// The cinematic layer is authored DATA validated by a fail-closed loader. These
// pin the two halves the design makes load-bearing: a malformed visual, beat or
// check is a reported defect that omits the module (never a half-rendered one),
// and the mastery checks are a real completion gate, not decoration.

if (!M1_CONTENT.ok) {
  throw new Error(`content/m1/module.json did not load: ${M1_CONTENT.defects.join("; ")}`);
}
const M1 = M1_CONTENT.definition;

// The raw authored envelope, so a test can corrupt one field and reload it.
const RAW = JSON.parse(
  JSON.stringify(
    // Reconstruct a minimal-but-valid envelope from the loaded definition.
    { contentId: "BOS.MD01.CONTENT.MODULE.v1", reviewStatus: "AUTHOR_DRAFT", budget: {}, module: M1 },
  ),
) as { module: LearningModuleDefinition; [k: string]: unknown };

function reload(mutate: (env: { module: LearningModuleDefinition }) => void) {
  const env = JSON.parse(JSON.stringify(RAW)) as { module: LearningModuleDefinition };
  mutate(env);
  return loadAuthoredModule(env);
}

// ---------------------------------------------------------------------------
// The authored M1 lesson
// ---------------------------------------------------------------------------

test("the authored M1 lesson loads with a presenter, scenes and four checks", () => {
  assert.equal(M1_CONTENT.ok, true);
  assert.ok(M1.presenter, "the deck names a presenter");
  assert.equal(M1.presenter?.glbKey, "system-presenter-rigged");
  // Never a placeholder or existing NPC rig.
  assert.match(M1.presenter!.glbKey, /^system-presenter/);

  const scened = M1.cards.filter((card) => card.scene && card.scene.beats.length > 0);
  assert.equal(scened.length, 6, "every card is a scene");

  // Four checks across three concepts: INTOLERABLE_ACTS is checked twice (the
  // closure as collective punishment, then the scope of the four acts).
  const checks = moduleRequiredCheckIds(M1);
  assert.deepEqual(checks, [
    "BOS.MD01.CHECK.CLOSURE.v1",
    "BOS.MD01.CHECK.ACTS.v1",
    "BOS.MD01.CHECK.REPRESENTATION.v1",
    "BOS.MD01.CHECK.ANSWER.v1",
  ]);
});

test("every historical visual carries full provenance and an honest classification", () => {
  const visuals = M1.cards.flatMap((card) => card.scene?.visuals ?? []);
  assert.ok(visuals.length >= 4, "the lesson shows real historical visuals");
  for (const visual of visuals) {
    for (const field of ["src", "alt", "title", "caption", "attribution", "sourceUrl", "date", "rights"] as const) {
      assert.ok(visual[field].trim().length > 0, `${visual.id} has ${field}`);
    }
    assert.ok(visual.src.startsWith("/"), `${visual.id} is a local asset, not a hotlink`);
    // A reconstruction never presents itself as documentary evidence.
    if (visual.classification === "PROJECT_RECONSTRUCTION") {
      assert.doesNotMatch(`${visual.title} ${visual.caption} ${visual.alt}`, /\bactual\b/i);
    }
  }
  // At least one genuine historical source (not only reconstructions).
  assert.ok(visuals.some((v) => v.classification === "PRIMARY_SOURCE"));
});

// ---------------------------------------------------------------------------
// Fail-closed loading of malformed cinematic data
// ---------------------------------------------------------------------------

test("a visual missing provenance is refused, not half-rendered", () => {
  const loaded = reload((env) => {
    const card = env.module.cards.find((c) => c.scene?.visuals.length)!;
    // Drop the sourceUrl from the first visual.
    delete (card.scene!.visuals[0] as Record<string, unknown>).sourceUrl;
  });
  assert.equal(loaded.ok, false);
  assert.ok(!loaded.ok && loaded.defects.some((d) => /source|visual/i.test(d)));
});

test("a reconstruction that calls itself 'actual' is a defect", () => {
  const bad: LearningModuleDefinition = {
    ...M1,
    cards: [
      {
        ...M1.cards[0]!,
        scene: {
          beats: [{ id: "b1", text: "x" }],
          visuals: [
            {
              id: "v1",
              src: "/x.png",
              alt: "a",
              title: "The actual notice",
              caption: "c",
              attribution: "a",
              sourceUrl: "u",
              date: "d",
              rights: "r",
              classification: "PROJECT_RECONSTRUCTION",
            },
          ],
        },
      },
      ...M1.cards.slice(1),
    ],
  };
  const defects = moduleDefinitionDefects(bad);
  assert.ok(defects.some((d) => /actual/i.test(d)), "the false claim is reported");
});

test("a pooled check with no correct answer, or a correct distractor, is refused", () => {
  // M1's checks are pooled ({correctOption, distractorPool}). The answer must be
  // the one correct option and the pool must hold only wrong ones.
  const none = reload((env) => {
    const card = env.module.cards.find((c) => c.check)!;
    (card.check!.correctOption as { correct: boolean }).correct = false;
  });
  assert.equal(none.ok, false);
  assert.ok(!none.ok && none.defects.some((d) => /must be marked correct/i.test(d)));

  const two = reload((env) => {
    const card = env.module.cards.find((c) => c.check)!;
    (card.check!.distractorPool![0] as { correct: boolean }).correct = true;
  });
  assert.equal(two.ok, false);
  assert.ok(!two.ok && two.defects.some((d) => /marked correct/i.test(d)));
});

test("a pooled check option with no feedback is refused", () => {
  const loaded = reload((env) => {
    const card = env.module.cards.find((c) => c.check)!;
    (card.check!.distractorPool![1] as { feedback: string }).feedback = "";
  });
  assert.equal(loaded.ok, false);
  assert.ok(!loaded.ok && loaded.defects.some((d) => /feedback/.test(d)));
});

test("a beat naming a visual the scene does not carry is a defect", () => {
  const bad: LearningModuleDefinition = {
    ...M1,
    cards: [
      {
        ...M1.cards[0]!,
        scene: { beats: [{ id: "b1", text: "x", visualId: "ghost" }], visuals: [] },
      },
      ...M1.cards.slice(1),
    ],
  };
  assert.ok(moduleDefinitionDefects(bad).some((d) => /ghost/.test(d)));
});

// ---------------------------------------------------------------------------
// Slideshow / subtitle selection
// ---------------------------------------------------------------------------

test("the slide shown tracks the active beat's visual", () => {
  const closure = M1.cards.find((c) => c.id.includes("CLOSURE"))!;
  const scene = closure.scene!;
  // Beat 0 shows the port-bill circular; a later beat moves to the caged-town print.
  assert.equal(sceneBeatVisual(scene, 0)?.id, "m1-coc-port-bill");
  assert.equal(sceneBeatVisual(scene, scene.beats.length - 1)?.id, "m1-bostonians-distress");
  assert.equal(sceneBeatSubtitle(scene, 0), scene.beats[0]!.text);
  // Content is available with no animation whatsoever — reduced motion never
  // hides a subtitle or a slide, it only removes flicker/drift (CSS/shader).
  assert.ok(sceneBeatSubtitle(scene, 0).length > 0);
});

// ---------------------------------------------------------------------------
// The mastery gate is real
// ---------------------------------------------------------------------------

test("completion requires every required check, not only the deck", () => {
  const cues = M1.cards.map((c) => c.cueId);
  const checks = moduleRequiredCheckIds(M1);

  // Deck read but no checks mastered: refused.
  assert.equal(
    completeModuleRun({
      definition: M1,
      attemptOrdinal: 1,
      acknowledgedCueIds: cues,
      acknowledgedCheckIds: [],
      observedSeconds: 180,
      at: "2026-07-27T00:00:00.000Z",
    }),
    null,
  );

  // Checks short: still refused, and they are named.
  assert.deepEqual(unmasteredCheckIds(M1, checks.slice(0, 2)), checks.slice(2));
  assert.equal(moduleRunChecksMastered(M1, checks.slice(0, 2)), false);
  assert.equal(
    completeModuleRun({
      definition: M1,
      attemptOrdinal: 1,
      acknowledgedCueIds: cues,
      acknowledgedCheckIds: checks.slice(0, 2),
      observedSeconds: 180,
      at: "2026-07-27T00:00:00.000Z",
    }),
    null,
  );

  // Deck read AND every check mastered: it completes and pays zero.
  const completion = completeModuleRun({
    definition: M1,
    attemptOrdinal: 1,
    acknowledgedCueIds: cues,
    acknowledgedCheckIds: checks,
    observedSeconds: 180,
    at: "2026-07-27T00:00:00.000Z",
  });
  assert.ok(completion);
  assert.equal(completion?.awardedXp, 0);
  assert.deepEqual([...completion!.acknowledgedCheckIds].sort(), [...checks].sort());
});
