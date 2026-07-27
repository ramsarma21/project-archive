// The canonical encounter variant selection — the ONE place both the client and
// the grading authority compute which variant a stop asks.
//
// This is the same discipline duelBrief.ts uses for the boss duel and for the
// same reason: if the client picked the variant and told the server, a client
// could claim an easier one, or claim it answered a variant it never saw. So the
// choice is a pure function of the DURABLE attempt facts — the stored 128-bit
// seed hex and the attempt ordinal — computed identically on both sides. The
// server never trusts a client's claim of which item it is; it recomputes it.
//
// TWO PROPERTIES, BOTH REQUIRED BY THE SLATE. The same attempt reproduces the
// same variant exactly (the seed and ordinal are the whole input, and
// `projectFieldSeed`/`fieldRandom` are pure). Different attempts vary: the seed
// rotates which variant an ordinal lands on across players, and the ordinal
// rotates it across a single player's three attempts — so with three authored
// variants a player's three attempts see three DIFFERENT variants, which is the
// "no repeats where content depth allows" the gate asks for.

import { fieldRandom, projectFieldSeed } from "@pa/duel";
import {
  M1_ENCOUNTERS,
  encounterById,
  type EncounterId,
  type EncounterVariantRef,
  type PerspectiveEncounter,
} from "./bank.js";

/**
 * The 32-bit seed an encounter draw runs on, projected from the attempt's hex.
 *
 * Its own stream (`"encounter"` salt) so it does not share draws with the duel's
 * `m1DuelSeed` or the patrol phase — two systems drawing from one stream would
 * couple in ways nobody authored.
 */
export function encounterSeed(attemptSeedHex: string): number {
  return projectFieldSeed([attemptSeedHex, "encounter"]);
}

/**
 * Which variant of one encounter this attempt asks.
 *
 * The seed picks a base offset per encounter; the ordinal walks forward from it.
 * `attemptOrdinal` is 1-based (the first attempt is 1), matching the mission
 * ticket, so attempt 1 lands on the base, attempt 2 the next, attempt 3 the
 * next — distinct while the ordinal stays under the variant count.
 */
export function selectEncounterVariant(
  enc: PerspectiveEncounter,
  attemptSeedHex: string,
  attemptOrdinal: number,
): EncounterVariantRef {
  const count = enc.variants.length;
  if (count === 0) throw new Error(`encounter ${enc.id} has no variants`);
  const seed = encounterSeed(attemptSeedHex);
  const salt = projectFieldSeed([enc.id]) & 0xffff;
  const base = Math.floor(fieldRandom(seed, 0, salt) * count) % count;
  const index = (base + Math.max(0, attemptOrdinal - 1)) % count;
  return enc.variants[index]!;
}

/**
 * The item id one encounter asks in a stored attempt. The server grades THIS,
 * never the client's claim; the client draws the prompt for THIS. Identical
 * output on both sides is the whole point.
 */
export function expectedEncounterItemId(input: {
  readonly encounterId: EncounterId;
  readonly attemptSeedHex: string;
  readonly attemptOrdinal: number;
}): string {
  return selectEncounterVariant(
    encounterById(input.encounterId),
    input.attemptSeedHex,
    input.attemptOrdinal,
  ).itemId;
}

/** Every encounter's chosen variant for one attempt, in route order. */
export function encounterVariantsForAttempt(
  attemptSeedHex: string,
  attemptOrdinal: number,
): Array<{ readonly encounter: PerspectiveEncounter; readonly variant: EncounterVariantRef }> {
  return M1_ENCOUNTERS.map((encounter) => ({
    encounter,
    variant: selectEncounterVariant(encounter, attemptSeedHex, attemptOrdinal),
  }));
}
