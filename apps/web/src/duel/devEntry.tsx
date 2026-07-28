import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { BossTier } from "@pa/duel";
import { m1DuelSeed } from "@pa/mission-m1";
import { DuelScreen, type DuelDescriptor } from "./DuelScreen.js";
import { m1DuelDescriptor } from "./m1Duel.js";
import {
  alternatingVerdicts,
  createStandInVerdictAuthority,
  httpVerdictAuthority,
} from "./duelGrading.js";
import { missionCast, missionDuelDescriptor } from "./missionBrief.js";
import { M1_MISSION_ID, duelBrief } from "../chapter/m1Mission.js";
import {
  establishLocalSession,
  getSession,
  postModuleCompletion,
  postOpenMissionAttempt,
} from "../api.js";
import type { InspectFraming } from "./duelCamera.js";
import type { GripTuning } from "./DuelActor.js";
import "../styles.css";

// WHY LIVE MODE NOW OPENS A REAL ATTEMPT.
//
// `?verdict=live` used to mount `m1DuelDescriptor` — a standalone descriptor whose
// duel id is `BOS.MD01.DUEL.A1` — with NO server session and NO open progression
// attempt. The verdict route (correctly) refuses that: it binds every verdict to
// the player's own open attempt and requires the posted duel id to be that
// attempt's canonical one, so every POST came back 401 (no session) and the client
// granted the maximum on its non-2xx fallback. A playtest here therefore graded
// NOTHING — a wrong answer paid the same fourteen balls as a right one — which is
// exactly the "grading has never worked" the boss-fight owner reported, because
// this shortcut is the path he plays on.
//
// The fix does NOT weaken the route's canonicality check. It establishes a
// legitimate attempt the same way the mission container does: a throwaway local
// dev profile gets a real session, records the module gate, and opens a real
// mission attempt; the duel is then built from that attempt's own ordinal and seed
// (`m1DuelId(ordinal)`, `m1DuelSeed(attemptSeedHex)`), so the id the client posts
// to is the attempt's canonical one and the item each round asks is the item the
// server grades. A fresh profile per load means every playtest is a clean attempt
// one and nothing a real player owns is ever spent.

const CHAPTER_ID = "boston-1765";
const MODULE_ID = "BOS.MD01.MODULE.BRIEF.v1";
// The module gate's inputs, transcribed from apps/api/src/progression/content.ts
// (the web build ships no content directory to import them from). The server
// re-derives the required set and refuses a completion missing any, so these must
// match the authored deck.
const MODULE_CUES = [
  "BOS.MD01.CUE.BRIEF_IDENTITY.v1",
  "BOS.MD01.CUE.BRIEF_POSTWAR.v1",
  "BOS.MD01.CUE.BRIEF_STAMP.v1",
  "BOS.MD01.CUE.BRIEF_REPRESENTATION.v1",
  "BOS.MD01.CUE.BRIEF_SYNTHESIS.v1",
  "BOS.MD01.CUE.BRIEF_INSERT.v1",
];
const MODULE_CHECKS = [
  "BOS.MD01.CHECK.POSTWAR_REVENUE.v1",
  "BOS.MD01.CHECK.STAMP_SCOPE.v1",
  "BOS.MD01.CHECK.REPRESENTATION.v1",
];

/** 32 random bytes as 64 lowercase hex, the shape a profile's variation seed takes. */
function randomSeedHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * What live mode is doing while it opens the attempt, or why it could not. Kept as
 * state so the harness can say so on screen rather than mounting a duel that will
 * silently grant everything.
 */
type LiveAttempt =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly descriptor: DuelDescriptor }
  | { readonly status: "error"; readonly message: string };

/**
 * Open a real, canonical, gradeable attempt on a throwaway local profile and build
 * the duel from it — the same construction the mission container uses, so the item
 * each round asks is the item the server grades and a wrong answer actually costs
 * bullets.
 */
async function openLivePracticeDuel(): Promise<DuelDescriptor> {
  const localProfileId = crypto.randomUUID();
  const established = await establishLocalSession({
    profileId: localProfileId,
    displayName: "duel-harness",
    seedHex: randomSeedHex(),
  });
  if (!established.ok) {
    throw new Error(
      `could not open a local session (${established.reason}). Is the API up on /v1?`,
    );
  }
  const session = await getSession();
  const csrf = session?.csrfToken;
  const profileId = session?.profile?.profileId;
  if (!csrf || !profileId) {
    throw new Error("the local session did not return a CSRF token and profile.");
  }
  const recorded = await postModuleCompletion(
    profileId,
    {
      chapterId: CHAPTER_ID,
      moduleId: MODULE_ID,
      gatesKind: "MISSION_ATTEMPT",
      gatesId: M1_MISSION_ID,
      acknowledgedCueIds: MODULE_CUES,
      acknowledgedCheckIds: MODULE_CHECKS,
      observedSeconds: 180,
    },
    csrf,
  );
  if (recorded.status !== "OK") {
    throw new Error(`the module gate was refused: ${JSON.stringify(recorded)}`);
  }
  const opened = await postOpenMissionAttempt(
    profileId,
    { chapterId: CHAPTER_ID, missionId: M1_MISSION_ID },
    csrf,
  );
  if (opened.status !== "OK") {
    throw new Error(`opening a mission attempt was refused: ${JSON.stringify(opened)}`);
  }
  const attempt = opened.value;
  const cast = missionCast(M1_MISSION_ID);
  if (!cast) throw new Error("no duel cast is registered for M1.");
  // The duel seed IS the attempt's own, derived exactly as the server derives it
  // when it selects the item for each round, so what the player is asked is what is
  // graded. `duelBrief` composes the canonical `m1DuelId(ordinal)`.
  const brief = duelBrief(m1DuelSeed(attempt.attemptSeedHex), attempt.attemptOrdinal);
  const descriptor = missionDuelDescriptor(brief, cast);
  // Dev-only introspection for capture scripts: which attempt this run opened.
  (window as unknown as { __duelDev?: unknown }).__duelDev = {
    profileId,
    attemptOrdinal: attempt.attemptOrdinal,
    attemptSeedHex: attempt.attemptSeedHex,
    duelId: descriptor.duelId,
  };
  return descriptor;
}

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
  const mode = params.get("verdict") ?? "alt";
  const isLive = mode === "live";

  // Scripted modes keep the standalone descriptor and never touch the server.
  const scriptedDescriptor = useMemo(
    () => m1DuelDescriptor({ attempt: 1 + runId, tier: (tier as BossTier) || 1 }),
    [runId, tier],
  );

  // Live mode opens a real attempt first, so the duel it mounts is canonical and
  // gradeable. Until it is ready there is nothing to fight, and if it fails the
  // harness says why rather than mounting a duel that would grant everything.
  const [live, setLive] = useState<LiveAttempt>({ status: "loading" });
  useEffect(() => {
    if (!isLive) return undefined;
    let cancelled = false;
    setLive({ status: "loading" });
    void openLivePracticeDuel()
      .then((descriptor) => {
        if (!cancelled) setLive({ status: "ready", descriptor });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLive({
            status: "error",
            message: cause instanceof Error ? cause.message : String(cause),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isLive, runId]);

  const authority = useMemo(() => {
    if (mode === "live") return httpVerdictAuthority;
    if (mode === "correct") return createStandInVerdictAuthority(() => "CORRECT", 260);
    if (mode === "wrong") return createStandInVerdictAuthority(() => "WRONG", 260);
    return createStandInVerdictAuthority(alternatingVerdicts, 260);
  }, [mode]);

  const grip = useMemo(gripFromParams, []);
  const inspect = useMemo(inspectFromParams, []);

  const descriptor = isLive
    ? live.status === "ready"
      ? live.descriptor
      : null
    : scriptedDescriptor;

  return (
    <>
      <HarnessBanner mode={mode} />
      {isLive && live.status === "loading" && (
        <BootstrapNotice>Opening a ranked practice attempt…</BootstrapNotice>
      )}
      {isLive && live.status === "error" && (
        <BootstrapNotice error>
          Could not open a gradeable attempt, so nothing here would be graded:{" "}
          {live.message}
        </BootstrapNotice>
      )}
      {descriptor && (
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
      )}
    </>
  );
}

/** A small centred banner for the live-mode bootstrap state. Dev-only chrome. */
function BootstrapNotice(props: { children: ReactNode; error?: boolean }) {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        padding: "24px",
        textAlign: "center",
        font: "600 14px/1.5 ui-monospace, monospace",
        color: props.error ? "#3a0a0a" : "#04210f",
        background: props.error ? "#ffd7d7" : "#0a0e14",
        ...(props.error ? {} : { color: "#9fdcff" }),
      }}
    >
      <div style={{ maxWidth: 560 }}>{props.children}</div>
    </div>
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
        ? "DEV DUEL HARNESS · verdict=live · a real graded attempt is opened on a throwaway profile, so a wrong answer costs half the magazine, just like real play."
        : `DEV DUEL HARNESS · verdict=${props.mode} · SCRIPTED — answers are NOT graded; bullets follow a fixed script, not your answer. This is not the shipped duel — play the game at /index.html, or add ?verdict=live to grade here.`}
    </div>
  );
}

// No StrictMode, deliberately, and for the same reason the mission floor harness
// drops it: this page now opens a REAL server session and attempt in an effect, and
// StrictMode's mount → unmount → remount double-invokes that effect. Two invocations
// establish two local sessions that fight over the one shared cookie, so the first's
// CSRF token no longer matches the cookie the second wrote and its module POST is
// refused 403 — leaving the harness flapping between "ready" and "could not open".
// The production container (useMissionSession) keeps its own StrictMode; this dev
// harness owns a single bootstrap and does not need the double-render check at the
// cost of a doubled login.
createRoot(document.getElementById("root")!).render(<Harness />);
