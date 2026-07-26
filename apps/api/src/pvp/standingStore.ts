// Where a leaderboard survives a restart.
//
// The standing table is the one PvP object that has to be durable, and the reason is
// not symmetry with the rest of the schema. A lobby lost to a restart costs somebody a
// six-character code. A live match lost to a restart costs one fight. A leaderboard
// lost to a restart costs a class its standing — and standing is the only thing PvP
// accumulates, so losing it silently converts the mode into something students stop
// believing.
//
// THE DATABASE IS THE SOURCE OF TRUTH HERE, NOT A CACHE OF IT. There is deliberately
// no in-memory copy of a standing row. A cache would have to be correct across a
// restart, a second API task and a hand-edited row, and the failure mode of getting it
// wrong is not a stale read — it is applying a match delta to a base value that is out
// of date, which silently rewrites a student's points. Every read below goes to
// Postgres and every write is a transaction, which costs one round trip per lobby and
// buys the property that nothing can clobber a number it did not first read.
//
// The arithmetic is not here. @pa/pvp's `applyMatchResult` owns what a result is worth
// and this file only persists what it returns, which is why the zero-sum rule, the
// floor and the upset bonus have exactly one definition.

import {
  applyMatchResult,
  generateHandle,
  leaderboard,
  newStandingRecord,
  parseHandle,
  type DuelSide,
  type LeaderboardRow,
  type PvpMatchResult,
  type StandingRecord,
} from "@pa/pvp";
import { query, transaction } from "../db.js";

/** Rank everybody starts at while the unlock gate is open. Nobody has earned a Level. */
const STARTING_RANK = 1;

/**
 * How many handles to try before giving up.
 *
 * `generateHandle` is deterministic per profile out of a 2.3-million combination
 * space, so a collision is rare — and a rare failure that 500s a student's first duel
 * is still a failure. The generator takes an attempt number precisely so a reroll is
 * available, and `parseHandle` is applied to our own output so the only strings that
 * can reach a public board are ones this system could have produced.
 */
const HANDLE_ATTEMPTS = 8;

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

export interface BankedVerdict {
  readonly side: DuelSide;
  readonly roundIndex: number;
  readonly itemId: string;
  readonly itemVersion: string;
  readonly kind: "CORRECT" | "WRONG";
  readonly source: string;
  readonly responseRef: string | null;
}

export interface BankMatchInput {
  readonly result: PvpMatchResult;
  readonly code: string;
  readonly seed: number;
  readonly startedAtMs: number;
  readonly participants: {
    readonly A: { readonly profileId: string; readonly handle: string; readonly rank: number };
    readonly B: { readonly profileId: string; readonly handle: string; readonly rank: number };
  };
  /** Verdict labels only. No answer text crosses this boundary, by design. */
  readonly verdicts: readonly BankedVerdict[];
}

export interface PvpStandingStore {
  /** This profile's standing, created on first sight. Its handle is generated. */
  ensure(profileId: string): Promise<StandingRecord>;
  board(limit?: number): Promise<readonly LeaderboardRow[]>;
  /**
   * Bank a decided match and move both standings, exactly once.
   *
   * Returns true only for the call that actually banked it. The uniqueness of
   * `pvp_match.match_id` is what makes that true across polls, across processes and
   * across a restart — `settle` runs on every read, and both clients keep polling a
   * finished match to find out how it ended.
   */
  bank(input: BankMatchInput): Promise<boolean>;
}

interface StandingRow {
  profile_id: string;
  handle: string;
  rank: number;
  points: number;
  wins: number;
  losses: number;
  draws: number;
}

function toRecord(row: StandingRow): StandingRecord {
  return {
    profileId: row.profile_id,
    handle: row.handle,
    rank: row.rank,
    points: row.points,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
  };
}

const SELECT_COLUMNS =
  "profile_id, handle, rank, points, wins, losses, draws";

function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export function postgresPvpStandingStore(): PvpStandingStore {
  const read = async (profileId: string): Promise<StandingRecord | null> => {
    const rows = await query<StandingRow>(
      `select ${SELECT_COLUMNS} from pvp_standing where profile_id=$1`,
      [profileId],
    );
    const row = rows.rows[0];
    return row ? toRecord(row) : null;
  };

  return {
    async ensure(profileId: string): Promise<StandingRecord> {
      const existing = await read(profileId);
      if (existing) return existing;

      for (let attempt = 0; attempt < HANDLE_ATTEMPTS; attempt++) {
        const generated = generateHandle(profileId, attempt);
        const checked = parseHandle(generated.handle);
        if (!checked.ok) continue;
        // The starting values come from @pa/pvp rather than from the column defaults,
        // so "where a profile starts" has one definition and the defaults are only a
        // backstop for a row written by hand.
        const fresh = newStandingRecord(profileId, checked.handle, STARTING_RANK);
        try {
          const inserted = await query<StandingRow>(
            `insert into pvp_standing(profile_id, handle, rank, points, wins, losses, draws)
             values ($1,$2,$3,$4,$5,$6,$7)
             on conflict (profile_id) do nothing
             returning ${SELECT_COLUMNS}`,
            [
              profileId,
              fresh.handle,
              fresh.rank,
              fresh.points,
              fresh.wins,
              fresh.losses,
              fresh.draws,
            ],
          );
          const row = inserted.rows[0];
          if (row) return toRecord(row);
          // Another request created this profile's row between the read and the
          // insert. Theirs is as good as ours.
          const raced = await read(profileId);
          if (raced) return raced;
        } catch (cause) {
          // A handle collision, which is what the reroll exists for. Anything else is
          // not ours to swallow.
          if (!isUniqueViolation(cause)) throw cause;
        }
      }
      throw new Error(
        `could not mint a free handle for ${profileId} in ${HANDLE_ATTEMPTS} attempts`,
      );
    },

    async board(limit = 50): Promise<readonly LeaderboardRow[]> {
      const rows = await query<StandingRow>(
        `select ${SELECT_COLUMNS} from pvp_standing
         order by points desc, wins desc, handle asc
         limit $1`,
        [Math.max(0, limit)],
      );
      // Ordered in SQL for the index, then handed to @pa/pvp's own `leaderboard` so the
      // tie-break, the limit and — most importantly — the DROPPING OF profile_id are
      // decided in exactly one place. A board row has no field for an identifier.
      return leaderboard(rows.rows.map(toRecord), limit);
    },

    async bank(input: BankMatchInput): Promise<boolean> {
      const { result, participants } = input;
      return transaction(async (client) => {
        const claimed = await client.query(
          `insert into pvp_match(
             match_id, code, seed, profile_a, profile_b,
             winner_side, reason, tiebreak, health_a, health_b,
             needs_review, started_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           on conflict (match_id) do nothing`,
          [
            result.matchId,
            input.code,
            input.seed,
            participants.A.profileId,
            participants.B.profileId,
            result.winner,
            result.reason,
            result.tiebreak,
            Math.round(result.healthA),
            Math.round(result.healthB),
            result.needsReview,
            new Date(input.startedAtMs).toISOString(),
          ],
        );
        // Somebody already banked this one. Every poll of a finished match arrives
        // here, so this is the common case rather than the exceptional one.
        if (claimed.rowCount === 0) return false;

        // Locked in the same transaction as the claim, so two simultaneous polls
        // cannot both read 100 and both write 120.
        const held = await client.query<StandingRow>(
          `select ${SELECT_COLUMNS} from pvp_standing
           where profile_id = any($1::uuid[]) for update`,
          [[participants.A.profileId, participants.B.profileId]],
        );
        const byProfile = new Map(held.rows.map((row) => [row.profile_id, toRecord(row)]));
        const recordFor = (side: DuelSide): StandingRecord =>
          byProfile.get(participants[side].profileId) ??
          newStandingRecord(
            participants[side].profileId,
            participants[side].handle,
            participants[side].rank,
          );

        const update = applyMatchResult(result, {
          A: recordFor("A"),
          B: recordFor("B"),
        });
        for (const record of update.records) {
          await client.query(
            `insert into pvp_standing(profile_id, handle, rank, points, wins, losses, draws)
             values ($1,$2,$3,$4,$5,$6,$7)
             on conflict (profile_id) do update set
               rank = excluded.rank,
               points = excluded.points,
               wins = excluded.wins,
               losses = excluded.losses,
               draws = excluded.draws,
               updated_at = now()`,
            [
              record.profileId,
              record.handle,
              record.rank,
              record.points,
              record.wins,
              record.losses,
              record.draws,
            ],
          );
        }

        for (const verdict of input.verdicts) {
          await client.query(
            `insert into pvp_match_verdict(
               match_id, side, round_index, item_id, item_version, kind, source, response_ref
             ) values ($1,$2,$3,$4,$5,$6,$7,$8)
             on conflict (match_id, side, round_index) do nothing`,
            [
              result.matchId,
              verdict.side,
              verdict.roundIndex,
              verdict.itemId,
              verdict.itemVersion,
              verdict.kind,
              verdict.source,
              verdict.responseRef,
            ],
          );
        }
        return true;
      });
    },
  };
}
