// A live proof that the boss duel is GRADED, and that the graded verdict — and
// nothing else — decides both magazines.
// `pnpm --filter @pa/api duel:verify:award:live`
//
// This is the check the "always 14 7" report needed and no offline test can make:
// it posts a deliberately CORRECT and a deliberately WRONG answer to the SAME item
// through the real duel route, against the REAL classifier, and requires that
//
//   * the two come back different — a wrong answer is WRONG, source CLASSIFIER,
//     path MODEL, not a fallback CORRECT granted because grading was unreachable;
//   * the persisted `duel_verdicts` rows record exactly those kinds; and
//   * the M1 boss's SYMMETRIC_COMPLEMENT award, fed those real verdicts, arms the
//     player 14 / boss 7 on the correct answer and player 7 / boss 14 on the wrong
//     one — the complement rule, end to end.
//
// It is deliberately NOT in `pnpm test`: it needs the database and it calls the
// paid classifier. It drives the real `registerDuelRoutes` with an injected attempt
// authority (the same seam duel-attempt-authority.test.ts uses) so the SAME item
// can be graded both ways without seeding a whole progression run — everything
// downstream of the attempt (grading, the evidence gate, the first-answer store,
// the receipt) is the production path. Everything it writes to the database it
// deletes again.

import "../config.js";
import { randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { m1DuelId, m1EvidenceRelevantCardIds } from "@pa/mission-m1";
import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  bossProfileForTier,
  grantRoundBullets,
  mintVerdict,
  roundAmmoSources,
  type VerdictKind,
} from "@pa/duel";
import { query } from "../db.js";
import { csrfTokenForSession } from "../auth.js";
import { createDuelGrading } from "./grading.js";
import { registerDuelRoutes } from "../routes/duels.js";
import { postgresDuelVerdictStore } from "./verdictStore.js";

// One item, graded both ways. A well-understood cause item whose correct answer is
// unambiguous and whose wrong answer is plainly off-topic, so the proof does not
// hinge on a rubric edge the content pass may still be tuning.
const ITEM_ID = "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1";
const CONCEPT_ID = "BOS.CONCEPT.POSTWAR_REVENUE.v1";
const CANONICAL = m1DuelId(1);
const CORRECT_ANSWER =
  "Because Britain came out of the war with France in 1763 owing more money than it ever had, and Parliament decided the colonies should pay part of that debt.";
const WRONG_ANSWER =
  "Because the king was angry that Boston refused to build him a new palace, so he ordered soldiers to take our church bells.";

const pass = (line: string): void => console.log(`  \u2713 ${line}`);
function fail(line: string): never {
  throw new Error(line);
}

async function makeProfile(label: string): Promise<string> {
  const account = await query<{ id: string }>("insert into accounts default values returning id");
  const accountId = account.rows[0]!.id;
  const profile = await query<{ id: string }>(
    `insert into profiles(account_id, display_name, variation_root_seed_hex)
     values ($1,$2,$3) returning id`,
    [accountId, `award-verify-${label}`, randomBytes(32).toString("hex")],
  );
  const profileId = profile.rows[0]!.id;
  const sid = randomUUID();
  await query(
    `insert into access_sessions(id, profile_id, account_id, expires_at)
     values ($1,$2,$3, now() + interval '1 hour')`,
    [sid, profileId, accountId],
  );
  return profileId;
}

async function drop(profileId: string): Promise<void> {
  const acct = await query<{ account_id: string }>(
    "select account_id from profiles where id=$1",
    [profileId],
  );
  await query("delete from duel_verdicts where profile_id=$1", [profileId]);
  await query("delete from access_sessions where profile_id=$1", [profileId]);
  await query("delete from profiles where id=$1", [profileId]);
  if (acct.rows[0]) await query("delete from accounts where id=$1", [acct.rows[0].account_id]);
}

/** The runtime magazines the M1 boss award produces for one player verdict. */
function magazinesFor(kind: VerdictKind): { player: number; boss: number } {
  const profile = bossProfileForTier(1, "BOS.MD01.BOSS.CONSTABLE", {
    ammoPolicy: "SYMMETRIC_COMPLEMENT",
  });
  const config = { opponent: { kind: "BOSS" as const, profile } } as never;
  const verdict = mintVerdict({ kind, itemId: ITEM_ID, itemVersion: "v1", source: "CLASSIFIER" });
  const sources = roundAmmoSources(config, [{ side: "A", verdict }]);
  return {
    player: grantRoundBullets({ source: sources.A, unspentFromPreviousRound: 0 }).magazine,
    boss: grantRoundBullets({ source: sources.B, unspentFromPreviousRound: 0 }).magazine,
  };
}

async function main(): Promise<void> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const grading = createDuelGrading(app.log);

  const owners: Record<
    string,
    { attemptId: string; attemptOrdinal: number; attemptSeedHex: string; missionId: string; chapterId: string }
  > = {};
  await registerDuelRoutes(app, {
    grading,
    authenticate: async (sid) => (sid && owners[sid] ? { profileId: sid } : null),
    resolveAttempt: async (profileId) => owners[profileId] ?? null,
    // Pinned to ONE item so the SAME question is graded both ways. This is the only
    // injection; grade/evidence/store/receipt are the production route.
    questionAuthority: { duelId: () => CANONICAL, expectedItemId: () => ITEM_ID },
    verdictStore: postgresDuelVerdictStore(),
  });
  await app.ready();

  console.log("\nHealth");
  if (!grading.health.configured) {
    fail("no classifier credential is resolvable; every round would be granted the maximum. Set TRUEFOUNDRY_API_KEY");
  }
  pass(`classifier configured: model=${grading.health.model}`);

  const relevant = [...m1EvidenceRelevantCardIds(ITEM_ID)];

  const profiles: string[] = [];
  try {
    const good = await makeProfile("good");
    const bad = await makeProfile("bad");
    profiles.push(good, bad);
    for (const id of [good, bad]) {
      owners[id] = { attemptId: id, attemptOrdinal: 1, attemptSeedHex: "0".repeat(32), missionId: "M", chapterId: "c" };
    }

    const post = (profileId: string, answer: string) =>
      app.inject({
        method: "POST",
        url: `/v1/duels/${encodeURIComponent(CANONICAL)}/rounds/1/verdict`,
        headers: { "x-pa-csrf-token": csrfTokenForSession(profileId), "content-type": "application/json" },
        cookies: { pa_session: profileId },
        // The item's own relevant evidence cards are placed on BOTH runs, so the ONLY
        // difference between them is what the student wrote — the evidence gate cannot
        // be what separates the verdicts.
        payload: { side: "A", itemId: ITEM_ID, itemVersion: "v1", conceptId: CONCEPT_ID, answer, selectedCardIds: relevant },
      });

    console.log("\nGrading, live, one item both ways");
    const goodRes = await post(good, CORRECT_ANSWER);
    const badRes = await post(bad, WRONG_ANSWER);
    if (goodRes.statusCode !== 200) fail(`correct answer refused: ${goodRes.statusCode} ${goodRes.body}`);
    if (badRes.statusCode !== 200) fail(`wrong answer refused: ${badRes.statusCode} ${badRes.body}`);
    const g = goodRes.json() as Record<string, string>;
    const b = badRes.json() as Record<string, string>;

    if (g.source !== "CLASSIFIER" || goodRes.headers["x-pa-grading-path"] !== "MODEL") {
      fail(`the correct answer was not decided by the classifier (source=${g.source}, path=${goodRes.headers["x-pa-grading-path"]}); this run measures nothing about grading`);
    }
    if (b.source !== "CLASSIFIER" || badRes.headers["x-pa-grading-path"] !== "MODEL") {
      fail(`the wrong answer was not decided by the classifier (source=${b.source}, path=${badRes.headers["x-pa-grading-path"]}); this run measures nothing about grading`);
    }
    if (g.kind !== "CORRECT") fail(`a correct answer graded ${g.kind}, not CORRECT`);
    if (b.kind !== "WRONG") fail(`a wrong answer graded ${b.kind}, not WRONG — the classifier is not discriminating, which is the bug`);
    pass(`the same item graded both ways by the classifier: correct -> CORRECT, wrong -> WRONG`);

    console.log("\nPersisted rows");
    const rows = await query<{ profile_id: string; kind: string; source: string; grading_path: string }>(
      "select profile_id, kind, source, grading_path from duel_verdicts where profile_id = any($1)",
      [[good, bad]],
    );
    const goodRow = rows.rows.find((r) => r.profile_id === good);
    const badRow = rows.rows.find((r) => r.profile_id === bad);
    if (goodRow?.kind !== "CORRECT" || badRow?.kind !== "WRONG") {
      fail(`persisted rows do not match: correct-run=${goodRow?.kind}, wrong-run=${badRow?.kind}`);
    }
    pass(`duel_verdicts persisted CORRECT for the correct answer and WRONG for the wrong one`);

    console.log("\nAward: the graded verdict decides both magazines (M1 SYMMETRIC_COMPLEMENT boss)");
    const correctMags = magazinesFor(g.kind as VerdictKind);
    const wrongMags = magazinesFor(b.kind as VerdictKind);
    console.log(`      correct answer -> player ${correctMags.player}, boss ${correctMags.boss}`);
    console.log(`      wrong   answer -> player ${wrongMags.player}, boss ${wrongMags.boss}`);
    if (correctMags.player !== BULLETS_FOR_CORRECT || correctMags.boss !== BULLETS_FOR_WRONG) {
      fail(`a correct answer must arm the player ${BULLETS_FOR_CORRECT} and the boss ${BULLETS_FOR_WRONG}`);
    }
    if (wrongMags.player !== BULLETS_FOR_WRONG || wrongMags.boss !== BULLETS_FOR_CORRECT) {
      fail(`a wrong answer must arm the player ${BULLETS_FOR_WRONG} and the boss ${BULLETS_FOR_CORRECT} — a flat boss stuck at ${BULLETS_FOR_WRONG} is the "14 7" defect`);
    }
    pass(`correct -> player 14 / boss 7; wrong -> player 7 / boss 14`);

    console.log("\nThe boss duel grades answers, and the verdict — not the round — arms both sides.\n");
  } finally {
    for (const p of profiles) await drop(p).catch(() => undefined);
    await app.close();
  }
}

main().then(() => process.exit(0)).catch((cause) => {
  console.error(`\nFAILED: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});
