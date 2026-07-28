// A live smoke test of the boss duel's grading path.
// `pnpm --filter @pa/api duel:verify:live`
//
// This is not a unit test and it is deliberately not in `pnpm test`: it needs a
// database, it calls the real classifier, and it costs money. What it answers is
// the question no offline test can — does an answer a student actually types get
// graded on its merits, and does a wrong one cost them the difference?
//
// It drives `buildApp()` rather than a hand-assembled Fastify instance, so a route
// missing from app.ts fails here exactly as it does in a browser. That is not
// hypothetical: the whole reason this file exists is that the endpoint the duel
// client has been posting to since the duel landed was never registered, and every
// answer took the client's 1.5-second timeout path and was granted the maximum
// magazine. A silent success is the failure mode, so the check that matters most
// is the cheapest one: post a good answer and a bad one to the SAME item and
// require that they come back different.
//
// AND THAT CHECK USED TO PASS WITH NOTHING GRADED, which is worth stating because
// it is the same defect this script exists to catch, in this script. Round 4 posts
// an empty box, which `preCheckAnswer` decides WRONG deterministically with no
// model call. So `correct === 0 || wrong === 0` was satisfied by the pre-check
// alone: run against an unreachable gateway, the three real answers all came back
// CORRECT on the fallback, the empty box came back WRONG, and the script printed
// "✓ the same item graded both ways" and exited 0. Both halves of the proof now
// have to come from rounds a CLASSIFIER actually decided, and a run with no
// classification at all fails by name.
//
// Everything it creates in the database it deletes again.

import "../config.js";
import { randomBytes } from "node:crypto";
import { m1ContentBank } from "@pa/grading";
import {
  m1DuelId,
  m1ExpectedDuelCardIds,
  m1ExpectedDuelItem,
} from "@pa/mission-m1";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { csrfTokenForSession } from "../auth.js";
import { query } from "../db.js";
import { createDuelGrading } from "./grading.js";
import { DUEL_ROUND_CEILING } from "./request.js";

// The boss duel is now bound to the player's OWN open progression attempt: the route
// resolves the attempt, requires the posted duel id to be its canonical one, and
// grades the item the ROUND asks (server-selected from the stored seed+ordinal),
// ignoring the client's claim. So this check can no longer post a hand-written duel
// id with a hand-picked item and expect a grade — it must open a real attempt first,
// exactly as the browser does, then grade the item the round actually asks. The two
// content constants below are the module gate's inputs, transcribed from
// progression/content.ts (the API ships no content directory to import them from).
const CHAPTER_ID = "boston-1765";
const MISSION_ID = "PA.SEA01.CH02.BOSTON.MD01";
const MODULE_ID = "BOS.MD01.MODULE.BRIEF.v1";
const MODULE_CUES = [
  "BOS.MD01.CUE.BRIEF_IDENTITY.v1",
  "BOS.MD01.CUE.BRIEF_POSTWAR.v1",
  "BOS.MD01.CUE.BRIEF_STAMP.v1",
  "BOS.MD01.CUE.BRIEF_REPRESENTATION.v1",
  "BOS.MD01.CUE.BRIEF_SYNTHESIS.v1",
  "BOS.MD01.CUE.BRIEF_INSERT.v1",
];
const MODULE_CHECKS = [
  "BOS.MD01.CHECK.POSTWAR_REVENUE.v1",
  "BOS.MD01.CHECK.STAMP_SCOPE.v1",
  "BOS.MD01.CHECK.REPRESENTATION.v1",
];

interface OpenAttempt {
  readonly attemptOrdinal: number;
  readonly attemptSeedHex: string;
  readonly duelId: string;
}

/**
 * Open a real mission attempt for a test user, the same two round trips the browser
 * makes: record the mandatory module, then open the attempt. Returns the server's
 * ordinal, seed and the canonical duel id every graded post must carry.
 */
async function openAttemptFor(
  app: FastifyInstance,
  user: TestUser,
  auth: () => Record<string, string>,
): Promise<OpenAttempt> {
  const moduleRes = await app.inject({
    method: "POST",
    url: `/v1/profiles/${user.profileId}/progression/modules`,
    headers: auth(),
    payload: {
      chapterId: CHAPTER_ID,
      moduleId: MODULE_ID,
      gatesKind: "MISSION_ATTEMPT",
      gatesId: MISSION_ID,
      acknowledgedCueIds: MODULE_CUES,
      acknowledgedCheckIds: MODULE_CHECKS,
      observedSeconds: 180,
    },
  });
  if (moduleRes.statusCode !== 200) {
    fail(`could not record the module gate: ${moduleRes.statusCode} ${moduleRes.body}`);
  }
  const openRes = await app.inject({
    method: "POST",
    url: `/v1/profiles/${user.profileId}/progression/mission-attempts`,
    headers: auth(),
    payload: { chapterId: CHAPTER_ID, missionId: MISSION_ID },
  });
  if (openRes.statusCode !== 200) {
    fail(`could not open a mission attempt: ${openRes.statusCode} ${openRes.body}`);
  }
  const attempt = openRes.json() as {
    attemptOrdinal: number;
    attemptSeedHex: string;
  };
  return {
    attemptOrdinal: attempt.attemptOrdinal,
    attemptSeedHex: attempt.attemptSeedHex,
    duelId: m1DuelId(attempt.attemptOrdinal),
  };
}

/**
 * The first round whose server-selected item is asked AGAIN at a later round, so the
 * SAME item can be graded both ways. The duel's bank permutation is not a plain
 * cycle, so the pair is discovered rather than assumed.
 */
function sameItemBothWays(attempt: OpenAttempt): {
  itemId: string;
  goodRound: number;
  badRound: number;
} {
  const rounds = new Map<string, number[]>();
  for (let round = 1; round <= 24; round += 1) {
    const itemId = m1ExpectedDuelItem({
      attemptSeedHex: attempt.attemptSeedHex,
      attemptOrdinal: attempt.attemptOrdinal,
      round,
    }).item.itemId;
    rounds.set(itemId, [...(rounds.get(itemId) ?? []), round]);
  }
  for (const [itemId, asked] of rounds) {
    if (asked.length >= 2 && referenceAnswerFor(itemId)) {
      return { itemId, goodRound: asked[0]!, badRound: asked[1]! };
    }
  }
  return fail("no item is asked twice inside 24 rounds; cannot grade one both ways");
}

/**
 * @pa/duel's `BULLETS_FOR_CORRECT` and `BULLETS_FOR_WRONG`, reported rather than
 * enforced. @pa/api does not depend on the duel simulation — the whole point of
 * this wire is that the SERVER never sends a bullet count and the client's reducer
 * derives one from `kind` alone — so these two numbers are printed to make the
 * consequence of a verdict visible, and `packages/duel/src/__tests__/bullets.test.ts`
 * is where they are actually asserted.
 */
const REPORTED_BULLETS: Readonly<Record<string, number>> = {
  CORRECT: 14,
  WRONG: 7,
};

interface TestUser {
  readonly profileId: string;
  readonly accountId: string;
  readonly sessionId: string;
}

async function makeUser(label: string): Promise<TestUser> {
  const account = await query<{ id: string }>(
    "insert into accounts default values returning id",
  );
  const accountId = account.rows[0]!.id;
  const profile = await query<{ id: string }>(
    `insert into profiles(account_id, display_name, variation_root_seed_hex)
     values ($1,$2,$3) returning id`,
    [accountId, `duel-verify-${label}`, randomBytes(32).toString("hex")],
  );
  const profileId = profile.rows[0]!.id;
  const sessionId = randomBytes(32).toString("base64url");
  await query(
    `insert into access_sessions(id, profile_id, account_id, expires_at)
     values ($1,$2,$3, now() + interval '1 hour')`,
    [sessionId, profileId, accountId],
  );
  return { profileId, accountId, sessionId };
}

async function dropUser(user: TestUser): Promise<void> {
  await query("delete from access_sessions where profile_id=$1", [user.profileId]);
  await query("delete from profiles where id=$1", [user.profileId]);
  await query("delete from accounts where id=$1", [user.accountId]);
}

const pass = (line: string): void => console.log(`  \u2713 ${line}`);

// A declaration rather than a const arrow, so its `never` return narrows the code
// after every call site and the script reads as a list of assertions.
function fail(line: string): never {
  throw new Error(line);
}

/** The item's own authored reference answer. */
function referenceAnswerFor(itemId: string): string {
  const bank = m1ContentBank() as unknown as {
    items: readonly { itemId: string; referenceAnswer: string; question: string }[];
  };
  const item = bank.items.find((entry) => entry.itemId === itemId);
  if (!item) fail(`no authored reference answer for ${itemId}`);
  return item.referenceAnswer;
}

function questionFor(itemId: string): string {
  const bank = m1ContentBank() as unknown as {
    items: readonly { itemId: string; question: string }[];
  };
  return bank.items.find((entry) => entry.itemId === itemId)?.question ?? "";
}

const ENVELOPE_KEYS = ["itemId", "itemVersion", "kind", "responseRef", "source"];

async function main(): Promise<void> {
  const app = await buildApp();
  const users: TestUser[] = [];
  let failures = 0;

  try {
    const student = await makeUser("student");
    const stranger = await makeUser("stranger");
    users.push(student, stranger);

    const as = (user: TestUser) => ({ cookie: `pa_session=${user.sessionId}` });
    const mutatingAs = (user: TestUser) => ({
      cookie: `pa_session=${user.sessionId}`,
      "x-pa-csrf-token": csrfTokenForSession(user.sessionId),
    });

    // Open the student's OWN attempt, exactly as the browser does, so the graded
    // rounds below post the attempt's canonical duel id and are bound to a real run.
    // Without this the route refuses every post 409 before grading — which is the
    // integrated route working as designed, and the reason a check that skipped it
    // proved nothing about grading.
    const attempt = await openAttemptFor(app, student, () => mutatingAs(student));
    const DUEL_ID = attempt.duelId;
    const url = (round: number) =>
      `/v1/duels/${encodeURIComponent(DUEL_ID)}/rounds/${round}/verdict`;

    // ---- the route exists at all ------------------------------------------
    console.log("\nRegistration");
    const anonymous = await app.inject({ method: "POST", url: url(1) });
    if (anonymous.statusCode === 404) {
      fail(
        `POST ${url(1)} is 404 — the route is not registered in app.ts, which is the original bug`,
      );
    }
    if (anonymous.statusCode !== 401) {
      fail(`an unauthenticated verdict should be 401, got ${anonymous.statusCode}`);
    }
    pass("the endpoint the duel client posts to is registered and refuses 401");

    const noToken = await app.inject({
      method: "POST",
      url: url(1),
      headers: as(student),
      payload: { side: "A", itemId: "x", itemVersion: "v1", conceptId: "c", answer: "a" },
    });
    if (noToken.statusCode !== 403) {
      fail(`a mutation without a CSRF token should be 403, got ${noToken.statusCode}`);
    }
    pass("a signed-in post without the CSRF header is refused with 403");

    const forged = await app.inject({
      method: "POST",
      url: url(1),
      headers: { ...as(student), "x-pa-csrf-token": "not-the-token" },
      payload: { side: "A", itemId: "x", itemVersion: "v1", conceptId: "c", answer: "a" },
    });
    if (forged.statusCode !== 403) fail(`a forged CSRF token should be 403, got ${forged.statusCode}`);
    pass("a forged CSRF token is refused with 403");

    const stolen = await app.inject({
      method: "POST",
      url: url(1),
      // The stranger's cookie with the student's token, and vice versa. The token
      // is derived from the session, so neither combination can be assembled.
      headers: { ...as(stranger), "x-pa-csrf-token": csrfTokenForSession(student.sessionId) },
      payload: { side: "A", itemId: "x", itemVersion: "v1", conceptId: "c", answer: "a" },
    });
    if (stolen.statusCode !== 403) {
      fail(`another session's CSRF token should be 403, got ${stolen.statusCode}`);
    }
    pass("one session's CSRF token does not work for another");

    // ---- is grading actually grading? -------------------------------------
    console.log("\nHealth");
    const health = await app.inject({
      method: "GET",
      url: "/v1/duels/grading/health",
      headers: as(student),
    });
    const state = health.json() as {
      configured: boolean;
      model: string | null;
      policyId: string;
      items: number;
      budgetMs: number;
    };
    console.log(
      `      configured=${state.configured} model=${state.model} items=${state.items} budget=${state.budgetMs}ms policy=${state.policyId}`,
    );
    if (!state.configured) {
      fail(
        "no classifier credential is resolvable, so every round would be granted the maximum; set TRUEFOUNDRY_API_KEY",
      );
    }
    // A credential is not reachability, and saying so was the old bug in one
    // line: `configured` is true as soon as a key and a base URL are readable
    // from the environment, and the gateway behind them was never asked
    // anything.
    pass(`a credential resolves and the bank holds ${state.items} items`);

    // ---- a real graded round ----------------------------------------------
    //
    // The same item both ways. Two different items would prove nothing: the whole
    // question is whether what the STUDENT WROTE changed the outcome. The route now
    // selects the item from the stored attempt (never the client's claim), so the
    // pair of rounds that ask the SAME item is discovered from the attempt's own seed
    // and the item's authored reference answer is graded against the item the round
    // actually asks.
    console.log("\nGrading, live, one item both ways");
    const both = sameItemBothWays(attempt);
    const itemId = both.itemId;
    // The round's Codex cards, server-derived. Placed on the good answer because the
    // route folds prose AND evidence: a CLASSIFIER CORRECT with unsatisfied evidence
    // is minted WRONG, exactly as the duel requires the player to place them.
    const goodCards = m1ExpectedDuelCardIds({
      attemptSeedHex: attempt.attemptSeedHex,
      attemptOrdinal: attempt.attemptOrdinal,
      round: both.goodRound,
    });
    // A third round for the empty box (a deterministic pre-check WRONG), distinct
    // from the two that grade the item both ways.
    const emptyRound = [2, 3, 4, 5, 6].find(
      (candidate) => candidate !== both.goodRound && candidate !== both.badRound,
    )!;
    console.log(`      item     ${itemId}`);
    console.log(`      question ${questionFor(itemId).slice(0, 110)}…`);
    console.log(`      rounds   good=${both.goodRound} wrong=${both.badRound} (same item)`);

    interface Round {
      readonly label: string;
      readonly round: number;
      readonly answer: string;
      readonly expect: "CORRECT" | "WRONG";
      readonly cards: readonly string[];
    }
    const rounds: readonly Round[] = [
      {
        label: "the item's own authored reference answer, with its Codex evidence",
        round: both.goodRound,
        answer: referenceAnswerFor(itemId),
        expect: "CORRECT",
        cards: goodCards,
      },
      {
        label: "a deliberately off-topic answer to the SAME item",
        round: both.badRound,
        answer: "the colonists adored the king and asked him to tax them more heavily",
        expect: "WRONG",
        cards: goodCards,
      },
      {
        label: "an empty box",
        round: emptyRound,
        answer: "",
        expect: "WRONG",
        cards: [],
      },
    ];

    const seen: {
      round: number;
      kind: string;
      receipt: string;
      /** True only when a classification decided this round. */
      classified: boolean;
    }[] = [];
    for (const entry of rounds) {
      const startedAt = Date.now();
      const response = await app.inject({
        method: "POST",
        url: url(entry.round),
        headers: mutatingAs(student),
        payload: {
          side: "A",
          itemId,
          itemVersion: "v1",
          conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
          answer: entry.answer,
          selectedCardIds: entry.cards,
        },
      });
      const elapsed = Date.now() - startedAt;
      if (response.statusCode !== 200) {
        fail(`round ${entry.round} was refused: ${response.statusCode} ${response.body}`);
      }
      const envelope = response.json() as Record<string, unknown>;

      // The contract, checked on the real wire. An extra key here is not ignored
      // by the client — it fails the whole verdict.
      const keys = Object.keys(envelope).sort();
      if (JSON.stringify(keys) !== JSON.stringify(ENVELOPE_KEYS)) {
        fail(`the body must be exactly ${ENVELOPE_KEYS.join(",")}, got ${keys.join(",")}`);
      }
      const receipt = response.headers["x-pa-verdict-receipt"];
      if (typeof receipt !== "string" || receipt.length === 0) {
        fail("no receipt header; the verdict cannot be authenticated once it is spent");
      }
      const kind = String(envelope.kind);
      const path = String(response.headers["x-pa-grading-path"]);
      // The header is absent on a graded round and names the cause on an ungraded
      // one. Printed because `source` alone cannot tell them apart: it reads
      // GRADING_TIMEOUT whether the model overran 1250ms or the gateway refused
      // the request in eight.
      const fallback = response.headers["x-pa-grading-fallback"];
      const classified = envelope.source === "CLASSIFIER";
      seen.push({ round: entry.round, kind, receipt, classified });

      const mark = kind === entry.expect ? "\u2713" : "!";
      if (kind !== entry.expect) failures += 1;
      console.log(
        `  ${mark} round ${entry.round}  ${kind.padEnd(7)} ${String(REPORTED_BULLETS[kind] ?? "?").padStart(2)} balls  ` +
          `${String(elapsed).padStart(4)}ms  ${path.padEnd(9)}  ` +
          `source=${String(envelope.source).padEnd(15)} ${entry.label}`,
      );
      if (typeof fallback === "string") {
        console.log(`        NOT GRADED: ${fallback} — this round was granted, not read`);
      }
      if (entry.answer.length > 0) {
        console.log(`        “${entry.answer.slice(0, 96)}${entry.answer.length > 96 ? "…" : ""}”`);
      }
    }

    // ONLY CLASSIFIED ROUNDS COUNT TOWARDS THE PROOF. A fallback CORRECT is not
    // evidence of grading and an ABSTAINED WRONG is not evidence of grading; a
    // run in which every real answer was granted and only the empty box came back
    // WRONG satisfied the old arithmetic exactly.
    const graded = seen.filter((entry) => entry.classified);
    if (graded.length === 0) {
      const snapshot = (
        await app.inject({
          method: "GET",
          url: "/v1/duels/grading/health",
          headers: as(student),
        })
      ).json() as { grading?: { status?: string; advice?: string | null } };
      fail(
        "not one round was decided by a classification: every answer was granted " +
          `the maximum. /v1/health says ${snapshot.grading?.status ?? "?"} — ` +
          `${snapshot.grading?.advice ?? "no advice reported"}`,
      );
    }
    const correct = graded.filter((entry) => entry.kind === "CORRECT").length;
    const wrong = graded.filter((entry) => entry.kind === "WRONG").length;
    if (correct === 0 || wrong === 0) {
      fail(
        `every classified answer graded the same way (${correct} correct, ${wrong} wrong of ${graded.length} classified). ` +
          "The classifier is answering but not discriminating — this is the bug, not a pass.",
      );
    }
    pass(
      `the same item graded both ways BY THE CLASSIFIER: ${correct} CORRECT (${REPORTED_BULLETS.CORRECT} balls) and ${wrong} WRONG (${REPORTED_BULLETS.WRONG} balls)`,
    );

    // ---- the receipt binds to one profile, one duel, one round ------------
    //
    // WHAT A RECEIPT DOES AND DOES NOT ATTEST, because the two are easy to read
    // as one thing. It proves THE SERVER MINTED THIS ENVELOPE for this player,
    // this duel and this round — that the client did not author or move it. It
    // says nothing about whether a classifier read the answer: a fallback CORRECT
    // granted because the gateway was unreachable is minted by the server and gets
    // a perfectly valid receipt. "Signed" and "graded" are independent, and the
    // section above is the one that establishes graded.
    console.log("\nReceipt binding");
    const verifier = createDuelGrading(app.log);
    const first = seen[0]!;
    const firstBody = (
      await app.inject({
        method: "POST",
        url: url(first.round),
        headers: mutatingAs(student),
        payload: {
          side: "A",
          itemId,
          itemVersion: "v1",
          conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
          answer: referenceAnswerFor(itemId),
        },
      })
    ).json() as { kind: "CORRECT" | "WRONG"; itemId: string; itemVersion: string; source: "CLASSIFIER" | "GRADING_TIMEOUT" | "ABSTAINED" | "OPPONENT_AUTHORITY"; responseRef: string | null };
    const binding = {
      profileId: student.profileId,
      attemptId: DUEL_ID,
      roundIndex: first.round,
    };
    if (!verifier.verifyReceipt(firstBody, binding, first.receipt)) {
      fail("the receipt does not verify for the round it was minted for");
    }
    pass("the receipt verifies for {profileId, duelId, roundIndex}");

    for (const [label, moved] of [
      ["another round", { ...binding, roundIndex: binding.roundIndex + 1 }],
      ["another duel", { ...binding, attemptId: `${DUEL_ID}#2` }],
      ["another player", { ...binding, profileId: stranger.profileId }],
    ] as const) {
      if (verifier.verifyReceipt(firstBody, moved, first.receipt)) {
        fail(`a receipt verified for ${label}; a CORRECT can be replayed`);
      }
    }
    pass("it verifies for nothing else: not another round, another duel, or another player");

    if (verifier.verifyReceipt({ ...firstBody, kind: "CORRECT" }, binding, first.receipt) !==
        (firstBody.kind === "CORRECT")) {
      fail("a flipped verdict verified against its own receipt");
    }
    pass("a verdict flipped in the browser fails verification");

    // ---- a long duel keeps grading -----------------------------------------
    console.log("\nRound bounds");
    for (const round of [7, DUEL_ROUND_CEILING]) {
      const late = await app.inject({
        method: "POST",
        url: url(round),
        headers: mutatingAs(student),
        payload: {
          side: "A",
          itemId,
          itemVersion: "v1",
          conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
          answer: "war debt",
        },
      });
      if (late.statusCode !== 200) {
        fail(`round ${round} was refused: ${late.statusCode} ${late.body} — a duel that goes long stops being graded`);
      }
    }
    pass(`rounds 7 and ${DUEL_ROUND_CEILING} grade normally; there is no six-round cap`);

    const beyond = await app.inject({
      method: "POST",
      url: url(DUEL_ROUND_CEILING + 1),
      headers: mutatingAs(student),
      payload: {
        side: "A",
        itemId,
        itemVersion: "v1",
        conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
        answer: "war debt",
      },
    });
    if (beyond.statusCode !== 400) {
      fail(`a round past the structural ceiling should be 400, got ${beyond.statusCode}`);
    }
    pass(`round ${DUEL_ROUND_CEILING + 1} names no round of any duel and is refused`);

    // ---- a client cannot grade itself ---------------------------------------
    console.log("\nSelf-grading");
    const selfGraded = await app.inject({
      method: "POST",
      url: url(5),
      headers: mutatingAs(student),
      payload: {
        side: "A",
        itemId,
        itemVersion: "v1",
        conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
        answer: "nonsense",
        kind: "CORRECT",
      },
    });
    if ((selfGraded.json() as { error?: string }).error !== "VERDICT_NOT_ACCEPTED") {
      fail(`a client-supplied verdict should be VERDICT_NOT_ACCEPTED, got ${selfGraded.body}`);
    }
    pass("a request carrying its own `kind` is refused by name, not silently dropped");

    const bulletCount = await app.inject({
      method: "POST",
      url: url(5),
      headers: mutatingAs(student),
      payload: {
        side: "A",
        itemId,
        itemVersion: "v1",
        conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
        answer: "nonsense",
        bullets: 14,
      },
    });
    if ((bulletCount.json() as { error?: string }).error !== "VERDICT_NOT_ACCEPTED") {
      fail(`a client-supplied bullet count should be VERDICT_NOT_ACCEPTED, got ${bulletCount.body}`);
    }
    pass("a request carrying `bullets` is refused the same way");

    // ---- and what the endpoints say about all of it -------------------------
    //
    // Read last, so it reports the rate the rounds above actually produced. This
    // is the number a person watches during a lesson, and it was capable of
    // saying DEGRADED through a run in which nothing was graded at all.
    console.log("\nWhat /v1/health says about the run it just did");
    const finalHealth = (
      await app.inject({ method: "GET", url: "/v1/health" })
    ).json() as {
      grading?: {
        status?: string;
        classifiedInWindow?: number;
        gradeableInWindow?: number;
        ungradedInWindow?: number;
        ungradedPercent?: number | null;
        ungradedByDiagnosis?: Record<string, number>;
        advice?: string | null;
      };
    };
    const signal = finalHealth.grading ?? {};
    console.log(
      `      status=${signal.status} classified=${signal.classifiedInWindow}/${signal.gradeableInWindow} ` +
        `ungraded=${signal.ungradedInWindow} (${signal.ungradedPercent ?? "n/a"}%)`,
    );
    if (signal.advice) console.log(`      ${signal.advice}`);
    const anyUngraded = (signal.ungradedInWindow ?? 0) > 0;
    if (signal.status === "OK" && anyUngraded && signal.classifiedInWindow === 0) {
      fail(
        "/v1/health says OK while nothing was graded; the endpoint is reporting " +
          "the opposite of the truth",
      );
    }
    if (!anyUngraded && signal.status !== "OK") {
      fail(`/v1/health says ${signal.status} with no ungraded rounds in the window`);
    }
    pass(`/v1/health agrees with what the rounds above did: ${signal.status}`);

    console.log(
      failures === 0
        ? "\nThe duel grades answers. A wrong one costs the student half the magazine.\n"
        : `\n${failures} check(s) need attention — see the ! lines above.\n`,
    );
  } finally {
    for (const user of users) await dropUser(user).catch(() => undefined);
    await app.close();
  }
  // A verdict that graded the wrong way is a red run, not a green one. Every
  // hard precondition above throws through `fail`, but a round whose kind did
  // not match its expectation only increments `failures` and keeps going so the
  // whole picture is printed — and that count has to reach the exit code, or a
  // live run in which a CORRECT answer was graded WRONG prints its ! line and
  // still exits 0, which is the silent-success this script exists to refuse.
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((cause) => {
  console.error(`\nFAILED: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});
