import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CodexOverlay } from "./CodexOverlay.js";
import type { CodexStandingLike } from "./codexView.js";

// A dev-only mount of the Codex binder, so it can be opened and screenshotted before
// the hub routes to it. Not in the production input list. A standing is hand-picked so
// the shot shows every card state: mastered, learned, and locked-with-trial.

const STANDING: CodexStandingLike = {
  pvpLegalCardIds: ["BOS.MD01.CARD.WAR_DEBT.v1"],
  learnedCardIds: [
    "BOS.MD01.CARD.WAR_DEBT.v1",
    "BOS.MD01.CARD.COLONIAL_REVENUE.v1",
    "BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1",
    "BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1",
  ],
};

const reduced = new URLSearchParams(location.search).get("reduced") === "1";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CodexOverlay open onClose={() => {}} codex={STANDING} reducedMotion={reduced} />
  </StrictMode>,
);
