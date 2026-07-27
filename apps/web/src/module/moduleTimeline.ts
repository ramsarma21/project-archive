import type { ModuleNarrationBeat } from "./moduleFormat.js";

// ---------------------------------------------------------------------------
// The module's cinematic beat cursor (pure, unit-testable).
//
// A card's scene is a slideshow of narration beats. This advances a cursor
// WITHIN a card by clamped frame deltas, exactly on the principle of
// engine-world's presentationTimeline: a stalled main thread, a backgrounded
// tab, or a timer burst can never fast-forward unseen narration or slides,
// because a single rendered frame may only consume MAX_MODULE_FRAME_MS of the
// timeline. The audited failure this prevents is the whole scene completing
// during a stall so the learner returns to a finished, unseen slideshow.
//
// It advances BEATS, never CARDS. Reaching the last beat marks the cursor done
// and holds on that beat; turning the card is the learner's, through the
// advance control, and is never time-locked. Back and replay reset the cursor.
//
// It owns no clock and no requestAnimationFrame — the player supplies deltas —
// so it is a pure function of (durations, cursor, delta) and testable without a
// DOM.
// ---------------------------------------------------------------------------

/**
 * The most timeline a single rendered frame may consume. Normal frames are
 * 8–33ms; anything larger is a stall or a background gap, clamped so at most a
 * quarter-second of a beat is lost rather than the whole scene.
 */
export const MAX_MODULE_FRAME_MS = 250;

/**
 * How long a beat is shown when the timeline drives it, from its word count.
 * Sized for spoken narration at roughly 155 words per minute plus a short
 * lead-in, then clamped so the shortest beat still reads and the longest cannot
 * strand a learner. This is a presentation target only: the learner turns the
 * card, and a beat that outlives its estimate simply stays on screen.
 */
export function beatDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const ms = 900 + (words / 155) * 60_000;
  return Math.max(2200, Math.min(14_000, Math.round(ms)));
}

/** Per-beat durations for a scene's beats, in order. */
export function moduleBeatDurations(
  beats: readonly ModuleNarrationBeat[],
): number[] {
  return beats.map((beat) => beatDurationMs(beat.text));
}

export interface ModuleTimelineCursor {
  /** Index of the beat currently showing. Clamped to the last beat. */
  readonly beatIndex: number;
  readonly elapsedInBeatMs: number;
  /** True once the final beat's target has elapsed. The card does not turn. */
  readonly done: boolean;
}

/** A fresh cursor on the first beat. A scene with no beats is done at once. */
export function createModuleCursor(beatCount: number): ModuleTimelineCursor {
  return { beatIndex: 0, elapsedInBeatMs: 0, done: beatCount === 0 };
}

/**
 * Advance the cursor by one clamped frame delta.
 *
 * The raw delta is clamped to MAX_MODULE_FRAME_MS first, so a burst of expired
 * wall-clock time advances at most one clamped step. When the cursor reaches
 * the final beat it holds there with `done` set — it never rolls past the end
 * of the scene, because turning the card is the learner's decision.
 */
export function advanceModuleTimeline(
  durations: readonly number[],
  cursor: ModuleTimelineCursor,
  rawDeltaMs: number,
): ModuleTimelineCursor {
  if (durations.length === 0) return { beatIndex: 0, elapsedInBeatMs: 0, done: true };
  let remaining = Math.max(0, Math.min(rawDeltaMs, MAX_MODULE_FRAME_MS));
  let { beatIndex, elapsedInBeatMs } = cursor;
  while (remaining > 0 && beatIndex < durations.length) {
    const isLast = beatIndex === durations.length - 1;
    const left = durations[beatIndex]! - elapsedInBeatMs;
    if (remaining < left) {
      elapsedInBeatMs += remaining;
      remaining = 0;
      break;
    }
    if (isLast) {
      // Hold on the last beat rather than running off the end of the scene.
      return { beatIndex, elapsedInBeatMs: durations[beatIndex]!, done: true };
    }
    remaining -= left;
    beatIndex += 1;
    elapsedInBeatMs = 0;
  }
  return {
    beatIndex,
    elapsedInBeatMs,
    done: beatIndex >= durations.length - 1 && elapsedInBeatMs >= (durations[beatIndex] ?? 0),
  };
}

/** The beat index currently showing, clamped into range. */
export function activeBeatIndex(
  durations: readonly number[],
  cursor: ModuleTimelineCursor,
): number {
  if (durations.length === 0) return 0;
  return Math.min(cursor.beatIndex, durations.length - 1);
}

/** Jump the cursor to a specific beat, e.g. when a voiceover cue lands early. */
export function seekModuleTimeline(
  durations: readonly number[],
  beatIndex: number,
): ModuleTimelineCursor {
  if (durations.length === 0) return { beatIndex: 0, elapsedInBeatMs: 0, done: true };
  const clamped = Math.max(0, Math.min(beatIndex, durations.length - 1));
  // Seeking shows that beat fresh: elapsed resets and the cursor is not done
  // until the timeline advances the last beat to its target.
  return { beatIndex: clamped, elapsedInBeatMs: 0, done: false };
}
