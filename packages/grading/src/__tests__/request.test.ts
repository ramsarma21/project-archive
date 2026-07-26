// The client's half of the wire, tested against what an attacker sends.
//
// The route in apps/api is a thin wrapper over this function, so this is where the
// "a client can never submit a verdict" claim is actually established.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { DUEL_ROUNDS, DUEL_ROUND_CEILING } from "@pa/duel/structure";
import { MAX_SUBMITTED_ANSWER_CHARS, parseGradeAnswerRequest } from "../request.js";

const valid = {
  itemId: "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1",
  attemptId: "attempt-1",
  roundIndex: 0,
  answer: "they were broke after the war",
};

describe("a well-formed submission", () => {
  it("is accepted with exactly its four fields", () => {
    const parsed = parseGradeAnswerRequest(valid);
    assert.ok(parsed.ok);
    assert.deepEqual(Object.keys(parsed.value).sort(), [
      "answer",
      "attemptId",
      "itemId",
      "roundIndex",
    ]);
  });

  it("accepts an empty answer, which grades as wrong rather than failing", () => {
    // An empty box is a submission. Refusing it at the wire would leave the round
    // ungraded and the duel waiting.
    assert.equal(parseGradeAnswerRequest({ ...valid, answer: "" }).ok, true);
  });

  it("accepts every round the machine can actually reach", () => {
    for (let round = 0; round < DUEL_ROUND_CEILING; round += 1) {
      assert.equal(
        parseGradeAnswerRequest({ ...valid, roundIndex: round }).ok,
        true,
        `round ${round} is inside the duel's own ceiling and must be gradable`,
      );
    }
  });

  it("grades past the sixth round, which is where a long duel is decided", () => {
    // The regression this file exists to prevent. A duel has no fixed length; it
    // runs until a health bar empties, typically 5 to 9 rounds. A validator that
    // stops at six refuses every verdict from the point the fight gets close, so
    // the student answers into a void exactly when the answer is worth most.
    assert.ok(
      DUEL_ROUND_CEILING > DUEL_ROUNDS,
      "the typical length is not the bound; the ceiling is",
    );
    for (const roundIndex of [DUEL_ROUNDS, DUEL_ROUNDS + 1, DUEL_ROUND_CEILING - 1]) {
      assert.equal(
        parseGradeAnswerRequest({ ...valid, roundIndex }).ok,
        true,
        `round ${roundIndex} was refused`,
      );
    }
  });
});

describe("a client cannot submit its own verdict", () => {
  // Each of these is a field a cheating client would reach for. All are rejected,
  // and all are rejected by name so the attempt is countable in a log.
  for (const field of [
    "verdict",
    "kind",
    "grade",
    "correct",
    "isCorrect",
    "result",
    "outcome",
    "score",
    "label",
    "confidence",
    "ideas",
    "ideasPresent",
    "source",
    "receipt",
    "itemVersion",
    "rubricVersion",
    "profileId",
  ]) {
    it(`rejects "${field}" as an attempt to self-grade`, () => {
      const parsed = parseGradeAnswerRequest({ ...valid, [field]: "CORRECT" });
      assert.equal(parsed.ok, false);
      assert.equal(parsed.ok === false && parsed.code, "VERDICT_NOT_ACCEPTED");
    });
  }

  for (const field of ["bullets", "bulletCount", "ammo", "magazine", "rounds"]) {
    it(`rejects "${field}", so a bullet count never crosses the wire`, () => {
      const parsed = parseGradeAnswerRequest({ ...valid, [field]: 3 });
      assert.equal(parsed.ok, false);
      assert.equal(parsed.ok === false && parsed.code, "VERDICT_NOT_ACCEPTED");
    });
  }

  it("is case-insensitive about the field name", () => {
    for (const field of ["VERDICT", "Bullets", "bUlLeTs"]) {
      const parsed = parseGradeAnswerRequest({ ...valid, [field]: 3 });
      assert.equal(parsed.ok === false && parsed.code, "VERDICT_NOT_ACCEPTED");
    }
  });

  it("rejects an unrecognised field rather than ignoring it", () => {
    // The allowlist is what makes the next field name safe too, without anyone
    // having to remember to add it to a denylist.
    const parsed = parseGradeAnswerRequest({ ...valid, somethingNew: true });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.code, "UNKNOWN_FIELD");
  });

  it("rejects a nested payload that hides a verdict inside an allowed name", () => {
    const parsed = parseGradeAnswerRequest({
      ...valid,
      answer: { text: "x", verdict: "CORRECT" },
    });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.code, "BAD_FIELD_TYPE");
  });

  it("rejects a prototype-pollution attempt", () => {
    const parsed = parseGradeAnswerRequest(
      JSON.parse(`{"itemId":"a","attemptId":"b","roundIndex":0,"answer":"c","__proto__":{"verdict":"CORRECT"}}`),
    );
    // JSON.parse puts __proto__ on the object as an own key, so the allowlist sees
    // it. Either rejection is correct; silently accepting is not.
    assert.equal(parsed.ok, false);
  });
});

describe("malformed submissions", () => {
  for (const [label, body] of [
    ["a string", "answer"],
    ["an array", [1, 2, 3]],
    ["null", null],
    ["a number", 7],
  ] as const) {
    it(`rejects ${label}`, () => {
      const parsed = parseGradeAnswerRequest(body);
      assert.equal(parsed.ok === false && parsed.code, "NOT_AN_OBJECT");
    });
  }

  for (const field of ["itemId", "attemptId", "answer", "roundIndex"] as const) {
    it(`rejects a missing ${field}`, () => {
      const body = { ...valid };
      delete (body as Record<string, unknown>)[field];
      const parsed = parseGradeAnswerRequest(body);
      assert.equal(parsed.ok === false && parsed.code, "MISSING_FIELD");
    });
  }

  it("rejects a non-integer round", () => {
    assert.equal(
      parseGradeAnswerRequest({ ...valid, roundIndex: 1.5 }).ok === false &&
        parseGradeAnswerRequest({ ...valid, roundIndex: 1.5 }).ok,
      false,
    );
    const parsed = parseGradeAnswerRequest({ ...valid, roundIndex: "0" });
    assert.equal(parsed.ok === false && parsed.code, "BAD_FIELD_TYPE");
  });

  it("rejects a round the machine cannot reach", () => {
    for (const roundIndex of [-1, DUEL_ROUND_CEILING, DUEL_ROUND_CEILING + 1, 9999]) {
      const parsed = parseGradeAnswerRequest({ ...valid, roundIndex });
      assert.equal(
        parsed.ok === false && parsed.code,
        "ROUND_OUT_OF_RANGE",
        `round ${roundIndex} is outside the ceiling and must be refused`,
      );
    }
  });

  it("rejects an answer long enough to be a cost attack", () => {
    const parsed = parseGradeAnswerRequest({
      ...valid,
      answer: "x".repeat(MAX_SUBMITTED_ANSWER_CHARS + 1),
    });
    assert.equal(parsed.ok === false && parsed.code, "ANSWER_TOO_LONG");
  });

  it("rejects an empty or oversized itemId", () => {
    assert.equal(parseGradeAnswerRequest({ ...valid, itemId: "" }).ok, false);
    assert.equal(
      parseGradeAnswerRequest({ ...valid, itemId: "x".repeat(201) }).ok,
      false,
    );
  });
});
