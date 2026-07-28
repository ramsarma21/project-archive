import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  M1_MODULE_ID,
  bostonProgressionContent,
} from "../src/progression/content.js";

// The server's module gate against the authored deck it was transcribed from.
//
// THE DRIFT THIS CATCHES, stated by the code it guards. `content.ts` carries M1's
// deck as two hand-copied lists — `MODULE_DECKS` and `MODULE_CHECKS` — under a
// comment that says out loud they are "Transcribed from content/m1/module.json,
// which the API cannot import" (the container image ships apps/api and packages
// and no content directory). That transcription is the whole module gate: the
// server derives the required cue and check sets from these and REFUSES a reported
// completion missing any. So a copy that drifts from the authored file is a live
// authority bug wearing a passing suite — either the server rejects a legitimate
// run (the mission becomes unreachable), or, if a required check were dropped
// here, it opens the mission behind a check the player never had to answer.
//
// A test is the right shape for this rather than a shared import, because the
// physical separation is deliberate and load-bearing (the API deploys without the
// content directory). What must not be left to a reader's diligence is that the
// two agree; this asserts it against the authored file on disk, which the test
// process CAN read even though the shipped server cannot.
//
// This is the same class as the boss's tactical opt-ins in missionDuel.test.ts and
// the two duel construction paths in apps/web/test/duelPathParity.test.ts: a real
// path and the thing it is supposed to mirror, pinned so they cannot silently part.

/** The authored module, read from the content directory the server ships without. */
function authoredModule(): {
  moduleId: string;
  cards: readonly { cueId: string; check?: { id: string } }[];
} {
  const here = dirname(fileURLToPath(import.meta.url));
  // apps/api/test -> apps/api -> apps -> repo root.
  const path = resolve(here, "../../../content/m1/module.json");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    module: {
      moduleId: string;
      cards: readonly { cueId: string; check?: { id: string } }[];
    };
  };
  return parsed.module;
}

test("the server's transcribed cue deck is exactly the authored one, in order", () => {
  const authored = authoredModule();
  // The transcription is keyed by module id, so a right list under the wrong id
  // would still leave the real module ungated. Pin that first.
  assert.equal(
    authored.moduleId,
    M1_MODULE_ID,
    "the authored module.json is keyed to the id content.ts transcribes under",
  );

  const content = bostonProgressionContent();
  const authoredCues = authored.cards.map((card) => card.cueId);
  assert.deepEqual(
    content.moduleDeckCueIds(M1_MODULE_ID),
    authoredCues,
    "content.ts's MODULE_DECKS has drifted from content/m1/module.json's cards",
  );
});

test("the server's required checks are exactly the authored card checks, in card order", () => {
  const authored = authoredModule();
  const content = bostonProgressionContent();
  const authoredChecks = authored.cards
    .map((card) => card.check?.id)
    .filter((id): id is string => typeof id === "string");
  assert.deepEqual(
    content.moduleRequiredCheckIds(M1_MODULE_ID),
    authoredChecks,
    "content.ts's MODULE_CHECKS has drifted from content/m1/module.json's checks",
  );
});
