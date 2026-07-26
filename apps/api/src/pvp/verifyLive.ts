// A live smoke test of the whole PvP path. `pnpm --filter @pa/api pvp:verify:live`
//
// This is not a unit test and it is deliberately not in `pnpm test`: it needs a
// database, it calls the real classifier, and it costs money. What it is for is the
// question no unit test answers — does a duel between TWO SIGNED-IN PEOPLE actually
// work end to end, through the routes the app really registers?
//
// It drives `buildApp()` itself rather than a hand-assembled Fastify instance, so a
// route that is not registered in app.ts fails here exactly as it would in a
// browser. And it uses two distinct session cookies throughout, because that is the
// thing that has to hold tomorrow: one machine, two accounts, two sessions.
//
// Everything it creates in the database it deletes again.

import "../config.js";
import { randomBytes } from "node:crypto";
import { m1ContentBank } from "@pa/grading";
import { buildApp } from "../app.js";
import { csrfTokenForSession } from "../auth.js";
import { query } from "../db.js";
import { poolHealth, pvpItemBank, pvpQuestionBank } from "./questionPool.js";

const WAIT_STEP_MS = 400;

interface TestUser {
  readonly label: string;
  readonly profileId: string;
  readonly accountId: string;
  readonly sessionId: string;
}

function seedHex(): string {
  return randomBytes(32).toString("hex");
}

async function makeUser(label: string): Promise<TestUser> {
  const account = await query<{ id: string }>(
    "insert into accounts default values returning id",
  );
  const accountId = account.rows[0]!.id;
  const profile = await query<{ id: string }>(
    `insert into profiles(account_id, display_name, variation_root_seed_hex)
     values ($1,$2,$3) returning id`,
    [accountId, `pvp-verify-${label}`, seedHex()],
  );
  const profileId = profile.rows[0]!.id;
  const sessionId = randomBytes(32).toString("base64url");
  await query(
    `insert into access_sessions(id, profile_id, account_id, expires_at)
     values ($1,$2,$3, now() + interval '1 hour')`,
    [sessionId, profileId, accountId],
  );
  return { label, profileId, accountId, sessionId };
}

async function dropUser(user: TestUser): Promise<void> {
  await query("delete from access_sessions where profile_id=$1", [user.profileId]);
  await query("delete from profiles where id=$1", [user.profileId]);
  await query("delete from accounts where id=$1", [user.accountId]);
}

const pass = (line: string): void => console.log(`  \u2713 ${line}`);

interface AuthoredAnswer {
  readonly text: string;
  /** Which half of the pool it came from, so the walk can show the mix. */
  readonly source: "PvE" | "PvP-only";
}

/**
 * The item's own authored reference answer.
 *
 * Looks in both halves of the pool, because a round can now draw a PvP-only
 * hardening item as readily as a PvE one — the first version of this looked only at
 * `items` and fell over the first time round one drew a hardening item.
 */
function authoredAnswerFor(itemId: string): AuthoredAnswer | null {
  const bank = m1ContentBank() as unknown as {
    items: readonly { itemId: string; referenceAnswer: string }[];
    pvpHardening?: { items?: readonly { itemId: string; referenceAnswer: string }[] };
  };
  const pve = bank.items.find((entry) => entry.itemId === itemId);
  if (pve) return { text: pve.referenceAnswer, source: "PvE" };
  const pvp = bank.pvpHardening?.items?.find((entry) => entry.itemId === itemId);
  return pvp ? { text: pvp.referenceAnswer, source: "PvP-only" } : null;
}

// A declaration rather than a const arrow, so its `never` return narrows the code
// after every call site and the script reads as a list of assertions.
function fail(line: string): never {
  throw new Error(line);
}

async function main(): Promise<void> {
  const app = await buildApp();
  const users: TestUser[] = [];
  let failures = 0;

  // A read needs only the cookie; a mutation needs the CSRF token too, exactly as
  // the browser sends it after reading /v1/session.
  const as = (user: TestUser) => ({ cookie: `pa_session=${user.sessionId}` });
  const mutatingAs = (user: TestUser) => ({
    cookie: `pa_session=${user.sessionId}`,
    "x-pa-csrf-token": csrfTokenForSession(user.sessionId),
  });

  try {
    const host = await makeUser("host");
    const guest = await makeUser("guest");
    users.push(host, guest);
    console.log(
      `\nTwo separate sessions created.\n  host  profile ${host.profileId}\n  guest profile ${guest.profileId}\n`,
    );

    // ---- the pool, and the invariant it exists to hold --------------------
    console.log("Question pool");
    const health = poolHealth();
    const ceiling = 24; // @pa/duel DUEL_ROUND_CEILING
    console.log(
      `      ${health.total} composed, ${health.unguarded} under the capstone guard, ${health.gradable} gradable, ${health.capstoneShared} shared from the capstone`,
    );
    if (health.unguarded <= ceiling) {
      fail(
        `the guarded pool is ${health.unguarded} and the round ceiling is ${ceiling}: a match could repeat a question`,
      );
    }
    pass(`${health.unguarded} > ${ceiling}: no match can repeat a question`);
    const ungradable = pvpQuestionBank().items.filter(
      (item) => pvpItemBank().get(item.itemId) === undefined,
    );
    if (ungradable.length !== health.capstoneShared) {
      console.log(
        `      ! ${ungradable.length} items are not gradable but ${health.capstoneShared} capstone items were expected`,
      );
      failures += 1;
    } else {
      pass("every item PvP can draw is one the grader can grade");
    }

    // ---- the routes are registered at all --------------------------------
    console.log("\nRegistration");
    const anonymous = await app.inject({ method: "POST", url: "/api/pvp/lobby" });
    if (anonymous.statusCode === 404) {
      fail("POST /api/pvp/lobby is 404 — the routes are not registered in app.ts");
    }
    if (anonymous.statusCode !== 401) {
      fail(`an unauthenticated lobby should be 401, got ${anonymous.statusCode}`);
    }
    pass("POST /api/pvp/lobby is registered and refuses an anonymous caller with 401");

    // A signed-in caller with no CSRF token. The cookie alone is exactly what a
    // cross-site form post would carry, which is the whole attack.
    const noToken = await app.inject({
      method: "POST",
      url: "/api/pvp/lobby",
      headers: as(host),
    });
    if (noToken.statusCode !== 403) {
      fail(
        `a mutation without a CSRF token should be 403, got ${noToken.statusCode} ${noToken.body}`,
      );
    }
    pass("a signed-in mutation without the CSRF token is refused with 403");

    const wrongToken = await app.inject({
      method: "POST",
      url: "/api/pvp/lobby",
      headers: { ...as(host), "x-pa-csrf-token": "not-the-token" },
    });
    if (wrongToken.statusCode !== 403) {
      fail(`a forged CSRF token should be 403, got ${wrongToken.statusCode}`);
    }
    pass("a forged CSRF token is refused with 403");

    const readWithoutToken = await app.inject({
      method: "GET",
      url: "/api/pvp/leaderboard",
    });
    if (readWithoutToken.statusCode !== 200) {
      fail("a read must not require a CSRF token; the poll loop carries none");
    }
    pass("reads still need no token, so the poll loop is unaffected");

    // ---- a lobby, and the self-duel guard --------------------------------
    console.log("\nLobby");
    const created = await app.inject({
      method: "POST",
      url: "/api/pvp/lobby",
      headers: mutatingAs(host),
    });
    if (created.statusCode !== 200) {
      fail(`creating a lobby failed: ${created.statusCode} ${created.body}`);
    }
    const lobby = created.json() as { code: string; handle: string };
    pass(`host opened lobby ${lobby.code} as ${lobby.handle}`);

    const selfJoin = await app.inject({
      method: "POST",
      url: `/api/pvp/lobby/${lobby.code}/join`,
      headers: mutatingAs(host),
    });
    const selfBody = selfJoin.json() as { error?: string };
    if (selfBody.error !== "CANNOT_DUEL_YOURSELF") {
      fail(
        `the host joining their own lobby should be CANNOT_DUEL_YOURSELF, got ${selfJoin.statusCode} ${selfJoin.body}`,
      );
    }
    pass("the same session cannot join its own lobby (CANNOT_DUEL_YOURSELF)");

    const joined = await app.inject({
      method: "POST",
      url: `/api/pvp/lobby/${lobby.code}/join`,
      headers: mutatingAs(guest),
    });
    if (joined.statusCode !== 200) {
      fail(`the guest could not join: ${joined.statusCode} ${joined.body}`);
    }
    const match = joined.json() as { matchId: string; side: string };
    pass(`a DIFFERENT session joined and started match ${match.matchId} as side ${match.side}`);

    const hostView = await app.inject({
      method: "GET",
      url: `/api/pvp/lobby/${lobby.code}`,
      headers: as(host),
    });
    const hostLobby = hostView.json() as { status: string; side: string; matchId: string };
    if (hostLobby.status !== "STARTED" || hostLobby.side !== "A") {
      fail(`the host should see STARTED on side A, got ${hostView.body}`);
    }
    pass("the host's own poll reports STARTED — this is how the lobby screen advances");

    // ---- reach the first question ----------------------------------------
    console.log("\nThe first round");
    interface MatchRead {
      readonly snapshot: { phase: string; round: number; tick: number; self: { ammo: number } };
      readonly question: {
        itemId: string;
        question: string;
        appearance: number;
        recycled: boolean;
      } | null;
    }
    const started = Date.now();
    let polled: MatchRead | null = null;
    while (Date.now() - started < 40_000) {
      const poll = await app.inject({
        method: "GET",
        url: `/api/pvp/match/${match.matchId}`,
        headers: as(host),
      });
      if (poll.statusCode !== 200) {
        fail(`polling the match failed: ${poll.statusCode} ${poll.body}`);
      }
      polled = poll.json() as MatchRead;
      if (polled.question) break;
      await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
    }
    const opening = polled;
    if (!opening?.question) {
      fail("no question was ever served — the match never reached QUESTION_PENDING");
    }
    pass(
      `reached ${opening.snapshot.phase} at round ${opening.snapshot.round} after ${(
        (Date.now() - started) /
        1000
      ).toFixed(1)}s`,
    );
    console.log(`      item     ${opening.question.itemId}`);
    console.log(`      question ${opening.question.question.slice(0, 96)}…`);
    console.log(`      ammo before answering: ${opening.snapshot.self.ammo}`);

    // ---- a real graded answer --------------------------------------------
    //
    // The answer has to fit the item the AUTHORITY drew, which varies per match now
    // that the round's question is a seeded choice. A canned answer would grade WRONG
    // for the honest reason that it answers a different question, and would look like
    // a grading failure. So the good answer is the item's own authored reference: if
    // the classifier will not accept the answer the author wrote, grading is broken.
    console.log("\nGrading (live)");
    const askedId = opening.question.itemId;
    const authored = authoredAnswerFor(askedId);
    if (!authored) fail(`no authored reference answer for ${askedId}`);
    const answerText = authored.text;
    console.log(`      drawn from the ${authored.source} half of the pool`);
    const gradeStarted = Date.now();
    const graded = await app.inject({
      method: "POST",
      url: `/api/pvp/match/${match.matchId}/answer`,
      headers: mutatingAs(host),
      payload: { answerText },
    });
    if (graded.statusCode !== 200) {
      fail(`the answer was refused: ${graded.statusCode} ${graded.body}`);
    }
    const verdict = graded.json() as {
      verdict: string;
      snapshot: { self: { ammo: number }; phase: string };
    };
    pass(
      `a good answer graded ${verdict.verdict} in ${Date.now() - gradeStarted}ms; ammo is now ${verdict.snapshot.self.ammo}`,
    );

    const wrongStarted = Date.now();
    const wrong = await app.inject({
      method: "POST",
      url: `/api/pvp/match/${match.matchId}/answer`,
      headers: mutatingAs(guest),
      payload: { answerText: "because of the weather in Boston" },
    });
    if (wrong.statusCode !== 200) {
      fail(`the guest's answer was refused: ${wrong.statusCode} ${wrong.body}`);
    }
    const wrongVerdict = wrong.json() as {
      verdict: string;
      snapshot: { self: { ammo: number } };
    };
    pass(
      `an off-topic answer graded ${wrongVerdict.verdict} in ${Date.now() - wrongStarted}ms; ammo is ${wrongVerdict.snapshot.self.ammo}`,
    );
    if (verdict.verdict === wrongVerdict.verdict) {
      console.log(
        "      ! both answers received the same verdict. An unreachable classifier grants everything; check the credential.",
      );
      failures += 1;
    }

    // What the verdicts were actually worth. Bullets are granted once BOTH sides
    // have committed, so the magazine is only readable after the round turns over —
    // and it is reported rather than asserted, because the economy is @pa/duel's to
    // set and it is being retuned right now.
    const grantStarted = Date.now();
    let granted: { self: number; opponent: number } | null = null;
    while (Date.now() - grantStarted < 15_000) {
      const poll = await app.inject({
        method: "GET",
        url: `/api/pvp/match/${match.matchId}`,
        headers: as(host),
      });
      const body = poll.json() as {
        snapshot: { phase: string; self: { ammo: number }; opponent: { ammo: number } };
      };
      if (body.snapshot.phase !== "QUESTION_PENDING") {
        granted = {
          self: body.snapshot.self.ammo,
          opponent: body.snapshot.opponent.ammo,
        };
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
    }
    if (!granted) {
      console.log("      ! the round never left QUESTION_PENDING after both answers");
      failures += 1;
    } else {
      pass(
        `bullets granted: ${verdict.verdict} loaded ${granted.self}, ${wrongVerdict.verdict} loaded ${granted.opponent}`,
      );
    }

    // ---- past round seven --------------------------------------------------
    //
    // The round a six-item pool would start repeating at, and the round a
    // hard-coded six-round grading cap would start refusing at. An open-ended duel
    // spends most of its life here, so "it worked in round one" is not evidence.
    console.log("\nPast round seven");
    const asked = new Map<string, number>([[askedId, 1]]);
    let lastRound = opening.snapshot.round;
    const walkStarted = Date.now();
    while (lastRound < 8 && Date.now() - walkStarted < 300_000) {
      const poll = await app.inject({
        method: "GET",
        url: `/api/pvp/match/${match.matchId}`,
        headers: as(host),
      });
      const body = poll.json() as MatchRead & { result: unknown };
      if (body.result) fail(`the match resolved early at round ${body.snapshot.round}`);
      if (!body.question) {
        await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
        continue;
      }
      const round = body.snapshot.round;
      const item = body.question;
      if (round === lastRound) {
        await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
        continue;
      }
      lastRound = round;
      asked.set(item.itemId, (asked.get(item.itemId) ?? 0) + 1);

      const good = authoredAnswerFor(item.itemId);
      if (!good) fail(`round ${round} drew ${item.itemId}, which has no authored answer`);

      const hostAnswer = await app.inject({
        method: "POST",
        url: `/api/pvp/match/${match.matchId}/answer`,
        headers: mutatingAs(host),
        payload: { answerText: good.text },
      });
      const guestAnswer = await app.inject({
        method: "POST",
        url: `/api/pvp/match/${match.matchId}/answer`,
        headers: mutatingAs(guest),
        payload: { answerText: "nothing to do with the question" },
      });
      if (hostAnswer.statusCode !== 200 || guestAnswer.statusCode !== 200) {
        fail(
          `round ${round} could not be graded: host ${hostAnswer.statusCode} ${hostAnswer.body}; guest ${guestAnswer.statusCode} ${guestAnswer.body}`,
        );
      }
      const hostVerdict = (hostAnswer.json() as { verdict: string }).verdict;
      console.log(
        `      round ${round}: ${item.itemId.split(".").slice(-2)[0]} (${good.source}) -> ${hostVerdict}${
          item.recycled ? ` [RECYCLED, appearance ${item.appearance}]` : ""
        }`,
      );
    }
    if (lastRound < 8) fail(`only reached round ${lastRound} inside the time budget`);
    pass(`graded every round through round ${lastRound}, past the old six-round cap`);

    const repeated = [...asked.entries()].filter(([, count]) => count > 1);
    if (repeated.length > 0) {
      console.log(
        `      ! an item repeated inside one match: ${repeated.map(([id]) => id).join(", ")}`,
      );
      failures += 1;
    } else {
      pass(`${asked.size} distinct questions asked, none repeated`);
    }

    // ---- intents are accepted --------------------------------------------
    console.log("\nIntents");
    const live = await app.inject({
      method: "GET",
      url: `/api/pvp/match/${match.matchId}`,
      headers: as(host),
    });
    const tick = (live.json() as { snapshot: { tick: number } }).snapshot.tick;
    const intents = await app.inject({
      method: "POST",
      url: `/api/pvp/match/${match.matchId}/intents`,
      headers: mutatingAs(host),
      payload: {
        frames: [
          {
            seq: 1,
            tick,
            moveX: 1,
            moveZ: 0,
            sprint: false,
            crouch: false,
            jump: false,
            dodge: false,
            fire: true,
            aimX: 0,
            aimZ: 1,
            abilityId: null,
          },
        ],
      },
    });
    if (intents.statusCode !== 200) {
      fail(`intents were refused: ${intents.statusCode} ${intents.body}`);
    }
    const ack = intents.json() as { rejected: string[]; snapshot: { tick: number } };
    if (ack.rejected.length > 0) {
      console.log(`      ! the authority refused a frame: ${ack.rejected.join(", ")}`);
      failures += 1;
    } else {
      pass(`one intent frame accepted at tick ${ack.snapshot.tick}`);
    }

    const smuggled = await app.inject({
      method: "POST",
      url: `/api/pvp/match/${match.matchId}/intents`,
      headers: mutatingAs(host),
      payload: { frames: [{ seq: 2, tick, health: 100 }] },
    });
    const smuggledAck = smuggled.json() as { rejected: string[] };
    if (!smuggledAck.rejected.some((line) => line.startsWith("UNKNOWN_FIELD"))) {
      fail("a frame carrying `health` should be refused as UNKNOWN_FIELD");
    }
    pass("a frame trying to carry `health` is refused, not ignored");

    // ---- a third party cannot look in -------------------------------------
    const stranger = await makeUser("stranger");
    users.push(stranger);
    const peek = await app.inject({
      method: "GET",
      url: `/api/pvp/match/${match.matchId}`,
      headers: as(stranger),
    });
    if (peek.statusCode !== 403) {
      fail(`a third session should get 403 on somebody else's match, got ${peek.statusCode}`);
    }
    pass("a third session cannot read the match");

    // ---- resolve and settle ------------------------------------------------
    console.log("\nResolution and standing");
    const forfeited = await app.inject({
      method: "POST",
      url: `/api/pvp/match/${match.matchId}/forfeit`,
      headers: mutatingAs(guest),
    });
    const result = (forfeited.json() as { result: { winner: string; reason: string } | null })
      .result;
    if (!result || result.winner !== "A") {
      fail(`a guest forfeit should hand the win to A, got ${forfeited.body}`);
    }
    pass(`the match resolved: ${result.reason}, winner ${result.winner}`);

    const board = await app.inject({ method: "GET", url: "/api/pvp/leaderboard" });
    const rows = (board.json() as {
      rows: { handle: string; points: number; wins: number; losses: number }[];
    }).rows;
    if (rows.length < 2) fail(`the board should carry both duellists, got ${board.body}`);
    const winner = rows.find((row) => row.wins === 1);
    const loser = rows.find((row) => row.losses === 1);
    if (winner === undefined || loser === undefined) {
      fail(`the board did not record the result: ${board.body}`);
    }
    pass(
      `standing moved: ${winner.handle} ${winner.points} (win), ${loser.handle} ${loser.points} (loss)`,
    );

    // Both clients keep polling after the fight ends, to discover the result. Every
    // one of those reads runs `settle`, so the standing has to be banked exactly
    // once — unguarded, the winner gained twenty points per poll.
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "GET",
        url: `/api/pvp/match/${match.matchId}`,
        headers: as(host),
      });
    }
    const after = (
      (await app.inject({ method: "GET", url: "/api/pvp/leaderboard" })).json() as {
        rows: { handle: string; points: number; wins: number }[];
      }
    ).rows;
    const winnerAfter = after.find((row) => row.handle === winner.handle);
    if (!winnerAfter || winnerAfter.points !== winner.points || winnerAfter.wins !== 1) {
      fail(
        `polling a resolved match moved the standing again: ${winner.points} -> ${winnerAfter?.points} over three reads`,
      );
    }
    pass("three more polls of the resolved match moved nothing; the result banks once");
    if (winner.points !== 120 || loser.points !== 88) {
      console.log(
        `      ! expected 100+20 and 100-12 at equal Rank, got ${winner.points} and ${loser.points}`,
      );
      failures += 1;
    }
    for (const row of rows) {
      if (/pvp-verify/.test(row.handle)) {
        fail("a display name reached the leaderboard — handles must be generated");
      }
    }
    pass("the board carries generated handles only, no display names");

    console.log(
      failures === 0
        ? "\nPvP is reachable end to end.\n"
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
