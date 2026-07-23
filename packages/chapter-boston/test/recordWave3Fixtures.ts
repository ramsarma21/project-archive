// Record the Wave 3 determinism fixtures: drive the scripted autoplay for
// both seeds plus the missSyncs path, then serialize the full committed event
// log AND the replay-projected RuntimeView/MasteryReport, byte-exact.
//
// Run: node --import tsx test/recordWave3Fixtures.ts
// Regenerate ONLY for intentional flow/content changes; the replay-parity
// test treats these files as the save-compatibility contract.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHAPTER_ID, PACKAGE_ID } from "../src/ids.js";
import { buildMasteryReport } from "@pa/runtime";
import { BOSTON_1765_CHAPTER, createDay1Session } from "../src/index.js";
import { autoplay } from "./autoplay.js";
import { WAVE3_CASES, pinnedMeta, type Wave3Fixture } from "./wave3-fixtures.helper.js";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "wave3");
mkdirSync(OUT_DIR, { recursive: true });

for (const c of WAVE3_CASES) {
  const run = autoplay(c.seedHex, c.mode);
  if (!run.done) throw new Error(`${c.name}: autoplay did not complete`);
  // Project the canonical view/report by REPLAYING the committed log through
  // a fresh session — exactly what resume, the API replay validator, and the
  // replay-parity gate do.
  const replayed = createDay1Session({
    variationRootSeedHex: c.seedHex,
    assessmentMode: "QA_DRAFT",
    priorEvents: run.events,
  });
  if (replayed.committedEvents.length !== run.events.length) {
    throw new Error(`${c.name}: replay consumed ${replayed.committedEvents.length}/${run.events.length} events`);
  }
  if (replayed.isDone !== run.done) throw new Error(`${c.name}: replay done mismatch`);
  const meta = pinnedMeta(PACKAGE_ID, CHAPTER_ID, c.seedHex, run.events.length);
  const fixture: Wave3Fixture = {
    name: c.name,
    seedHex: c.seedHex,
    mode: c.mode,
    assessmentMode: "QA_DRAFT",
    done: replayed.isDone,
    meta,
    events: run.events,
    view: replayed.ctx.view(),
    report: buildMasteryReport(
      replayed.ctx.learner,
      meta,
      replayed.ctx.checkpoint,
      replayed.ctx.field.engagedMicroIds,
      BOSTON_1765_CHAPTER.report,
    ),
  };
  const file = join(OUT_DIR, `${c.name}.json`);
  writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`recorded ${file}: events=${run.events.length} steps=${run.steps}`);
}
