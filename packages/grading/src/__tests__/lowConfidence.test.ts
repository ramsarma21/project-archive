// The low-confidence ledger, on its own.
//
// The policy it implements is the resolution of a real disagreement: granting on
// classifier uncertainty is an exploit with a discoverable input, and refusing on
// classifier uncertainty is a false-negative machine aimed at the students this
// service exists to protect. Rate-limiting is what makes both statements false at
// once, and these tests are the arithmetic behind the threshold.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  LOW_CONFIDENCE_GRANT_ALLOWANCE,
  LOW_CONFIDENCE_WINDOW_MS,
  MemoryLowConfidenceLedger,
  NoGrantLowConfidenceLedger,
  needsLowConfidencePolicy,
} from "../lowConfidence.js";
// The real bullet economy, so the threshold's arithmetic is checked against the
// numbers the duel actually grants rather than against copies of them.
import { BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG } from "@pa/duel";

describe("the threshold", () => {
  it("is two grants in an hour", () => {
    assert.equal(LOW_CONFIDENCE_GRANT_ALLOWANCE, 2);
    assert.equal(LOW_CONFIDENCE_WINDOW_MS, 60 * 60 * 1_000);
  });

  it("makes farming strictly worse than answering honestly", () => {
    // Six rounds. A student who games the grader converts at most the allowance
    // into three-bullet rounds and fights the other four on one bullet each.
    const rounds = 6;
    const farmed =
      LOW_CONFIDENCE_GRANT_ALLOWANCE * BULLETS_FOR_CORRECT +
      (rounds - LOW_CONFIDENCE_GRANT_ALLOWANCE) * BULLETS_FOR_WRONG;
    const honestOnThree = 3 * BULLETS_FOR_CORRECT + 3 * BULLETS_FOR_WRONG;
    assert.ok(
      farmed < honestOnThree,
      `farming yields ${farmed} bullets, answering three of six honestly yields ${honestOnThree}`,
    );
    // And it is far short of the perfect duel, so the strategy never competes.
    assert.ok(farmed < rounds * BULLETS_FOR_CORRECT);
  });

  it("leaves room for an honest student's occasional odd answer", () => {
    // One allowance would cost a round the second time a student phrased something
    // strangely in a six-round duel, which is not rare.
    assert.ok(LOW_CONFIDENCE_GRANT_ALLOWANCE >= 2);
  });
});

describe("the ledger", () => {
  it("grants up to the allowance and then withholds", () => {
    const ledger = new MemoryLowConfidenceLedger(2);
    assert.equal(ledger.record("p").outcome, "GRANTED");
    assert.equal(ledger.record("p").outcome, "GRANTED");
    assert.equal(ledger.record("p").outcome, "WITHHELD_AND_FLAGGED");
    assert.equal(ledger.record("p").outcome, "WITHHELD_AND_FLAGGED");
  });

  it("reports the running count so the review surface can show the lean", () => {
    const ledger = new MemoryLowConfidenceLedger(1);
    assert.equal(ledger.record("p").grantsInWindow, 1);
    assert.equal(ledger.record("p").grantsInWindow, 2);
    assert.equal(ledger.record("p").grantsInWindow, 3);
  });

  it("flags only once the allowance is spent", () => {
    const ledger = new MemoryLowConfidenceLedger(1);
    ledger.record("p");
    assert.equal(ledger.isFlagged("p"), false);
    ledger.record("p");
    assert.equal(ledger.isFlagged("p"), true);
    assert.deepEqual(ledger.flaggedProfiles, ["p"]);
  });

  it("keeps profiles independent", () => {
    const ledger = new MemoryLowConfidenceLedger(1);
    ledger.record("a");
    ledger.record("a");
    assert.equal(ledger.record("b").outcome, "GRANTED");
    assert.deepEqual(ledger.flaggedProfiles, ["a"]);
  });

  it("resets the count on a new window", () => {
    let clock = 0;
    const ledger = new MemoryLowConfidenceLedger(1, 1_000, () => clock);
    assert.equal(ledger.record("p").outcome, "GRANTED");
    assert.equal(ledger.record("p").outcome, "WITHHELD_AND_FLAGGED");
    clock = 1_001;
    assert.equal(ledger.record("p").outcome, "GRANTED");
  });

  it("carries the flag across a window reset, because a clock is not a review", () => {
    let clock = 0;
    const ledger = new MemoryLowConfidenceLedger(1, 1_000, () => clock);
    ledger.record("p");
    ledger.record("p");
    assert.ok(ledger.isFlagged("p"));
    clock = 10_000;
    ledger.record("p");
    assert.ok(ledger.isFlagged("p"), "the flag waits for a human");
  });

  it("lets a human clear the flag", () => {
    const ledger = new MemoryLowConfidenceLedger(1);
    ledger.record("p");
    ledger.record("p");
    ledger.clearFlag("p");
    assert.equal(ledger.isFlagged("p"), false);
  });

  it("does not flag a profile it has never seen", () => {
    assert.equal(new MemoryLowConfidenceLedger().isFlagged("stranger"), false);
  });
});

describe("when the policy applies at all", () => {
  it("applies to a LOW-confidence WRONG", () => {
    assert.equal(needsLowConfidencePolicy("LOW", "WRONG"), true);
  });

  it("does not apply to a LOW-confidence CORRECT", () => {
    // Nothing to grant. Spending the allowance here would let a student exhaust
    // their own protection on answers that already went their way.
    assert.equal(needsLowConfidencePolicy("LOW", "CORRECT"), false);
  });

  it("does not apply at MEDIUM or HIGH confidence", () => {
    assert.equal(needsLowConfidencePolicy("MEDIUM", "WRONG"), false);
    assert.equal(needsLowConfidencePolicy("HIGH", "WRONG"), false);
    assert.equal(needsLowConfidencePolicy(null, "WRONG"), false);
  });
});

describe("the disabled ledger", () => {
  it("never grants, which is what the eval harness needs", () => {
    const ledger = new NoGrantLowConfidenceLedger();
    assert.equal(ledger.record().outcome, "WITHHELD_AND_FLAGGED");
    assert.equal(ledger.isFlagged(), false);
    assert.deepEqual(ledger.flaggedProfiles, []);
  });
});
