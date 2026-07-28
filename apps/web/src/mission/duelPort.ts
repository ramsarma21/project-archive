import type { ComponentType } from "react";

// ---------------------------------------------------------------------------
// The duel boundary.
//
// `packages/duel` is a complete headless core and `apps/web/src/duel` is its
// view, owned by another author. `@pa/web` does not depend on `@pa/duel` yet, so
// this file is the seam: the container hands over a brief, the view runs the
// duel, the view hands back a report, and the container never looks inside
// either payload.
//
// Two payloads are deliberately opaque. `opponent.profile` is a `BossProfile` and
// `questions` are `DuelQuestionRef[]`, both owned by @pa/duel, and every field
// name here matches `CreateDuelInput` so the view spreads the brief straight into
// `createDuel`/`createDuelRuntime` with two casts and no restructuring. When
// @pa/web gains @pa/duel as a dependency those types can be imported and the
// casts deleted; until then `unknown` is the honest statement that this file is
// not their author.
//
// The view registers itself rather than being imported, so the container has no
// compile-time dependency on a directory that does not exist yet, and the loop
// is runnable — with the duel unavailable and saying so — the moment the hub is
// wired.
// ---------------------------------------------------------------------------

export type DuelSideId = "A" | "B";

/**
 * Everything the duel view needs to construct the duel. Mirrors CreateDuelInput.
 *
 * Narrowed to the four fields the consumer (apps/web/src/duel/missionBrief.ts)
 * actually reads. It once carried `world`, `placement`, `rounds` and `conceptIds`
 * too, but the duel is fought in the shared origin arena (`yardArena()`), not on a
 * slice carved out of the mission level — so the world and placement were built
 * every mission start and read by nothing, `rounds` cannot travel to a core that
 * ends on health rather than a length, and the round reports take their concepts
 * from `questions` (the only list that pairs an item with a concept). Those four
 * were dead-but-plausible: a field named `world` sitting next to a real arena
 * invites the next author to assume it is load-bearing. Removed.
 */
export interface MissionDuelBrief {
  readonly duelId: string;
  /** Projected from the attempt seed. The duel must not seed itself. */
  readonly seed: number;
  /**
   * @pa/duel `OpponentSource`, narrowed to the PvE case a mission can produce.
   * `profile` is a `BossProfile`; see the note above.
   */
  readonly opponent: { readonly kind: "BOSS"; readonly profile: unknown };
  /** @pa/duel `DuelQuestionRef[]`, one per round. Opaque here. */
  readonly questions: readonly unknown[];
}

/**
 * The time of day to light the arena at, when a mission enters its duel.
 *
 * The mission is set before dawn and the duel is a beat later at the same place,
 * so the fight must not open at the arena's stand-alone midday. This is the seam
 * that carries the mission's sky across: the container computes it from the
 * dawn model at the moment of arrival (see missionDuelSky.ts) and the duel view
 * lights the yard from it instead of its own daylight rig. Absent, the arena
 * keeps its stand-alone default — the stand-alone duel has no mission clock.
 *
 * Colours only where colours travel across tone curves; the intensities are
 * expressed in the arena's own (ACES) range rather than the mission stage's
 * (Neutral) one, so the duel view can apply them without a second calibration.
 * A plain data record, so this port stays free of three.js and of the duel.
 */
export interface DuelSky {
  /** Background / clear colour, `#rrggbb`. */
  readonly background: string;
  /** Fog colour and exponential density. */
  readonly fogColor: string;
  readonly fogDensity: number;
  /** Hemisphere sky/ground colours and its intensity in the arena's range. */
  readonly hemiSky: string;
  readonly hemiGround: string;
  readonly hemiIntensity: number;
  /** Key (sun/moon) colour and intensity in the arena's range. Direction is the
   *  arena's own, kept for readable raking shadows off the cover. */
  readonly sunColor: string;
  readonly sunIntensity: number;
}

/** One round's knowledge evidence. Reports; mints nothing, gates nothing. */
export interface MissionDuelRoundReport {
  readonly round: number;
  readonly itemId: string;
  readonly conceptId: string;
  /** Binary by design. There is no partial verdict anywhere in the duel. */
  readonly verdict: "CORRECT" | "WRONG";
  /** Derived by the duel's reducer from the verdict. Never submitted. */
  readonly bullets: number;
}

/** Mirrors @pa/duel `DuelOutcome`. */
export interface MissionDuelOutcome {
  readonly winner: DuelSideId | null;
  readonly reason: "KNOCKOUT" | "ROUNDS_EXHAUSTED";
  readonly healthA: number;
  readonly healthB: number;
  readonly tiebreak: "NONE" | "HEALTH" | "HITS_LANDED" | "DRAWN";
}

/**
 * What the duel view hands back.
 *
 * `won` is the view's projection of `duelClearedMission(outcome)` and is the
 * only field the container's clear condition reads — the tiebreak reasoning
 * (winning on points clears the mission) belongs to @pa/duel, not here.
 */
export interface MissionDuelReport {
  readonly won: boolean;
  readonly outcome: MissionDuelOutcome;
  readonly rounds: readonly MissionDuelRoundReport[];
  /** Ticks actually spent in engagement, as seconds. The design's fight clock. */
  readonly engagementSeconds: number;
  /**
   * @pa/duel's serialised commit log: the verdicts, the derived grants, and the
   * terminal result. Carried through to the durable commit untouched, and it
   * carries no raw answer text by construction.
   */
  readonly committedEvents: readonly Record<string, unknown>[];
}

export interface MissionDuelViewProps {
  readonly brief: MissionDuelBrief;
  readonly missionId: string;
  readonly attemptOrdinal: number;
  readonly reducedMotion: boolean;
  /**
   * The mission's time of day for the arena, or absent to keep the stand-alone
   * daylight. Set by the container from the dawn state at yard arrival, so the
   * fight opens in the same pre-dawn the officer stopped the player in rather
   * than jumping to midday across the cutscene→duel seam.
   */
  readonly sky?: DuelSky;
  /** Called exactly once, when the duel resolves. */
  readonly onResolved: (report: MissionDuelReport) => void;
  /** Called when the player leaves the duel without finishing it. */
  readonly onAbandon: (reason: string) => void;
}

export type MissionDuelView = ComponentType<MissionDuelViewProps>;

let registered: MissionDuelView | null = null;

/**
 * Installs the duel view. `apps/web/src/duel` calls this once at import time.
 *
 * A later call replaces the earlier one so a hot reload does not leave a stale
 * component installed.
 */
export function registerDuelView(view: MissionDuelView): void {
  registered = view;
}

export function duelView(): MissionDuelView | null {
  return registered;
}

/** Test seam. Production has exactly one registration and never clears it. */
export function clearDuelView(): void {
  registered = null;
}

/**
 * What the container should render when a mission reaches its duel.
 *
 * `PENDING_WITH_DEV_WIN` offers a control that reports a win nobody fought, which
 * exists only so the XP decay schedule can be walked before the duel view lands. A
 * dev-only path that hands out a win is exactly the kind of thing that survives to
 * production because it fires under a flag nobody audits — so the decision is a
 * pure function with a test on it, and the first clause is the one that matters:
 * **a registered duel view makes the harness unreachable**, whatever the flags say.
 *
 * The audit is therefore "is a view registered", which is a property of the build
 * rather than a habit, and the whole harness is deleted with `DuelUnavailable` in
 * one edit the day the view registers.
 */
export type DuelSurfaceMode = "VIEW" | "PENDING" | "PENDING_WITH_DEV_WIN";

export function duelSurfaceMode(input: {
  hasView: boolean;
  isDevBuild: boolean;
  harnessRequested: boolean;
}): DuelSurfaceMode {
  if (input.hasView) return "VIEW";
  if (input.isDevBuild && input.harnessRequested) return "PENDING_WITH_DEV_WIN";
  return "PENDING";
}
