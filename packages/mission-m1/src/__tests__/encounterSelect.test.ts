import assert from "node:assert/strict";
import { test } from "node:test";
import {
  M1_ENCOUNTERS,
  encounterById,
  encounterItemIds,
} from "../encounters/bank.js";
import {
  encounterVariantsForAttempt,
  expectedEncounterItemId,
  selectEncounterVariant,
} from "../encounters/select.js";

const SEED_A = "0123456789abcdef0123456789abcdef";
const SEED_B = "fedcba9876543210fedcba9876543210";

test("each encounter has at least three variants and unique item ids", () => {
  assert.equal(M1_ENCOUNTERS.length, 2);
  for (const enc of M1_ENCOUNTERS) {
    assert.ok(enc.variants.length >= 3, `${enc.id} has < 3 variants`);
  }
  const ids = encounterItemIds();
  assert.equal(new Set(ids).size, ids.length, "item ids are not unique");
});

test("selection is deterministic for the same attempt", () => {
  const shambles = encounterById("SHAMBLES_STOP");
  const first = selectEncounterVariant(shambles, SEED_A, 1);
  const again = selectEncounterVariant(shambles, SEED_A, 1);
  assert.equal(first.itemId, again.itemId);
});

test("a player's three attempts see three different variants (no repeats)", () => {
  for (const enc of M1_ENCOUNTERS) {
    const picked = [1, 2, 3].map(
      (ordinal) => selectEncounterVariant(enc, SEED_A, ordinal).itemId,
    );
    assert.equal(
      new Set(picked).size,
      3,
      `${enc.id} repeated a variant across three attempts: ${picked.join(", ")}`,
    );
  }
});

test("different seeds can land a first attempt on different variants", () => {
  // Over both encounters at least one differs between two distinct seeds; a
  // selection insensitive to the seed would make every player's run identical.
  const a = encounterVariantsForAttempt(SEED_A, 1).map((e) => e.variant.itemId);
  const b = encounterVariantsForAttempt(SEED_B, 1).map((e) => e.variant.itemId);
  assert.notDeepEqual(a, b);
});

test("the server-side expected id equals the client's chosen variant", () => {
  for (const enc of M1_ENCOUNTERS) {
    for (const ordinal of [1, 2, 3]) {
      const client = selectEncounterVariant(enc, SEED_A, ordinal).itemId;
      const server = expectedEncounterItemId({
        encounterId: enc.id,
        attemptSeedHex: SEED_A,
        attemptOrdinal: ordinal,
      });
      assert.equal(server, client);
    }
  }
});
