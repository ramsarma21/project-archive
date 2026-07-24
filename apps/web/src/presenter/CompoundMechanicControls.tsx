import { useEffect, useRef, useState, type CSSProperties } from "react";
import type {
  PrintJobPhaseScores,
  PrintJobQuality,
  PrintJobVariant,
} from "@pa/contracts";
import { useMechanicActionKey } from "./mechanicKeys.js";
import { ambientAudio } from "@pa/chapter-boston-world";

type VisualPhase = "READY" | "ACTIVE" | "COMMIT" | "COMPLETE";

function emitVisual(
  kind: "PRINT_JOB" | "HAUL_JOB" | "POST_JOB",
  stage: string,
  progress: number,
  phase: VisualPhase,
  detail: {
    inkSide?: "LEFT" | "RIGHT";
    inkStroke?: number;
    inkValid?: boolean;
  } = {},
) {
  window.dispatchEvent(
    new CustomEvent("pa:mechanic-visual", {
      detail: {
        kind,
        stage,
        stageProgress: Math.max(0, Math.min(1, progress)),
        progress: Math.max(0, Math.min(1, progress)),
        active: phase === "ACTIVE",
        phase,
        ...detail,
      },
    }),
  );
}

export function printQualityFor(phases: PrintJobPhaseScores): PrintJobQuality {
  const values = Object.values(phases);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const minimum = Math.min(...values);
  if (average >= 0.85 && minimum >= 0.6) return "CRISP";
  if (minimum < 0.35) return "SMUDGED";
  return "USABLE";
}

/** Pure, frame-rate-independent curves for deterministic input scoring. */
export function timingWindowPosition(elapsedMs: number, periodMs: number): number {
  const phase = ((elapsedMs % periodMs) + periodMs) % periodMs / periodMs;
  return phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
}

export function timingWindowScore(position: number): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(position - 0.5) * 2));
}

export function inkBeatScore(elapsedMs: number, strokeIndex: number): number {
  const targetMs = (strokeIndex + 1) * 560;
  return Math.max(0.35, 1 - Math.abs(elapsedMs - targetMs) / 520);
}

// Alignment stages used to open with the marker dead-centre at "100% TRUE" —
// five stages of theater with zero challenge (feel-audit-1 P1-18). Each stage
// now opens with a real offset the player must correct. The offset is a pure
// hash of the stage key: presentation-only (the committed MECHANIC_RESULT
// records the player's actual final score, so replay determinism is
// untouched), stable for a given stage, and varied across stages.
export function startingAlignmentFor(stageKey: string): number {
  let hash = 2166136261;
  for (let index = 0; index < stageKey.length; index++) {
    hash ^= stageKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 8) % 1000) / 1000; // 0..1
  const side = (hash & 1) === 0 ? 1 : -1;
  // Offset magnitude 0.18..0.38 from centre: always visibly off, never pinned
  // to the rail.
  const magnitude = 0.18 + unit * 0.2;
  return 0.5 + side * magnitude;
}

function alignmentScore(value: number): number {
  return Math.max(0, 1 - Math.abs(value - 0.5) * 2);
}

// The job's phases as a readable rail: done, current (lit), upcoming. This
// replaces the bare "2/3" counters so a multi-stage job always shows where
// you are and what comes next.
export function StageRail(props: {
  stages: readonly string[];
  index: number;
}) {
  return (
    <ol
      className="stage-rail"
      aria-label={`Stage ${props.index + 1} of ${props.stages.length}`}
    >
      {props.stages.map((stage, position) => (
        <li
          key={stage}
          className={
            position < props.index
              ? "done"
              : position === props.index
                ? "current"
                : ""
          }
        >
          <i aria-hidden="true">{position < props.index ? "✓" : ""}</i>
          {stage.replaceAll("_", " ")}
        </li>
      ))}
    </ol>
  );
}

// Hold-to-work button: the whole button fills while held, so the interaction
// reads at a glance (no separate meter needed). The SAME element persists
// across a job's stages — `resetKey` disarms and clears it per stage. Never
// remount it mid-job: a keyed remount under a still-held pointer strands the
// pointer capture on the removed node, and a shared instance without a reset
// kept progress=1 and refused to re-arm (both wedged the haul at BALANCE).
function HoldAdvance(props: {
  label: string;
  disabled: boolean;
  resetKey: string;
  onProgress: (progress: number) => void;
  onComplete: (steadiness: number) => void;
}) {
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const started = useRef<number | null>(null);
  const raf = useRef(0);
  const slips = useRef(0);
  const duration = 1050;
  const setBoth = (value: number) => {
    progressRef.current = value;
    setProgress(value);
  };
  useEffect(() => {
    // New stage on the same mounted button: cancel any running hold and
    // clear the fill so a finished stage never bleeds into the next.
    cancelAnimationFrame(raf.current);
    started.current = null;
    progressRef.current = 0;
    setProgress(0);
    // The reset itself does not emit a visual; the stage emits on input.
  }, [props.resetKey]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const stop = () => {
    if (progressRef.current >= 1) return;
    if (progressRef.current > 0.12) slips.current += 1;
    cancelAnimationFrame(raf.current);
    started.current = null;
    setBoth(0);
    props.onProgress(0);
  };
  const begin = () => {
    if (props.disabled || started.current !== null || progressRef.current >= 1) return;
    started.current = performance.now();
    const tick = () => {
      if (started.current === null) return;
      const next = Math.min(1, (performance.now() - started.current) / duration);
      setBoth(next);
      props.onProgress(next);
      if (next >= 1) {
        started.current = null;
        props.onComplete(Math.max(0.35, 0.96 - slips.current * 0.18));
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const holding = progress > 0 && progress < 1;
  // Honor "HOLD SPACE" from anywhere: the previous button-focus-only
  // onKeyDown was dead for keyboard-only players (feel-audit-1 P1-2).
  useMechanicActionKey({
    enabled: !props.disabled,
    codes: ["Space", "Enter"],
    onDown: begin,
    onUp: stop,
  });
  return (
    <button
      className={`mechanic-action mechanic-hold${holding ? " holding" : ""}${progress >= 1 ? " held" : ""}`}
      style={{ "--hold": progress } as CSSProperties}
      disabled={props.disabled}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        begin();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <i className="hold-fill" aria-hidden="true" />
      <span className="hold-label">
        {progress >= 1 ? "DONE" : holding ? "KEEP HOLDING…" : props.label}
      </span>
      <kbd>{progress >= 1 ? "" : "HOLD SPACE · OR HOLD CLICK"}</kbd>
    </button>
  );
}

function TimingWindow(props: {
  stage: "CATCH" | "PULL";
  periodMs: number;
  disabled: boolean;
  onComplete: (score: number) => void;
}) {
  const [position, setPosition] = useState(0);
  const [locked, setLocked] = useState(false);
  const positionRef = useRef(0);
  const startedAt = useRef(0);
  const raf = useRef(0);
  useEffect(() => {
    startedAt.current = performance.now();
    const tick = (now: number) => {
      const next = timingWindowPosition(now - startedAt.current, props.periodMs);
      positionRef.current = next;
      setPosition(next);
      emitVisual("PRINT_JOB", props.stage, next, "ACTIVE");
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [props.periodMs, props.stage]);
  const commit = () => {
    if (locked || props.disabled) return;
    setLocked(true);
    cancelAnimationFrame(raf.current);
    props.onComplete(timingWindowScore(positionRef.current));
  };
  useMechanicActionKey({
    enabled: !locked && !props.disabled,
    codes: ["Space", "Enter"],
    onDown: commit,
  });
  const score = timingWindowScore(position);
  return (
    <div className={`timing-window timing-${props.stage.toLowerCase()}`}>
      <div
        className="timing-track"
        role="meter"
        aria-label={`${props.stage.toLowerCase()} timing`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(score * 100)}
      >
        <i className="timing-usable" />
        <i className="timing-crisp" />
        <i className="timing-marker" style={{ left: `${position * 100}%` }} />
      </div>
      <div className="timing-scale" aria-hidden="true">
        <span>EARLY</span><strong>CLEAN WINDOW</strong><span>LATE</span>
      </div>
      <button
        className="mechanic-action"
        disabled={locked || props.disabled}
        onClick={commit}
      >
        {props.stage === "CATCH" ? "CATCH NOW" : "DROP THE BAR"}
        <kbd>SPACE / CLICK</kbd>
      </button>
    </div>
  );
}

const PRINT_STAGES = ["CATCH", "INK", "REGISTER", "PULL", "PEEL"] as const;
type PrintStage = (typeof PRINT_STAGES)[number];

// What the current stage asks of the player, in plain words. The long job
// prompt stays as a one-line sub note; the headline is always the action.
const PRINT_STAGE_COPY: Record<PrintStage, { headline: string; hint: string }> = {
  CATCH: {
    headline: "Catch the sheet square",
    hint: "Slide until the sheet sits dead centre, then take it.",
  },
  INK: {
    headline: "Ink the forme evenly",
    hint: "Alternate daubs — follow the lit side, four strokes.",
  },
  REGISTER: {
    headline: "Set the register true",
    hint: "Line the points up dead centre before the pull.",
  },
  PULL: {
    headline: "Pull the bar smoothly",
    hint: "Centre the stroke — a hard or short pull smudges.",
  },
  PEEL: {
    headline: "Peel the proof clean",
    hint: "Lift slow and steady so the ink never smears.",
  },
};

export function PrintJobControl(props: {
  prompt: string;
  variant: PrintJobVariant;
  accessible: boolean;
  busy: boolean;
  onDone: (result: {
    phases: PrintJobPhaseScores;
    quality: PrintJobQuality;
    accessible: boolean;
  }) => void;
}) {
  const [stageIndex, setStageIndex] = useState(0);
  const [alignment, setAlignment] = useState(() =>
    startingAlignmentFor(`${props.variant}:CATCH`),
  );
  const [inkStrokes, setInkStrokes] = useState(0);
  const [inkExpected, setInkExpected] = useState<"LEFT" | "RIGHT">("LEFT");
  const [inkPenalty, setInkPenalty] = useState(0);
  const [inkTimingTotal, setInkTimingTotal] = useState(0);
  const [inkBeatProgress, setInkBeatProgress] = useState(0);
  const [scores, setScores] = useState<Partial<PrintJobPhaseScores>>({});
  const [locked, setLocked] = useState(false);
  const doneTimer = useRef(0);
  const inkTimers = useRef<number[]>([]);
  const accessibleInkRunning = useRef(false);
  const inkStartedAt = useRef(0);
  const inkBeatRaf = useRef(0);
  const inkStrokesRef = useRef(0);
  inkStrokesRef.current = inkStrokes;
  const stage = PRINT_STAGES[stageIndex]!;
  const alignmentRef = useRef(alignment);
  alignmentRef.current = alignment;
  // One keyboard model across every stage (feel-audit-1 P1-1/P1-2):
  // Space/Enter commits the align stages; 1/2 daub left/right during INK.
  const isAlignStage =
    !props.accessible &&
    stage === "REGISTER";
  useMechanicActionKey({
    enabled: isAlignStage && !locked && !props.busy,
    codes: ["Space", "Enter"],
    onDown: () => completeStage(alignmentScore(alignmentRef.current)),
  });
  const strokeRef = useRef<(side: "LEFT" | "RIGHT") => void>(() => {});
  useMechanicActionKey({
    enabled: !props.accessible && stage === "INK" && !locked && !props.busy,
    codes: ["Digit1", "Numpad1"],
    onDown: () => strokeRef.current("LEFT"),
  });
  useMechanicActionKey({
    enabled: !props.accessible && stage === "INK" && !locked && !props.busy,
    codes: ["Digit2", "Numpad2"],
    onDown: () => strokeRef.current("RIGHT"),
  });

  useEffect(() => {
    emitVisual("PRINT_JOB", stage, 0, "READY");
    if (stage === "INK") {
      inkStartedAt.current = performance.now();
      const tick = (now: number) => {
        setInkBeatProgress(
          Math.max(
            0,
            Math.min(
              1,
              (now - inkStartedAt.current - inkStrokesRef.current * 560) / 560,
            ),
          ),
        );
        inkBeatRaf.current = requestAnimationFrame(tick);
      };
      inkBeatRaf.current = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(inkBeatRaf.current);
      window.clearTimeout(doneTimer.current);
      for (const timer of inkTimers.current) window.clearTimeout(timer);
      inkTimers.current = [];
      accessibleInkRunning.current = false;
    };
  }, [stage]);

  const completeStage = (score: number) => {
    if (locked || props.busy) return;
    const key = stage.toLowerCase() as keyof PrintJobPhaseScores;
    const next = { ...scores, [key]: Math.max(0, Math.min(1, score)) };
    setScores(next);
    emitVisual("PRINT_JOB", stage, 1, stage === "PEEL" ? "COMPLETE" : "COMMIT");
    // Identity audio (design1 feature 5): the platen thunk lands on the pull
    // commit — full weight only for a near-perfect pull — and the bright
    // paper snap on the final peel. Missing files stay silent.
    if (stage === "PULL") {
      ambientAudio.playIdentity(
        "press-pull-thunk",
        score >= 0.92 ? 0.55 : score >= 0.65 ? 0.38 : 0.24,
      );
    }
    if (stage === "PEEL") {
      ambientAudio.playIdentity("paper-snap", score >= 0.9 ? 0.48 : 0.3);
    }
    if (stageIndex < PRINT_STAGES.length - 1) {
      const nextStage = PRINT_STAGES[stageIndex + 1]!;
      setStageIndex((index) => index + 1);
      setAlignment(startingAlignmentFor(`${props.variant}:${nextStage}`));
      return;
    }
    setLocked(true);
    const phases = next as PrintJobPhaseScores;
    const quality = printQualityFor(phases);
    window.dispatchEvent(
      new CustomEvent("pa:print-quality", {
        detail: { quality, phases, variant: props.variant },
      }),
    );
    doneTimer.current = window.setTimeout(
      () =>
        props.onDone({
          phases,
          quality,
          accessible: props.accessible,
        }),
      props.accessible ? 0 : 500,
    );
  };

  const accessibleAction = props.accessible ? (
    <button
      className="mechanic-action"
      disabled={props.busy || locked || accessibleInkRunning.current}
      onClick={() => {
        if (stage !== "INK") {
          completeStage(0.78);
          return;
        }
        // Accessible confirm preserves the same object-space alternating
        // action, but deterministically supplies a usable rhythm score.
        accessibleInkRunning.current = true;
        ambientAudio.playIdentity("ink-dab-1");
        emitVisual("PRINT_JOB", stage, 0.25, "ACTIVE", {
          inkSide: "LEFT",
          inkStroke: 1,
          inkValid: true,
        });
        inkTimers.current.push(
          window.setTimeout(() => {
            ambientAudio.playIdentity("ink-dab-2");
            emitVisual("PRINT_JOB", stage, 0.5, "ACTIVE", {
              inkSide: "RIGHT",
              inkStroke: 2,
              inkValid: true,
            });
          }, 190),
          window.setTimeout(() => {
            ambientAudio.playIdentity("ink-dab-1");
            emitVisual("PRINT_JOB", stage, 0.75, "ACTIVE", {
              inkSide: "LEFT",
              inkStroke: 3,
              inkValid: true,
            });
          }, 380),
          window.setTimeout(() => {
            ambientAudio.playIdentity("ink-dab-2");
            emitVisual("PRINT_JOB", stage, 1, "ACTIVE", {
              inkSide: "RIGHT",
              inkStroke: 4,
              inkValid: true,
            });
            accessibleInkRunning.current = false;
            completeStage(0.78);
          }, 570),
        );
      }}
    >
      COMPLETE {stage}
      <kbd>ENTER / CLICK</kbd>
    </button>
  ) : null;

  const stageControl = (() => {
    if (accessibleAction) return accessibleAction;
    if (stage === "INK") {
      const stroke = (side: "LEFT" | "RIGHT") => {
        if (side !== inkExpected) {
          setInkPenalty((value) => value + 0.18);
          emitVisual(
            "PRINT_JOB",
            stage,
            inkStrokes / 4,
            "ACTIVE",
            {
              inkSide: side,
              inkStroke: inkStrokes,
              inkValid: false,
            },
          );
          return;
        }
        const next = inkStrokes + 1;
        const timing = inkBeatScore(
          performance.now() - inkStartedAt.current,
          inkStrokes,
        );
        setInkStrokes(next);
        setInkTimingTotal((value) => value + timing);
        setInkExpected(side === "LEFT" ? "RIGHT" : "LEFT");
        // Alternating leather-on-metal dabs (identity audio, design1 #5).
        ambientAudio.playIdentity(side === "LEFT" ? "ink-dab-1" : "ink-dab-2");
        emitVisual("PRINT_JOB", stage, next / 4, "ACTIVE", {
          inkSide: side,
          inkStroke: next,
          inkValid: true,
        });
        if (next === 4) {
          completeStage(
            Math.max(0.35, (inkTimingTotal + timing) / 4 - inkPenalty),
          );
        }
      };
      strokeRef.current = stroke;
      return (
        <div className="ink-stage">
          <div
            className="ink-beat-track"
            role="meter"
            aria-label="ink timing"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(inkBeatProgress * 100)}
          >
            <i className="ink-beat-window" />
            <i
              className="ink-beat-marker"
              style={{ left: `${inkBeatProgress * 100}%` }}
            />
          </div>
          <div className="ink-pips" aria-label={`${inkStrokes} of 4 strokes`}>
            {[0, 1, 2, 3].map((pip) => (
              <i
                key={pip}
                className={pip < inkStrokes ? "done" : pip === inkStrokes ? "next" : ""}
                aria-hidden="true"
              />
            ))}
          </div>
          <div className="ink-daubs">
            <button
              className={inkExpected === "LEFT" ? "expected" : ""}
              disabled={props.busy || locked}
              onClick={() => stroke("LEFT")}
            >
              <kbd>1</kbd> DAUB LEFT
              <small>{inkExpected === "LEFT" ? "◈ NEXT" : "\u00a0"}</small>
            </button>
            <button
              className={inkExpected === "RIGHT" ? "expected" : ""}
              disabled={props.busy || locked}
              onClick={() => stroke("RIGHT")}
            >
              <kbd>2</kbd> DAUB RIGHT
              <small>{inkExpected === "RIGHT" ? "◈ NEXT" : "\u00a0"}</small>
            </button>
          </div>
        </div>
      );
    }
    if (stage === "PEEL") {
      return (
        <HoldAdvance
          resetKey={stage}
          label="HOLD TO PEEL"
          disabled={props.busy || locked}
          onProgress={(progress) => emitVisual("PRINT_JOB", stage, progress, "ACTIVE")}
          onComplete={(steadiness) => completeStage(steadiness)}
        />
      );
    }
    if (stage === "CATCH" || stage === "PULL") {
      return (
        <TimingWindow
          stage={stage}
          periodMs={stage === "CATCH" ? 1900 : 1280}
          disabled={props.busy || locked}
          onComplete={completeStage}
        />
      );
    }
    const trueness = alignmentScore(alignment);
    return (
      <>
        <div className="align-stage">
          <div className="align-strip" aria-hidden="true">
            <i className="align-zone" />
            <i className="align-center" />
            <i className="align-marker" style={{ left: `${alignment * 100}%` }} />
          </div>
          <input
            className="align-input"
            aria-label={`${stage.toLowerCase()} alignment`}
            type="range"
            min={0}
            max={100}
            value={alignment * 100}
            onChange={(event) => {
              const next = Number(event.target.value) / 100;
              setAlignment(next);
              emitVisual("PRINT_JOB", stage, next, "ACTIVE");
            }}
          />
          <span
            className={`align-readout ${trueness >= 0.92 ? "perfect" : trueness >= 0.7 ? "good" : ""}`}
          >
            {Math.round(trueness * 100)}% TRUE
          </span>
        </div>
        <button
          className="mechanic-action"
          disabled={props.busy || locked}
          onClick={() => completeStage(alignmentScore(alignment))}
        >
          SET REGISTER
          <kbd>SLIDE CENTRE · SPACE / CLICK</kbd>
        </button>
      </>
    );
  })();

  const copy = PRINT_STAGE_COPY[stage];
  return (
    <div className="mechanic-shell mechanic-press">
      <header className="mechanic-header">
        <span className="mechanic-kicker">PRESSWORK // {props.variant.replaceAll("_", " ")}</span>
      </header>
      <StageRail stages={PRINT_STAGES} index={stageIndex} />
      <h2>{copy.headline}</h2>
      <p className="mechanic-note">{copy.hint}</p>
      <div className="mechanic-stagebox">{stageControl}</div>
    </div>
  );
}

const HAUL_STAGES = ["LOAD", "BALANCE", "THREAD"] as const;

const HAUL_STAGE_COPY: Record<
  (typeof HAUL_STAGES)[number],
  { headline: string; hint: string }
> = {
  LOAD: {
    headline: "Shoulder the bolt",
    hint: "Hold steady while you heave it off the stack.",
  },
  BALANCE: {
    headline: "Balance the weight",
    hint: "Hold steady until the load settles square.",
  },
  THREAD: {
    headline: "Thread the doorway",
    hint: "Hold steady to ease it through without a scrape.",
  },
};

export function HaulJobControl(props: {
  prompt: string;
  accessible: boolean;
  busy: boolean;
  onDone: (result: {
    phases: { load: number; balance: number; thread: number };
    accessible: boolean;
  }) => void;
}) {
  const [index, setIndex] = useState(0);
  const scores = useRef({ load: 0.7, balance: 0.7, thread: 0.7 });
  const stage = HAUL_STAGES[index]!;
  const finish = () => {
    scores.current[stage.toLowerCase() as keyof typeof scores.current] =
      props.accessible ? 0.75 : 0.9;
    emitVisual("HAUL_JOB", stage, 1, index === 2 ? "COMPLETE" : "COMMIT");
    if (index < 2) setIndex((value) => value + 1);
    else props.onDone({ phases: scores.current, accessible: props.accessible });
  };
  return (
    <div className="mechanic-shell mechanic-effort">
      <header className="mechanic-header">
        <span className="mechanic-kicker">HAUL // HEAVY WORK</span>
      </header>
      <StageRail stages={HAUL_STAGES} index={index} />
      <h2>{HAUL_STAGE_COPY[stage].headline}</h2>
      <p className="mechanic-note">{HAUL_STAGE_COPY[stage].hint}</p>
      <div className="mechanic-stagebox">
        {props.accessible ? (
          <button className="mechanic-action" disabled={props.busy} onClick={finish}>
            COMPLETE {stage}<kbd>ENTER / CLICK</kbd>
          </button>
        ) : (
          // resetKey re-arms the shared hold per stage: a finished stage's
          // progress can never bleed into the next (the old shared instance
          // froze at "COMPLETE" and wedged the job on BALANCE).
          <HoldAdvance
            resetKey={stage}
            label={`HOLD TO ${stage}`}
            disabled={props.busy}
            onProgress={(progress) => emitVisual("HAUL_JOB", stage, progress, "ACTIVE")}
            onComplete={finish}
          />
        )}
      </div>
    </div>
  );
}

const POST_STAGES = ["LINE_UP", "TACK_LEFT", "TACK_RIGHT"] as const;

const POST_STAGE_COPY: Record<
  (typeof POST_STAGES)[number],
  { headline: string; hint: string }
> = {
  LINE_UP: {
    headline: "Line the notice up",
    hint: "Slide until it hangs true on the board.",
  },
  TACK_LEFT: {
    headline: "Tack the left corner",
    hint: "One firm tap sets the nail.",
  },
  TACK_RIGHT: {
    headline: "Tack the right corner",
    hint: "Second tap and it holds fast.",
  },
};

export function PostJobControl(props: {
  prompt: string;
  accessible: boolean;
  busy: boolean;
  onDone: (result: {
    phases: { lineUp: number; tackLeft: number; tackRight: number };
    accessible: boolean;
  }) => void;
}) {
  const [stage, setStage] = useState<(typeof POST_STAGES)[number]>("LINE_UP");
  const [alignment, setAlignment] = useState(() =>
    startingAlignmentFor("POST_JOB:LINE_UP"),
  );
  const scores = useRef({ lineUp: 0.7, tackLeft: 0.7, tackRight: 0.7 });
  const finishRef = useRef<() => void>(() => {});
  useMechanicActionKey({
    enabled: !props.busy,
    codes: ["Space", "Enter"],
    onDown: () => finishRef.current(),
  });
  const finishStage = () => {
    if (stage === "LINE_UP") {
      scores.current.lineUp = props.accessible ? 0.75 : alignmentScore(alignment);
      emitVisual("POST_JOB", stage, 1, "COMMIT");
      setStage("TACK_LEFT");
    } else if (stage === "TACK_LEFT") {
      scores.current.tackLeft = props.accessible ? 0.75 : 0.9;
      emitVisual("POST_JOB", stage, 1, "COMMIT");
      setStage("TACK_RIGHT");
    } else {
      scores.current.tackRight = props.accessible ? 0.75 : 0.9;
      emitVisual("POST_JOB", stage, 1, "COMPLETE");
      props.onDone({ phases: scores.current, accessible: props.accessible });
    }
  };
  finishRef.current = finishStage;
  const trueness = alignmentScore(alignment);
  return (
    <div className="mechanic-shell mechanic-place">
      <header className="mechanic-header">
        <span className="mechanic-kicker">POST NOTICE // BOARD</span>
      </header>
      <StageRail stages={POST_STAGES} index={POST_STAGES.indexOf(stage)} />
      <h2>{POST_STAGE_COPY[stage].headline}</h2>
      <p className="mechanic-note">{POST_STAGE_COPY[stage].hint}</p>
      <div className="mechanic-stagebox">
        {stage === "LINE_UP" && !props.accessible && (
          <div className="align-stage">
            <div className="align-strip" aria-hidden="true">
              <i className="align-zone" />
              <i className="align-center" />
              <i className="align-marker" style={{ left: `${alignment * 100}%` }} />
            </div>
            <input
              className="align-input"
              aria-label="Notice alignment"
              type="range"
              min={0}
              max={100}
              value={alignment * 100}
              onChange={(event) => {
                const next = Number(event.target.value) / 100;
                setAlignment(next);
                emitVisual("POST_JOB", stage, next, "ACTIVE");
              }}
            />
            <span
              className={`align-readout ${trueness >= 0.92 ? "perfect" : trueness >= 0.7 ? "good" : ""}`}
            >
              {Math.round(trueness * 100)}% TRUE
            </span>
          </div>
        )}
        <button className="mechanic-action" disabled={props.busy} onClick={finishStage}>
          {stage === "LINE_UP" ? "SET ALIGNMENT" : stage === "TACK_LEFT" ? "SET LEFT TACK" : "SET RIGHT TACK"}
          <kbd>ENTER / CLICK</kbd>
        </button>
      </div>
    </div>
  );
}
