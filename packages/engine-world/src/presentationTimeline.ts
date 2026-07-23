import type { PresentationDirective } from "@pa/contracts";

// ---------------------------------------------------------------------------
// Presentation timeline model (pure, unit-testable).
//
// The authored directive batch of a plan is compiled into a list of timed
// steps (location swaps, subtitles, read panels, inter-item gaps). The runner
// in Play.tsx advances a cursor with CLAMPED frame deltas, so a main-thread
// stall, a backgrounded tab, or a timer burst can never fast-forward the
// batch: at most one clamped step of progress happens per rendered frame.
// This is the root fix for the audited "arrival dialogue never played" class
// (feel-audit-1 P0-1): with setTimeout chains, every queued timer expired
// during a stall and the whole arrival presentation completed unseen.
// ---------------------------------------------------------------------------

export type ReadingSpeed = "RELAXED" | "STANDARD" | "BRISK";

export type TimelineStep =
  | { kind: "LOCATION"; locationId: string; durationMs: number }
  | { kind: "SUBTITLE"; directive: PresentationDirective; durationMs: number }
  | { kind: "READ_PANEL"; directive: PresentationDirective; durationMs: number }
  | { kind: "GAP"; durationMs: number };

// The largest amount of presentation time a single rendered frame may consume.
// Normal frames are 8-33ms; anything larger is a stall/background gap and is
// clamped so the player never loses more than a quarter-second of a beat.
export const MAX_TIMELINE_FRAME_MS = 250;

export function isSubtitleDirective(
  directive: PresentationDirective,
): boolean {
  return (
    directive.kind === "DIALOGUE" ||
    directive.kind === "SCENE" ||
    directive.kind === "NARRATION" ||
    directive.kind === "ARCHIVE" ||
    directive.kind === "AMBIENT_CHATTER"
  );
}

export function subtitleDurationMs(
  text: string,
  readingSpeed: ReadingSpeed,
): number {
  const words = text.trim().split(/\s+/).length;
  const base = 650 + (words / 2.7) * 1000;
  const pace = readingSpeed === "RELAXED" ? 1.3 : readingSpeed === "BRISK" ? 0.82 : 1;
  return Math.max(1700, Math.min(6500, base * pace));
}

export function readPanelDurationMs(
  title: string,
  body: string,
  readingSpeed: ReadingSpeed,
): number {
  const words = `${title} ${body}`.trim().split(/\s+/).length;
  const base = 1200 + (words / 3.2) * 1000;
  const pace = readingSpeed === "RELAXED" ? 1.35 : readingSpeed === "BRISK" ? 0.82 : 1;
  return Math.max(3200, Math.min(9000, base * pace));
}

// Compile a directive batch into ordered timed steps. Mirrors the previous
// setTimeout choreography exactly: location swaps hold 420ms, empty scene
// text holds 380ms, subtitles/read panels hold their reading duration and are
// followed by a short clear gap (140ms / 180ms).
export function buildTimeline(
  directives: readonly PresentationDirective[],
  originLocationId: string | null,
  readingSpeed: ReadingSpeed,
): TimelineStep[] {
  const steps: TimelineStep[] = [];
  let timelineLocation = originLocationId;
  for (const directive of directives) {
    const directiveLocation = directive.locationId;
    if (directiveLocation && directiveLocation !== timelineLocation) {
      timelineLocation = directiveLocation;
      steps.push({ kind: "LOCATION", locationId: directiveLocation, durationMs: 420 });
    }
    if (directive.kind === "SCENE") {
      if (directive.text.trim()) {
        steps.push({
          kind: "SUBTITLE",
          directive,
          durationMs: subtitleDurationMs(directive.text, readingSpeed),
        });
        steps.push({ kind: "GAP", durationMs: 140 });
      } else {
        steps.push({ kind: "GAP", durationMs: 380 });
      }
      continue;
    }
    if (directive.kind === "READ_PANEL") {
      steps.push({
        kind: "READ_PANEL",
        directive,
        durationMs: readPanelDurationMs(directive.title, directive.body, readingSpeed),
      });
      steps.push({ kind: "GAP", durationMs: 180 });
      continue;
    }
    if (isSubtitleDirective(directive) && "text" in directive) {
      steps.push({
        kind: "SUBTITLE",
        directive,
        durationMs: subtitleDurationMs(directive.text, readingSpeed),
      });
      steps.push({ kind: "GAP", durationMs: 140 });
    }
  }
  return steps;
}

export interface TimelineCursor {
  stepIndex: number;
  elapsedInStepMs: number;
  done: boolean;
}

export function createTimelineCursor(steps: readonly TimelineStep[]): TimelineCursor {
  return { stepIndex: 0, elapsedInStepMs: 0, done: steps.length === 0 };
}

// Advance the cursor by one frame delta. The delta is clamped so a stalled or
// hidden frame can never consume more than MAX_TIMELINE_FRAME_MS of the batch
// — a burst of expired wall-clock time therefore advances at most one clamped
// step of presentation instead of skipping the entire sequence.
export function advanceTimeline(
  steps: readonly TimelineStep[],
  cursor: TimelineCursor,
  rawDeltaMs: number,
): TimelineCursor {
  if (cursor.done) return cursor;
  let remaining = Math.max(0, Math.min(rawDeltaMs, MAX_TIMELINE_FRAME_MS));
  let { stepIndex, elapsedInStepMs } = cursor;
  while (remaining > 0 && stepIndex < steps.length) {
    const step = steps[stepIndex]!;
    const left = step.durationMs - elapsedInStepMs;
    if (remaining < left) {
      elapsedInStepMs += remaining;
      remaining = 0;
      break;
    }
    remaining -= left;
    stepIndex += 1;
    elapsedInStepMs = 0;
  }
  return {
    stepIndex,
    elapsedInStepMs,
    done: stepIndex >= steps.length,
  };
}

export function activeStep(
  steps: readonly TimelineStep[],
  cursor: TimelineCursor,
): TimelineStep | null {
  if (cursor.done) return null;
  return steps[cursor.stepIndex] ?? null;
}
