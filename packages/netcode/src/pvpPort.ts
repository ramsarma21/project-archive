// The single import surface onto @pa/pvp.
//
// Modelled on @pa/duel's own `engine.ts`, and for the same reason: there is one
// match authority for this game and netcode CONSUMES it rather than forking it.
// Every other module here reaches @pa/pvp through this file, so the exact extent
// of what netcode depends on is one file long and legible at a glance.
//
// That matters more than usual right now, because @pa/pvp is being built
// concurrently by another agent. Naming the dependency in one place means a change
// over there is a compile error in one place here, and it means the list of things
// netcode needs from that package is a file rather than a memory.
//
// WHAT IS DELIBERATELY NOT HERE: any of @pa/pvp's own policy. Matchmaking,
// brackets, handles, cosmetics, question pools, standing and the leaderboard are
// theirs, and netcode neither imports nor second-guesses them. What crosses this
// line is the authority as a value, the intent trust boundary, the per-side
// projection, and the disconnect grace — the four things a transport genuinely
// cannot do without.

export {
  // The authority as a pure value. Netcode adds a clock and a socket around this
  // and nothing else; every decision that matters is still made in @pa/pvp.
  advanceMatch,
  ingestIntent,
  submitVerdict,
  forfeitMatch,
  matchResult,
  snapshotsFor,
  awaitingVerdicts,
  // Silence policy, consumed rather than restated — including its rule that a
  // player thinking about an untimed question is never counted as silent, which is
  // exactly the behaviour a free-response round needs and would be very easy to
  // get wrong independently.
  silentSides,
  DISCONNECT_GRACE_MS,
  type PvpAuthority,
  type ForfeitReason,
  type PvpMatchResult,
  type PvpParticipant,
  type MatchIdentity,
  type MatchPhase,
} from "@pa/pvp";

export {
  // The trust boundary. A client sends INTENT and nothing else; this is the
  // definition of that and netcode does not widen it by one field.
  parseIntentFrame,
  acceptIntentFrame,
  toCombatIntent,
  INTENT_FRAME_KEYS,
  MAX_INTENT_LEAD_TICKS,
  MAX_INTENT_LAG_TICKS,
  type ClientIntentFrame,
  type IntentRejection,
} from "@pa/pvp";

export {
  // The fog-of-war projection. What a client is told about the opponent is decided
  // there, by the engine's own line-of-sight query, and netcode forwards it
  // verbatim: a snapshot encoder that assembled its own opponent view would be a
  // second place for a wallhack to be introduced.
  projectSnapshotFor,
  FORBIDDEN_SNAPSHOT_KEYS,
  type MatchSnapshot,
  type OpponentView,
  type SelfView,
  type ProjectileView,
} from "@pa/pvp";
