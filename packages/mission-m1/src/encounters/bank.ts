// The M1 perspective encounters — the CLIENT-SAFE half.
//
// M1 has always been a silent run: the traversal runtime has no question
// surface at all (see apps/web/src/mission/traversal.ts). These two encounters
// are the thing that changes that, and they are NOT trivia. Each is a watcher
// who stops the player on the route and asks them to argue a case that THIS
// watcher — with his own loyalty, job and priorities — would actually credit.
// A right answer is not "the true fact"; it is a justification the speaker in
// front of you would accept, which is a different and harder thing and the whole
// point of grounding a question in a perspective.
//
// WHAT LIVES HERE AND WHAT DOES NOT. This module is imported by the browser
// bundle (apps/web depends on @pa/mission-m1), so it carries ONLY what is safe
// to ship to a client: the speaker's role and loyalty, his priorities, the
// situational hint, and the prompt the player reads. The reference answer, the
// required ideas, the accept/reject banks and the rubric live server-side in
// @pa/grading's encounter bank and never cross the wire — a client that had the
// rubric could grade itself. `apps/api/test/encounter-authority.test.ts` is the
// drift test that proves the identities and prompts here match that bank exactly.
//
// The identities (`itemId`) are the join. The canonical selection helper in
// ./select.ts picks one variant per encounter from the durable attempt seed and
// ordinal, and BOTH the client (to draw the prompt) and the API (to grade) run
// that same helper over these same ids, so the server grades the item the round
// is actually asking rather than one the client claims.

import type { Vec3Tuple } from "../types.js";

export type EncounterId = "SHAMBLES_STOP" | "ROPEWALK_STOP";

/**
 * The speaker's stance, shown to the player in the overlay. This is the
 * "explicit hint" the design asks for: the player is told, in plain words, whose
 * side the man is on and what he cares about, because the answer that works is
 * the one that speaks to those cares.
 */
export interface EncounterSpeaker {
  /** In the level's own words. Also a caption/dev-overlay label. */
  readonly role: string;
  /** The imported watcher this speaker IS. Must match a PatrolSpec id. */
  readonly watcherId: string;
  /** A second body that closes in, or null. Matches a PatrolSpec id when set. */
  readonly secondaryWatcherId: string | null;
  /** Whose authority he answers to, one phrase. */
  readonly affiliation: string;
  /** His loyalty, one line the overlay prints under the role. */
  readonly loyalty: string;
  /** 2-3 priority chips. The values an accepted answer has to speak to. */
  readonly priorities: readonly string[];
  /** What he will let the player pass for, stated so it is never a guessing game. */
  readonly situationalHint: string;
}

/**
 * Where a stop happens, and the standoff the actors walk to.
 *
 * Positions are the level's data, tuned against the real route geometry; the
 * deterministic approach in ./machine.ts walks the actors here through the
 * collision world with a swept capsule, so nobody teleports or clips.
 */
export interface EncounterTrigger {
  /** The player must be grounded within `radiusM` of this to arm the stop. */
  readonly at: Vec3Tuple;
  readonly radiusM: number;
  /** Where the speaker stops, at conversational distance, facing the player. */
  readonly speakerStandoff: Vec3Tuple;
  /** Where a secondary guard stops, or null when there is only a speaker. */
  readonly secondaryStandoff: Vec3Tuple | null;
  /**
   * True for the opening stop, which may arm only after a GROUNDED landing near
   * the drop — not by falling past it, and not by spawning in the air above it.
   * The second stop is on the interior route and arms on grounded arrival.
   */
  readonly requiresGroundedApproach: boolean;
}

/** One authored variant: its identity and the prompt the player reads. */
export interface EncounterVariantRef {
  /** Short local id: `WHY_PAY`. */
  readonly variantId: string;
  /** The full versioned id the grading bank keys on. */
  readonly itemId: string;
  readonly itemVersion: string;
  /**
   * The open-ended question, verbatim. Shown to the player AND graded as the
   * item's `ask`; the drift test asserts the two are the same string.
   */
  readonly prompt: string;
}

export interface PerspectiveEncounter {
  readonly id: EncounterId;
  /** Position along the route, 0 first. The opening stop is 0. */
  readonly order: number;
  readonly poolId: string;
  readonly conceptId: string;
  readonly speaker: EncounterSpeaker;
  readonly trigger: EncounterTrigger;
  /**
   * World seconds the involved watchers are perception-suppressed for after a
   * CORRECT (or granted) answer while they return to patrol. Deterministic and
   * bounded — never permanent — so the reprieve is real and the guards come back.
   */
  readonly reprieveWorldSeconds: number;
  /** At least three deterministic variants; one is chosen per attempt. */
  readonly variants: readonly EncounterVariantRef[];
}

// ---------------------------------------------------------------------------
// A. SHAMBLES_STOP — the market-watch constable, immediately after the drop.
//
// Perspective: a Crown/Parliament man. He is not interested in whether the tax
// is fair; he is interested in whether you can give him a reason a King's officer
// would credit for the colonies paying it. The accepted family of answers is the
// Crown's own case, argued in the player's words: Parliament's sovereign
// authority over the colonies (virtual representation), and/or the colonies
// having been defended in the late war at great cost and fairly sharing that
// debt. Any one of those, plausibly stated, passes; a personal opinion, an
// insult, or a wrong-war/wrong-tax answer does not.
// ---------------------------------------------------------------------------

const SHAMBLES: PerspectiveEncounter = {
  id: "SHAMBLES_STOP",
  order: 0,
  poolId: "BOS.MD01.POOL.ENC_SHAMBLES.v1",
  conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
  speaker: {
    role: "Market-watch constable",
    watcherId: "WATCH_SHAMBLES",
    secondaryWatcherId: "SENTRY_GAOL",
    affiliation: "Crown & Parliament",
    loyalty: "Sworn to the King's peace and the lawful authority of Parliament.",
    priorities: [
      "Order in the market",
      "Obedience to the King's law",
      "Paying down the late war's debt",
    ],
    situationalHint:
      "He is a Crown man. He will wave you on only for a reason a King's officer would credit — Parliament's authority, or the colonies sharing the cost of a war fought for them — not for your opinion of the tax.",
  },
  trigger: {
    at: [16.6, 0, 0.4],
    radiusM: 3.6,
    speakerStandoff: [18.2, 0, 0.9],
    secondaryStandoff: [20.4, 0, -1.4],
    requiresGroundedApproach: true,
  },
  reprieveWorldSeconds: 10,
  variants: [
    {
      variantId: "WHY_PAY",
      itemId: "BOS.MD01.ENC.SHAMBLES.WHY_PAY.v1",
      itemVersion: "v1",
      prompt:
        "Halt there. The war's won, the French are out of Canada, and still London wants its new duties paid. Give me one reason a King's man would credit for Boston to pay them — not a mob's slogan.",
    },
    {
      variantId: "WHO_DEFENDED",
      itemId: "BOS.MD01.ENC.SHAMBLES.WHO_DEFENDED.v1",
      itemVersion: "v1",
      prompt:
        "You'll not pass shouting 'no taxes' at me. Who do you think held the frontier while you slept safe in Boston these ten years — and who should help pay for it? Answer plainly.",
    },
    {
      variantId: "BY_WHAT_RIGHT",
      itemId: "BOS.MD01.ENC.SHAMBLES.BY_WHAT_RIGHT.v1",
      itemVersion: "v1",
      prompt:
        "By what right, then, does Parliament lay a tax on Boston at all? Tell me the King's own answer to that, and I'll let you by.",
    },
  ],
};

// ---------------------------------------------------------------------------
// B. ROPEWALK_STOP — the ropewalk's night man, on the interior route.
//
// Perspective: a wage-earning dockhand, not an ideologue. He does not care about
// sovereignty; he cares about whether he works tomorrow. The accepted family
// connects the Stamp Act's SCOPE, COST or DISRUPTION to his trade: the stamped
// paper is on the ship's clearance papers, the bills of lading, the contracts,
// the newspapers and legal writs — so no stamp means no cleared cargo, no work,
// lower wages, higher prices, idle rigging. Any plausible line from the Act to
// his livelihood passes; a sovereignty lecture that never touches the docks, or
// a wrong-tax answer, does not.
// ---------------------------------------------------------------------------

const ROPEWALK: PerspectiveEncounter = {
  id: "ROPEWALK_STOP",
  order: 1,
  poolId: "BOS.MD01.POOL.ENC_ROPEWALK.v1",
  conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1",
  speaker: {
    role: "Ropewalk night man",
    watcherId: "SENTRY_ROPEWALK",
    secondaryWatcherId: null,
    affiliation: "The ropewalk's wages",
    loyalty: "Loyal to no side but his own pay — the work, the contracts, the ships.",
    priorities: [
      "Wages and steady work",
      "Ship clearances and contracts",
      "No trouble that stops the walk",
    ],
    situationalHint:
      "He's a working man, not a politician. He'll stand aside if you can show the stamped paper touches HIS trade — the clearances, the contracts, the cargo — not if you preach him rights he can't eat.",
  },
  trigger: {
    // On the required interior floor line — between D2_FLOOR_W (59.6, 21.8) and
    // the vault/slide toward D2_STAGE — so the stop is on the route the player
    // walks, not off it. The night man closes from his post at (72.6, 23.6).
    at: [61.5, 0, 19.6],
    radiusM: 4.0,
    speakerStandoff: [63.5, 0, 20.4],
    secondaryStandoff: null,
    requiresGroundedApproach: false,
  },
  reprieveWorldSeconds: 12,
  variants: [
    {
      variantId: "WHY_CARE",
      itemId: "BOS.MD01.ENC.ROPEWALK.WHY_CARE.v1",
      itemVersion: "v1",
      prompt:
        "You're the effigy lot, aren't you. Tell me straight, why should a man who lays rope for a living care a damn about a stamp on a bit of paper? Make it my business.",
    },
    {
      variantId: "WHAT_STOPS",
      itemId: "BOS.MD01.ENC.ROPEWALK.WHAT_STOPS.v1",
      itemVersion: "v1",
      prompt:
        "Say the stamp comes in and I don't buy it. What of it stops — here, in this walk, on these ships? Name me the thing it actually costs me.",
    },
    {
      variantId: "WHOSE_TROUBLE",
      itemId: "BOS.MD01.ENC.ROPEWALK.WHOSE_TROUBLE.v1",
      itemVersion: "v1",
      prompt:
        "Papers and pamphlets — that's the merchants' quarrel and the lawyers', not mine. What has any of that got to do with the rope I sell and the wage I take home?",
    },
  ],
};

/** The two encounters, in route order. */
export const M1_ENCOUNTERS: readonly PerspectiveEncounter[] = [SHAMBLES, ROPEWALK];

const BY_ID = new Map(M1_ENCOUNTERS.map((enc) => [enc.id, enc]));

export function encounterById(id: EncounterId): PerspectiveEncounter {
  const enc = BY_ID.get(id);
  if (!enc) throw new Error(`unknown encounter ${id}`);
  return enc;
}

/** Every authored variant id across both encounters. The drift test's anchor. */
export function encounterItemIds(): readonly string[] {
  return M1_ENCOUNTERS.flatMap((enc) =>
    enc.variants.map((variant) => variant.itemId),
  );
}

export function encounterVariant(
  enc: PerspectiveEncounter,
  itemId: string,
): EncounterVariantRef | undefined {
  return enc.variants.find((variant) => variant.itemId === itemId);
}

/**
 * The prompt authored for one item id, or undefined. Exported so the drift test
 * can assert the client prompt equals the grading bank's `ask` by id.
 */
export function encounterPromptFor(itemId: string): string | undefined {
  for (const enc of M1_ENCOUNTERS) {
    const variant = encounterVariant(enc, itemId);
    if (variant) return variant.prompt;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The client-visible projection.
//
// This is the ONLY shape a browser is ever handed. It carries the prompt and the
// speaker's disposition and nothing that would let a client grade itself. It is
// deliberately a flat record with a fixed key set, so the drift test can assert
// by enumeration that no rubric field ever leaks into it.
// ---------------------------------------------------------------------------

export interface EncounterClientView {
  readonly encounterId: EncounterId;
  readonly itemId: string;
  readonly speakerRole: string;
  readonly affiliation: string;
  readonly loyalty: string;
  readonly priorities: readonly string[];
  readonly hint: string;
  readonly prompt: string;
}

/** The keys a client view is allowed to carry. Asserted by the drift test. */
export const ENCOUNTER_CLIENT_VIEW_KEYS = [
  "encounterId",
  "itemId",
  "speakerRole",
  "affiliation",
  "loyalty",
  "priorities",
  "hint",
  "prompt",
] as const;

export function encounterClientView(
  enc: PerspectiveEncounter,
  variant: EncounterVariantRef,
): EncounterClientView {
  return {
    encounterId: enc.id,
    itemId: variant.itemId,
    speakerRole: enc.speaker.role,
    affiliation: enc.speaker.affiliation,
    loyalty: enc.speaker.loyalty,
    priorities: [...enc.speaker.priorities],
    hint: enc.speaker.situationalHint,
    prompt: variant.prompt,
  };
}
