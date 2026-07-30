import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  M1_CODEX_CARD_IDS,
  M1_DUEL_ITEMS,
  M1_EVIDENCE_HAND_SIZE,
  duelItemCodexCardIds,
  evidenceHandProjection,
  evidencePolicyFrom,
  gradeEvidenceSelection,
  m1EvidencePolicy,
  m1EvidenceRelevantCardIds,
  validateEvidenceSelection,
} from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(
  readFileSync(resolve(here, "../../../../content/m1/duel-items.json"), "utf8"),
) as {
  items: readonly { itemId: string; codexCardIds: readonly string[] }[];
  pvpHardening?: { items?: readonly { itemId: string; codexCardIds: readonly string[] }[] };
};

const ALL_ITEMS = [...bank.items, ...(bank.pvpHardening?.items ?? [])];
const AUTHORIZED = M1_CODEX_CARD_IDS; // playtest: a profile holds all nine.

test("the deck universe is exactly the nine authored cards", () => {
  assert.equal(M1_CODEX_CARD_IDS.length, 9);
  assert.equal(new Set(M1_CODEX_CARD_IDS).size, 9);
});

test("relevant cards match the authored bank for every item, PvE and hardening", () => {
  for (const item of ALL_ITEMS) {
    const relevant = m1EvidenceRelevantCardIds(item.itemId);
    assert.deepEqual(
      [...relevant].sort(),
      [...item.codexCardIds].sort(),
      `${item.itemId} relevant cards drift from the bank`,
    );
    assert.ok(relevant.length > 0, `${item.itemId} has no relevant cards`);
  }
});

test("PvE relevant cards come from the safe resolver, not a copy", () => {
  const first = M1_DUEL_ITEMS[0]!;
  assert.deepEqual(
    m1EvidenceRelevantCardIds(first.itemId),
    duelItemCodexCardIds(first.itemId),
  );
});

test("the offered hand is deterministic in the item id", () => {
  for (const item of ALL_ITEMS) {
    const a = m1EvidencePolicy(item.itemId).offeredCardIds;
    const b = m1EvidencePolicy(item.itemId).offeredCardIds;
    assert.deepEqual(a, b, `${item.itemId} hand is not stable`);
  }
});

test("every hand contains its relevant cards and at least one decoy", () => {
  for (const item of ALL_ITEMS) {
    const policy = m1EvidencePolicy(item.itemId);
    for (const relevant of policy.relevantCardIds) {
      assert.ok(policy.offeredCardIds.includes(relevant), `${item.itemId} drops a relevant card`);
    }
    const decoys = policy.offeredCardIds.filter((id) => !policy.relevantCardIds.includes(id));
    assert.ok(decoys.length >= 1, `${item.itemId} has no decoy — selection would be trivial`);
    // The hand is drawn from the deck and never larger than it.
    for (const id of policy.offeredCardIds) {
      assert.ok(M1_CODEX_CARD_IDS.includes(id), `${item.itemId} offered a card not in the deck`);
    }
    assert.equal(new Set(policy.offeredCardIds).size, policy.offeredCardIds.length, "no dupes in a hand");
    assert.ok(policy.offeredCardIds.length <= M1_CODEX_CARD_IDS.length);
  }
});

test("the public projection never leaks which cards are relevant", () => {
  const projection = evidenceHandProjection(m1EvidencePolicy(M1_DUEL_ITEMS[0]!.itemId));
  const keys = Object.keys(projection);
  for (const forbidden of ["relevant", "accepted", "incompatible"]) {
    assert.ok(!keys.some((k) => k.toLowerCase().includes(forbidden)), `projection leaks ${forbidden}`);
  }
  assert.ok(projection.minSupport >= 1);
  assert.ok(Array.isArray(projection.offeredCardIds));
});

test("a selection of enough relevant cards satisfies the policy", () => {
  const policy = m1EvidencePolicy("BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1");
  const grade = gradeEvidenceSelection(policy, policy.relevantCardIds.slice(0, policy.minSupport));
  assert.equal(grade.satisfied, true);
  assert.equal(grade.reason, "OK");
});

test("too few relevant cards is TOO_FEW, whatever decoys are added", () => {
  const policy = m1EvidencePolicy("BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1"); // two relevant, min 2
  assert.equal(policy.minSupport, 2);
  const decoy = policy.offeredCardIds.find((id) => !policy.relevantCardIds.includes(id))!;
  const grade = gradeEvidenceSelection(policy, [policy.relevantCardIds[0]!, decoy]);
  assert.equal(grade.satisfied, false);
  assert.equal(grade.reason, "TOO_FEW");
  assert.equal(grade.supportCount, 1);
});

test("multiple valid combinations exist when relevant exceeds the minimum", () => {
  const policy = m1EvidencePolicy("BOS.MD01.DUEL.REP.SPEAKS_FOR_ALL.v1"); // 3 relevant, min 2
  assert.equal(policy.relevantCardIds.length, 3);
  assert.equal(policy.minSupport, 2);
  const [a, b, c] = policy.relevantCardIds;
  for (const pair of [[a, b], [a, c], [b, c]] as const) {
    assert.equal(gradeEvidenceSelection(policy, pair).satisfied, true, `${pair} should count`);
  }
});

test("a single-card item needs exactly one relevant card", () => {
  const policy = m1EvidencePolicy("BOS.MD01.DUEL.ACTS.WHO_IT_FALLS_ON.v1");
  assert.equal(policy.relevantCardIds.length, 1);
  assert.equal(policy.minSupport, 1);
  assert.equal(gradeEvidenceSelection(policy, policy.relevantCardIds).satisfied, true);
  assert.equal(gradeEvidenceSelection(policy, []).satisfied, false);
});

test("validation rejects an unoffered, duplicate, or unauthorized card", () => {
  const policy = m1EvidencePolicy("BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1");
  const offered = policy.offeredCardIds;
  const notOffered = M1_CODEX_CARD_IDS.find((id) => !offered.includes(id));

  assert.equal(validateEvidenceSelection(policy, [offered[0]!], AUTHORIZED).ok, true);

  if (notOffered) {
    const r = validateEvidenceSelection(policy, [notOffered], AUTHORIZED);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.code, "NOT_OFFERED");
  }

  const dup = validateEvidenceSelection(policy, [offered[0]!, offered[0]!], AUTHORIZED);
  assert.equal(dup.ok, false);
  assert.equal(dup.ok === false && dup.code, "DUPLICATE");

  const unauth = validateEvidenceSelection(policy, [offered[0]!], []);
  assert.equal(unauth.ok, false);
  assert.equal(unauth.ok === false && unauth.code, "UNAUTHORIZED");
});

test("an incompatible card fails the selection even with enough support", () => {
  // Synthetic policy: two relevant, one incompatible decoy that is forced into the
  // hand. Exercises the mechanism the M1 deck has no false card to use.
  const relevant = ["BOS.MD01.CARD.NON_IMPORTATION.v1", "BOS.MD01.CARD.PETITION_AND_CONGRESS.v1"];
  const policy = {
    itemId: "TEST.ITEM",
    relevantCardIds: relevant,
    offeredCardIds: [...relevant, "BOS.MD01.CARD.CONSENT_GROUND.v1"],
    acceptedGroups: [],
    minSupport: 2,
    incompatibleCardIds: ["BOS.MD01.CARD.CONSENT_GROUND.v1"],
    maxSelectable: 3,
  } as const;
  const grade = gradeEvidenceSelection(policy, [...relevant, "BOS.MD01.CARD.CONSENT_GROUND.v1"]);
  assert.equal(grade.satisfied, false);
  assert.equal(grade.reason, "INCOMPATIBLE");
});

test("the hand size targets the configured size when the deck allows", () => {
  const policy = m1EvidencePolicy("BOS.MD01.DUEL.ACTS.WHO_IT_FALLS_ON.v1"); // 1 relevant
  assert.equal(policy.offeredCardIds.length, M1_EVIDENCE_HAND_SIZE);
});

test("evidencePolicyFrom intersects relevant against the deck", () => {
  const policy = evidencePolicyFrom({
    itemId: "TEST",
    relevantCardIds: ["BOS.MD01.CARD.NON_IMPORTATION.v1", "NOT.A.REAL.CARD.v1"],
  });
  assert.deepEqual(policy.relevantCardIds, ["BOS.MD01.CARD.NON_IMPORTATION.v1"]);
});

// ---------------------------------------------------------------------------
// The raised pedagogical bar: most items require synthesising two or more cards.
// ---------------------------------------------------------------------------

test("most items require synthesising two or more evidence cards", () => {
  assert.equal(ALL_ITEMS.length, 25);
  const min2 = ALL_ITEMS.filter((item) => m1EvidencePolicy(item.itemId).minSupport >= 2);
  // 15 of the 25 items — a majority — are authored to need two or more cards. The 1774
  // Coercive-Acts slate is more single-proposition than the 1765 Stamp slate it
  // replaced: the collective-punishment trio and the scope items each turn on one
  // claim, so this is the honest ceiling rather than the 18/25 the old chained
  // debt->revenue->stamp items reached. Flagged to the owner as a measured consequence
  // of the reslate: the evidence hand is still a synthesis for the majority of the deck.
  assert.equal(min2.length, 15, `${min2.length}/25 require 2+`);
  assert.ok(min2.length / ALL_ITEMS.length >= 0.6, "most items should need 2+");
});

test("the single-card items are exactly the ones history decides with one claim", () => {
  // The closure trio turns on one card (the punishment falls on the town); the scope
  // items turn on one act; the covenant and the boycott's bite each rest on the one
  // non-importation card; and three single-claim hardening items. Each is deliberately
  // left at one, and this pins that set so a future edit is a choice.
  const min1 = ALL_ITEMS.filter(
    (item) => m1EvidencePolicy(item.itemId).minSupport === 1,
  )
    .map((item) => item.itemId)
    .sort();
  assert.deepEqual(min1, [
    "BOS.MD01.DUEL.ACTS.FINE_OR_CLOSURE.v1",
    "BOS.MD01.DUEL.ACTS.FOUR_NOT_ONE.v1",
    "BOS.MD01.DUEL.ACTS.NOT_A_FINE.v1",
    "BOS.MD01.DUEL.ACTS.WHICH_ACT.v1",
    "BOS.MD01.DUEL.ACTS.WHO_HAS_GRIEVANCE.v1",
    "BOS.MD01.DUEL.ACTS.WHO_IT_FALLS_ON.v1",
    "BOS.MD01.DUEL.ACTS.WHY_THE_TOWN.v1",
    "BOS.MD01.DUEL.REP.WHICH_MAN.v1",
    "BOS.MD01.DUEL.RESIST.THE_COVENANT.v1",
    "BOS.MD01.DUEL.RESIST.WHY_IT_BITES.v1",
  ]);
});

test("the promoted items now need two distinct pieces of evidence", () => {
  for (const itemId of [
    "BOS.MD01.DUEL.ACTS.STILL_LAWFUL.v1",
    "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1",
    "BOS.MD01.DUEL.REP.NOT_THE_MONEY.v1",
    "BOS.MD01.DUEL.REP.LAWFUL_BUT_UNJUST.v1",
    "BOS.MD01.DUEL.REP.HOW_FAR_IT_GOES.v1",
    "BOS.MD01.DUEL.RESIST.NOT_WAR.v1",
    "BOS.MD01.DUEL.RESIST.HOW_THEY_ANSWER.v1",
  ]) {
    const policy = m1EvidencePolicy(itemId);
    assert.ok(policy.relevantCardIds.length >= 2, `${itemId} has fewer than two relevant`);
    assert.equal(policy.minSupport, 2, `${itemId} minSupport`);
    // A single relevant card is no longer enough on its own.
    const one = gradeEvidenceSelection(policy, [policy.relevantCardIds[0]!]);
    assert.equal(one.satisfied, false, `${itemId} passed on one card`);
    assert.equal(one.reason, "TOO_FEW");
  }
});

test("three-relevant items admit more than one defensible pair", () => {
  for (const itemId of [
    "BOS.MD01.DUEL.REP.SPEAKS_FOR_ALL.v1",
    "BOS.MD01.DUEL.REP.LAWFUL_BUT_UNJUST.v1",
  ]) {
    const policy = m1EvidencePolicy(itemId);
    assert.equal(policy.relevantCardIds.length, 3, `${itemId} is not three-relevant`);
    assert.equal(policy.minSupport, 2);
    const [a, b, c] = policy.relevantCardIds;
    for (const pair of [[a, b], [a, c], [b, c]] as const) {
      assert.equal(
        gradeEvidenceSelection(policy, pair).satisfied,
        true,
        `${itemId} rejected ${pair}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// PvP intersection: a raised minimum can never be dealt as unsatisfiable.
// ---------------------------------------------------------------------------

test("every raised minimum stays satisfiable from a PvP legal-card intersection", () => {
  // PvP deals from the intersection of both players' legal cards, and `askableItems`
  // only offers an item when BOTH hold every one of its cards — so the worst-case
  // intersection still contains all of the item's relevant cards. Model that worst
  // case (deck = exactly the relevant cards) and prove the minimum is reachable.
  for (const item of ALL_ITEMS) {
    const relevant = m1EvidenceRelevantCardIds(item.itemId);
    const policy = evidencePolicyFrom({
      itemId: item.itemId,
      relevantCardIds: relevant,
      allCardIds: relevant,
    });
    const present = policy.offeredCardIds.filter((id) =>
      policy.relevantCardIds.includes(id),
    ).length;
    assert.ok(
      policy.minSupport <= present,
      `${item.itemId} needs ${policy.minSupport} but only ${present} relevant dealt`,
    );
    assert.equal(
      gradeEvidenceSelection(policy, policy.relevantCardIds).satisfied,
      true,
      `${item.itemId} cannot be satisfied from its own relevant set`,
    );
  }
});

test("an under-provisioned deck clamps the minimum rather than dealing an unsatisfiable hand", () => {
  // The defensive case: if an intersection ever dropped a relevant card, the minimum
  // clamps to what is dealable rather than demanding a card the hand does not hold.
  const relevant = m1EvidenceRelevantCardIds("BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1");
  assert.equal(relevant.length, 2);
  const policy = evidencePolicyFrom({
    itemId: "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1",
    relevantCardIds: relevant,
    allCardIds: [relevant[0]!], // only one card survives the intersection
  });
  assert.equal(policy.relevantCardIds.length, 1);
  assert.equal(policy.minSupport, 1);
  assert.equal(
    gradeEvidenceSelection(policy, policy.relevantCardIds).satisfied,
    true,
  );
});
