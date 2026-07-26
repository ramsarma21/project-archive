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

  const authority = useMemo(() => {
    const mode = params.get("verdict") ?? "alt";
    if (mode === "live") return httpVerdictAuthority;
    if (mode === "correct") return createStandInVerdictAuthority(() => "CORRECT", 260);
    if (mode === "wrong") return createStandInVerdictAuthority(() => "WRONG", 260);
    return createStandInVerdictAuthority(alternatingVerdicts, 260);
  }, []);

  const grip = useMemo(gripFromParams, []);
  const inspect = useMemo(inspectFromParams, []);

  return (
    <DuelScreen
      descriptor={descriptor}
      verdictAuthority={authority}
      reducedMotion={params.get("reduced") === "1"}
      playerGrip={grip}
      opponentGrip={grip}
      inspect={inspect}
      onRuntime={(runtime) => {
        // Inspection handle: lets a capture script read the phase, the tick and the
        // poses instead of guessing them from pixels.
        (window as unknown as { __duel?: unknown }).__duel = runtime;
      }}
      onAgain={() => setRunId((value) => value + 1)}
      onResolved={(outcome, commitLog) => {
        console.log("[duel] resolved", outcome, commitLog);
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
