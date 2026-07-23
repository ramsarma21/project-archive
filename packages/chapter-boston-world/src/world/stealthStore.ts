// External store for the live stealth/chase HUD, mirroring the QuestMarkerHud
// pattern (a tiny store written imperatively by R3F directors, read in the DOM
// via useSyncExternalStore, meaningful-change-gated so the HUD re-renders only
// when a displayed value actually shifts — never per frame). Per Production
// Plan D.0.3 / D.8 and Build-Brief M0 task 3.
//
// This store is a DISPLAY PROJECTION, not authoritative simulation state. The
// authoritative stamina/suspicion/heat/etc live in the field sim + runtime
// contract; directors push a snapshot here for the HUD. It holds NO wall-clock
// state and drives NO Canvas rerenders. Multiple independent writers are
// supported: Player/ChaseDirector patch `stamina/chaseActive/timedDash`,
// WatcherDirector patches `suspicion/detectionState/nearestWatcherDir`, and the
// runtime bridge patches `heat/standing` — each via patch() with only its own
// fields.

import type { FieldRuntimeView } from "@pa/contracts";

// Graduated detection readout, mirrors the D.3 suspicion tells:
//   CLEAR   S < 0.35  (no watcher tell)
//   WARY    S ≥ 0.35  (watcher head-turn + soft sting)
//   ALERTED S ≥ 0.70  (watcher breaks toward the player)
//   CAUGHT  S ≥ 1.0   (confrontation)
export type DetectionState = "CLEAR" | "WARY" | "ALERTED" | "CAUGHT";

// D.4 global heat state machine.
export type HeatState = "calm" | "noticed" | "watched" | "hunted";

// D.5 social-camouflage standing band (never shown as a number).
export type StandingBand = "marked" | "neutral" | "familiar" | "trusted";

export interface StealthSnapshot {
  stamina: number; // [0,1]; only meaningful/visible during chase/timed dash
  suspicion: number; // [0,1]; max over active watchers
  detectionState: DetectionState;
  heat: HeatState;
  standing: StandingBand;
  chaseActive: boolean;
  timedDash: boolean;
  chaseState:
    | "IDLE"
    | "STARTING"
    | "ACTIVE"
    | "SHAKEN"
    | "CAUGHT"
    | "RESOLVING"
    | "ENDED";
  confirmResolve: boolean;
  announcement: string;
  // Camera-relative chevron rotation for the nearest watcher (radians, CSS
  // clockwise: 0 = screen-right, -PI/2 = dead ahead), or null when no watcher
  // is relevant. WatcherDirector converts the world offset using the live
  // camera before patching, so the HUD can apply it directly to the glyph.
  nearestWatcherDir: number | null;
}

export const EMPTY_STEALTH_SNAPSHOT: StealthSnapshot = {
  stamina: 1,
  suspicion: 0,
  detectionState: "CLEAR",
  heat: "calm",
  standing: "neutral",
  chaseActive: false,
  timedDash: false,
  chaseState: "IDLE",
  confirmResolve: false,
  announcement: "",
  nearestWatcherDir: null,
};

// Meaningful-change epsilons: sub-epsilon numeric drift does not notify (the
// HUD bar/pip render at ~1% granularity), so directors may patch every frame.
export const STAMINA_EPS = 0.005;
export const SUSPICION_EPS = 0.005;
export const DIR_EPS = 0.02; // radians (~1.1°)

export interface StealthStore {
  getSnapshot: () => StealthSnapshot;
  patch: (partial: Partial<StealthSnapshot>) => void;
  reset: () => void;
  subscribe: (listener: () => void) => () => void;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

function dirChanged(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a !== b; // null <-> value is a change
  return angleDiff(a, b) >= DIR_EPS;
}

// True if any DISPLAYED value shifted enough to warrant a re-render.
function meaningfulChange(cur: StealthSnapshot, next: StealthSnapshot): boolean {
  return (
    Math.abs(cur.stamina - next.stamina) >= STAMINA_EPS ||
    Math.abs(cur.suspicion - next.suspicion) >= SUSPICION_EPS ||
    cur.detectionState !== next.detectionState ||
    cur.heat !== next.heat ||
    cur.standing !== next.standing ||
    cur.chaseActive !== next.chaseActive ||
    cur.timedDash !== next.timedDash ||
    cur.chaseState !== next.chaseState ||
    cur.confirmResolve !== next.confirmResolve ||
    cur.announcement !== next.announcement ||
    dirChanged(cur.nearestWatcherDir, next.nearestWatcherDir)
  );
}

export function createStealthStore(): StealthStore {
  let snapshot: StealthSnapshot = EMPTY_STEALTH_SNAPSHOT;
  const listeners = new Set<() => void>();

  const applyClamp = (s: StealthSnapshot): StealthSnapshot => ({
    ...s,
    stamina: clamp01(s.stamina),
    suspicion: clamp01(s.suspicion),
  });

  return {
    getSnapshot: () => snapshot,
    patch: (partial) => {
      const merged = applyClamp({ ...snapshot, ...partial });
      // Keep the previous object identity when nothing meaningful changed so
      // useSyncExternalStore does not schedule a render.
      if (!meaningfulChange(snapshot, merged)) return;
      snapshot = merged;
      for (const listener of listeners) listener();
    },
    reset: () => {
      if (snapshot === EMPTY_STEALTH_SNAPSHOT) return;
      snapshot = EMPTY_STEALTH_SNAPSHOT;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// Derive the detection readout from a raw suspicion value using the D.3 tell
// thresholds. Directors call this so the store's detectionState stays in lockstep
// with the suspicion pip without duplicating the thresholds.
export function detectionStateForSuspicion(suspicion: number): DetectionState {
  if (suspicion >= 1) return "CAUGHT";
  if (suspicion >= 0.7) return "ALERTED";
  if (suspicion >= 0.35) return "WARY";
  return "CLEAR";
}

const RUNTIME_HEAT: Record<FieldRuntimeView["heat"]["band"], HeatState> = {
  CALM: "calm",
  NOTICED: "noticed",
  WATCHED: "watched",
  HUNTED: "hunted",
};

const RUNTIME_STANDING: Record<
  FieldRuntimeView["standing"]["band"],
  StandingBand
> = {
  MARKED: "marked",
  NEUTRAL: "neutral",
  FAMILIAR: "familiar",
  TRUSTED: "trusted",
};

export function stealthPatchFromRuntimeField(
  field: FieldRuntimeView,
): Pick<StealthSnapshot, "heat" | "standing" | "chaseActive"> {
  return {
    heat: RUNTIME_HEAT[field.heat.band],
    standing: RUNTIME_STANDING[field.standing.band],
    chaseActive: field.activeChase !== null,
  };
}
