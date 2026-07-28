// dev:reset-mission — reset ONE profile's attempts for ONE mission, preserving the
// module gate. The operator-side twin of the dev-gated /v1/dev/reset-mission route.
//
// This is the productised form of the hand-run SQL a reset used to need, and it
// keeps the audit trail that made the ad-hoc version trustworthy: it prints the
// before and after state (mission_progress, the attempt rows, and the surviving
// module-gate ordinals) around the change.
//
// It reuses the progression service's own advisory-lock discipline — the Postgres
// store takes `pg_advisory_xact_lock('progression:<id>')` for the whole transaction
// — and its preserve-the-gate invariant, rather than re-implementing the delete in
// raw SQL where the gate could be wiped by accident. It refuses to run when
// NODE_ENV === "production": this erases progression and is a local testing tool.
//
// Usage:
//   pnpm dev:reset-mission --profile=<uuid|email> [--mission=<id>] [--chapter=<id>]
//
// The profile is REQUIRED (there is no safe default person to erase). Mission and
// chapter default to M1 / boston-1765. A profile given as an email is resolved
// through external_identities.

import "../config.js";
import { pool, query } from "../db.js";
import { ProgressionService } from "../progression/service.js";
import { postgresProgressionStore } from "../progression/postgresStore.js";
import {
  BOSTON_RUNTIME_CHAPTER_ID,
  M1_MISSION_ID,
  bostonProgressionContent,
} from "../progression/content.js";

interface Args {
  profile?: string;
  mission: string;
  chapter: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { mission: M1_MISSION_ID, chapter: BOSTON_RUNTIME_CHAPTER_ID };
  for (const raw of argv) {
    const match = /^--([a-zA-Z]+)=(.*)$/.exec(raw);
    if (!match) continue;
    const key = match[1];
    const value = match[2] ?? "";
    if (key === "profile") args.profile = value;
    else if (key === "mission") args.mission = value;
    else if (key === "chapter") args.chapter = value;
  }
  return args;
}

function fail(message: string): never {
  console.error(`dev:reset-mission: ${message}`);
  process.exit(1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a --profile argument (UUID or email) to a real, existing profile id. */
async function resolveProfileId(profile: string): Promise<string> {
  if (UUID_RE.test(profile)) {
    const rows = await query<{ id: string }>("select id from profiles where id=$1", [
      profile,
    ]);
    if (rows.rowCount === 0) fail(`no profile exists with id ${profile}`);
    return rows.rows[0]!.id;
  }
  // Otherwise treat it as an email and resolve through the identity table.
  const rows = await query<{ id: string; display_name: string; email: string }>(
    `select p.id, p.display_name, ei.email
     from profiles p
     join external_identities ei on ei.account_id = p.account_id
     where ei.email = $1
     order by p.created_at`,
    [profile],
  );
  if (rows.rowCount === 0) fail(`no profile found for email ${profile}`);
  if (rows.rowCount! > 1) {
    fail(
      `email ${profile} resolves to ${rows.rowCount} profiles ` +
        `(${rows.rows.map((r) => r.id).join(", ")}); pass a specific --profile=<uuid>`,
    );
  }
  return rows.rows[0]!.id;
}

interface StateSnapshot {
  missionProgress: unknown;
  attempts: unknown[];
  moduleGateOrdinals: number[];
}

async function readState(
  profileId: string,
  chapterId: string,
  missionId: string,
): Promise<StateSnapshot> {
  const prog = await query(
    `select attempts_used, outcome, awarded_xp, cleared_on_attempt, cleared_at, failed_at
     from mission_progress where profile_id=$1 and chapter_id=$2 and mission_id=$3`,
    [profileId, chapterId, missionId],
  );
  const attempts = await query(
    `select attempt_ordinal, status from mission_attempts
     where profile_id=$1 and chapter_id=$2 and mission_id=$3 order by attempt_ordinal`,
    [profileId, chapterId, missionId],
  );
  const gate = await query<{ gates_ordinal: number }>(
    `select gates_ordinal from learning_module_completions
     where profile_id=$1 and chapter_id=$2 and gates_kind='MISSION_ATTEMPT' and gates_id=$3
     order by gates_ordinal`,
    [profileId, chapterId, missionId],
  );
  return {
    missionProgress: prog.rows[0] ?? null,
    attempts: attempts.rows,
    moduleGateOrdinals: gate.rows.map((r) => r.gates_ordinal),
  };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    fail("refuses to run with NODE_ENV=production — this erases progression");
  }
  const args = parseArgs(process.argv.slice(2));
  if (!args.profile) {
    fail(
      "a --profile=<uuid|email> is required. " +
        `Mission defaults to ${M1_MISSION_ID}, chapter to ${BOSTON_RUNTIME_CHAPTER_ID}.`,
    );
  }

  const profileId = await resolveProfileId(args.profile);

  console.log(
    `\ndev:reset-mission\n  profile: ${profileId}\n  chapter: ${args.chapter}\n  mission: ${args.mission}`,
  );

  const before = await readState(profileId, args.chapter, args.mission);
  console.log("\n===== BEFORE =====");
  console.dir(before, { depth: null });

  const service = new ProgressionService(
    postgresProgressionStore(),
    bostonProgressionContent(),
  );
  const result = await service.resetMissionAttempts(profileId, {
    chapterId: args.chapter,
    missionId: args.mission,
  });
  if (!result.ok) {
    fail(`reset refused: ${result.error}`);
  }

  const after = await readState(profileId, args.chapter, args.mission);
  console.log("\n===== AFTER =====");
  console.dir(after, { depth: null });
  console.log("\n===== RESULT =====");
  console.dir(result.value, { depth: null });

  // The invariant, stated out loud so a run that silently broke it is visible.
  const gateHeld =
    before.moduleGateOrdinals.length > 0 &&
    before.moduleGateOrdinals.every((o) => after.moduleGateOrdinals.includes(o));
  console.log(
    `\nmodule gate preserved: ${gateHeld ? "YES" : "n/a or CHANGED"} ` +
      `(before=[${before.moduleGateOrdinals.join(",")}] after=[${after.moduleGateOrdinals.join(",")}])`,
  );
}

main()
  .catch((cause) => fail(cause instanceof Error ? cause.message : String(cause)))
  .finally(() => {
    void pool.end();
  });
