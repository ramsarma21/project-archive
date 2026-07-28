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
// B. ROPEWALK_STOP — the printer's bill-sticker, on the meeting-house roof.
//
// The stable id is ROPEWALK_STOP and the item ids are still BOS.MD01.ENC.ROPEWALK.*
// — they are opaque join keys the client, the grading authority and the drift
// test all key on, and the player never sees them — but the BEAT has moved. It
// used to force the guided line to dive south through the whole ropewalk shed to
// meet a dockhand; the route lane built a direct roofline connection over Hollis
// Meeting (D_SROOF_E -> the meeting-house leads -> the steeple), and this stop now
// lives ON that direct line so the detour is gone. The ropewalk shed and its
// night man (SENTRY_ROPEWALK) are untouched — the shed stays a real, optionally
// explorable space; only the mandatory beat left it.
//
// The concept is unchanged: BOS.CONCEPT.STAMP_SCOPE.v1, the reach of the Stamp
// Act across printed and legal paper. The speaker is re-cast to fit where the
// beat now happens AND to teach that reach in the module's own central exemplar:
// a printer's bill-sticker, up on the meeting-house leads by lantern to hang the
// night's notices. He is a wage-earning working man, not an ideologue — his whole
// trade IS the printed paper the Act taxes (newspapers, handbills, notices), so a
// tax on that paper is a tax on his living. The accepted family connects the
// Stamp Act's SCOPE, COST or DISRUPTION to that trade: the stamp falls on every
// sheet the printers run, so a bought stamp on each one means fewer runs, fewer
// bills to paste, dearer paper, and his wage shrinks or stops. Any plausible line
// from the Act to his livelihood passes; an abstract-rights lecture that never
// reaches the presses, or a wrong-tax answer, does not.
// ---------------------------------------------------------------------------

const BILLMAN: PerspectiveEncounter = {
  id: "ROPEWALK_STOP",
  order: 1,
  poolId: "BOS.MD01.POOL.ENC_ROPEWALK.v1",
  conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1",
  speaker: {
    role: "Printer's bill-sticker",
    watcherId: "BILLMAN_HOLLIS",
    secondaryWatcherId: null,
    affiliation: "The printers' bill-work",
    loyalty: "Loyal to no side but his own pay — the sheets, the paste, the bills that go up by dark.",
    priorities: [
      "Wages and steady work",
      "The printers who feed him sheets",
      "No trouble that shuts the presses",
    ],
    situationalHint:
      "He's a working man, not a politician. He'll stand aside if you can show the stamp lands on the printed paper his whole trade IS — the newspapers, the handbills, the notices — not if you preach him rights he can't eat.",
  },
  trigger: {
    // On the direct roofline the route lane built: the player lands on the Hollis
    // Meeting leads (HOLLIS_MEETING__ROOF, y=8.20) at the west strip around
    // D_MEETING_W (74.3, 8.2, 9) and crosses to the steeple, so the stop is on
    // the route the player walks, not off it. The bill-sticker closes from his
    // post on the same flat roof at (74.9, 8.2, 12.0), clear of the raised monitor.
    at: [74.6, 8.2, 9.4],
    // 5.0m, not 3.6m. The beat is MANDATORY — traversal.ts gates REACHED_DUEL on
    // `encountersParticipated`, so a run that never arms this stop can never
    // resolve and times out (the soft-lock M1-STATUS flagged). It therefore has
    // to catch EVERY line to the steeple, and the elm crown (the only ascent into
    // the tree) is only reachable from that steeple, so this disc gates the sole
    // path to the objective. Two lines cross this roof: the guided drop lands at
    // D_MEETING_W (0.5m in), and the ground-up buttress climb tops out at
    // E_MEETING_S (75.4, 8.2, 13.8) — 4.47m from centre — then runs to E_GAMBREL_S
    // (3.49m) or D_MEETING_ROOF (1.94m). At 3.6m the buttress branch only clipped
    // the disc by ~0.1-0.4m (E_GAMBREL_S at 3.49; the E_MEETING_S->E_GAMBREL_S
    // segment dipped to 3.22m), thin enough that a corner-cutting line or a later
    // node nudge could reopen the bypass. 5.0m puts E_MEETING_S itself inside with
    // ~0.5m of margin, so the stop arms the instant the player tops the buttress
    // onto the leads, and every route crosses it with room. Bounded ABOVE by the
    // elm: BOUGH_CROWN sits at y=8.3 (inside the 2.0m same-surface band, so the
    // XZ radius is the ONLY separator) but its nearest node is 9.0m away in XZ, so
    // 5.0m keeps 4.0m of clearance and cannot arm the roof stop from the tree.
    radiusM: 5.0,
    speakerStandoff: [74.9, 8.2, 11.0],
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
        "You're the effigy lot, aren't you. Tell me straight, why should a man who pastes bills for his bread care a damn about a stamp on a bit of paper? Make it my business.",
    },
    {
      variantId: "WHAT_STOPS",
      itemId: "BOS.MD01.ENC.ROPEWALK.WHAT_STOPS.v1",
      itemVersion: "v1",
      prompt:
        "Say the stamp comes in and the printers won't buy it. What of it stops — here, on this wall, in the sheets I hang? Name me the thing it actually costs me.",
    },
    {
      variantId: "WHOSE_TROUBLE",
      itemId: "BOS.MD01.ENC.ROPEWALK.WHOSE_TROUBLE.v1",
      itemVersion: "v1",
      prompt:
        "Deeds and lawyers' writs — that's the merchants' quarrel and the courts', not mine. What has a tax on their paper got to do with the bills I paste and the wage I take home?",
    },
  ],
};

/** The two encounters, in route order. */
export const M1_ENCOUNTERS: readonly PerspectiveEncounter[] = [SHAMBLES, BILLMAN];

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
