import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { M1_MODULE } from "./m1Module.js";
import { ModuleArchive } from "./ModuleArchive.js";
import type { ModuleRunCompletion } from "./moduleGate.js";
import "../styles.css";

// Dev-only harness for the Archive learning module. Not shipped and not routed:
// the hub deploys the real module through the mission session machine, behind
// the attempt gate and the account service. This mounts the SAME ModuleArchive
// with M1's own authored definition so the whole surface — the case-file index,
// the per-file cutscenes, the presenter, the subtitles, the voiceover controls
// and the mastery checks — can be played and captured without the gate in front.
//
//   ?reduced=1   reduced motion (flicker/drift removed; content stays visible).

const params = new URLSearchParams(window.location.search);
const reducedMotion = params.get("reduced") === "1";

function Harness() {
  const [completed, setCompleted] = useState<ModuleRunCompletion | null>(null);
  const [runId, setRunId] = useState(0);

  if (!M1_MODULE) {
    return (
      <div style={{ color: "#fff", padding: 40, fontFamily: "system-ui" }}>
        M1 module failed to load. See console.
      </div>
    );
  }

  if (completed) {
    // A capture script reads this to confirm the honest completion fired.
    (window as unknown as { __moduleComplete?: unknown }).__moduleComplete = completed;
    return (
      <div
        role="status"
        style={{ color: "#c9fff2", padding: 40, fontFamily: "system-ui" }}
        data-testid="module-complete"
      >
        <h1>Module complete</h1>
        <p>Cues acknowledged: {completed.acknowledgedCueIds.length}</p>
        <p>Checks mastered: {completed.acknowledgedCheckIds.length}</p>
        <p>Observed seconds: {completed.observedSeconds}</p>
        <button type="button" onClick={() => { setCompleted(null); setRunId((n) => n + 1); }}>
          Again
        </button>
      </div>
    );
  }

  return (
    <ModuleArchive
      key={runId}
      definition={M1_MODULE}
      attemptOrdinal={1}
      reducedMotion={reducedMotion}
      onComplete={setCompleted}
      onExit={() => setRunId((n) => n + 1)}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
