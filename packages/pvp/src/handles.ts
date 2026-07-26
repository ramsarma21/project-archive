// Pseudonymous handles, and the reason they are GENERATED rather than typed.
//
// The obvious privacy requirement is that no real name reaches a leaderboard, and
// a free-text handle field with a name filter would satisfy that requirement on
// paper. It is the wrong design anyway, because a handle is not just an identifier:
//
//   - It is a PUBLIC, PERSISTENT TEXT CHANNEL between minors. Anything a student can
//     type into it, every other student in the bracket reads on the leaderboard, for
//     as long as the row stands. That is the same moderation liability that rules out
//     free-text chat, wearing a different hat, and a blocklist loses that fight
//     permanently — spelling, spacing and leetspeak are infinite and a thirteen-year-
//     old has more patience than the list does.
//   - It is a deanonymisation vector even when it is not abusive. "jmartinez7b" is a
//     roster name with a suffix.
//
// So a handle is drawn from authored word lists and nothing else. `parseHandle`
// accepts only strings this module could itself have produced, which means the
// validator is an enumeration rather than a filter: there is no string a student can
// submit that carries a message, because there is no free component to carry it.
// Rerolls give the student ownership of the outcome without giving them a text field.
//
// The lists are deliberately era-flavoured and neutral: no ranks, no titles, nothing
// that reads as a claim about a real person, nothing that combines into an insult.

import { fieldRandom, projectFieldSeed } from "@pa/duel";

/** Authored, reviewed, and the ONLY source of the first component. */
export const HANDLE_ADJECTIVES: readonly string[] = [
  "Quiet",
  "Swift",
  "Steady",
  "Clever",
  "Patient",
  "Restless",
  "Careful",
  "Bright",
  "Distant",
  "Northern",
  "Harbour",
  "Midnight",
  "Copper",
  "Iron",
  "Amber",
  "Silent",
];

/** Authored, reviewed, and the ONLY source of the second component. */
export const HANDLE_NOUNS: readonly string[] = [
  "Lantern",
  "Compass",
  "Almanac",
  "Cipher",
  "Sextant",
  "Ledger",
  "Beacon",
  "Anchor",
  "Quill",
  "Signal",
  "Courier",
  "Wharf",
  "Tide",
  "Kestrel",
  "Sparrow",
  "Ferry",
];

/** Four digits, so two students who draw the same words are still distinct. */
export const HANDLE_DISCRIMINATOR_MIN = 1000;
export const HANDLE_DISCRIMINATOR_MAX = 9999;

/**
 * How many times a student may reroll. Bounded because a handle is also a stable
 * identity on a leaderboard, and because an unbounded reroll is a slow search for a
 * combination that reads badly.
 */
export const HANDLE_REROLLS_ALLOWED = 5;

const HANDLE_PATTERN = /^([A-Z][a-z]+)([A-Z][a-z]+)-(\d{4})$/;

export interface PvpHandle {
  readonly handle: string;
  /** Which reroll produced it. 0 is the handle a profile is first given. */
  readonly attempt: number;
}

/**
 * Deterministic from the profile's own seed material, so the same profile is offered
 * the same sequence of handles on every device and after any reload. Uses the shared
 * seeded RNG rather than a local one — see the one-core rule.
 */
export function generateHandle(profileSeed: string, attempt = 0): PvpHandle {
  const seed = projectFieldSeed(["PVP_HANDLE", profileSeed]);
  const adjective =
    HANDLE_ADJECTIVES[
      Math.floor(fieldRandom(seed, attempt, 1) * HANDLE_ADJECTIVES.length) %
        HANDLE_ADJECTIVES.length
    ]!;
  const noun =
    HANDLE_NOUNS[
      Math.floor(fieldRandom(seed, attempt, 2) * HANDLE_NOUNS.length) %
        HANDLE_NOUNS.length
    ]!;
  const span = HANDLE_DISCRIMINATOR_MAX - HANDLE_DISCRIMINATOR_MIN + 1;
  const discriminator =
    HANDLE_DISCRIMINATOR_MIN +
    (Math.floor(fieldRandom(seed, attempt, 3) * span) % span);
  return { handle: `${adjective}${noun}-${discriminator}`, attempt };
}

export type HandleRejection =
  | "NOT_A_STRING"
  | "MALFORMED"
  | "UNKNOWN_ADJECTIVE"
  | "UNKNOWN_NOUN"
  | "DISCRIMINATOR_OUT_OF_RANGE";

export type HandleParseResult =
  | { readonly ok: true; readonly handle: string }
  | { readonly ok: false; readonly reason: HandleRejection };

/**
 * Accepts only what this module could have generated. Every component is checked
 * against its list, so "handle validation" is a closed enumeration and not a filter
 * that has to anticipate what a student might try.
 */
export function parseHandle(input: unknown): HandleParseResult {
  if (typeof input !== "string") return { ok: false, reason: "NOT_A_STRING" };
  const match = HANDLE_PATTERN.exec(input);
  if (!match) return { ok: false, reason: "MALFORMED" };
  const [, adjective, noun, digits] = match;
  if (!HANDLE_ADJECTIVES.includes(adjective!)) {
    return { ok: false, reason: "UNKNOWN_ADJECTIVE" };
  }
  if (!HANDLE_NOUNS.includes(noun!)) {
    return { ok: false, reason: "UNKNOWN_NOUN" };
  }
  const discriminator = Number(digits);
  if (
    discriminator < HANDLE_DISCRIMINATOR_MIN ||
    discriminator > HANDLE_DISCRIMINATOR_MAX
  ) {
    return { ok: false, reason: "DISCRIMINATOR_OUT_OF_RANGE" };
  }
  return { ok: true, handle: input };
}

/** Total handles available, for collision reasoning. */
export const HANDLE_SPACE_SIZE =
  HANDLE_ADJECTIVES.length *
  HANDLE_NOUNS.length *
  (HANDLE_DISCRIMINATOR_MAX - HANDLE_DISCRIMINATOR_MIN + 1);
