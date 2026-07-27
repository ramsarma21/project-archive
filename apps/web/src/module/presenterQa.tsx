import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { M1_MODULE } from "./m1Module.js";
import { SystemPresenter } from "./SystemPresenter.js";
import type { ModuleShotKind } from "./moduleShots.js";
import "./module.css";
import "../styles.css";

// Dev-only close-up QA harness. It mounts the SHIPPED SystemPresenter inside the
// SHIPPED cinematic room chrome (so the face is judged in real context), at a
// static shot chosen by query param, and does nothing else — no timeline, no
// subtitle band, no scrim — so a capture script can frame the head and shoulders
// tightly at native resolution. This changes no production code path.
//
//   ?shot=REACTION|PRESENTER_MEDIUM|OVER_SHOULDER  (default REACTION)
//   ?reduced=1                                     reduced motion

const params = new URLSearchParams(window.location.search);
const shot = (params.get("shot") ?? "REACTION") as ModuleShotKind;
const reduced = params.get("reduced") === "1";

function PresenterQa() {
  const presenter = M1_MODULE?.presenter;
  if (!presenter) {
    return (
      <div style={{ color: "#fff", padding: 40, fontFamily: "system-ui" }}>
        M1 presenter unavailable. See console.
      </div>
    );
  }
  return (
    <div className="mod mod-cine" data-shot={shot} data-phase="PLAYING" style={{ position: "fixed", inset: 0 }}>
      <div className="mod-cine-room" aria-hidden="true">
        <div className="mod-cine-fog" />
        <div className="mod-cine-grid" />
        <div className="mod-cine-vignette" />
      </div>
      <div className="mod-cine-presenter">
        <SystemPresenter
          presenter={presenter}
          speaking
          shot={shot}
          reducedMotion={reduced}
          speechCueId="qa-closeup"
          speechText="Boston, the fourteenth of August, seventeen sixty-five."
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PresenterQa />
  </StrictMode>,
);
