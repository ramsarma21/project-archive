import { Component, Suspense, lazy, type ReactNode } from "react";
import {
  registerDuelView,
  type MissionDuelViewProps,
} from "../mission/duelPort.js";

// ---------------------------------------------------------------------------
// Where the duel joins the game.
//
// The mission container holds a registry rather than an import of this directory
// (see ../mission/duelPort.ts), and until now nothing called it: the container
// reached its DUEL phase, asked for a view, got null, and rendered a curtain
// saying so. This file is the call.
//
// It follows the precedent the chapter set. `installBostonChapter()` lives beside
// the missions it registers and main.tsx calls it before the app mounts, so
// registration lives with the thing being registered and the container stays free
// of a compile-time dependency on it. `installMissionDuel()` is the same shape,
// for the same reason, called from the same place.
//
// TWO THINGS ARE LOAD-BEARING AND NEITHER IS OBVIOUS.
//
// The view is code-split, exactly as the chapter splits M1's art: main.tsx imports
// this module eagerly, and a hub that never deploys should not pay to parse a
// render tree for a fight it is not having. Everything heavy — the stage, the
// actors, the gunplay, the arena — is behind the dynamic import below.
//
// And the Suspense boundary is HERE rather than around the mount point, because
// MissionRun renders the registered view directly with no boundary above it. A
// bare `lazy` component would therefore throw on first render and take the attempt
// down through the app error boundary — a failure that only appears the first time
// a real player reaches a real duel, which is to say after every unit test has
// passed. The boundary belongs to whoever registers a lazy component.
//
// BOTH boundaries, and the second one was found by playing rather than by reasoning.
// Suspense covers a chunk that has not arrived YET; it does nothing for one that
// arrives as a rejection, and `import()` rejects for a reason that has nothing to do
// with this code: a deploy replaces the hashed chunk while a session is open, and the
// page the player is holding asks for a file that no longer exists. Observed, from a
// static server that had not built the chunk — "Failed to fetch dynamically imported
// module" — and the consequence was the whole app resetting to the title screen with
// an attempt open, which is the worst available outcome. So the failure is caught and
// stated where it happens, and it offers the same single exit the container's own
// `DuelUnavailable` offers: concede, which spends the attempt honestly rather than
// losing it silently.
//
// This module deliberately imports no stylesheet. `duel.css` travels with the
// chunk it dresses, and the curtain below is drawn in the container's own vocabulary
// instead: the view is mounted inside MissionRun's `.msn`, so `mission.css` is
// already on the page, and the wait therefore looks like the phase transitions on
// either side of it rather than like the duel arriving early. It also keeps this
// module importable outside a bundler, which is what lets a test assert that the
// registration actually happens.
// ---------------------------------------------------------------------------

const MissionDuel = lazy(async () => ({
  default: (await import("./MissionDuel.js")).MissionDuel,
}));

/**
 * What is on screen while the duel's chunk arrives.
 *
 * Words, not a stand-in fight. The imported-visible-world rule forbids a
 * placeholder that could be mistaken for content, and the face-off has not begun:
 * there is nothing to show yet and saying so is the honest frame.
 */
function ArenaLoading() {
  return (
    <div className="msn-curtain" role="status">
      <span className="msn-curtain-kicker">Route complete · duel armed</span>
      <h1 className="msn-curtain-headline">Into the yard.</h1>
      <p className="msn-curtain-detail">
        He is waiting at the far end of the rope-walk.
      </p>
    </div>
  );
}

/**
 * The duel's chunk failing to arrive, said out loud.
 *
 * One way out and it is a loss, for the same reason the container's own curtain
 * offers one: a surface that hands back a win for a fight nobody had is a surface
 * that hands out XP. It cannot retry, either — a chunk that 404s once because the
 * deploy moved underneath this page will 404 every time, and a retry button that
 * always fails is worse than no button.
 */
function ArenaUnavailable(props: {
  detail: string;
  missionId: string;
  onAbandon: (reason: string) => void;
}) {
  return (
    <div className="msn-curtain" role="alert">
      <span className="msn-curtain-kicker">Route complete · duel unavailable</span>
      <h1 className="msn-curtain-headline">The yard did not load.</h1>
      <p className="msn-curtain-detail">
        The route held and he is waiting, but the duel's code could not be fetched
        ({props.detail}). Reloading the page will pick up the current build.
        Leaving here spends the attempt.
      </p>
      <div className="msn-curtain-actions">
        <button
          type="button"
          onClick={() => props.onAbandon(`the duel chunk failed to load: ${props.detail}`)}
        >
          Concede the attempt
        </button>
      </div>
    </div>
  );
}

interface ChunkGuardState {
  readonly failure: string | null;
}

class MissionDuelSurface extends Component<MissionDuelViewProps, ChunkGuardState> {
  state: ChunkGuardState = { failure: null };

  static getDerivedStateFromError(error: unknown): ChunkGuardState {
    return { failure: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown): void {
    // Loud, because the shape of this failure is operational rather than logical:
    // a burst of them across a class is a deploy that invalidated open sessions.
    console.error("[duel] the duel view failed to mount", error);
  }

  render(): ReactNode {
    if (this.state.failure !== null) {
      return (
        <ArenaUnavailable
          detail={this.state.failure}
          missionId={this.props.missionId}
          onAbandon={this.props.onAbandon}
        />
      );
    }
    return (
      <Suspense fallback={<ArenaLoading />}>
        <MissionDuel {...this.props} />
      </Suspense>
    );
  }
}

let installed = false;

/**
 * Installs the duel view. Called once from main.tsx, before the app mounts.
 *
 * Idempotent, so a hot reload cannot end up racing two registrations; the registry
 * itself would keep the later one, and this keeps the earlier one rather than
 * replacing a component React is already rendering.
 */
export function installMissionDuel(): void {
  if (installed) return;
  registerDuelView(MissionDuelSurface);
  installed = true;
}
