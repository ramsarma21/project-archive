import { useState } from "react";
import { ModuleArchive } from "../module/ModuleArchive.js";
import { LessonIntro } from "../pages/intro/LessonIntro.js";
import { MissionRun } from "./MissionRun.js";
import { MISSION_BLOCK_COPY } from "./session.js";
import type { MissionSessionApi } from "./useMissionSession.js";
import "./mission.css";

// ---------------------------------------------------------------------------
// The hub's one mount point for all gameplay.
//
// The hub renders this once, unconditionally, and hides its own chrome while
// `session.isForeground`. Everything between pressing Deploy and coming back with
// a result happens inside here: the mandatory module, the instanced level, the
// duel, and the result.
//
// The module is rendered here rather than by the hub deliberately. It is the first
// phase of a mission attempt, not a hub surface — a player is already inside an
// attempt's gate when they are reading it — and mounting it anywhere else invites
// a second route into a mission that does not pass through the gate.
//
// The LESSON INTAKE cutscene opens that module phase, for the same reason: it is
// the briefing for an attempt the player is already inside, so it belongs behind
// the gate rather than on the hub. It is distinct from the game-open `GameIntro`,
// which runs once per launch on the way to the hub and is untouched by this.
// ---------------------------------------------------------------------------

export function MissionDeck(props: {
  session: MissionSessionApi;
  reducedMotion: boolean;
}) {
  const { session } = props;
  const phase = session.phase;

  // Which module run has already had its intake cutscene. Keyed by run rather
  // than a boolean so a second attempt is briefed again, and so leaving the
  // module and coming back does not silently skip it.
  const [briefedRun, setBriefedRun] = useState<string | null>(null);

  if (phase.phase === "IDLE" || phase.phase === "DEPLOYING") return null;

  if (phase.phase === "BLOCKED") {
    return (
      <aside className="msn-block" role="status">
        <span className="msn-block-kicker">Deploy refused</span>
        <p className="msn-block-copy">{MISSION_BLOCK_COPY[phase.reason]}</p>
        <button type="button" onClick={session.dismissBlock}>
          Understood
        </button>
      </aside>
    );
  }

  if (phase.phase === "MODULE") {
    const runKey = `${phase.definition.moduleId}#${phase.attemptOrdinal}`;
    if (briefedRun !== runKey) {
      return (
        <LessonIntro
          reducedMotion={props.reducedMotion}
          onDone={() => setBriefedRun(runKey)}
        />
      );
    }
    return (
      <ModuleArchive
        definition={phase.definition}
        attemptOrdinal={phase.attemptOrdinal}
        reducedMotion={props.reducedMotion}
        onComplete={session.completeModule}
        onExit={session.abandonModule}
      />
    );
  }

  return <MissionRun session={session} reducedMotion={props.reducedMotion} />;
}
