// The three things netcode needs from @pa/engine-world that @pa/duel's public
// surface does not re-export.
//
// Modelled on @pa/duel's own `engine.ts`, and kept this short on purpose. Netcode
// owns no physics: movement, collision and the integrator are consumed through
// @pa/duel's `stepCombat` and nothing here reaches past that. What is imported
// below is one constructor, one bound and one type, each with a reason:
//
//   createGroundedState  builds the opponent puppet a prediction needs in the other
//                        fighter slot. Using the ENGINE'S constructor rather than a
//                        MotionState literal means the puppet cannot end up missing
//                        a field the integrator expects — which is the exact way a
//                        "harmless" local copy becomes a fork.
//   MAX_CATCHUP_STEPS    how many fixed steps a stalled process may run in one wake.
//                        The server loop needs a bound and the engine already has an
//                        argued one; inventing a second would be two answers to one
//                        question.
//   MotionState          the body type, so the wire codec can be total over it.
//
// The subpath import is deliberate and matches @pa/duel's reasoning: the package
// root re-exports React and three components, and the netcode server must stay
// importable from plain Node.

export {
  createGroundedState,
  type MotionState,
} from "@pa/engine-world/playerMotion";

export { MAX_CATCHUP_STEPS } from "@pa/engine-world/fieldSimulation";
