// The client-safe encounter projection and the server-side encounter rubric bank
// must never drift apart.
//
// The client (in @pa/mission-m1) knows the item ids, the prompts, and the
// speaker's disposition. The server (in @pa/grading) holds the rubric — the
// reference answer, the required ideas, the accept/reject banks — and NONE of
// that may reach the browser. This test is the belt on both:
//
//   * every variant the client can select has a rubric server-side, and the
//     bank carries no orphan item the client cannot reach; and
//   * the prompt the player is shown is byte-for-byte the `ask` the classifier
//     grades — a stop that showed one question and graded another would be a
//     silent unfairness; and
//   * the client view shape carries only the safe keys, so no refactor can leak
//     a reference answer or a rubric into the projection a browser is handed.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENCOUNTER_CLIENT_VIEW_KEYS,
  M1_ENCOUNTERS,
  encounterClientView,
  encounterItemIds,
  encounterPromptFor,
} from "@pa/mission-m1";
import { m1EncounterBank } from "@pa/grading";

test("every client encounter variant has a matching server rubric, and vice versa", () => {
  const bank = m1EncounterBank();
  const clientIds = [...encounterItemIds()].sort();
  const serverIds = bank.items.map((item) => item.itemId).sort();
  assert.deepEqual(clientIds, serverIds);
});

test("the player-visible prompt is exactly the graded ask, per item", () => {
  const bank = m1EncounterBank();
  for (const item of bank.items) {
    const prompt = encounterPromptFor(item.itemId);
    assert.ok(prompt, `no client prompt for ${item.itemId}`);
    assert.equal(prompt, item.ask, `prompt/ask drift on ${item.itemId}`);
  }
});

test("the client view carries only safe keys — never a rubric field", () => {
  const forbidden = ["correct", "ideas", "needs", "accept", "reject", "wrongIfSays", "rubric"];
  for (const enc of M1_ENCOUNTERS) {
    for (const variant of enc.variants) {
      const view = encounterClientView(enc, variant) as Record<string, unknown>;
      assert.deepEqual(
        Object.keys(view).sort(),
        [...ENCOUNTER_CLIENT_VIEW_KEYS].sort(),
        `${variant.itemId} client view keys drifted`,
      );
      for (const key of forbidden) {
        assert.equal(key in view, false, `${variant.itemId} view leaked ${key}`);
      }
    }
  }
});
