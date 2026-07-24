import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { InputRequest, PresenterEvent, MechanicParams } from "@pa/contracts";
import {
  HaulJobControl,
  PostJobControl,
  PrintJobControl,
  startingAlignmentFor,
} from "./CompoundMechanicControls.js";
import { useMechanicActionKey } from "./mechanicKeys.js";
import { choiceTagline } from "../pages/play/playCopy.js";
import {
  consequenceReceipt,
  dispatchPresentationNotice,
  stakeTags,
} from "@pa/engine-world";

type MechanicPhase = "READY" | "ACTIVE" | "COMMIT" | "COMPLETE";

function emitMechanicVisual(
  kind: MechanicParams["kind"],
  progress: number,
  active: boolean,
  phase: MechanicPhase = active ? "ACTIVE" : "READY",
) {
  window.dispatchEvent(new CustomEvent("pa:mechanic-visual", {
    detail: { kind, progress: Math.max(0, Math.min(1, progress)), active, phase },
  }));
}

export function Controls(props: {
  request: InputRequest;
  // Returns whether the runtime accepted the event; timer-driven emitters
  // (the Breather) retry on false instead of latching (feel-audit-1 P0-5).
  onEvent: (e: PresenterEvent) => void | Promise<boolean>;
  busy: boolean;
  spatialNavigation?: boolean;
  accessibleMechanics?: boolean;
}) {
  const { request, onEvent, busy } = props;
  switch (request.kind) {
    case "CONTINUE":
      return (
        <div className="choice-panel">
          <div className="choices choices-single">
            <button className="choice choice-gold" disabled={busy} onClick={() => onEvent({ type: "CONTINUE" })}>
              <span className="clabel">{request.label ?? "Continue"}</span>
            </button>
          </div>
        </div>
      );
    case "ACK":
      return (
        <SystemWindow heading="ARCHIVE // BEFORE YOU MOVE ON">
          <p className="system-text">{request.text}</p>
          <button className="system-confirm" disabled={busy} onClick={() => onEvent({ type: "ACK" })}>
            Understood
          </button>
        </SystemWindow>
      );
    case "FOCUS_READ":
      return (
        <div className="choice-panel">
          <div className="frame choice-frame">{request.teaser}</div>
          <div className="choices choices-two">
            <button className="choice choice-gold" disabled={busy} onClick={() => onEvent({ type: "FOCUS_READ_OPENED", objectId: request.objectId })}>
              <span className="clabel">{request.title}</span>
              <span className="choice-subtext">Step in and read it</span>
            </button>
            <button className="choice choice-gold" disabled={busy} onClick={() => onEvent({ type: "FOCUS_READ_SKIPPED", objectId: request.objectId })}>
              <span className="clabel">Keep moving</span>
              <span className="choice-subtext">Leave it unread</span>
            </button>
          </div>
        </div>
      );
    case "BREATHER":
      return <Breather request={request} onEvent={onEvent} />;
    case "FREE_ROAM": {
      // Once a stop is committed, control returns to the world: the gold
      // marker and the holo task strip carry the objective. The center of the
      // screen stays clear while walking.
      if (request.selectedTargetId) {
        const selected = request.targets.find((t) => t.targetId === request.selectedTargetId);
        // The gold-marker redirect nudge (FREE_ROAM_IDLE) is fired by the
        // movement-aware IdleRedirectTracker inside World3D, which only
        // triggers on genuine non-progress. No blind timer here.
        return (
          <>
            {!props.spatialNavigation && selected && (
              <div className="choice-panel">
                <div className="choices choices-single">
                  <button className="choice choice-gold" disabled={busy} onClick={() => onEvent({ type: "FREE_ROAM_GOTO", targetId: selected.targetId })}>
                    <span className="clabel">{selected.label}</span>
                    <span className="choice-subtext">Arrive at this destination</span>
                  </button>
                </div>
              </div>
            )}
          </>
        );
      }
      return (
        <div className="choice-panel">
          <div className="frame choice-frame">
            {request.targets.length > 1 ? "Pick your next stop." : "One place to be."}
          </div>
          <div className={`choices${request.targets.length === 1 ? " choices-single" : request.targets.length === 2 ? " choices-two" : ""}`}>
            {request.targets.filter((t) => t.marker !== "HIDDEN").map((t) => (
              <button key={t.targetId} className="choice choice-gold" disabled={busy} onClick={() => onEvent({ type: "FREE_ROAM_SELECT", targetId: t.targetId })}>
                <span className="clabel">{t.targetId === "RIDER_HANDBILLS" && <b className="timed-glyph">☼</b>}{t.label}</span>
                <span className="choice-subtext">
                  {stakeTags(t.effects).join(" · ") ||
                    (t.targetId === "RIDER_HANDBILLS"
                      ? "Timed · gone at the bell"
                      : "Select this stop")}
                </span>
              </button>
            ))}
            {request.canProceed && (
              <button className="choice choice-gold" disabled={busy} onClick={() => onEvent({ type: "FREE_ROAM_IDLE" })}>
                <span className="clabel">Wait a moment</span>
                <span className="choice-subtext">Let the street move</span>
              </button>
            )}
          </div>
        </div>
      );
    }
    case "CHOICE": {
      const isArchiveSync = request.promptId.includes(".SYNC.");
      const options = (
        <div className={`choices${request.options.length === 1 ? " choices-single" : request.options.length === 2 ? " choices-two" : ""}`}>
          {request.options.map((o) => {
            const tagline =
              stakeTags(o.effects).join(" · ") || choiceTagline(o.tags);
            return (
              <button
                key={o.choiceId}
                className="choice choice-gold"
                disabled={busy || o.disabled}
                onClick={async () => {
                  const accepted = await onEvent({
                    type: "CHOICE_SELECTED",
                    promptId: request.promptId,
                    choiceId: o.choiceId,
                  });
                  if (accepted !== false && o.effects) {
                    dispatchPresentationNotice({
                      id: `receipt:${request.promptId}:${o.choiceId}`,
                      dedupeKey: `receipt:${request.promptId}`,
                      kind: "ARCHIVE_NOTICE",
                      speaker: "YOU",
                      text: consequenceReceipt(o.effects),
                      durationMs: 4_200,
                      captions: true,
                    });
                  }
                }}
              >
                <span className="clabel">{o.label}</span>
                {tagline && <span className="choice-subtext">{tagline}</span>}
              </button>
            );
          })}
        </div>
      );
      if (isArchiveSync) {
        // Prediction framing, not test framing (design1 kill list): the
        // Archive asks for your read of the street, and the world answers.
        return (
          <SystemWindow heading="ARCHIVE // CALL IT">
            <p className="system-text">{request.frame}</p>
            {options}
          </SystemWindow>
        );
      }
      return (
        <div className="choice-panel">
          <div className="frame choice-frame">{request.frame}</div>
          {options}
        </div>
      );
    }
    case "MECHANIC":
      return (
        <Mechanic
          promptId={request.promptId}
          params={request.params}
          onEvent={onEvent}
          busy={busy}
          accessible={Boolean(props.accessibleMechanics)}
        />
      );
    case "DAY_END":
      return (
        <div className="choice-panel">
          <div className="choices choices-single">
            <button className="choice choice-gold" disabled={busy} onClick={() => onEvent({ type: "CONTINUE" })}>
              <span className="clabel">Finish the day</span>
            </button>
          </div>
        </div>
      );
    case "CHECKPOINT_DEBRIEF":
      return null;
  }
}

// Archive prompts render as a System window: a floating, glowing blue
// holographic notice only the field agent can see.
export function SystemWindow(props: { heading: string; children: ReactNode }) {
  return (
    <section className="system-window" role="dialog" aria-label="Archive notification">
      <span className="system-glow" aria-hidden="true" />
      <header className="system-header">
        <span className="system-sigil" aria-hidden="true">!</span>
        <span className="system-heading">{props.heading}</span>
      </header>
      <div className="system-body">{props.children}</div>
      <i className="system-corner tl" aria-hidden="true" />
      <i className="system-corner tr" aria-hidden="true" />
      <i className="system-corner bl" aria-hidden="true" />
      <i className="system-corner br" aria-hidden="true" />
    </section>
  );
}

// The breather's completion is presenter-owed: once the duration elapses the
// runtime is waiting on BREATHER_COMPLETE and nothing else can advance the
// day. The commit path can transiently drop events (persist round-trips,
// choreography-ready races — especially just after a resume), so this timer
// RETRIES until the runtime actually accepts the event. A fire-once timer
// wedged the whole plan in BREATHER forever (feel-audit-1 P0-5).
const BREATHER_RETRY_MS = 800;
export function breatherScheduleKey(
  request: Extract<InputRequest, { kind: "BREATHER" }>,
): string {
  return `${request.requestId}:${request.durationMs}`;
}

function Breather(props: {
  request: Extract<InputRequest, { kind: "BREATHER" }>;
  onEvent: (event: PresenterEvent) => void | Promise<boolean>;
}) {
  const onEventRef = useRef(props.onEvent);
  onEventRef.current = props.onEvent;
  const scheduleKey = breatherScheduleKey(props.request);
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let attemptInFlight = false;
    const attempt = async () => {
      if (cancelled || attemptInFlight) return;
      attemptInFlight = true;
      try {
        const accepted = await onEventRef.current({ type: "BREATHER_COMPLETE" });
        // Only an explicit `false` (guard-dropped commit) retries; a void
        // return keeps legacy fire-once semantics.
        if (cancelled || accepted !== false) return;
      } finally {
        attemptInFlight = false;
      }
      timer = window.setTimeout(() => void attempt(), BREATHER_RETRY_MS);
    };
    timer = window.setTimeout(() => void attempt(), props.request.durationMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Re-arm only for a new semantic breather. Projection-only plan refreshes
    // (heat decay, map discovery) clone the request object but preserve this
    // key, so they cannot starve the required completion timer.
  }, [scheduleKey, props.request.durationMs]);
  return null;
}

// A mechanic completion is earned state delivered by a ONE-SHOT timer
// (EffortControl/PressControl fire onDone once, then latch completedRef).
// A guard-dropped commit — choreography-readiness flicker, in-flight save —
// must therefore RETRY until the runtime accepts it, exactly like the
// breather timer above, or the completed control soft-locks the day (seen
// live: the effigy pin hold stuck on "SECURED" in the full-day E2E).
const MECHANIC_RESULT_RETRY_MS = 350;
function useCommittedResult(
  onEvent: (e: PresenterEvent) => void | Promise<boolean>,
): (event: PresenterEvent) => void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);
  return useCallback((event: PresenterEvent) => {
    let attemptInFlight = false;
    const attempt = async () => {
      if (cancelledRef.current || attemptInFlight) return;
      attemptInFlight = true;
      try {
        const accepted = await onEventRef.current(event);
        // Only an explicit `false` (guard-dropped commit) retries; a void
        // return keeps legacy fire-once semantics.
        if (cancelledRef.current || accepted !== false) return;
      } finally {
        attemptInFlight = false;
      }
      window.setTimeout(() => void attempt(), MECHANIC_RESULT_RETRY_MS);
    };
    void attempt();
  }, []);
}

function Mechanic(props: {
  promptId: string;
  params: MechanicParams;
  onEvent: (e: PresenterEvent) => void | Promise<boolean>;
  busy: boolean;
  accessible: boolean;
}) {
  const { params, promptId, busy } = props;
  const onEvent = useCommittedResult(props.onEvent);
  // Every control is KEYED BY PROMPT ID: consecutive requests of the same
  // mechanic kind (e.g. the fixed event's "move with the crowd" hold straight
  // into the effigy pin hold) must NEVER reuse the previous instance — a
  // reused EffortControl keeps completedRef latched and mounts pre-"SECURED",
  // its one-shot onDone already spent: an unrecoverable soft-lock (found by
  // the full-day E2E at the effigy pin).
  if (params.kind === "PRESS") return <PressControl key={promptId} prompt={params.prompt} onDone={(stopOffset) => onEvent({ type: "MECHANIC_RESULT", promptId, result: { kind: "PRESS", stopOffset } })} busy={busy} />;
  if (params.kind === "EFFORT") return <EffortControl key={promptId} prompt={params.prompt} onDone={(holdMs) => onEvent({ type: "MECHANIC_RESULT", promptId, result: { kind: "EFFORT", holdMs } })} busy={busy} />;
  if (params.kind === "PLACE") return <PlaceControl key={promptId} prompt={params.prompt} onDone={(alignment) => onEvent({ type: "MECHANIC_RESULT", promptId, result: { kind: "PLACE", alignment } })} busy={busy} />;
  if (params.kind === "PRINT_JOB") {
    return (
      <PrintJobControl
        key={promptId}
        prompt={params.prompt}
        variant={params.printVariant ?? "PIKE_PROOF"}
        accessible={props.accessible}
        busy={busy}
        onDone={({ phases, quality, accessible }) =>
          onEvent({
            type: "MECHANIC_RESULT",
            promptId,
            result: { kind: "PRINT_JOB", phases, quality, accessible },
          })
        }
      />
    );
  }
  if (params.kind === "HAUL_JOB") {
    return (
      <HaulJobControl
        key={promptId}
        prompt={params.prompt}
        accessible={props.accessible}
        busy={busy}
        onDone={({ phases, accessible }) =>
          onEvent({
            type: "MECHANIC_RESULT",
            promptId,
            result: { kind: "HAUL_JOB", phases, accessible },
          })
        }
      />
    );
  }
  if (params.kind === "POST_JOB") {
    return (
      <PostJobControl
        key={promptId}
        prompt={params.prompt}
        accessible={props.accessible}
        busy={busy}
        onDone={({ phases, accessible }) =>
          onEvent({
            type: "MECHANIC_RESULT",
            promptId,
            result: { kind: "POST_JOB", phases, accessible },
          })
        }
      />
    );
  }
  return <SortControl key={promptId} params={params} onDone={(assignments) => onEvent({ type: "MECHANIC_RESULT", promptId, result: { kind: "SORT", assignments } })} busy={busy} />;
}

// Oscillating + accelerating needle. Stop near center for a clean pull.
function PressControl(props: { prompt: string; onDone: (o: number) => void; busy: boolean }) {
  const [pos, setPos] = useState(0.08);
  const [passes, setPasses] = useState(0);
  const [locked, setLocked] = useState(false);
  const posRef = useRef(0.08);
  const dirRef = useRef(1);
  const speedRef = useRef(0.42);
  const lastTimeRef = useRef(0);
  const raf = useRef(0);
  const doneTimer = useRef(0);
  useEffect(() => {
    const tick = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const dt = Math.min(0.04, (time - lastTimeRef.current) / 1000);
      lastTimeRef.current = time;
      let p = posRef.current + dirRef.current * speedRef.current * dt;
      if (p >= 1) {
        p = 1;
        dirRef.current = -1;
        setPasses((value) => value + 1);
      }
      if (p <= 0) {
        p = 0;
        dirRef.current = 1;
        setPasses((value) => value + 1);
      }
      speedRef.current = Math.min(1.28, speedRef.current + dt * 0.055);
      posRef.current = p;
      setPos(p);
      emitMechanicVisual("PRESS", p, true);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf.current);
      window.clearTimeout(doneTimer.current);
      emitMechanicVisual("PRESS", posRef.current, false);
    };
  }, []);
  const distance = Math.abs(pos - 0.5);
  const accuracy = Math.max(0, 1 - distance * 2);
  const result = distance <= 0.08 ? "CRISP PULL" : distance <= 0.22 ? "USABLE" : "SMUDGE RISK";
  function commit() {
    if (locked || props.busy) return;
    cancelAnimationFrame(raf.current);
    setLocked(true);
    emitMechanicVisual("PRESS", posRef.current, false, "COMMIT");
    // Completion beat: the world press slams, presses, and slides the fresh
    // sheet out of the bed before the next plan replaces this request.
    doneTimer.current = window.setTimeout(() => props.onDone(posRef.current), 950);
  }
  // The advertised SPACE binding, honored without needing button focus.
  useMechanicActionKey({
    enabled: !locked && !props.busy,
    codes: ["Space"],
    onDown: commit,
  });
  return (
    <div className="mechanic-shell mechanic-press">
      <header className="mechanic-header">
        <span className="mechanic-kicker">PRESSWORK // TIMING</span>
        <span className={`mechanic-grade ${distance <= 0.08 ? "perfect" : distance <= 0.22 ? "good" : ""}`}>
          {locked ? result : `${Math.round(accuracy * 100)}% ALIGNMENT`}
        </span>
      </header>
      <h2>{props.prompt}</h2>
      <p className="mechanic-note">
        Stop the needle inside the green band — the tighter, the cleaner the pull.
      </p>
      <div className="press-stage">
        <div className="press-track" aria-label={`Press alignment ${Math.round(pos * 100)} percent`}>
          <div className="press-zone usable" />
          <div className="press-zone crisp" />
          <div className="press-center" />
          <div className="press-needle" style={{ left: `${pos * 100}%` }}><i /></div>
          <div className="press-ticks" aria-hidden="true" />
        </div>
        <div className="press-scale" aria-hidden="true"><span>EARLY</span><strong>CLEAN PULL</strong><span>LATE</span></div>
      </div>
      <div className="mechanic-footer">
        <span>PASS {String(passes + 1).padStart(2, "0")} · speed increasing</span>
        <button className="mechanic-action" disabled={props.busy || locked} onClick={commit}>
          {locked ? result : "STOP THE PRESS"}
          <kbd>SPACE / CLICK</kbd>
        </button>
      </div>
    </div>
  );
}

function EffortControl(props: { prompt: string; onDone: (ms: number) => void; busy: boolean }) {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Press and hold. Do not release early.");
  const startRef = useRef<number | null>(null);
  const raf = useRef(0);
  const doneTimer = useRef(0);
  const completedRef = useRef(false);
  const TARGET = 1200;
  function begin() {
    if (props.busy || startRef.current !== null || completedRef.current) return;
    startRef.current = performance.now();
    setMessage("Keep steady…");
    const tick = (now: number) => {
      const held = performance.now() - (startRef.current ?? 0);
      const nextProgress = Math.min(1, held / TARGET);
      setProgress(nextProgress);
      emitMechanicVisual("EFFORT", nextProgress, true);
      if (nextProgress >= 1) {
        startRef.current = null;
        completedRef.current = true;
        setMessage("Grip secured");
        emitMechanicVisual("EFFORT", 1, false, "COMPLETE");
        // Completion beat: the staged action (press pull, bolt drop, bundle
        // handoff) plays out in the world before the request advances.
        doneTimer.current = window.setTimeout(() => props.onDone(TARGET), 700);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }
  function end() {
    if (startRef.current === null || completedRef.current) return;
    cancelAnimationFrame(raf.current);
    startRef.current = null;
    setProgress(0);
    setMessage("Grip lost—hold continuously to finish.");
    emitMechanicVisual("EFFORT", 0, false);
  }
  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    window.clearTimeout(doneTimer.current);
    emitMechanicVisual("EFFORT", 0, false);
  }, []);
  // "HOLD SPACE" without requiring the button to own keyboard focus
  // (feel-audit-1 P1-2: keyboard-only players were hard-blocked here). F is
  // bound too: hold verbs staged in the world (pin the handbill, pin the
  // page) read as "hold F" — the game's one interaction key.
  useMechanicActionKey({
    enabled: !props.busy && !completedRef.current,
    codes: ["Space", "Enter", "KeyF"],
    onDown: begin,
    onUp: end,
  });
  const ringStyle = { "--mechanic-progress": `${progress * 360}deg` } as CSSProperties;
  const holding = progress > 0 && progress < 1;
  return (
    <div className="mechanic-shell mechanic-effort">
      <header className="mechanic-header">
        <span className="mechanic-kicker">PHYSICAL ACTION // GRIP</span>
        <span className={progress === 1 ? "mechanic-grade perfect" : "mechanic-grade"}>{Math.round(progress * 100)}%</span>
      </header>
      <h2>{props.prompt}</h2>
      <div className="effort-stage">
        <div className="effort-ring" style={ringStyle}><strong>{Math.round(progress * 100)}</strong><small>HOLD</small></div>
        <div className="effort-readout">
          <div className="effort-bar"><div style={{ width: `${progress * 100}%` }} /></div>
          <p>{message}</p>
        </div>
      </div>
      <button
        className={`mechanic-action mechanic-hold${holding ? " holding" : ""}${completedRef.current ? " held" : ""}`}
        style={{ "--hold": progress } as CSSProperties}
        disabled={props.busy || completedRef.current}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          begin();
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(event) => {
          if ((event.code === "Space" || event.code === "Enter") && !event.repeat) begin();
        }}
        onKeyUp={(event) => {
          if (event.code === "Space" || event.code === "Enter") end();
        }}
      >
        <i className="hold-fill" aria-hidden="true" />
        <span className="hold-label">
          {completedRef.current ? "SECURED" : holding ? "KEEP HOLDING…" : "HOLD TO STEADY"}
        </span>
        <kbd>{completedRef.current ? "" : "HOLD F / SPACE · OR HOLD CLICK"}</kbd>
      </button>
    </div>
  );
}

function PlaceControl(props: { prompt: string; onDone: (a: number) => void; busy: boolean }) {
  const [val, setVal] = useState(() => startingAlignmentFor("PLACE:LINE_UP"));
  const [locked, setLocked] = useState(false);
  const doneTimer = useRef(0);
  const score = Math.max(0, 1 - Math.abs(val - 0.5) * 2);
  useEffect(() => {
    emitMechanicVisual("PLACE", val, true);
  }, [val]);
  useEffect(() => () => {
    window.clearTimeout(doneTimer.current);
    emitMechanicVisual("PLACE", val, false);
  }, []);
  return (
    <div className="mechanic-shell mechanic-place">
      <header className="mechanic-header">
        <span className="mechanic-kicker">PLACEMENT // ALIGNMENT</span>
        <span className={`mechanic-grade ${score >= 0.92 ? "perfect" : score >= 0.7 ? "good" : ""}`}>{Math.round(score * 100)}% TRUE</span>
      </header>
      <h2>{props.prompt}</h2>
      <p className="mechanic-note">
        Slide the sheet into the marked frame, then tack it down.
      </p>
      <div className="place-stage">
        <div className="place-target"><i /><span className="place-sheet" style={{ transform: `translateX(${(val - 0.5) * 280}px) rotate(${(val - 0.5) * 7}deg)` }} /></div>
        <input aria-label="Sheet alignment" type="range" min={0} max={100} value={val * 100} onChange={(e) => setVal(Number(e.target.value) / 100)} />
      </div>
      <button className="mechanic-action" disabled={props.busy || locked} onClick={() => {
        setLocked(true);
        emitMechanicVisual("PLACE", val, false, "COMMIT");
        // Completion beat: two nail taps land while the sheet snaps flat.
        doneTimer.current = window.setTimeout(() => props.onDone(val), 700);
      }}>{locked ? "TACKED" : "TACK IT HERE"} <kbd>ALIGN CENTER</kbd></button>
    </div>
  );
}

function SortControl(props: { params: MechanicParams; onDone: (a: { itemId: string; bucketId: string }[]) => void; busy: boolean }) {
  const items = props.params.sortItems ?? [];
  const buckets = props.params.sortBuckets ?? [];
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [locked, setLocked] = useState(false);
  const doneTimer = useRef(0);
  const allAssigned = items.every((i) => assign[i.itemId]);
  useEffect(() => {
    emitMechanicVisual("SORT", items.length ? Object.keys(assign).length / items.length : 0, true);
  }, [assign, items.length]);
  useEffect(() => () => {
    window.clearTimeout(doneTimer.current);
    emitMechanicVisual("SORT", 0, false);
  }, []);
  // Presentation-only: lets the world layer slide the matching sheet onto
  // its pile the moment an item is assigned.
  function assignItem(itemId: string, bucketId: string) {
    setAssign((a) => ({ ...a, [itemId]: bucketId }));
    window.dispatchEvent(new CustomEvent("pa:sort-assign", { detail: { itemId, bucketId } }));
  }
  return (
    <div className="mechanic-shell mechanic-sort">
      <header className="mechanic-header">
        <span className="mechanic-kicker">COMPOSITOR // SORT</span>
        <span className="mechanic-grade">{Object.keys(assign).length}/{items.length} SET</span>
      </header>
      <h2>{props.params.prompt}</h2>
      <p className="mechanic-note">
        Set every paper in its pile, then lock the composition.
      </p>
      <div className="sort-stage">
        {items.map((it, index) => (
          <div className="sort-item" key={it.itemId}>
            <span><small>{String(index + 1).padStart(2, "0")}</small>{it.label}</span>
            <span className="sort-buckets">
            {buckets.map((b) => (
              <button key={b.bucketId} className={assign[it.itemId] === b.bucketId ? "selected" : ""} onClick={() => assignItem(it.itemId, b.bucketId)}>{b.label}</button>
            ))}
          </span>
          </div>
        ))}
      </div>
      <button className="mechanic-action" disabled={props.busy || !allAssigned || locked}
        onClick={() => {
          setLocked(true);
          emitMechanicVisual("SORT", 1, false, "COMMIT");
          doneTimer.current = window.setTimeout(
            () => props.onDone(items.map((i) => ({ itemId: i.itemId, bucketId: assign[i.itemId]! }))),
            500,
          );
        }}>
        {locked ? "COMPOSED" : "LOCK COMPOSITION"} <kbd>{allAssigned ? "READY" : "ASSIGN ALL"}</kbd>
      </button>
    </div>
  );
}
