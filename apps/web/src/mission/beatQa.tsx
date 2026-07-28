import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  beatPresentation,
  createBeatRun,
  m1NailStanceBeat,
  stepBeat,
  type BeatPresentation,
  type BeatRun,
} from "@pa/beat";
import { MissionBeatPanel } from "./MissionBeatPanel.js";
import { createMissionInputState } from "./missionInput.js";
import "./mission.css";

// Harness for INSPECTING the elm beat's holographic panel in the states the live
// mission produces only in the middle of a three-minute run. Not shipped and not
// routed. It mounts the REAL `MissionBeatPanel` and drives the REAL @pa/beat
// machine to each state, so what is screenshotted is exactly what the shipped
// panel draws — only the seed and which state to stop at are injected.
//
//   ?state=idle|active|hit|miss|resolved   which state to capture (default active)
//   ?seed=n                                the attempt seed (default 7)
//   ?reduced=1                             reduced motion

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "active";
const reduced = params.get("reduced") === "1";
const seed = Number(params.get("seed") ?? 7);

/** Drive the real machine to the requested state and return its projection. */
function buildView(): { beat: BeatPresentation; inStance: boolean } {
  const spec = m1NailStanceBeat();
  let run: BeatRun = createBeatRun(spec, seed);
  let processed = -1;
  const view = (): BeatPresentation =>
    beatPresentation(run, processed < 0 ? 0 : processed);
  const tick = (hitCell: number | null): void => {
    processed += 1;
    run = stepBeat(run, { tick: processed, hitCell, inStance: true }).run;
  };

  if (state === "idle") return { beat: view(), inStance: true };

  // Arm, then run to the first live flare.
  tick(null);
  for (let guard = 0; guard < 600 && view().activeCell === null; guard += 1) tick(null);

  if (state === "active") return { beat: view(), inStance: true };

  if (state === "hit") {
    const cell = view().activeCell;
    if (cell !== null) tick(cell);
    return { beat: view(), inStance: true };
  }

  if (state === "miss") {
    // Let this flare fade without striking it.
    for (let guard = 0; guard < 600 && view().lastResult !== "MISS"; guard += 1) tick(null);
    return { beat: view(), inStance: true };
  }

  // resolved: play the whole act cleanly to the finish.
  for (let guard = 0; guard < 4000 && view().phase !== "RESOLVED"; guard += 1) {
    const cell = view().activeCell;
    tick(cell);
  }
  return { beat: view(), inStance: true };
}

function Harness() {
  const { beat, inStance } = buildView();
  const input = createMissionInputState();
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background:
          "radial-gradient(120% 90% at 50% 42%, #14263a 0%, #0a1622 55%, #05080d 100%)",
      }}
    >
      <MissionBeatPanel
        beat={beat}
        inStance={inStance}
        input={input}
        reducedMotion={reduced}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
