// Where a PvP arena renderer plugs in.
//
// WHY THIS IS NOT `registerDuelView`. The mission container's registry
// (../mission/duelPort.ts) installs a view that is handed a `MissionDuelBrief` and
// RUNS THE DUEL ITSELF: it calls createDuel, owns the state, and reports an outcome
// back. That is right for a boss fight, where the browser is the authority.
//
// It is wrong for PvP, where the authority is the API process. Mounting a
// brief-driven view here would start a second simulation in the browser, and a
// second simulation is not a rendering detail — it is a client that disagrees with
// the server about who got shot. The entire PvP design exists to prevent exactly
// that.
//
// So PvP asks for a strictly narrower thing: a component that is handed the LATEST
// AUTHORITATIVE SNAPSHOT and draws it. No state, no reducer, no outcome. It reports
// nothing back except aim, because aim is the one piece of input a renderer is
// uniquely able to produce (it comes from the pointer against the drawn scene).
//
// Until such a view is registered, `PvpArena` renders the honest thing: the match
// is live on the server, this is what the server says, and there is no picture yet.
// It does not draw a stand-in fight, and it never fabricates a position.
//
// `apps/web/src/duel` — which owns every duel visual and which this directory may
// import from but never edit — registers this by calling `registerPvpArenaView`
// once at import time, exactly as it does for the mission registry.

import type { ComponentType } from "react";
import type { OpponentSighting } from "./arenaFeed.js";
import type { MatchSnapshot } from "./protocol.js";

/** The presented sighting state a renderer reports up for the HUD to read. */
export type PresentedSighting = OpponentSighting["kind"];

export interface PvpArenaViewProps {
  /** The most recent authoritative snapshot. The only source of truth to draw. */
  readonly snapshot: MatchSnapshot;
  readonly reducedMotion: boolean;
  /**
   * World-space aim, reported up so the intent sender can put it on the wire.
   * The renderer owns this because the pointer is resolved against the drawn
   * scene; everything else about input is sampled by the session.
   */
  readonly onAim: (x: number, z: number) => void;
  /** Camera yaw, so movement stays camera-relative like every other mode. */
  readonly onCameraYaw: (yaw: number) => void;
  /**
   * Bind gameplay pointer input to the canvas the renderer owns. The renderer is the
   * only layer that has the canvas element, so the session hands the binding down and
   * the renderer wires it to `gl.domElement`. Returns the detach.
   */
  readonly bindInput: (canvas: HTMLElement) => () => void;
  /**
   * The PRESENTED opponent sighting, reported up when it changes. The HUD's "lost sight"
   * warning must read this — the delayed sample the body is drawn from — not the newest
   * raw snapshot, or the banner flips a render delay before the body it describes moves.
   */
  readonly onOpponentSighting?: (kind: PresentedSighting) => void;
}

export type PvpArenaView = ComponentType<PvpArenaViewProps>;

let registered: PvpArenaView | null = null;

/** Installs the arena renderer. A later call replaces an earlier one, for HMR. */
export function registerPvpArenaView(view: PvpArenaView): void {
  registered = view;
}

export function pvpArenaView(): PvpArenaView | null {
  return registered;
}

/** Test seam. Production registers once and never clears. */
export function clearPvpArenaView(): void {
  registered = null;
}

export type PvpArenaMode = "VIEW" | "PENDING";

/**
 * One clause, and it is deliberately not configurable: there is no dev flag that
 * substitutes a drawn fight, because a stand-in arena is indistinguishable from a
 * working one in a screenshot and would be believed.
 */
export function pvpArenaMode(hasView: boolean): PvpArenaMode {
  return hasView ? "VIEW" : "PENDING";
}
