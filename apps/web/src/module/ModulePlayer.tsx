import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import {
  formatModuleClock,
  moduleCardWindows,
  moduleTargetSeconds,
  type LearningModuleDefinition,
  type ModuleCardWindow,
} from "./moduleFormat.js";
import { completeModuleRun, type ModuleRunCompletion } from "./moduleGate.js";
import "./module.css";

/** The advance control describes the card, so opening the deck reads card one. */
const CARD_REGION_ID = "mod-card-region";

/**
 * The module player: one deck, one card at a time, and a completion signal.
 *
 * Two constraints shape all of it.
 *
 * The player advances every card. Nothing on this surface auto-advances, times
 * out, or disables itself while a clock runs, so a slow reader is never rushed
 * and a fast reader is never held. The three minutes are drawn — the rail below
 * shows where each card's target sits and where the reader is against it — and
 * that is the whole extent of the pacing's authority.
 *
 * Read cards can be returned to, and returning costs nothing. Acknowledgement
 * is a high-water mark over cue ids (see `moduleRunIsComplete`), so re-reading
 * the representation card never re-locks the gate behind it.
 */
export function ModulePlayer(props: {
  definition: LearningModuleDefinition;
  /** Which attempt this run opens. Above 1 the module is a retry gate. */
  attemptOrdinal: number;
  reducedMotion: boolean;
  onComplete: (completion: ModuleRunCompletion) => void;
  /** Leaving without finishing. The gate stays shut; nothing is recorded. */
  onExit: () => void;
}) {
  const { definition } = props;
  const windows = useMemo(() => moduleCardWindows(definition), [definition]);
  const targetSeconds = useMemo(() => moduleTargetSeconds(definition), [definition]);

  const [index, setIndex] = useState(0);
  const [acknowledged, setAcknowledged] = useState<readonly string[]>([]);
  const [elapsed, setElapsed] = useState(0);

  // Wall seconds, reported as `observedSeconds` and never a gate condition. One
  // second is the finest granularity anything here displays, so the tick is one
  // second: this is a readout, not an animation frame loop. The start instant is
  // held in a ref as well, so the time filed on the completion is measured from
  // the clock rather than read off the last tick that happened to land.
  const startedAtRef = useRef(Date.now());
  useEffect(() => {
    startedAtRef.current = Date.now();
    setElapsed(0);
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [definition.moduleId]);

  const current = windows[index];
  const acknowledgedSet = useMemo(() => new Set(acknowledged), [acknowledged]);
  const readCount = definition.cards.filter((card) =>
    acknowledgedSet.has(card.cueId),
  ).length;

  // One completion per mounted run. A held-down arrow key repeats faster than
  // React re-renders, and a module that fires its completion twice becomes two
  // durable rows the moment persistence lands.
  const completedRef = useRef(false);

  const onAdvance = useCallback(() => {
    const entry = windows[index];
    if (!entry || completedRef.current) return;
    const next = acknowledgedSet.has(entry.card.cueId)
      ? acknowledged
      : [...acknowledged, entry.card.cueId];
    setAcknowledged(next);

    if (index < windows.length - 1) {
      setIndex(index + 1);
      return;
    }
    // The last card's prompt is the completion. The run is minted from the cue
    // set rather than from having reached the end, so the deck being covered is
    // what finishes the module and not the player's position in it.
    const completion = completeModuleRun({
      definition,
      attemptOrdinal: props.attemptOrdinal,
      acknowledgedCueIds: next,
      observedSeconds: (Date.now() - startedAtRef.current) / 1000,
      at: new Date().toISOString(),
    });
    if (!completion) {
      console.warn(
        `[module] ${definition.moduleId} reached its last card with cards ` +
          "still unread. Nothing was completed.",
      );
      return;
    }
    completedRef.current = true;
    props.onComplete(completion);
  }, [
    acknowledged,
    acknowledgedSet,
    definition,
    index,
    props.attemptOrdinal,
    props.onComplete,
    windows,
  ]);

  const onBack = useCallback(() => setIndex((at) => Math.max(0, at - 1)), []);

  // Arrow keys drive the deck so the whole module is reachable without ever
  // finding the button, and Escape leaves. Modified chords are left alone: they
  // belong to the browser.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onAdvance();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onBack();
      } else if (event.key === "Escape") {
        event.preventDefault();
        props.onExit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onAdvance, onBack, props.onExit]);

  // The one focus move: onto the control that drives the deck, once, on open.
  // Focus deliberately does NOT follow the card — a reader who has found the
  // advance control keeps it for the whole deck, so repeated Enter presses work
  // all six times. The card region announces itself instead: it is described by
  // the advance control, which covers the first card on open, and it is a polite
  // live region, which covers every card after that.
  const advanceRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    advanceRef.current?.focus({ preventScroll: true });
  }, [definition.moduleId]);

  if (!current) return null;

  const isLast = index === windows.length - 1;
  const isRetry = props.attemptOrdinal > 1;

  return (
    <div className={`mod${props.reducedMotion ? " is-reduced" : ""}`}>
      <div className="mod-backdrop" aria-hidden="true" />

      <header className="mod-topbar">
        <button type="button" className="mod-leave" onClick={props.onExit}>
          <span aria-hidden="true">←</span> Leave module
        </button>
        <div className="mod-topbar-title">
          <span className="mod-sigil" aria-hidden="true">◈</span>
          <span className="mod-wordmark">Learning module</span>
        </div>
        {/* Stated rather than implied. XP has one payer and this is not it. */}
        <span className="mod-topbar-note">Pays no XP</span>
      </header>

      <section className="mod-panel" aria-labelledby="mod-title">
        <span className="mod-panel-scan" aria-hidden="true" />
        <span className="mod-panel-corner tl" aria-hidden="true" />
        <span className="mod-panel-corner tr" aria-hidden="true" />
        <span className="mod-panel-corner bl" aria-hidden="true" />
        <span className="mod-panel-corner br" aria-hidden="true" />

        <header className="mod-head">
          <div className="mod-head-copy">
            <span className="mod-kicker">
              {isRetry
                ? `Required again · attempt ${props.attemptOrdinal} of ${MAX_MISSION_ATTEMPTS}`
                : "Required before deployment"}
            </span>
            <h1 className="mod-title" id="mod-title">
              {definition.title}
            </h1>
            <p className="mod-subtitle">{definition.subtitle}</p>
          </div>
          <div className="mod-clock">
            <span className="mod-clock-now">{formatModuleClock(elapsed)}</span>
            <span className="mod-clock-target">
              of {formatModuleClock(targetSeconds)} target
            </span>
          </div>
        </header>

        <ModulePacingRail
          windows={windows}
          index={index}
          acknowledged={acknowledgedSet}
          elapsed={elapsed}
          targetSeconds={targetSeconds}
          onJump={setIndex}
        />

        {/* Reading is never gated behind an animation here: the body is present
            the moment the card is. A typed reveal is the hub's System voice, not
            a way to serve content a student has to read. */}
        <div
          className="mod-card-region"
          id={CARD_REGION_ID}
          aria-live="polite"
          aria-atomic="true"
        >
          <article className="mod-card" key={current.card.id}>
            <div className="mod-card-head">
              <span className="mod-card-kicker">{current.card.kicker}</span>
              <span className="mod-card-window">
                Target {formatModuleClock(current.fromSeconds)}–
                {formatModuleClock(current.throughSeconds)}
              </span>
            </div>

            {current.card.body.map((paragraph, at) => (
              <p className="mod-card-line" key={at}>
                {paragraph}
              </p>
            ))}

            {current.card.excerpt && (
              <figure className="mod-excerpt">
                <span className="mod-excerpt-kicker">Source</span>
                <blockquote className="mod-excerpt-body">
                  {current.card.excerpt.lines.map((line, at) => (
                    <p key={at}>{line}</p>
                  ))}
                </blockquote>
                <figcaption className="mod-excerpt-cite">
                  {current.card.excerpt.title} · {current.card.excerpt.attribution}
                </figcaption>
              </figure>
            )}
          </article>
        </div>

        <footer className="mod-actions">
          <button
            type="button"
            className="mod-back"
            onClick={onBack}
            disabled={index === 0}
          >
            Back
          </button>
          <span className="mod-progress">
            {readCount} of {definition.cards.length} read
          </span>
          <button
            type="button"
            className={`mod-advance${isLast ? " is-final" : ""}`}
            aria-describedby={CARD_REGION_ID}
            onClick={onAdvance}
            ref={advanceRef}
          >
            {current.card.advanceLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

/**
 * The three minutes, drawn. Segments are proportional to their authored
 * windows, so the forty-second concept cards visibly dominate the fifteen- and
 * twenty-second frames, and the marker shows where the reader is against the
 * target.
 *
 * It reports and never commands: no segment gates the one after it, and a
 * marker past the end of the rail is simply a marker past the end of the rail.
 * A card already read can be returned to from here; one not yet read cannot be
 * jumped to, which keeps the rail from becoming a way around the deck.
 */
function ModulePacingRail(props: {
  windows: readonly ModuleCardWindow[];
  index: number;
  acknowledged: ReadonlySet<string>;
  elapsed: number;
  targetSeconds: number;
  onJump: (index: number) => void;
}) {
  const overrun = props.elapsed > props.targetSeconds;
  const markerPercent =
    props.targetSeconds > 0
      ? Math.min(100, (props.elapsed / props.targetSeconds) * 100)
      : 0;

  return (
    <div className="mod-rail">
      <div className="mod-rail-track">
        {props.windows.map((entry, at) => {
          const read = props.acknowledged.has(entry.card.cueId);
          const classes = [
            "mod-rail-seg",
            read ? "is-read" : "",
            at === props.index ? "is-current" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const span = entry.throughSeconds - entry.fromSeconds;
          const target = `${formatModuleClock(entry.fromSeconds)} to ${formatModuleClock(entry.throughSeconds)}`;
          return (
            <button
              key={entry.card.id}
              type="button"
              className={classes}
              style={{ flexGrow: span }}
              disabled={!read}
              aria-current={at === props.index ? "step" : undefined}
              aria-label={`${entry.card.kicker}, target ${target}, ${read ? "read" : "not read yet"}`}
              onClick={() => props.onJump(at)}
            >
              <span className="mod-rail-fill" aria-hidden="true" />
            </button>
          );
        })}
        <span
          className={`mod-rail-marker${overrun ? " is-past" : ""}`}
          style={{ left: `${markerPercent}%` }}
          aria-hidden="true"
        />
      </div>
      <p className="mod-rail-note">
        Times are targets — you advance every card yourself. Arrow keys move,
        Esc leaves.
      </p>
    </div>
  );
}
