import type { ComponentType } from "react";
import type { CollisionWorld, Vec3 } from "@pa/engine-world";

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

/** Everything the duel view needs to construct the duel. Mirrors CreateDuelInput. */
export interface MissionDuelBrief {
  readonly duelId: string;
  /** Projected from the attempt seed. The duel must not seed itself. */
  readonly seed: number;
  readonly rounds: number;
  /** The arena's collision world. The same representation as the floor's. */
  readonly world: CollisionWorld;
  /**
   * @pa/duel `OpponentSource`, narrowed to the PvE case a mission can produce.
   * `profile` is a `BossProfile`; see the note above.
   */
  readonly opponent: { readonly kind: "BOSS"; readonly profile: unknown };
  /** @pa/duel `DuelQuestionRef[]`, one per round. Opaque here. */
  readonly questions: readonly unknown[];
  readonly placement: Readonly<
    Record<DuelSideId, { readonly pos: Vec3; readonly yaw: number }>
  >;
  /** Concepts the six rounds cover, in authored order, for the result screen. */
  readonly conceptIds: readonly string[];
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
