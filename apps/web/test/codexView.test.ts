// The Codex card-state logic: what a card reads as, and what the temporary playtest
// access does and does not do.
//
// The component is verified by looking at it; this pins the pure decision it renders,
// because the one rule that is easy to get wrong — a signed-out preview must never
// claim a card was learned — is invisible in a screenshot and load-bearing for a
// child's record.

import test from "node:test";
import assert from "node:assert/strict";
import {
  codexCardStatus,
  codexGroupsView,
  M1_PVP_TRIAL_ACCESS,
  type CodexStandingLike,
} from "../src/codex/codexView.js";

const EMPTY: CodexStandingLike = { learnedCardIds: [], pvpLegalCardIds: [] };

test("status is PvP-legal, learned, or locked, in that order of precedence", () => {
  const codex: CodexStandingLike = {
    learnedCardIds: ["A", "B"],
    pvpLegalCardIds: ["A"],
  };
  assert.equal(codexCardStatus("A", codex), "PVP_LEGAL", "legal outranks learned");
  assert.equal(codexCardStatus("B", codex), "LEARNED");
  assert.equal(codexCardStatus("C", codex), "LOCKED");
});

test("the signed-out preview holds nothing: every card is locked, none claimed learned", () => {
  const groups = codexGroupsView(EMPTY, /* trialAccessActive */ false);
  const all = groups.flatMap((group) => group.cards);
  assert.equal(all.length, 9, "all nine still render as definitions");
  for (const card of all) {
    assert.equal(card.status, "LOCKED", `${card.cardId} must not claim learning when signed out`);
    assert.equal(card.trialAccess, false, "no trial chip when access is off");
  }
});

test("trial access lends PvP use to locked and learned cards, but not to legit-legal ones", () => {
  const codex: CodexStandingLike = {
    learnedCardIds: ["BOS.MD01.CARD.CONSENT_GROUND.v1"],
    pvpLegalCardIds: ["BOS.MD01.CARD.CONSENT_GROUND.v1"],
  };
  const groups = codexGroupsView(codex, /* trialAccessActive */ true);
  for (const card of groups.flatMap((group) => group.cards)) {
    if (card.status === "PVP_LEGAL") {
      assert.equal(card.trialAccess, false, "a legit-legal card needs no trial access");
    } else {
      assert.equal(card.trialAccess, true, "every other card carries the trial chip");
    }
  }
});

test("trial access never fabricates learning or mastery — it only labels", () => {
  const groups = codexGroupsView(EMPTY, true);
  for (const card of groups.flatMap((group) => group.cards)) {
    // Access is on, so trialAccess is true, but the durable status is still LOCKED.
    assert.equal(card.status, "LOCKED");
    assert.equal(card.trialAccess, true);
  }
});

test("the client trial flag exists as one revertible value", () => {
  assert.equal(typeof M1_PVP_TRIAL_ACCESS, "boolean");
});

test("the groups are the three concepts, and carry every card's title and proposition", () => {
  const groups = codexGroupsView(EMPTY);
  assert.equal(groups.length, 3);
  for (const group of groups) {
    assert.ok(group.label.length > 0);
    for (const card of group.cards) {
      assert.ok(card.title.length > 0);
      assert.ok(card.proposition.length > 0);
    }
  }
});
