// Determinism: the seed derivation and the one shuffle.
//
// The capstone is fully event-sourced and exactly replayable — unlike a mission,
// which commits only its outcome. That means every non-obvious choice the engine
// makes has to be reconstructable from committed data, and the only such choice
// is which of a concept's interchangeable items got served. So there is exactly
// one source of variation in this package, it is a stored seed, and this is the
// only file that produces randomness.
//
// THE RNG IS NOT NEW. `fieldRandom` and `projectFieldSeed` come from
// @pa/engine-world's headless `fieldSimulation` subpath, which is the same seeded
// generator the mission simulation and the duel use. This is the only file in the
// package that names that dependency. Writing a second generator here would give
// the repository two definitions of "deterministic", and the assessment is the
// worst place to have the weaker one.
//
// WHY A SHUFFLE AT ALL, given "one difficulty for everyone". Because parallel
// forms and per-student difficulty are different things. Every student gets the
// same blueprint — the same concepts, the same two items per concept, drawn from
// the same reserve with no per-student scaling — but not literally the same item
// ids, so a form is not shareable across a class period. Difficulty is held
// constant by the blueprint; only the interchangeable choice within a concept
// varies.

import { fieldRandom, projectFieldSeed } from "@pa/engine-world/fieldSimulation";

/**
 * The stored seed for one attempt's form, as 32 lowercase hex characters.
 *
 * Thirty-two characters because that is what contracts' `SeedHex` accepts, and
 * `projectFieldSeed` yields 32 bits, so four salted projections are concatenated
 * rather than one padded.
 */
export type FormSeedHex = string;

const SEED_HEX_PATTERN = /^[0-9a-f]{32}$/;

export function isFormSeedHex(value: string): value is FormSeedHex {
  return SEED_HEX_PATTERN.test(value);
}

/**
 * Derive an attempt's form seed.
 *
 * The parts must include the attempt ordinal. A retry that re-derived the first
 * attempt's seed would shuffle the reserve identically, and while the served
 * ledger would still exclude the items already used, the retry's item order
 * would be a deterministic function of the first attempt's — which is the exact
 * bug contracts' `MissionAttemptSchema` records having shipped once already,
 * where a missing stored ordinal made every retry replay attempt zero.
 */
export function deriveFormSeedHex(
  parts: readonly (string | number)[],
): FormSeedHex {
  let hex = "";
  for (let salt = 0; salt < 4; salt += 1) {
    const projected = projectFieldSeed([...parts, `s${salt}`]);
    hex += projected.toString(16).padStart(8, "0");
  }
  return hex;
}

/** Read a stored seed back into the 32-bit integers the generator takes. */
export function seedWords(seedHex: FormSeedHex): readonly number[] {
  const words: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    words.push(Number.parseInt(seedHex.slice(i * 8, i * 8 + 8), 16) >>> 0);
  }
  return words;
}

/**
 * A per-concept substream, so the order chosen for one concept cannot depend on
 * how many items another concept happened to draw. Without this, appending an
 * item to one concept's reserve would change every later concept's selection.
 */
export function conceptStreamSeed(
  seedHex: FormSeedHex,
  conceptId: string,
): number {
  const words = seedWords(seedHex);
  return projectFieldSeed([...words.map(String), conceptId]);
}

/**
 * Deterministic Fisher-Yates. Same seed and same input always give the same
 * output; the input is not mutated.
 */
export function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(fieldRandom(seed, i) * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
