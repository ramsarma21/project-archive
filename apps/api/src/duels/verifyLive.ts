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
// Everything it creates in the database it deletes again.

import "../config.js";
import { randomBytes } from "node:crypto";
import { m1ContentBank } from "@pa/grading";
import { buildApp } from "../app.js";
import { csrfTokenForSession } from "../auth.js";
import { query } from "../db.js";
import { createDuelGrading } from "./grading.js";
import { DUEL_ROUND_CEILING } from "./request.js";

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

const DUEL_ID = "PA.BOS.M1.EFFIGY_RUN#duel@1";

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
    pass(`the classifier is reachable and the bank holds ${state.items} items`);

    // ---- a real graded round ----------------------------------------------
    //
    // The same item both ways. Two different items would prove nothing: the whole
    // question is whether what the STUDENT WROTE changed the outcome.
    console.log("\nGrading, live, one item both ways");
    const itemId = "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1";
    console.log(`      item     ${itemId}`);
    console.log(`      question ${questionFor(itemId).slice(0, 110)}…`);

    interface Round {
      readonly label: string;
      readonly round: number;
      readonly answer: string;
      readonly expect: "CORRECT" | "WRONG";
    }
    const rounds: readonly Round[] = [
      {
        label: "the item's own authored reference answer",
        round: 1,
        answer: referenceAnswerFor(itemId),
        expect: "CORRECT",
      },
      {
        label: "a student's own words, correct",
        round: 2,
        answer: "they're broke from the war with france and want us to pay for it",
        expect: "CORRECT",
      },
      {
        label: "a plausible wrong answer",
        round: 3,
        answer: "because they wanted to control us and show they were in charge",
        expect: "WRONG",
      },
      {
        label: "an empty box",
        round: 4,
        answer: "",
        expect: "WRONG",
      },
    ];

    const seen: { round: number; kind: string; receipt: string }[] = [];
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
      seen.push({ round: entry.round, kind, receipt });

      const mark = kind === entry.expect ? "\u2713" : "!";
      if (kind !== entry.expect) failures += 1;
      console.log(
        `  ${mark} round ${entry.round}  ${kind.padEnd(7)} ${String(REPORTED_BULLETS[kind] ?? "?").padStart(2)} balls  ` +
          `${String(elapsed).padStart(4)}ms  ${String(response.headers["x-pa-grading-path"]).padEnd(6)}  ` +
          `source=${String(envelope.source).padEnd(15)} ${entry.label}`,
      );
      if (entry.answer.length > 0) {
        console.log(`        “${entry.answer.slice(0, 96)}${entry.answer.length > 96 ? "…" : ""}”`);
      }
    }

    const correct = seen.filter((entry) => entry.kind === "CORRECT").length;
    const wrong = seen.filter((entry) => entry.kind === "WRONG").length;
    if (correct === 0 || wrong === 0) {
      fail(
        `every answer graded the same way (${correct} correct, ${wrong} wrong). An unreachable classifier grants everything — this is the bug, not a pass.`,
      );
    }
    pass(
      `the same item graded both ways: ${correct} CORRECT (${REPORTED_BULLETS.CORRECT} balls) and ${wrong} WRONG (${REPORTED_BULLETS.WRONG} balls)`,
    );

    // ---- the receipt binds to one profile, one duel, one round ------------
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

    console.log(
      failures === 0
        ? "\nThe duel grades answers. A wrong one costs the student half the magazine.\n"
        : `\n${failures} check(s) need attention — see the ! lines above.\n`,
    );
  } finally {
    for (const user of users) await dropUser(user).catch(() => undefined);
    await app.close();
  }
  process.exit(0);
}

main().catch((cause) => {
  console.error(`\nFAILED: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});
