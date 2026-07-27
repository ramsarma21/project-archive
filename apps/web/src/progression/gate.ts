import { standingFor, type ProgressionView } from "./projection.js";

// ---------------------------------------------------------------------------
// What the hub may offer.
//
// This is the ADVISORY half of the module gate: it decides what the Deploy
// button looks like and what the map draws. The authoritative half is
// `authorizeAttempt`, which is a round trip and cannot be fooled. Keeping them
// as two things, and being explicit about which is which, is the point —
// a client-side answer that calls itself the gate is how the gate got bypassed
// in the first place.
//
// Everything here reads the server's projected view. Nothing reads a counter
// this browser incremented, which is why clearing site data changes exactly one
// thing: the hub has to fetch the snapshot again before it can draw.
// ---------------------------------------------------------------------------

/** Why a mission is or is not offerable. */
export type DeployStanding =
  /** Open, and the server has attempts left on it. */
  | { readonly deployable: true; readonly reason: "OPEN"; readonly attemptsRemaining: number }
  /** The chapter route has not reached it. */
  | { readonly deployable: false; readonly reason: "LOCKED" }
  /**
   * An attempt is open somewhere for this profile. There is ONE live attempt per
   * profile, so an open run blocks Deploy on EVERY mission — not just its own —
   * until it is forfeited (spending the attempt) or its queued outcome delivers.
   * It is never resumed into a fresh runtime.
   */
  | { readonly deployable: false; readonly reason: "INTERRUPTED" }
  /**
   * Nobody is signed in. Play requires a durable, server-backed attempt (there is
   * no unlimited practice), so the explicit `?hub=1` / Open Hub preview can render
   * the hub but cannot launch a mission. A real local or Google session lifts this.
   */
  | { readonly deployable: false; readonly reason: "SIGN_IN_REQUIRED" }
  /** Cleared, or three attempts burned. Pays zero forever, and cannot be replayed. */
  | { readonly deployable: false; readonly reason: "SPENT" }
  /**
   * Signed in, but this device has never seen this profile's progression and
   * cannot reach the server. Refused rather than guessed: the guess that costs
   * something is the optimistic one.
   */
  | { readonly deployable: false; readonly reason: "UNKNOWN" };

export interface DeployStandingInput {
  readonly view: ProgressionView;
  readonly missionId: string;
  /** The chapter's own unlock chain, evaluated against the resolved set. */
  readonly routeOpen: boolean;
  /**
   * True when `view` came from the server or from a cache of it. False when it
   * is the fresh-runner placeholder standing in for state we do not have.
   */
  readonly known: boolean;
  /**
   * True when nobody is signed in. There is no durable progression to protect,
   * so the route alone decides and the hub says plainly that nothing is saved.
   */
  readonly unranked: boolean;
}

export function deployStanding(input: DeployStandingInput): DeployStanding {
  // ONE open attempt per profile, so ANY open run blocks Deploy on EVERY mission —
  // checked before the route, because an open attempt held on mission A must also
  // close the door on route-open mission B rather than letting a second run start.
  // The runtime restarts from the top on a reload while the durable attempt keeps
  // its progress, so a fresh Deploy over an open attempt is exactly the replay this
  // gate exists to refuse. The player forfeits it first.
  if (input.view.openAttempt) {
    return { deployable: false, reason: "INTERRUPTED" };
  }
  if (!input.routeOpen) return { deployable: false, reason: "LOCKED" };
  // Signed out. Play is ranked and durable only — there is no unlimited practice —
  // so the preview hub renders but cannot deploy. Refused, not silently opened.
  if (input.unranked) {
    return { deployable: false, reason: "SIGN_IN_REQUIRED" };
  }
  if (!input.known) return { deployable: false, reason: "UNKNOWN" };
  const standing = standingFor(input.view, input.missionId);
  if (standing.spent) return { deployable: false, reason: "SPENT" };
  return {
    deployable: true,
    reason: "OPEN",
    attemptsRemaining: standing.attemptsRemaining,
  };
}
