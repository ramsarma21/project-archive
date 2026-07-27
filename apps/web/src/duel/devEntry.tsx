import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BossTier } from "@pa/duel";
import { DuelScreen } from "./DuelScreen.js";
import { m1DuelDescriptor } from "./m1Duel.js";
import {
  alternatingVerdicts,
  createStandInVerdictAuthority,
  httpVerdictAuthority,
} from "./duelGrading.js";
import type { InspectFraming } from "./duelCamera.js";
import type { GripTuning } from "./DuelActor.js";
import "../styles.css";

// Harness for looking at the duel. Not shipped and not routed: the mission container
// mounts `DuelScreen` for real, and this exists so the mode can be inspected and
// screenshotted before that lands.
//
// Everything it does is injection, never a shortcut through the core: the verdict
// comes from a stand-in AUTHORITY (which never reads the answer — it cannot grade,
// and neither can the client), the grip offsets come in as props, and the fight is
// the same reducer, running until somebody falls.
//
//   ?verdict=correct|wrong|alt   what the stand-in authority says. Default alt, so a
//                                single run shows both magazines the economy grants.
//   ?verdict=live                use the real HTTP authority instead.
//   ?inspect=gripA|gripB         lock the camera on a fighter's gun hand.
//   ?tier=1..5                   boss tier.
//   ?grip=x,y,z ?trim=x,y,z ?palm=n   live grip tuning, in metres and degrees.
//   ?reduced=1                   reduced motion.

const params = new URLSearchParams(window.location.search);

function numbers(key: string): [number, number, number] | null {
  const raw = params.get(key);
  if (!raw) return null;
  const parts = raw.split(",").map((value) => Number(value.trim()));
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function gripFromParams(): Partial<GripTuning> {
  const grip: Record<string, unknown> = {};
  const offset = numbers("grip");
  const trim = numbers("trim");
  const palm = params.get("palm");
  if (offset) grip.offset = offset;
  if (trim) grip.trimEulerDeg = trim;
  if (palm !== null && Number.isFinite(Number(palm))) grip.palmDrop = Number(palm);
  return grip as Partial<GripTuning>;
}

function inspectFromParams(): InspectFraming | null {
  const value = params.get("inspect");
  if (value === "gripA") return "GRIP_A";
  if (value === "gripB") return "GRIP_B";
  return null;
}

function Harness() {
  const [runId, setRunId] = useState(0);
  const tier = Number(params.get("tier") ?? "1");
  const descriptor = useMemo(
    () => m1DuelDescriptor({ attempt: 1 + runId, tier: (tier as BossTier) || 1 }),
    [runId, tier],
  );

  const mode = params.get("verdict") ?? "alt";
  const authority = useMemo(() => {
    if (mode === "live") return httpVerdictAuthority;
    if (mode === "correct") return createStandInVerdictAuthority(() => "CORRECT", 260);
    if (mode === "wrong") return createStandInVerdictAuthority(() => "WRONG", 260);
    return createStandInVerdictAuthority(alternatingVerdicts, 260);
  }, [mode]);

  const grip = useMemo(gripFromParams, []);
  const inspect = useMemo(inspectFromParams, []);

  return (
    <>
      <HarnessBanner mode={mode} />
      <DuelScreen
        descriptor={descriptor}
        verdictAuthority={authority}
        reducedMotion={params.get("reduced") === "1"}
        playerGrip={grip}
        opponentGrip={grip}
        inspect={inspect}
        onRuntime={(runtime) => {
          // Inspection handle: lets a capture script read the phase, the tick and
          // the poses instead of guessing them from pixels.
          (window as unknown as { __duel?: unknown }).__duel = runtime;
        }}
        onAgain={() => setRunId((value) => value + 1)}
        onResolved={(outcome, commitLog) => {
          console.log("[duel] resolved", outcome, commitLog);
        }}
      />
    </>
  );
}

/**
 * A loud, unmissable label for which authority this harness is running.
 *
 * This page mounts the SAME `DuelScreen` the shipped mission does, so on screen it
 * is indistinguishable from the real duel — and by default (`?verdict=alt`) it is
 * driven by a SCRIPTED stand-in that never reads the answer and returns
 * CORRECT/WRONG by round parity. That is exactly the "no matter what I answer it's
 * 14, 7, 14" report: the numbers are the alternating script, not a verdict, and the
 * grader is never asked. The banner exists so this harness can never again be
 * mistaken for the shipped, graded duel. It is dev-only; nothing renders it in the
 * production build, whose entry is `/index.html`.
 */
function HarnessBanner(props: { mode: string }) {
  const live = props.mode === "live";
  return (
    <div
      role="note"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: "6px 12px",
        font: "600 12px/1.4 ui-monospace, monospace",
        letterSpacing: "0.02em",
        color: live ? "#04210f" : "#2a1400",
        background: live ? "#7CFC9A" : "#FFC24B",
        borderBottom: `2px solid ${live ? "#0a6" : "#a65"}`,
        textAlign: "center",
        pointerEvents: "none",
      }}
    >
      {live
        ? "DEV DUEL HARNESS · verdict=live · answers ARE graded by the real server (/v1)."
        : `DEV DUEL HARNESS · verdict=${props.mode} · SCRIPTED — answers are NOT graded; bullets follow a fixed script, not your answer. This is not the shipped duel — play the game at /index.html, or add ?verdict=live to grade here.`}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
