// The first-answer ledger for boss duel verdicts.
//
// WHAT WAS BROKEN. The duel route minted a fresh verdict on every POST for a
// {profileId, duelId, round}. A student could submit an answer, read the verdict,
// and submit again with a better one — the round re-graded, and the last verdict
// won. Combined with the route trusting a client-supplied itemId, a round was not
// an exam question so much as a text box you could keep retyping until it said
// CORRECT.
//
// WHAT THIS FIXES. The first verdict minted for a {profileId, duelId, round} is the
// only verdict that key will ever have. A repeat submission — a changed answer, a
// double-fire, a reload — returns the EXACT first stored envelope and receipt and
// never reaches the classifier again. The receipt is stored beside the envelope so
// the repeat carries the same proof the first did.
//
// CONCURRENCY, TWO LAYERS. Across instances and restarts the database unique key is
// the authority: two API tasks racing the same key both try to insert, one wins,
// the loser reads back the winner's row and returns it. Within one instance a keyed
// gate coalesces concurrent submissions so the classifier is called once rather than
// once per racing request — an optimisation, never the correctness boundary, which
// is why the gate is best-effort and the unique key is not.
//
// WHAT IS NOT STORED. No answer text, ever — the same rule the whole mode is built
// around. Only the server-selected item id, the five verdict-envelope fields, the
// receipt, and the provenance the response headers need.

import type { VerdictEnvelope } from "@pa/grading";
import { query } from "../db.js";

/** Exactly what a repeat submission must be able to return, byte for byte. */
export interface StoredDuelVerdict {
  /** The five keys @pa/duel's parser accepts. `itemId` is the server-selected item. */
  readonly envelope: VerdictEnvelope;
  /** The HMAC the first mint produced. A repeat carries the same proof. */
  readonly receipt: string;
  /** Provenance for the response headers; never derived from, never on the body. */
  readonly gradingPath: string;
  readonly gradingLatencyMs: number;
  readonly fallbackDiagnosis: string | null;
  /**
   * The Codex card ids the FIRST answer placed as evidence, as they were graded.
   *
   * Recorded so the round is deterministic to replay and a second submission cannot
   * change the cards: a repeat returns this selection with the verdict it produced.
   * Card ids only — never the student's words, never which cards were relevant.
   */
  readonly selectedCardIds: readonly string[];
}

export interface DuelVerdictKey {
  readonly profileId: string;
  readonly duelId: string;
  readonly round: number;
}

export interface DuelVerdictResolution {
  readonly record: StoredDuelVerdict;
  /** True only for the caller whose grade actually became the stored row. */
  readonly firstMinted: boolean;
}

export interface DuelVerdictStore {
  /**
   * Return the stored verdict for this key, or mint one with `grade` and persist it.
   *
   * `grade` is called at most once per key that reaches an empty store: a key that
   * already has a row never grades again, and concurrent callers on one instance
   * share a single grade. The returned record is authoritative — a losing racer
   * gets the winner's row, not its own.
   */
  resolve(
    key: DuelVerdictKey,
    grade: () => Promise<StoredDuelVerdict>,
  ): Promise<DuelVerdictResolution>;
}

function keyString(key: DuelVerdictKey): string {
  return `${key.profileId}\u0000${key.duelId}\u0000${key.round}`;
}

/**
 * A per-key gate that coalesces concurrent resolutions on ONE instance.
 *
 * Best-effort by design: it exists only to avoid a duplicate classifier call when
 * two requests for the same round arrive together. Correctness — that a key has one
 * verdict forever — is the store's own (the DB unique key, or the memory map), and
 * holds with or without this.
 */
function createKeyedGate() {
  const inFlight = new Map<string, Promise<DuelVerdictResolution>>();
  return function gate(
    key: DuelVerdictKey,
    run: () => Promise<DuelVerdictResolution>,
  ): Promise<DuelVerdictResolution> {
    const id = keyString(key);
    const existing = inFlight.get(id);
    if (existing) return existing;
    const started = run().finally(() => inFlight.delete(id));
    inFlight.set(id, started);
    return started;
  };
}

/**
 * The in-memory store. Used by route tests, and the reference for the concurrency
 * contract the Postgres store must also satisfy: first write wins, a racer returns
 * the winner, and a stored key never grades again.
 */
export function inMemoryDuelVerdictStore(): DuelVerdictStore {
  const rows = new Map<string, StoredDuelVerdict>();
  const gate = createKeyedGate();
  return {
    resolve(key, grade) {
      return gate(key, async () => {
        const id = keyString(key);
        const existing = rows.get(id);
        if (existing) return { record: existing, firstMinted: false };
        const minted = await grade();
        // Re-check after the awaited grade: a racer without the gate (a different
        // process, in the real store) could have inserted meanwhile.
        const raced = rows.get(id);
        if (raced) return { record: raced, firstMinted: false };
        rows.set(id, minted);
        return { record: minted, firstMinted: true };
      });
    },
  };
}

interface DuelVerdictRow {
  kind: string;
  item_id: string;
  item_version: string;
  source: string;
  response_ref: string | null;
  receipt: string;
  grading_path: string;
  grading_latency_ms: number;
  fallback_diagnosis: string | null;
  selected_card_ids: string[] | null;
}

function fromRow(row: DuelVerdictRow): StoredDuelVerdict {
  return {
    envelope: {
      kind: row.kind as VerdictEnvelope["kind"],
      itemId: row.item_id,
      itemVersion: row.item_version,
      source: row.source as VerdictEnvelope["source"],
      responseRef: row.response_ref,
    },
    receipt: row.receipt,
    gradingPath: row.grading_path,
    gradingLatencyMs: row.grading_latency_ms,
    fallbackDiagnosis: row.fallback_diagnosis,
    // A pre-evidence row (migration default) reads back as no evidence recorded.
    selectedCardIds: row.selected_card_ids ?? [],
  };
}

/**
 * The durable store. The unique key `(profile_id, duel_id, round_index)` is the
 * authority across instances and restarts; `on conflict do nothing` plus a read-back
 * makes a racing loser return the winner rather than a second verdict.
 */
export function postgresDuelVerdictStore(): DuelVerdictStore {
  const gate = createKeyedGate();
  const load = async (key: DuelVerdictKey): Promise<StoredDuelVerdict | null> => {
    const rows = await query<DuelVerdictRow>(
      `select kind, item_id, item_version, source, response_ref, receipt,
              grading_path, grading_latency_ms, fallback_diagnosis, selected_card_ids
         from duel_verdicts
        where profile_id=$1 and duel_id=$2 and round_index=$3`,
      [key.profileId, key.duelId, key.round],
    );
    return rows.rows[0] ? fromRow(rows.rows[0]) : null;
  };
  return {
    resolve(key, grade) {
      return gate(key, async () => {
        const existing = await load(key);
        if (existing) return { record: existing, firstMinted: false };
        const minted = await grade();
        const inserted = await query<DuelVerdictRow>(
          `insert into duel_verdicts(
             profile_id, duel_id, round_index, kind, item_id, item_version,
             source, response_ref, receipt, grading_path, grading_latency_ms,
             fallback_diagnosis, selected_card_ids)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           on conflict (profile_id, duel_id, round_index) do nothing
           returning kind, item_id, item_version, source, response_ref, receipt,
                     grading_path, grading_latency_ms, fallback_diagnosis, selected_card_ids`,
          [
            key.profileId,
            key.duelId,
            key.round,
            minted.envelope.kind,
            minted.envelope.itemId,
            minted.envelope.itemVersion,
            minted.envelope.source,
            minted.envelope.responseRef,
            minted.receipt,
            minted.gradingPath,
            Math.round(minted.gradingLatencyMs),
            minted.fallbackDiagnosis,
            [...minted.selectedCardIds],
          ],
        );
        if (inserted.rows[0]) return { record: fromRow(inserted.rows[0]), firstMinted: true };
        // Another instance won the race between our load and our insert. Its row is
        // the authority; read it back and return the winner's verdict.
        const winner = await load(key);
        if (!winner) throw new Error("duel verdict insert conflicted but no row is present");
        return { record: winner, firstMinted: false };
      });
    },
  };
}
