// The two things netcode needs from @pa/engine-world that @pa/duel's public
// surface does not re-export.
//
// Modelled on @pa/duel's own `engine.ts`, and kept this short on purpose. Netcode
// owns no physics: movement, collision and the integrator are consumed through
// @pa/duel's `stepCombat` and nothing here reaches past that. What is imported
// below is one constructor and one type, each with a reason:
//
//   createGroundedState  builds the opponent puppet a prediction needs in the other
//                        fighter slot. Using the ENGINE'S constructor rather than a
//                        MotionState literal means the puppet cannot end up missing
//                        a field the integrator expects — which is the exact way a
//                        "harmless" local copy becomes a fork.
//   MotionState          the body type, so the wire codec can be total over it.
//
// WHAT USED TO BE HERE AND DELIBERATELY IS NOT. This file also re-exported the
// engine's `MAX_CATCHUP_STEPS` as the server's catch-up bound, on the reasoning that
// "the engine already has an argued bound; inventing a second would be two answers
// to one question." They were in fact two questions. The engine's number is derived
// from a frame-delta clamp the server does not have, so when it was retuned for slow
// render frames the server's tolerance for fast-forwarding unrendered combat moved
// with it. The server now owns `SERVER_MAX_CATCHUP_TICKS` in `server/host.ts`, which
// carries that argument. Do not re-add the re-export to bind them again.
//
// The subpath import is deliberate and matches @pa/duel's reasoning: the package
// root re-exports React and three components, and the netcode server must stay
// importable from plain Node.

export {
  createGroundedState,
  type MotionState,
} from "@pa/engine-world/playerMotion";
