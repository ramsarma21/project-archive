// The formative retrieval ledger — the store behind `concept_retrieval` (012).
//
// WHAT IT IS FOR. `concept_mastery` records the SUMMATIVE claim ("mastered at 100%
// on the chapter capstone"); this records the FORMATIVE one ("was asked this
// concept, in a gunfight or at a stop, and here is how it went"). The owner's
// framing is that the duel now carries the chapter's retrieval breadth, so its
// per-round verdicts are the primary learning evidence — and the audience is a
// teacher report, not a gate. A gate wants a boolean; a report wants enough to
// answer a human: which concepts has this student met, how often, how are they
// trending, what are they consistently missing, and when did they last see it.
//
// IT MOVES NO GATE. Nothing here writes `concept_mastery`, touches PvP card
// legality, or is read by any authority. Formative retrieval deliberately does NOT
// raise mastery: mastery gates PvP card access (ASSESSMENT_PASSED), so letting a
// fight win move it would unlock cards by grinding duels — the back door the owner
// asked to keep shut. Keeping the gate on the assessment is exactly what lets this
// record freely.
//
// SERVER-MINTED ONLY. A row is written at grade time from the SERVER-SELECTED
// item's concept and the SERVER-minted verdict. The wire already strips
// `correct`/`verdict`/`kind` from a submission, so a client cannot assert what it
// learned. The idempotency key `(profileId, duelId, roundIndex)` mirrors
// `duel_verdicts` 1:1, so the "first answer is final" dedup carries here: a repeat
// submission of the same round re-grades nothing and records nothing new.
//
// REPEATS AND SPACING. When the bank is exhausted the duel recycles items and marks
// the repeat (`@pa/duel`'s `askQuestion`). That marker is consumed here as
// `recycled`/`appearance`, and `seenAt`/`attemptId` carry the WHEN, so a report can
// tell one match's reuse from evidence spread across sessions.

import { pool, transaction } from "../db.js";

/** One graded question, as the server minted it. Written at grade time. */
export interface RetrievalEvent {
  readonly profileId: string;
  readonly chapterId: string;
  readonly missionId: string;
  readonly attemptId: string;
  readonly conceptId: string;
  /** The server-selected item id. An id, never answer text. */
  readonly itemId: string;
  readonly source: "DUEL" | "ENCOUNTER";
  /** The canonical verdict id this mirrors in `duel_verdicts`. */
  readonly duelId: string;
  readonly roundIndex: number;
  /** The server-minted verdict. Only meaningful when `graded` is true. */
  readonly correct: boolean;
  /** False when the verdict was the generous infrastructure grant, not evidence. */
  readonly graded: boolean;
  /** The duel lane's repeat marker: already asked earlier in this same match. */
  readonly recycled: boolean;
  /** 1-based count of how many times this item was asked in this match. */
  readonly appearance: number;
  readonly seenAt: string;
}

/**
 * The per-concept roll-up a report reads. Deliberately richer than a boolean: it
 * carries the counts, the correctness (over GRADED asks only, so an outage cannot
 * inflate it), the spread of time and attempts (spacing), and how much of the
 * evidence was a recycled repeat rather than a fresh ask.
 */
export interface ConceptRetrievalSummary {
  readonly conceptId: string;
  /** Every ask, including recycled repeats and ungraded (granted) rounds. */
  readonly asked: number;
  /** Asks that were genuinely graded (source ≠ the infrastructure grant). */
  readonly askedGraded: number;
  /** Correct AND graded. The honest numerator; `askedGraded` is the denominator. */
  readonly correct: number;
  /** Asks whose item had already been seen in the same match (weaker evidence). */
  readonly recycledAsks: number;
  /** Distinct server items this concept was asked through. */
  readonly distinctItems: number;
  /** Distinct mission attempts (matches) that contributed — a spacing signal. */
  readonly distinctAttempts: number;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

export interface ClearMissionResult {
  readonly retrievalRowsCleared: number;
  /** Verdict rows removed so a replay re-grades rather than returning the old ones. */
  readonly verdictsCleared: number;
}

export interface ConceptRetrievalStore {
  /**
   * Record one graded question. Idempotent on `(profileId, duelId, roundIndex)` —
   * a re-recorded round is a no-op, so the "first answer is final" property holds
   * here exactly as it does in the verdict store.
   */
  record(event: RetrievalEvent): Promise<void>;
  /** Every concept a profile has been asked in one chapter, rolled up for a report. */
  byChapter(profileId: string, chapterId: string): Promise<ConceptRetrievalSummary[]>;
  /**
   * Clear one mission's retrieval history AND the duel verdicts that produced it,
   * so a dev-reset replay genuinely re-grades and re-records rather than replaying
   * the prior run's stored verdicts. Scoped by (profile, chapter, mission).
   */
  clearMission(
    profileId: string,
    chapterId: string,
    missionId: string,
  ): Promise<ClearMissionResult>;
}

// ---------------------------------------------------------------------------
// In-memory double. Models the Postgres store field for field so a unit test
// drives the same record/read/clear contract without a database.
// ---------------------------------------------------------------------------

function key(event: Pick<RetrievalEvent, "profileId" | "duelId" | "roundIndex">): string {
  return `${event.profileId}\u0000${event.duelId}\u0000${event.roundIndex}`;
}

export function inMemoryConceptRetrievalStore(): ConceptRetrievalStore & {
  /** Test-only: the raw rows, so a test can assert exactly what was written. */
  rows(): RetrievalEvent[];
} {
  const rows = new Map<string, RetrievalEvent>();
  return {
    rows: () => [...rows.values()],
    async record(event) {
      const id = key(event);
      // First write wins, exactly as the Postgres `on conflict do nothing`.
      if (rows.has(id)) return;
      rows.set(id, { ...event });
    },
    async byChapter(profileId, chapterId) {
      const scoped = [...rows.values()].filter(
        (row) => row.profileId === profileId && row.chapterId === chapterId,
      );
      const byConcept = new Map<string, RetrievalEvent[]>();
      for (const row of scoped) {
        const list = byConcept.get(row.conceptId);
        if (list) list.push(row);
        else byConcept.set(row.conceptId, [row]);
      }
      return [...byConcept.entries()]
        .map(([conceptId, events]): ConceptRetrievalSummary => {
          const graded = events.filter((event) => event.graded);
          const times = events.map((event) => event.seenAt).sort();
          return {
            conceptId,
            asked: events.length,
            askedGraded: graded.length,
            correct: graded.filter((event) => event.correct).length,
            recycledAsks: events.filter((event) => event.recycled).length,
            distinctItems: new Set(events.map((event) => event.itemId)).size,
            distinctAttempts: new Set(events.map((event) => event.attemptId)).size,
            firstSeenAt: times[0]!,
            lastSeenAt: times[times.length - 1]!,
          };
        })
        .sort((a, b) => a.conceptId.localeCompare(b.conceptId));
    },
    async clearMission(profileId, chapterId, missionId) {
      let cleared = 0;
      for (const [id, row] of rows) {
        if (
          row.profileId === profileId &&
          row.chapterId === chapterId &&
          row.missionId === missionId
        ) {
          rows.delete(id);
          cleared += 1;
        }
      }
      // The in-memory double models only the retrieval table, not duel_verdicts;
      // the verdict clear is exercised in the Postgres suite.
      return { retrievalRowsCleared: cleared, verdictsCleared: 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// The durable store.
// ---------------------------------------------------------------------------

interface SummaryRow {
  concept_id: string;
  asked: number;
  asked_graded: number;
  correct: number;
  recycled_asks: number;
  distinct_items: number;
  distinct_attempts: number;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export function postgresConceptRetrievalStore(): ConceptRetrievalStore {
  return {
    async record(event) {
      await pool.query(
        `insert into concept_retrieval(
           profile_id, chapter_id, mission_id, attempt_id, concept_id, item_id,
           source, duel_id, round_index, correct, graded, recycled, appearance, seen_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (profile_id, duel_id, round_index) do nothing`,
        [
          event.profileId,
          event.chapterId,
          event.missionId,
          event.attemptId,
          event.conceptId,
          event.itemId,
          event.source,
          event.duelId,
          event.roundIndex,
          event.correct,
          event.graded,
          event.recycled,
          event.appearance,
          event.seenAt,
        ] as never[],
      );
    },
    async byChapter(profileId, chapterId) {
      const result = await pool.query<SummaryRow>(
        `select concept_id,
                count(*)::int as asked,
                count(*) filter (where graded)::int as asked_graded,
                count(*) filter (where graded and correct)::int as correct,
                count(*) filter (where recycled)::int as recycled_asks,
                count(distinct item_id)::int as distinct_items,
                count(distinct attempt_id)::int as distinct_attempts,
                min(seen_at) as first_seen_at,
                max(seen_at) as last_seen_at
           from concept_retrieval
          where profile_id=$1 and chapter_id=$2
          group by concept_id
          order by concept_id`,
        [profileId, chapterId] as never[],
      );
      return result.rows.map((row) => ({
        conceptId: row.concept_id,
        asked: row.asked,
        askedGraded: row.asked_graded,
        correct: row.correct,
        recycledAsks: row.recycled_asks,
        distinctItems: row.distinct_items,
        distinctAttempts: row.distinct_attempts,
        firstSeenAt: iso(row.first_seen_at),
        lastSeenAt: iso(row.last_seen_at),
      }));
    },
    async clearMission(profileId, chapterId, missionId) {
      // One transaction: the verdicts that produced this mission's retrieval rows,
      // then the retrieval rows themselves. The retrieval ledger IS the map from a
      // mission to its `(duel_id, round_index)` verdicts, so no mission-specific
      // duel-id shape has to be reconstructed here.
      return transaction(async (client) => {
        const verdicts = await client.query(
          `delete from duel_verdicts dv
             using concept_retrieval cr
            where dv.profile_id = cr.profile_id
              and dv.duel_id = cr.duel_id
              and dv.round_index = cr.round_index
              and cr.profile_id=$1 and cr.chapter_id=$2 and cr.mission_id=$3`,
          [profileId, chapterId, missionId] as never[],
        );
        const retrieval = await client.query(
          `delete from concept_retrieval
            where profile_id=$1 and chapter_id=$2 and mission_id=$3`,
          [profileId, chapterId, missionId] as never[],
        );
        return {
          retrievalRowsCleared: retrieval.rowCount ?? 0,
          verdictsCleared: verdicts.rowCount ?? 0,
        };
      });
    },
  };
}
