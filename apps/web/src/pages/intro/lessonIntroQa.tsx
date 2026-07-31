import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { LessonIntro } from "./LessonIntro.js";
import "../../styles.css";

// Dev-only harness for the LESSON intake cutscene. Not shipped and not routed:
// in play it opens the module phase behind the attempt gate (MissionDeck), which
// needs a server-opened attempt. This mounts the same component on its own so the
// clip, its captions, Skip and Escape can be played and captured directly.
//
//   ?reduced=1   reduced motion (the clip gets native controls).

const reducedMotion = new URLSearchParams(window.location.search).get("reduced") === "1";

function Harness() {
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);

  // Entered by a click, exactly as Deploy enters it in play. That is not just
  // staging: audible playback depends on the document having been activated, so
  // a harness that auto-played would test a quieter cutscene than the real one.
  if (!started) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh", background: "#05090f" }}>
        <button
          type="button"
          data-testid="deploy"
          onClick={() => setStarted(true)}
          style={{
            padding: "14px 28px", fontSize: 18, fontFamily: "system-ui",
            color: "#d8f4ff", background: "#123a5f", border: "1px solid #4aa3d8",
            borderRadius: 8, cursor: "pointer",
          }}
        >
          Deploy
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div
        role="status"
        data-testid="lesson-intro-done"
        style={{ color: "#c9fff2", padding: 40, fontFamily: "system-ui" }}
      >
        <h1>Lesson intake finished</h1>
        <p>In play this is where the Archive's case-file index takes over.</p>
        <button type="button" onClick={() => { setDone(false); setStarted(false); }}>
          Again
        </button>
      </div>
    );
  }
  return <LessonIntro reducedMotion={reducedMotion} onDone={() => setDone(true)} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
