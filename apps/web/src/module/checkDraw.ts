import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import { fieldRandom } from "@pa/engine-world";
import {
  checkDrawCount,
  isPooledCheck,
  type ModuleCheck,
  type ModuleCheckOption,
} from "./moduleFormat.js";

// ---------------------------------------------------------------------------
// The check drawer.
//
// The owner's complaint: "every single time you do this the questions are the
// exact same in the exact order." A pooled check answers it — each mission
// attempt draws a DIFFERENT subset of the distractor pool and shuffles the
// shown options — while keeping grading trustworthy.
//
// Two invariants make the shuffle safe, and both are the trap the owner named:
//
//   1. TRUTH IS ON THE OPTION, BY ID. The answer is `correctOption` and the pool
//      holds only distractors, so every drawn set is `{answer} ∪ (distractors)`
//      with exactly one `correct: true` — regardless of which distractors were
//      drawn or where the shuffle put them. Nothing is keyed by array position,
//      so a shuffled set still grades the right option (`isExactCheckSelection`).
//
//   2. THREE ATTEMPTS NEVER REPEAT. The draw is a deterministic function of
//      (check.id, attemptOrdinal): a per-check seeded permutation of the pool,
//      then an evenly-spaced window per ordinal. Distinct ordinals take distinct
//      contiguous windows of the permutation, and distinct windows are distinct
//      sets (a window is shorter than the pool), so attempts 1/2/3 never present
//      the same option set. The order is then shuffled by (check.id, ordinal),
//      so the answer's position also moves between sittings.
//
// Determinism is on (check.id, attemptOrdinal) rather than a wall clock or an
// attempt seed, because the module runs BEFORE the attempt is opened (it is the
// gate), so the ordinal 1/2/3 is the only per-sitting axis available — and it is
// exactly the axis the "never repeat across three attempts" guarantee needs.
// ---------------------------------------------------------------------------

/** A stable 32-bit seed from a string id (FNV-1a). */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A deterministic permutation of `0..n-1`, seeded. Decorate-sort by a per-index
 * random key: pure, allocation-cheap, and identical across platforms because
 * `fieldRandom` is the repo's pinned integer hash, not `Math.random`.
 */
function seededOrder(n: number, seed: number, salt: number): number[] {
  return Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => fieldRandom(seed, a, salt) - fieldRandom(seed, b, salt),
  );
}

/**
 * The window offset for one attempt: evenly spaced around the pool so the three
 * attempts land on well-separated, distinct windows. `floor((o-1) * P / M)` for
 * ordinals 1..M gives distinct offsets whenever `P >= M`, and the pooled-check
 * defect gate already requires `P >= drawCount > distractorsShown`.
 */
function windowOffset(attemptOrdinal: number, poolSize: number): number {
  const o = ((Math.max(1, Math.floor(attemptOrdinal)) - 1) % MAX_MISSION_ATTEMPTS);
  return Math.floor((o * poolSize) / MAX_MISSION_ATTEMPTS);
}

/**
 * The concrete options for one sitting: the answer plus a drawn subset of the
 * pool, shuffled. Returns a check whose `options` are set and whose pooled
 * fields are cleared, so everything downstream (the panel, `isExactCheckSelection`)
 * treats it as an ordinary single-select and never re-draws.
 *
 * A non-pooled (legacy fixed-list) check is returned unchanged.
 */
export function drawCheckOptions(check: ModuleCheck, attemptOrdinal: number): ModuleCheck {
  if (!isPooledCheck(check) || !check.correctOption || !check.distractorPool) {
    return check;
  }
  const pool = check.distractorPool;
  const drawCount = checkDrawCount(check);
  const distractorsShown = Math.max(1, Math.min(drawCount - 1, pool.length));
  const seed = hashId(check.id);

  // Per-check permutation of the pool (independent of the ordinal), then an
  // ordinal-specific contiguous window over it.
  const perm = seededOrder(pool.length, seed, 1);
  const offset = windowOffset(attemptOrdinal, pool.length);
  const chosen: ModuleCheckOption[] = [];
  for (let i = 0; i < distractorsShown; i += 1) {
    chosen.push(pool[perm[(offset + i) % pool.length]!]!);
  }

  // Shuffle the shown options (answer + chosen), seeded by id AND ordinal, so
  // the answer's position is not fixed and varies between sittings.
  const shown = [check.correctOption, ...chosen];
  const order = seededOrder(shown.length, seed ^ (attemptOrdinal + 1), 2);
  const options = order.map((i) => shown[i]!);

  const drawn: ModuleCheck = {
    id: check.id,
    prompt: check.prompt,
    reinforcement: check.reinforcement,
    options,
    selection: "single",
  };
  if (check.conceptId) return { ...drawn, conceptId: check.conceptId };
  return drawn;
}

/**
 * Every distractor subset the drawer can ever produce for a pooled check — one
 * per attempt ordinal 1..MAX_MISSION_ATTEMPTS — as arrays of option ids. Used by
 * tests to enumerate the reachable option sets and assert their properties.
 */
export function drawnOptionSetsForAllAttempts(check: ModuleCheck): string[][] {
  const sets: string[][] = [];
  for (let ordinal = 1; ordinal <= MAX_MISSION_ATTEMPTS; ordinal += 1) {
    const drawn = drawCheckOptions(check, ordinal);
    sets.push((drawn.options ?? []).map((option) => option.id));
  }
  return sets;
}
