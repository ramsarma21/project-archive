// Wave 3 determinism replay gate (permanent save-compatibility regression).
//
// Replays the frozen committed event logs from test/fixtures/wave3/ through
// the CURRENT session factory and byte-compares the projected RuntimeView and
// MasteryReport against the recorded ones. ZERO differences allowed: an
// engine/content split, registry change, or refactor must not alter how an
// existing save log projects. Intentional flow changes must regenerate the
// fixtures explicitly (test/recordWave3Fixtures.ts) and say so in review.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOSTON_1765_CHAPTER,
  buildMasteryReport,
  createDay1Session,
} from "../src/index.js";
import { WAVE3_CASES, firstDiffPath, type Wave3Fixture } from "./wave3-fixtures.helper.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "wave3");

for (const c of WAVE3_CASES) {
  test(`wave3 replay parity: ${c.name}`, () => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURE_DIR, `${c.name}.json`), "utf8"),
    ) as Wave3Fixture;

    const session = createDay1Session({
      variationRootSeedHex: fixture.seedHex,
      assessmentMode: fixture.assessmentMode,
      priorEvents: fixture.events,
    });
    assert.equal(
      session.committedEvents.length,
      fixture.events.length,
      "replay must consume the entire committed event log",
    );
    assert.equal(session.isDone, fixture.done, "completion state must match");

    const view = session.ctx.view();
    const report = buildMasteryReport(
      session.ctx.learner,
      fixture.meta,
      session.ctx.checkpoint,
      session.ctx.field.engagedMicroIds,
      BOSTON_1765_CHAPTER.report,
    );

    // Byte-exact comparison (round-tripped through JSON exactly like the
    // fixture itself); firstDiffPath makes the failure actionable.
    const viewDiff = firstDiffPath(JSON.parse(JSON.stringify(view)), fixture.view);
    assert.equal(viewDiff, null, `RuntimeView diverged at ${viewDiff}`);
    assert.equal(JSON.stringify(view, null, 2), JSON.stringify(fixture.view, null, 2));

    const reportDiff = firstDiffPath(JSON.parse(JSON.stringify(report)), fixture.report);
    assert.equal(reportDiff, null, `MasteryReport diverged at ${reportDiff}`);
    assert.equal(JSON.stringify(report, null, 2), JSON.stringify(fixture.report, null, 2));
  });
}
