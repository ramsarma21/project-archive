import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MissionInstance } from "../mission/levelPort.js";
import { VisorChrome } from "./VisorChrome.js";
import { VisorHoldStage, createLookState } from "./VisorHoldStage.js";
import { LINE_STYLE } from "./visorPalette.js";
import { buildVisorPlan, type VisorSource } from "./visorPlan.js";
import { visorSourceFor } from "./visorRegistry.js";
import "./visor.css";

// ---------------------------------------------------------------------------
// The held moment.
//
// The player arrives on the printshop leads and the world holds. The System's
// annotation comes up over the view they are actually standing in, they look around
// as long as they like, and when they release it the annotation clears, the mission
// runs bare, and the dawn clock starts counting from that moment.
//
// THE DIVISION IS THE DESIGN. The hold gives INTENT — where I am going, what I do
// when I get there, what is dangerous, what my body can do. The run gives
// EXECUTION, unassisted. Nothing drawn here survives the release except the
// mission HUD's own stealth readout, which explains a failure after it happens
// rather than solving the street in advance. Annotation that persisted into play
// would have the player following a line instead of learning to read a city, and
// they would never learn to read it.
//
// THREE THINGS IT REFUSES TO BE.
//
// Not a gate. The release is armed on the first frame and the reveal never blocks
// it, so a player who presses Space immediately loses nothing but the briefing they
// chose not to read. There is already a mandatory three-minute module in front of
// this; a fourth thing to sit through is how a student ends up five minutes from
// their first input.
//
// Not a modal. There is no scrim and no centred box. The chrome hugs the aperture
// and the annotation is in the street.
//
// Not repeated. First attempt only — `visorHoldsBriefing` in visorRegistry.ts is
// the whole policy, and the container keeps its existing skippable curtain for the
// retries, because a student replaying a mission they know should not be shown a
// map of it again.
// ---------------------------------------------------------------------------

/** Time the annotation takes to come up. Never blocks the release. */
const REVEAL_MS = 1500;
/** Time it takes to go dark once released. The cut into the run. */
const DISSOLVE_MS = 420;

/** Radians of look per pixel dragged. */
const LOOK_SENSITIVITY = 0.0028;
const LOOK_YAW_LIMIT = 1.15;
const LOOK_PITCH_LIMIT = 0.42;

export type VisorPhase = "REVEALING" | "HELD" | "RELEASING" | "RELEASED";

export function VisorHold(props: {
  instance: MissionInstance;
  /** The attempt's own seed. Watcher poses at tick 0 are derived from it. */
  seed: number;
  /** Overrides the registry. Tests and the dev harness. */
  source?: VisorSource;
  reducedMotion: boolean;
  /** Called once, when the annotation has finished going dark. */
  onRelease: () => void;
  onPhase?: (phase: VisorPhase) => void;
}) {
  const { instance, onRelease, onPhase, reducedMotion, seed } = props;

  const source = useMemo(
    () => props.source ?? visorSourceFor(instance.missionId),
    [instance.missionId, props.source],
  );

  const plan = useMemo(() => {
    if (!source) return null;
    return buildVisorPlan({
      source,
      spawn: [instance.spawn.pos.x, instance.spawn.pos.y, instance.spawn.pos.z],
      facingYaw: instance.spawn.yaw,
      // The field's own poses on the tick the run will begin. Not a guess, and
      // not a second patrol model: this is where those men will be.
      watchers: instance.watcherPosesAtTick(0, seed),
      objectives: instance.objectives
        .filter((objective) => objective.required)
        .map((objective) => objective.label),
      lineNotes: (["SAFE", "FAST", "EXPERT"] as const).map((line) => ({
        line,
        promise: LINE_STYLE[line].promise,
      })),
    });
  }, [instance, seed, source]);

  const intensity = useRef(reducedMotion ? 1 : 0);
  const direction = useRef<1 | -1>(1);
  const look = useMemo(createLookState, []);
  const [phase, setPhase] = useState<VisorPhase>(
    reducedMotion ? "HELD" : "REVEALING",
  );
  const phaseRef = useRef(phase);
  const setPhaseOnce = useCallback(
    (next: VisorPhase) => {
      if (phaseRef.current === next) return;
      phaseRef.current = next;
      setPhase(next);
      onPhase?.(next);
    },
    [onPhase],
  );

  // A mission with no registered source has no briefing to give. Release on the
  // first frame rather than showing an empty visor.
  useEffect(() => {
    if (plan) return;
    onRelease();
  }, [onRelease, plan]);

  /** Reported by the canvas's own loop when the visor is fully up, or fully gone. */
  const onSettled = useCallback(
    (atTop: boolean) => {
      if (atTop) {
        setPhaseOnce("HELD");
        return;
      }
      setPhaseOnce("RELEASED");
      onRelease();
    },
    [onRelease, setPhaseOnce],
  );

  const release = useCallback(() => {
    if (phaseRef.current === "RELEASING" || phaseRef.current === "RELEASED") return;
    // Under reduced motion there is no dissolve to watch, so the cut is immediate
    // rather than a shorter version of an animation that was opted out of.
    if (reducedMotion) {
      intensity.current = 0;
      setPhaseOnce("RELEASED");
      onRelease();
      return;
    }
    direction.current = -1;
    setPhaseOnce("RELEASING");
  }, [onRelease, reducedMotion, setPhaseOnce]);

  // Armed from the first frame. Space because it is already the key that means
  // "go"; Enter because a keyboard user reaches for it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.code !== "Space" && event.code !== "Enter") return;
      event.preventDefault();
      release();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [release]);

  const dragging = useRef<{ id: number; x: number; y: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragging.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    const clamp = (value: number, limit: number) =>
      Math.min(limit, Math.max(-limit, value));
    look.yaw = clamp(look.yaw - dx * LOOK_SENSITIVITY, LOOK_YAW_LIMIT);
    look.pitch = clamp(look.pitch + dy * LOOK_SENSITIVITY, LOOK_PITCH_LIMIT);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current?.id !== event.pointerId) return;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!plan) return null;

  return (
    <div
      className={`visor${reducedMotion ? " is-reduced" : ""}`}
      data-phase={phase}
    >
      <VisorHoldStage
        instance={instance}
        seed={seed}
        plan={plan}
        look={look}
        intensity={intensity}
        direction={direction}
        revealMs={REVEAL_MS}
        dissolveMs={DISSOLVE_MS}
        onSettled={onSettled}
        reducedMotion={reducedMotion}
      />
      {/* The look surface spans the whole frame so a drag may start anywhere the
          world is visible. The chrome above it claims its own hit tests. */}
      <div
        className="visor-look-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {instance.briefing && (
        <VisorChrome
          briefing={instance.briefing}
          answers={plan.answers}
          releasing={phase === "RELEASING" || phase === "RELEASED"}
          onRelease={release}
        />
      )}
    </div>
  );
}
