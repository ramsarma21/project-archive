// @pa/pvp — ranked 1v1 on the duel core.
//
// No rendering, no transport, no database: this package is the policy and the
// authority as pure values, so the thing that decides a ranked outcome is fully
// testable and, because @pa/duel is replay-exact, re-derivable from its inputs.
//
// The one-line summary of the architecture: PvP is a boss duel with
// `OpponentSource: REMOTE`, run on the server instead of in a browser.

export * from "./match.js";
export * from "./cosmetics.js";
export * from "./handles.js";
export * from "./brackets.js";
export * from "./matchmaking.js";
export * from "./gates.js";
export * from "./questionPool.js";
export * from "./lobby.js";
export * from "./intents.js";
export * from "./projection.js";
export * from "./authority.js";
export * from "./standing.js";

// The few duel/engine values a transport layer needs, re-exported so the API takes a
// dependency on ONE package instead of three. The fixed-step rate is the engine's and
// is not restated here; the arena is the duel's own reference courtyard.
export { FIELD_DT, FIELD_TICK_HZ, referenceArena, type DuelSide } from "@pa/duel";
