import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import {
  duelSurfaceMode,
  duelView,
  type MissionDuelReport,
} from "./duelPort.js";
import { MissionHud } from "./MissionHud.js";
import { MissionResultPanel } from "./MissionResultPanel.js";
import { MissionStage } from "./MissionStage.js";
import {
  attachMissionInput,
  createMissionInputState,
} from "./missionInput.js";
import { missionDefinition } from "./missionFormat.js";
import type { MissionPresentation } from "./traversal.js";
import type { MissionSessionApi } from "./useMissionSession.js";
// The held moment. Imported rather than registered, which is the seam its author
// designed: the visor's index registers M1's annotation source at import time, so
// there is no install call for anyone to forget and no way for the briefing to
// stop existing quietly. See apps/web/src/visor/index.ts.
import { VisorHold, visorHoldsBriefing } from "../visor/index.js";
import "./mission.css";

// ---------------------------------------------------------------------------
// The instanced container.
//
// A mission is an instance, not a place: the player leaves the hub, one contained
// level is assembled for one attempt, it is played, and it is torn down. Nothing
// survives the return but the result.
//
// Every phase from LOADING onward is rendered here, and the canvas is mounted for
// exactly one of them. Unmounting it is the whole of stopping the simulation, so
// leaving a mission cannot leave a loop running: there is no loop outside the
// canvas to leave.
// ---------------------------------------------------------------------------

/** `?missionDev=1`. Only ever consulted when no duel view is registered. */
function harnessRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("missionDev") === "1";
  } catch {
    return false;
  }
}

function isDevBuild(): boolean {
  try {
    return Boolean(import.meta.env.DEV);
  } catch {
    return false;
  }
}

function Curtain(props: { kicker: string; headline: string; detail?: string }) {
  return (
    <div className="msn-curtain" role="status">
      <span className="msn-curtain-kicker">{props.kicker}</span>
      <h1 className="msn-curtain-headline">{props.headline}</h1>
      {props.detail && <p className="msn-curtain-detail">{props.detail}</p>}
    </div>
  );
}

/**
 * The duel's absence, said out loud.
 *
 * It offers exactly one way out, and it is a loss. There is no control here that
 * can clear a mission without the duel having been fought, because a container
 * that could hand out a clear would be handing out XP.
 */
function DuelUnavailable(props: {
  missionId: string;
  attemptOrdinal: number;
  onAbandon: (reason: string) => void;
  onDevWin: (() => void) | null;
}) {
  useEffect(() => {
    console.warn(
      `[mission] ${props.missionId} reached its duel on attempt ` +
        `${props.attemptOrdinal} and no duel view is registered. ` +
        "Call registerDuelView from apps/web/src/duel.",
    );
  }, [props.attemptOrdinal, props.missionId]);

  return (
    <div className="msn-curtain" role="status">
      <span className="msn-curtain-kicker">Route complete · duel armed</span>
      <h1 className="msn-curtain-headline">The duel is not built yet.</h1>
      <p className="msn-curtain-detail">
        The route held and the boss is waiting, but no duel view has registered
        itself with the container, so there is nothing to fight. Leaving here
        spends the attempt — the container will not hand out a clear it did not
        watch you earn.
      </p>
      <div className="msn-curtain-actions">
        <button
          type="button"
          onClick={() => props.onAbandon("no duel view registered")}
        >
          Concede the attempt
        </button>
        {props.onDevWin && (
          <button type="button" className="is-dev" onClick={props.onDevWin}>
            Dev only · report a win with no rounds
          </button>
        )}
      </div>
    </div>
  );
}

function AbandonConfirm(props: {
  attemptOrdinal: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="msn-confirm" role="alertdialog" aria-labelledby="msn-confirm-title">
      <h2 className="msn-confirm-title" id="msn-confirm-title">
        Leaving spends this attempt.
      </h2>
      <p className="msn-confirm-copy">
        This is attempt {props.attemptOrdinal} of {MAX_MISSION_ATTEMPTS}. Attempts
        are spent permanently and they do not come back — walking out counts as a
        failed run, and the next one requires the module again.
      </p>
      <div className="msn-confirm-actions">
        <button type="button" onClick={props.onCancel} autoFocus>
          Keep playing
        </button>
        <button type="button" className="is-destructive" onClick={props.onConfirm}>
          Leave · spend the attempt
        </button>
      </div>
    </div>
  );
}

/** The authored non-interactive handoff, with the player able to skip it. */
function BriefingCurtain(props: {
  headline: string;
  lines: readonly string[];
  targetSeconds: number;
  onDone: () => void;
}) {
  const { onDone, targetSeconds } = props;

  // One timeout, cleared on the way out. The handoff is authored as
  // non-interactive, so it advances itself; the skip exists because a player on
  // their third attempt has read it twice.
  useEffect(() => {
    const handle = window.setTimeout(onDone, Math.max(0, targetSeconds) * 1000);
    return () => window.clearTimeout(handle);
  }, [onDone, targetSeconds]);

  return (
    <div className="msn-curtain is-briefing" role="status">
      <span className="msn-curtain-kicker">Insertion</span>
      <h1 className="msn-curtain-headline">{props.headline}</h1>
      {props.lines.map((line, at) => (
        <p className="msn-curtain-detail" key={at}>
          {line}
        </p>
      ))}
      <div className="msn-curtain-actions">
        <button type="button" onClick={onDone}>
          Go now
        </button>
      </div>
    </div>
  );
}

export function MissionRun(props: {
  session: MissionSessionApi;
  reducedMotion: boolean;
}) {
  const { session } = props;
  const phase = session.phase;

  const [hud, setHud] = useState<MissionPresentation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const input = useMemo(createMissionInputState, []);

  const inTraversal = phase.phase === "TRAVERSAL";

  // Input is bound only while the player is actually moving. Nothing is listening
  // during the briefing, the duel or the result, so a stray key cannot bank a
  // jump that fires on the frame traversal begins.
  useEffect(() => {
    if (!inTraversal) return undefined;
    return attachMissionInput(input);
  }, [inTraversal, input]);

  // Escape opens the confirmation rather than leaving, because leaving spends an
  // attempt and a mis-hit Escape is not consent to that.
  useEffect(() => {
    if (!inTraversal) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setConfirming((current) => !current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inTraversal]);

  // A fresh attempt starts with a clean HUD rather than the last run's numbers.
  const attemptId = "ticket" in phase ? phase.ticket.attemptId : null;
  const lastAttempt = useRef<string | null>(null);
  if (attemptId !== lastAttempt.current) {
    lastAttempt.current = attemptId;
    if (hud !== null) setHud(null);
    if (confirming) setConfirming(false);
  }

  const missionId =
    "ticket" in phase ? phase.ticket.missionId : phase.phase === "RETURNING" ? phase.result.missionId : null;
  const title = (missionId && missionDefinition(missionId)?.title) || "Operation";

  // The ordinal is deliberately absent here. This is the round trip that
  // decides it, and printing this browser's guess for the half-second before
  // the server answers is how a retry came to advertise full XP.
  if (phase.phase === "AUTHORIZING") {
    return (
      <div className="msn">
        <Curtain
          kicker="Opening the attempt"
          headline="Logging the deck with the System."
          detail="It decides which attempt this is, and what it pays."
        />
      </div>
    );
  }

  if (phase.phase === "LOADING") {
    return (
      <div className="msn">
        <Curtain
          kicker={`Attempt ${phase.ticket.attemptOrdinal} of ${MAX_MISSION_ATTEMPTS}`}
          headline="Assembling the operation."
          detail="The module is behind you and the attempt is open."
        />
      </div>
    );
  }

  if (phase.phase === "BRIEFING") {
    // The first attempt is held at the spawn: the annotation comes up over the
    // view the player is standing in, and acknowledging is what starts the run.
    // Nothing here builds a runtime, so the mission clock cannot have begun —
    // TRAVERSAL creates it, and `elapsedS` is `ticks * FIELD_DT` counted from
    // zero, which is why "the clock starts when you release" is structural
    // rather than a number this phase has to remember not to touch.
    //
    // A retry gets the authored curtain instead. That is the same policy the
    // visor states in `visorHoldsBriefing`, and it is asked rather than
    // re-derived here so there is one answer to "does this attempt teach".
    if (visorHoldsBriefing(phase.ticket.attemptOrdinal)) {
      return (
        <div className="msn">
          <VisorHold
            instance={phase.instance}
            seed={phase.ticket.seed}
            reducedMotion={props.reducedMotion}
            onRelease={session.acknowledgeBriefing}
          />
        </div>
      );
    }
    return (
      <div className="msn">
        <BriefingCurtain
          headline={phase.briefing.headline}
          lines={phase.briefing.lines}
          targetSeconds={phase.briefing.targetSeconds}
          onDone={session.acknowledgeBriefing}
        />
      </div>
    );
  }

  if (phase.phase === "TRAVERSAL") {
    const runtime = session.runtime;
    if (!runtime) {
      return (
        <div className="msn">
          <Curtain kicker="Operation" headline="Assembling the operation." />
        </div>
      );
    }
    return (
      <div className="msn">
        <MissionStage
          runtime={runtime}
          input={input}
          reducedMotion={props.reducedMotion}
          paused={confirming}
          onResolved={session.resolveTraversal}
          onSample={setHud}
        />
        {hud && (
          <MissionHud
            title={title}
            attemptOrdinal={phase.ticket.attemptOrdinal}
            presentation={hud}
            onAbandon={() => setConfirming(true)}
          />
        )}
        {confirming && (
          <AbandonConfirm
            attemptOrdinal={phase.ticket.attemptOrdinal}
            onConfirm={() => session.abandonAttempt("left during traversal")}
            onCancel={() => setConfirming(false)}
          />
        )}
      </div>
    );
  }

  if (phase.phase === "DUEL") {
    const Duel = duelView();
    const mode = duelSurfaceMode({
      hasView: Duel !== null,
      isDevBuild: isDevBuild(),
      harnessRequested: harnessRequested(),
    });
    if (mode !== "VIEW" || !Duel) {
      const devWin =
        mode === "PENDING_WITH_DEV_WIN"
          ? () =>
              session.resolveDuel({
                won: true,
                outcome: {
                  winner: "A",
                  reason: "KNOCKOUT",
                  healthA: 100,
                  healthB: 0,
                  tiebreak: "NONE",
                },
                rounds: [],
                engagementSeconds: 0,
                committedEvents: [],
              } satisfies MissionDuelReport)
          : null;
      return (
        <div className="msn">
          <DuelUnavailable
            missionId={phase.ticket.missionId}
            attemptOrdinal={phase.ticket.attemptOrdinal}
            onAbandon={session.abandonAttempt}
            onDevWin={devWin}
          />
        </div>
      );
    }
    return (
      <div className="msn">
        <Duel
          brief={phase.instance.duel}
          missionId={phase.ticket.missionId}
          attemptOrdinal={phase.ticket.attemptOrdinal}
          reducedMotion={props.reducedMotion}
          onResolved={session.resolveDuel}
          onAbandon={session.abandonAttempt}
        />
      </div>
    );
  }

  if (phase.phase === "RESULT") {
    return (
      <div className="msn">
        <MissionResultPanel
          title={title}
          result={phase.result}
          onReturn={session.returnToHub}
        />
      </div>
    );
  }

  if (phase.phase === "RETURNING") {
    return (
      <div className="msn">
        <Curtain kicker="Returning" headline="Back to the Archive." />
      </div>
    );
  }

  return null;
}
