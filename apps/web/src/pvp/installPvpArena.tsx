import { Suspense, lazy } from "react";
import { registerPvpArenaView } from "./arenaPort.js";
import type { PvpArenaViewProps } from "./arenaPort.js";

// Where the arena joins the duelling ground.
//
// `arenaPort.ts` expected this call to come from `apps/web/src/duel`, on the reasoning
// that the directory which owns every duel visual should own the registration too. It
// comes from here instead, for a reason that is about the boundary rather than about
// the design: that directory is being edited by the agent mounting the duel view into
// the mission container, and PvP may import from it but never write to it. So the
// registration lives with the thing being registered — the same shape
// `installMissionDuel()` uses, called from the same kind of place — and every visual
// it draws is still imported from `../duel`.
//
// TWO THINGS ARE LOAD-BEARING, NEITHER OBVIOUS, AND BOTH LEARNED NEXT DOOR.
//
// The view is code-split. A lobby that never starts a match should not pay to parse a
// render tree for a fight nobody is having, and the arena pulls in three.js, the rig
// loader and the whole scenery graph.
//
// The Suspense boundary is HERE rather than around the mount point, because
// `PvpArena` renders the registered view directly with nothing above it. A bare
// `lazy` component would throw on first render and take the match screen down — a
// failure that appears the first time two real players reach a real fight, which is
// to say after every test has passed. The boundary belongs to whoever registers a
// lazy component.

const SnapshotArena = lazy(async () => ({
  default: (await import("./SnapshotArena.js")).SnapshotArena,
}));

/**
 * What is on screen while the arena's chunk arrives.
 *
 * Words, not a stand-in fight. The imported-visible-world rule forbids a placeholder
 * that could be mistaken for content, and `arenaPort.ts` is explicit that a drawn
 * stand-in arena would be indistinguishable from a working one in a screenshot.
 */
function ArenaLoading() {
  return (
    <div className="pvp-pending">
      <div className="pvp-kicker">Arena loading</div>
      <h2>The match is live on the server. The picture is on its way.</h2>
      <p className="pvp-muted">
        Your intent frames are already reaching the authority. Nothing is being
        simulated here and nothing is being drawn until the yard arrives.
      </p>
    </div>
  );
}

function PvpArenaSurface(props: PvpArenaViewProps) {
  return (
    <Suspense fallback={<ArenaLoading />}>
      <SnapshotArena {...props} />
    </Suspense>
  );
}

let installed = false;

/**
 * Installs the arena renderer. Call once, before the app mounts.
 *
 * Idempotent, so a hot reload cannot race two registrations: the port itself would
 * keep the later one, and this keeps the earlier one rather than replacing a
 * component React is already rendering.
 */
export function installPvpArena(): void {
  if (installed) return;
  registerPvpArenaView(PvpArenaSurface);
  installed = true;
}
