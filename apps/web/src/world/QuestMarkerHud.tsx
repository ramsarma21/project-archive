// Objective quest-marker HUD (DOM overlay above the Canvas). It renders ONLY
// for the single ACTIVE/selected target: a world-anchored label with distance,
// a contextual approach prompt when nearby, a gold screen-edge wedge when the
// marker is occluded or off-camera, and a single aria-live announcement per
// state change. Available markers get nothing here (they stay dim/static in the
// world). No control glyphs: quest arrival is proximity-based.
//
// State flows through a tiny external store the QuestMarkerDirector writes from
// its throttled sampling loop, so only this component re-renders (never the
// whole Canvas subtree) and there is no per-frame React churn.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface QuestHudActive {
  targetId: string;
  label: string;
  state: "ACTIVE" | "NEARBY" | "ARRIVING";
  distanceM: number; // rounded whole metres
  nearPrompt: string;
  timed: boolean; // RIDER_HANDBILLS carries a "timed" sun glyph
  onScreen: boolean; // marker on camera AND not occluded
  occluded: boolean;
  labelX: number; // viewport fraction (used when onScreen)
  labelY: number;
  edgeX: number; // viewport fraction of the clamped edge wedge
  edgeY: number;
  edgeAngleRad: number;
}

export interface QuestHudSnapshot {
  active: QuestHudActive | null;
  highContrast: boolean;
  reducedMotion: boolean;
}

export const EMPTY_HUD_SNAPSHOT: QuestHudSnapshot = {
  active: null,
  highContrast: false,
  reducedMotion: false,
};

export interface QuestMarkerHudStore {
  getSnapshot: () => QuestHudSnapshot;
  set: (next: QuestHudSnapshot) => void;
  subscribe: (listener: () => void) => () => void;
}

// A meaningful-change comparison so the director can call set() freely but the
// HUD only re-renders when a rendered value actually shifts (distance is
// compared already-rounded; sub-pixel wedge jitter still updates because it
// drives positioning, but that is a cheap DOM style change on one node).
function sameActive(a: QuestHudActive | null, b: QuestHudActive | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.targetId === b.targetId &&
    a.state === b.state &&
    a.distanceM === b.distanceM &&
    a.onScreen === b.onScreen &&
    a.occluded === b.occluded &&
    a.timed === b.timed &&
    a.label === b.label &&
    a.nearPrompt === b.nearPrompt &&
    Math.abs(a.labelX - b.labelX) < 0.002 &&
    Math.abs(a.labelY - b.labelY) < 0.002 &&
    Math.abs(a.edgeX - b.edgeX) < 0.002 &&
    Math.abs(a.edgeY - b.edgeY) < 0.002 &&
    Math.abs(a.edgeAngleRad - b.edgeAngleRad) < 0.01
  );
}

export function createQuestMarkerHudStore(): QuestMarkerHudStore {
  let snapshot: QuestHudSnapshot = EMPTY_HUD_SNAPSHOT;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    set: (next) => {
      if (
        next.highContrast === snapshot.highContrast &&
        next.reducedMotion === snapshot.reducedMotion &&
        sameActive(next.active, snapshot.active)
      ) {
        return;
      }
      snapshot = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function announcementFor(active: QuestHudActive | null): string {
  if (!active) return "";
  switch (active.state) {
    case "ARRIVING":
      return `Arriving at ${active.label}.`;
    case "NEARBY":
      // Never compose "Step outside: Step outside." — when the approach
      // prompt IS the label, one copy suffices (feel-audit-1 P1-8).
      return active.nearPrompt === active.label
        ? `${active.label}.`
        : `${active.nearPrompt}: ${active.label}.`;
    case "ACTIVE":
    default:
      return `Objective set: ${active.label}.`;
  }
}

export function QuestMarkerHud(props: {
  store: QuestMarkerHudStore;
  // True while any overlay/modal/choice owns the screen: the HUD renders
  // nothing so no world label can paint over modal UI (feel-audit-1 P1-7).
  // This is DOM-side and stays authoritative even while the canvas subtree
  // is briefly suspended during scene-asset preloads.
  hidden?: boolean;
}) {
  const snap = useSyncExternalStore(
    props.store.subscribe,
    props.store.getSnapshot,
    props.store.getSnapshot,
  );
  const active = props.hidden ? null : snap.active;

  // One announcement per (target, phase) change: never a continuously changing
  // distance readout (that would spam a screen reader). The text also clears
  // after a beat so stale objective lines never linger in the live region
  // (feel-audit-1 P2-13).
  const [announce, setAnnounce] = useState("");
  const lastKey = useRef("");
  useEffect(() => {
    const key = active ? `${active.targetId}:${active.state}` : "";
    if (key !== lastKey.current) {
      lastKey.current = key;
      setAnnounce(announcementFor(active));
    }
  }, [active]);
  useEffect(() => {
    if (!announce) return;
    const timer = window.setTimeout(() => setAnnounce(""), 4500);
    return () => window.clearTimeout(timer);
  }, [announce]);

  const near = active ? active.state === "NEARBY" || active.state === "ARRIVING" : false;
  const showWorldLabel = Boolean(active && active.onScreen);
  const showEdge = Boolean(active && !active.onScreen);

  return (
    <div
      className={`quest-hud${snap.highContrast ? " quest-hc" : ""}${snap.reducedMotion ? " quest-rm" : ""}`}
      data-quest-active-id={active?.targetId ?? ""}
      data-quest-state={active?.state ?? ""}
      data-quest-distance={active ? String(active.distanceM) : ""}
      data-quest-occluded={active ? String(active.occluded) : ""}
      data-quest-edge-visible={String(showEdge)}
    >
      {showWorldLabel && active && (
        <div
          className={`quest-world-label${near ? " is-near" : ""}${active.state === "ARRIVING" ? " is-arriving" : ""}`}
          style={{ left: `${active.labelX * 100}%`, top: `${active.labelY * 100}%` }}
        >
          {active.timed && <b className="quest-timed-glyph" aria-hidden="true">{"\u263c"}</b>}
          {near ? (
            <span className="quest-label-text">{active.nearPrompt}</span>
          ) : (
            <span className="quest-label-text">
              {active.label}
              <span className="quest-label-dist"> {"\u00b7"} {active.distanceM}m</span>
            </span>
          )}
        </div>
      )}

      {showEdge && active && (
        <div
          className={`quest-edge-wedge${active.edgeX > 0.5 ? " is-right" : ""}`}
          style={{
            left: `${active.edgeX * 100}%`,
            top: `${active.edgeY * 100}%`,
            // Anchor so the arrow sits on the edge point and the label always
            // extends inboard (toward screen centre), never off-screen.
            transform: `translate(${active.edgeX > 0.5 ? "-100%" : "0"}, -50%)`,
            ["--wedge-angle" as string]: `${active.edgeAngleRad}rad`,
          }}
        >
          <span className="quest-edge-arrow" aria-hidden="true" />
          <span className="quest-edge-label">
            {active.label}
            {!near && <span className="quest-label-dist"> {"\u00b7"} {active.distanceM}m</span>}
          </span>
        </div>
      )}

      <div className="quest-aria" aria-live="polite" role="status">
        {announce}
      </div>
    </div>
  );
}
