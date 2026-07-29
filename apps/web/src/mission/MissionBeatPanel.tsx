import { useEffect, useRef, useState } from "react";
import type { BeatPresentation } from "@pa/beat";
import { MISSION_BINDINGS } from "./missionInput.js";
import type { MissionInputState } from "./missionInput.js";

// ---------------------------------------------------------------------------
// The precision beat, as a holographic whack-a-mole.
//
// This is the mission's climax and its one act of defiance: the player nails a
// handbill to the Liberty Tree in the dark with the watch in the street below.
// It USED to be an osu-style timing lane — a thin strip of converging marks with
// 33ms windows — which was small, finicky and far too hard for mission one. It is
// now a reaction test: flares come up on a big holographic panel one at a time,
// and the player clicks the lit one before it fades. Success is noticing and
// acting, never sub-frame timing, and the difficulty is deliberately gentle.
//
// The panel is UI, so it is procedural by exception (the imported-visible-world
// rule permits UI/Archive highlights, shaders and the like). It writes exactly
// one thing to the simulation: the cell the player struck, into the shared input
// state, edge-triggered and delivered to a single tick by the runtime. It reads
// the beat's projection and has no other way to touch the run.
//
// TWO WAYS IN, because "click it" is the point but the keyboard must keep working.
// A pointer click strikes the cell it lands on. A key press (the interact key, or
// Space) strikes whatever cell is LIT — the panel knows which one, so the keyboard
// path is as forgiving as the pointer path and never asks the player to aim.
//
// POINTER LOCK is released while the panel is live, because a locked pointer has
// no cursor and there would be nothing to click. Looking around reverts to the
// drag fallback for those few seconds, which is fine: the player is standing
// still on the bough doing the work.
//
// WHEN IT RESOLVES the grid gives way to a short "the handbill is up" seal — a
// beat of acknowledgement that holds briefly and parts on its own, rather than a
// grid of spent cells or nothing at all. See the completion block below.
// ---------------------------------------------------------------------------

/** A comfortable 3-wide grid; six cells fall into two rows. */
const COLUMNS = 3;

// ---- the completion acknowledgement ----------------------------------------
//
// When the beat resolves, the whack-a-mole grid has nothing left to click, so it
// gives way to a short "the handbill is up" seal instead of just sitting there
// with six dark cells. It is a beat of acknowledgement, not a celebration: the
// mission is timed against dawn, so it holds for a moment and then parts on its
// own. Presentation only — it reads the resolved grade off the projection and
// writes nothing back to the run, so it cannot touch the beat's difficulty.
/** How long the "posted" seal holds before it begins to part. */
const COMPLETION_HOLD_MS = 2000;
/** The fade-out that follows the hold, after which the card unmounts. */
const COMPLETION_PART_MS = 480;

type CompletionPhase = "hold" | "parting" | "gone";

function statusLine(beat: BeatPresentation): string {
  if (beat.phase === "RESOLVED") {
    return beat.grade === "TORN"
      ? "The sheet tore — half the tacks went wide."
      : beat.heard
        ? "The sheet is up. He heard some of that."
        : "The sheet is up, and nobody heard a thing.";
  }
  if (beat.lastResult === "MISS") return "A tack rang off the bark — he may have heard it.";
  if (beat.lastResult === "STRAY") return "Missed the mark, loud — steady on.";
  if (beat.lastResult === "HIT") return beat.heard ? "Keep going." : "Quiet. Keep going.";
  return "A flare will come up on the sheet. Strike it.";
}

function kicker(beat: BeatPresentation): string {
  if (beat.phase === "RESOLVED") return `The Liberty Tree · ${beat.grade.toLowerCase()}`;
  if (beat.phase === "STANCE") return "The Liberty Tree · nail the handbill";
  return `The Liberty Tree · ${beat.struck} of ${beat.total} struck`;
}

export function MissionBeatPanel(props: {
  beat: BeatPresentation;
  inStance: boolean;
  input: MissionInputState;
  reducedMotion: boolean;
}) {
  const { beat, inStance, input } = props;
  const live = beat.phase === "ACTIVE" || beat.phase === "SETTLING";
  const clickable = live || (beat.phase === "STANCE" && inStance);
  const resolved = beat.phase === "RESOLVED";

  // The completion seal holds, then parts, then unmounts, so the acknowledgement
  // never lingers into the run for the yard even if the player stays put on the
  // bough. Driven off the resolved phase alone, so a retry (a fresh run back in
  // STANCE) resets it.
  const [completion, setCompletion] = useState<CompletionPhase>("hold");
  useEffect(() => {
    if (!resolved) {
      setCompletion("hold");
      return undefined;
    }
    const part = window.setTimeout(() => setCompletion("parting"), COMPLETION_HOLD_MS);
    const gone = window.setTimeout(
      () => setCompletion("gone"),
      COMPLETION_HOLD_MS + COMPLETION_PART_MS,
    );
    return () => {
      window.clearTimeout(part);
      window.clearTimeout(gone);
    };
  }, [resolved]);

  const shown = clickable || (resolved && inStance && completion !== "gone");

  // The lit cell, kept in a ref so the one keydown listener below always reads
  // the latest without re-binding every sample.
  const activeCell = useRef<number | null>(beat.activeCell);
  activeCell.current = beat.activeCell;

  // A key press strikes whatever is lit. Bound once while the panel can be
  // played; it writes the same latch a click does, so the runtime consumes
  // either on exactly one tick.
  useEffect(() => {
    if (!clickable) return undefined;
    const codes = new Set([...MISSION_BINDINGS.strike.codes, "Space"]);
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!codes.has(event.code)) return;
      if (activeCell.current === null) return;
      event.preventDefault();
      input.beatHitCell = activeCell.current;
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clickable, input]);

  // Release the pointer lock so there is a cursor to click with. Looking around
  // falls back to drag-look for the duration, which is what the player wants
  // while standing still to work.
  useEffect(() => {
    if (!clickable) return;
    const doc = typeof document !== "undefined" ? document : null;
    if (doc?.pointerLockElement) doc.exitPointerLock?.();
  }, [clickable]);

  if (!shown) return null;

  const torn = beat.grade === "TORN";
  const className = [
    "msn-wam",
    live ? "is-live" : "",
    resolved ? "is-done" : "",
    resolved && completion === "parting" ? "is-parting" : "",
    torn && resolved ? "is-torn" : "",
    props.reducedMotion ? "is-reduced" : "",
    beat.heard ? "is-heard" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // The finished beat: a short seal rather than a grid of dark cells. It names
  // the outcome, keeps the running tally the tests pin (`beat.struck`/`total`),
  // and carries the same flavour line the live panel used, then parts on its own.
  if (resolved) {
    return (
      <section className={className} aria-label="Nail the handbill to the Liberty Tree">
        <div className="msn-wam-complete" role="status" aria-live="polite">
          <span className="msn-wam-seal" aria-hidden="true" />
          <span className="msn-wam-complete-title">
            {torn ? "Sheet torn" : "Handbill posted"}
          </span>
          <span className="msn-wam-complete-tally">
            {beat.struck} of {beat.total} struck
          </span>
          <span className="msn-wam-status">{statusLine(beat)}</span>
        </div>
      </section>
    );
  }

  return (
    <section className={className} aria-label="Nail the handbill to the Liberty Tree">
      <header className="msn-wam-head">
        <span className="msn-wam-kicker">{kicker(beat)}</span>
        <span className="msn-wam-tally" aria-live="polite">
          {beat.struck}/{beat.total}
        </span>
      </header>

      <div
        className="msn-wam-grid"
        role="group"
        aria-label="Handbill"
        style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }}
      >
        {beat.cells.map((cell) => {
          const isActive = cell.active;
          return (
            <button
              key={cell.cell}
              type="button"
              className={`msn-wam-cell${isActive ? " is-active" : ""}`}
              // The countdown of the live flare, exposed to CSS as a 1..0 fraction
              // for the ring. It is an aid, not a gate: the flare is hittable for
              // its whole window and a reduced-motion renderer ignores the ring.
              style={
                isActive
                  ? ({ ["--remain" as string]: `${cell.remaining01}` })
                  : undefined
              }
              aria-label={isActive ? "Strike this flare" : "Handbill corner"}
              aria-pressed={isActive}
              onPointerDown={(event) => {
                // Only a primary press, and never let it bubble to the canvas —
                // a click here is a strike, not a request to capture the mouse.
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                input.beatHitCell = cell.cell;
              }}
            >
              <span className="msn-wam-flare" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <footer className="msn-wam-foot">
        <span className="msn-wam-status" role="status">
          {statusLine(beat)}
        </span>
        <span className="msn-wam-hint">
          Click the flare, or press {MISSION_BINDINGS.strike.label.split(" / ")[0]}
        </span>
      </footer>
    </section>
  );
}
