// @pa/netcode — making two browsers agree about one fight, and proving it.
//
// No rendering, no sockets, no database, and exactly one timer (`server/loop.ts`).
// The rest of this package is pure values, for the same reason @pa/duel and @pa/pvp
// are: the thing that decides a ranked outcome should be exercisable without a
// process, and a bug in it should reproduce from a seed rather than from a story.
//
// THE ARCHITECTURE IN FOUR LINES.
//   One authoritative simulation, on the server, at engine-world's fixed 60 Hz.
//   The local player is predicted by replaying unacknowledged input through the
//     REAL @pa/duel `stepCombat`; there is no second simulation anywhere here.
//   The opponent is interpolated from authoritative snapshots, never predicted.
//   Every tick is hashed on both ends and compared, so drift is detected rather
//     than hoped against.
//
// WHY NOT LOCKSTEP, IN ONE PARAGRAPH, BECAUSE IT IS THE DECISION EVERYTHING ELSE
// FOLLOWS FROM. Two reasons, and the second is the one that settles it. First, the
// simulation calls `sin`, `cos`, `atan2` and `hypot` — 16 times in `playerMotion.ts`,
// 18 in `collision.ts`, 8 in `combat.ts`, 10 in `policy.ts` — and IEEE 754 does not
// pin any of them, so two students on Chrome and Safari would compute measurably
// different trajectories from identical inputs while passing every test on one
// laptop. Second, and structurally: @pa/pvp deliberately does not tell a client
// where an opponent it cannot see is standing, because a snapshot containing that
// is a wallhack for any modified client. Lockstep REQUIRES both clients to hold the
// whole world state in order to simulate it. The anti-cheat model and lockstep are
// mutually exclusive, so the choice was already made upstream and this package
// implements it rather than reopening it.

export * from "./hash.js";
export * from "./history.js";
export * from "./divergence.js";
export * from "./barrier.js";
export * from "./protocol.js";

export * from "./server/session.js";
export * from "./server/snapshot.js";
export * from "./server/host.js";
export * from "./server/loop.js";

export * from "./client/prediction.js";
export * from "./client/interpolation.js";
export * from "./client/client.js";

export * from "./sim/link.js";
export * from "./sim/profiles.js";

// The single import surface onto @pa/pvp, re-exported so a consumer can see
// exactly what netcode consumes from the match authority without reading imports.
export * as pvpPort from "./pvpPort.js";
