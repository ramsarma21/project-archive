import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import {
  DETECTION_CAUSE_LABEL,
  STEALTH_TUNING,
} from "@pa/engine-world";
import {
  crowdLabel,
  dawnSky,
  dawnStageLabel,
  shadowLabel,
  type DawnRead,
} from "./dawn.js";
import { MISSION_LEGEND } from "./missionInput.js";
import type { MissionPresentation, MissionStandingRead } from "./traversal.js";

// ---------------------------------------------------------------------------
// The mission HUD.
//
// It reports and never asks. There is no question surface on this overlay and no
// way to put one here: the three minutes contain zero knowledge checks by design,
// and the way that stays true is that the only thing on screen while the player is
// moving is state they already earned.
//
// Everything drawn is a projection sampled from the simulation eight times a
// second (see MissionStage). Nothing here can drive the run.
//
// It carries ONE objective at a time. The mission is a sequence of required
// steps and a player mid-run can hold one of them; the six-row list this used
// to print — two required steps and four optional challenges, all the same size
// in the corner of a dark frame — is why a playtester came out of the mission
// saying it had no objectives at all. Where that step IS is not drawn here: it
// is a mark in the street, because a direction belongs in the world. See
// `VisorRunMark`.
//
// The clock is the one thing on this overlay a player is meant to feel pressed
// by, and it is drawn as dawn rather than as a countdown to failure — because
// nothing fails on time. What the number is really counting down to is the
// moment the dark and the crowd stop hiding you, so the two things they are
// losing are printed next to it. See dawn.ts.
// ---------------------------------------------------------------------------

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The clock, as the last of the night.
 *
 * Two readings of one fact, because a number alone is a rule to be told and a
 * colour alone is a mood. The band is the sky's own colour at this moment with
 * the night spent so far filled in, and the digits are the minutes and seconds
 * left of it. Past the budget the digits keep counting, upward and marked as
 * over, since the run is still perfectly winnable — it is just winnable in the
 * open now.
 */
function DawnClock(props: { dawn: DawnRead }) {
  const { dawn } = props;
  const sky = dawnSky(dawn.lift01);
  const past = dawn.pastS > 0;

  if (!dawn.hasClock) {
    // A level that declared no budget gets no clock rather than a NaN.
    return (
      <div className="msn-hud-clock">
        <span className="msn-hud-clock-now">{clock(dawn.elapsedS)}</span>
        <span className="msn-hud-clock-target">elapsed · untimed</span>
      </div>
    );
  }

  return (
    <div
      className={`msn-hud-clock${past ? " is-over" : ""}`}
      aria-label="Time to dawn"
    >
      <span
        className="msn-hud-dawn-band"
        style={{ background: sky.sky }}
        aria-hidden="true"
      >
        <span
          className="msn-hud-dawn-band-fill"
          style={{
            width: `${Math.round(dawn.lift01 * 100)}%`,
            background: `linear-gradient(90deg, ${sky.sky}, ${sky.horizon})`,
          }}
        />
      </span>
      <span className="msn-hud-clock-now" role="timer">
        {past ? `+${clock(dawn.pastS)}` : clock(dawn.remainingS)}
      </span>
      <span className="msn-hud-clock-target">
        {past ? "past dawn" : "to dawn"} · {dawnStageLabel(dawn.stage).toLowerCase()}
      </span>
    </div>
  );
}

/**
 * The two things dawn is taking away, and how much of each is left.
 *
 * Drawn because the design's whole answer to urgency is that the clock costs the
 * player their tools rather than their attempt: a player who cannot see the dark
 * and the crowd going is a player being punished by something invisible, which is
 * the version that reads as unfair.
 *
 * The crowd row prints the counted bodies against the number the engine needs to
 * hide anybody, rather than a bar. "5 bodies · 4 hides you" teaches the rule in
 * one glance and is exactly the arithmetic `clusterContaining` is doing.
 */
function CoverPanel(props: {
  dawn: DawnRead;
  clusters: MissionPresentation["crowdClusters"];
}) {
  const { dawn } = props;
  const thickest = props.clusters.reduce(
    (most, cluster) => Math.max(most, cluster.density),
    0,
  );
  const needed = STEALTH_TUNING.crowdBlendMinDensity;
  const crowdGone = thickest < needed;

  return (
    <section className="msn-hud-card" aria-label="What still hides you">
      <span className="msn-hud-card-kicker">
        {dawnStageLabel(dawn.stage)} · what still hides you
      </span>

      <div className="msn-hud-cover-row">
        <span className="msn-hud-meter" role="presentation">
          <span
            className="msn-hud-meter-fill is-shadow"
            style={{ width: `${Math.round(dawn.shadowHold01 * 100)}%` }}
          />
        </span>
        <span className="msn-hud-note">{shadowLabel(dawn)}</span>
      </div>

      {props.clusters.length > 0 && (
        <div className="msn-hud-cover-row">
          <span
            className={`msn-hud-note${crowdGone ? " is-lost" : ""}`}
            aria-label="Crowd cover"
          >
            {crowdLabel(thickest)}
          </span>
          <span className="msn-hud-note is-quiet">
            {thickest} {thickest === 1 ? "body" : "bodies"} · {needed} hides you
          </span>
        </div>
      )}
    </section>
  );
}

/**
 * The one thing to be doing, and the one after it.
 *
 * This replaced a six-row checklist, and the checklist was the reason the
 * mission read as having no objectives at all. Every required step and every
 * optional challenge was printed at once, in one column, in the same size — so
 * the sentence a player needed at a sprint ("nail the handbill to the Liberty
 * Tree") was the first of six lines of equal weight in the corner of a frame
 * whose middle was a dark street. A list is a thing to read, and nobody reads
 * at a sprint.
 *
 * So: the current step is the headline, the step after it is named once and
 * dimly so the run has a shape rather than just a next, and the optional
 * challenges are counted and not named. They are challenges, and a player who
 * has been told four extra things to do has not been told the one thing they
 * have to.
 *
 * The range comes from the same read the mark in the street is drawing, so the
 * plate on the elm and the figure in the corner cannot disagree.
 */
function ObjectiveSpine(props: { standing: MissionStandingRead }) {
  const { standing } = props;
  const mark = standing.mark;

  return (
    <section className="msn-hud-card is-objective" aria-label="Objective">
      <span className="msn-hud-card-kicker">
        Objective · {standing.step} of {standing.steps}
      </span>
      <span className="msn-hud-objective-now">{standing.label}</span>

      {mark && (
        <span className="msn-hud-objective-range">
          <span className="msn-hud-objective-metres">
            {/* The tilde says the figure is the straight line because the route
                graph could not walk it from here. Two different measurements
                must not print identically. */}
            {mark.viaRoute ? "" : "~"}
            {Math.max(1, Math.round(mark.rangeM))} m
          </span>
          <span className="msn-hud-note is-quiet">{mark.title}</span>
        </span>
      )}

      {/* The imminent authored move, named the moment the guidance arms its
          gateway. This is the corner half of the wayfinding fix: the in-street
          mark posts the verb on the take-off, and this says the same word where
          a HUD-watching player is already looking, so "that scaffold is a
          climb" arrives before the run at it rather than after braking at it. */}
      {mark?.action && (
        <span
          className={`msn-hud-actioncue${mark.action.kind === "LEAP_OF_FAITH" ? " is-leap" : ""}`}
          role="status"
          aria-label="Your next move"
        >
          {mark.action.label}
        </span>
      )}

      {/* The current SAFE leg is authored below a run — a narrow ledge or beam —
          so a held sprint is capped to it. Said BEFORE the lip, not after the
          reader has already braked the body, so a player knows to ease off. */}
      {mark?.speedCapMps != null && (
        <span className="msn-hud-walkcue" role="status" aria-label="Walk this leg">
          SAFE · WALK
        </span>
      )}

      {standing.thenLabel && (
        <span className="msn-hud-objective-then">then {standing.thenLabel}</span>
      )}

      {standing.optionalTotal > 0 && (
        <span className="msn-hud-note is-quiet">
          {standing.optionalMet} of {standing.optionalTotal} challenges taken
        </span>
      )}
    </section>
  );
}

const ALERT_COPY: Readonly<Record<string, string>> = {
  UNAWARE: "Unnoticed",
  CURIOUS: "Something heard",
  INVESTIGATING: "Being looked for",
  SEARCHING: "Searched",
  ALERTED: "Seen",
};

/**
 * One line under the suspicion bar: what being seen is currently costing.
 *
 * IT USED TO SAY "position lost" AND THAT WAS NOT TRUE. Nothing about the
 * player's position changed when they were read: the line was a caption for a
 * consequence the game did not have, printed over a world in which every
 * watcher stayed on his mark. The consequence exists now — men walk onto the
 * ground you were seen on — so the line's job is to say the one thing a player
 * can act on, which `readout.hunt` has been computing all along and nothing has
 * ever drawn: how much further they have to get before the search breaks.
 *
 * "Eleven metres to break away" is an instruction. "You were seen" is a
 * notification, and a player who is being told only that has been told nothing.
 */
function huntNote(view: MissionPresentation): string {
  const hunt = view.stealth.readout?.hunt;
  if (!hunt?.active) {
    return view.detections === 0
      ? "Not yet read"
      : `Read ${view.detections}× · clear for now`;
  }
  if (hunt.hold === "STILL_SEEN") return "They still have you. Break away";
  const metres = Math.ceil(hunt.metresToClear);
  return metres > 0
    ? `Searched here · ${metres} m more to lose them`
    : "Clear of it — keep going";
}

/**
 * The one thing making the player visible right now, in their own words.
 *
 * This is what `stealth/readout.ts` exists for — its header names "being caught
 * and not knowing why" as the worst failure a stealth game can have — and the
 * `cause` it ranks every tick reached no surface. The whole ladder above it was
 * drawn: the state as a word, the suspicion as a bar, the hunt as a distance.
 * None of those says which of the eight things the player is doing is the one
 * getting them read, and that is the only part of it they can act on.
 *
 * Null while nobody is resolving the player. `NO_CONTACT` is the readout's word
 * for "nothing has you", which the line above already says better; printing
 * "Nobody is looking at you" under a flat bar is a row that is never not true.
 */
function causeNote(view: MissionPresentation): string | null {
  const cause = view.stealth.readout?.cause;
  if (!cause || cause === "NO_CONTACT") return null;
  return DETECTION_CAUSE_LABEL[cause];
}

export function MissionHud(props: {
  title: string;
  attemptOrdinal: number;
  presentation: MissionPresentation;
  onAbandon: () => void;
}) {
  const view = props.presentation;
  const cause = causeNote(view);

  // The exposure bar reads the LOUDER of the field's own suspicion and the
  // encounter-notice surge, so a stop arming after the drop drives the same bar
  // the player already watches. `noticed` is the encounter dominating — it puts
  // the bar into its surge/flash treatment (calmed to a static fill under
  // prefers-reduced-motion, in CSS) and renames the state to "Spotted".
  const notice = view.encounterNotice01;
  const fieldSuspicion = view.stealth.suspicion;
  const exposure = Math.max(fieldSuspicion, notice);
  const noticed = notice > 0.15 && notice >= fieldSuspicion;
  const exposureLabel = noticed
    ? "Spotted — hold"
    : ALERT_COPY[view.stealth.squadState] ?? view.stealth.squadState;

  return (
    <div className="msn-hud">
      <header className="msn-hud-top">
        <div className="msn-hud-ident">
          <span className="msn-hud-kicker">
            Operation · attempt {props.attemptOrdinal} of {MAX_MISSION_ATTEMPTS}
          </span>
          <span className="msn-hud-title">{props.title}</span>
        </div>

        {/* Counting down, and to dawn rather than to a loss. Running past it
            does not end the attempt — only the authored fail point and the duel
            do that — it costs the dark and the crowd, which the cover card
            below reports. */}
        <DawnClock dawn={view.dawn} />

        <button type="button" className="msn-hud-leave" onClick={props.onAbandon}>
          Abandon
        </button>
      </header>

      <div className="msn-hud-left">
        {/* Absent once every required step is met, which is the half-second
            between the last objective latching and the container resolving the
            run. A panel still asking for the handbill in that window would be
            asking for something already nailed up. */}
        {view.standing && <ObjectiveSpine standing={view.standing} />}

        <section
          className={`msn-hud-card${noticed ? " is-noticed" : ""}`}
          aria-label="Exposure"
        >
          {/* aria-live so a screen reader announces "Spotted" as the meter
              surges — the accessible half of the visible flash. */}
          <span className="msn-hud-card-kicker" role="status" aria-live="polite">
            {exposureLabel}
          </span>
          <div
            className={`msn-hud-meter${noticed ? " is-surge" : ""}`}
            role="presentation"
          >
            <span
              className="msn-hud-meter-fill"
              style={{ width: `${Math.round(exposure * 100)}%` }}
            />
          </div>
          <span className="msn-hud-note">{huntNote(view)}</span>
          {cause && (
            <span className="msn-hud-note is-quiet" aria-label="Why you are visible">
              {cause}
            </span>
          )}
        </section>

        <CoverPanel dawn={view.dawn} clusters={view.crowdClusters} />
      </div>

      <div className="msn-hud-right">
        {view.flow.chain > 0 && (
          <span className={`msn-hud-chain${view.flow.inFlow ? " is-flow" : ""}`}>
            <span className="msn-hud-chain-count">{view.flow.chain}</span>
            <span className="msn-hud-chain-label">
              {view.flow.inFlow ? "flow" : "chain"}
            </span>
          </span>
        )}
        {/* Throw charges. Drawn because a throw can miss — it can hit a body and
            put the noise three metres from the player instead of eighteen — so a
            player needs to know what a wasted one costs. */}
        {view.stealth.diversionCharges > 0 && (
          <span className="msn-hud-charges">
            <span className="msn-hud-chain-count">
              {view.stealth.diversionCharges}
            </span>
            <span className="msn-hud-chain-label">throws · Q</span>
          </span>
        )}
        {view.stealth.reflexActive && (
          <span className="msn-hud-reflex" role="status">
            <span className="msn-hud-reflex-label">Reflex</span>
            <span className="msn-hud-meter">
              <span
                className="msn-hud-meter-fill is-reflex"
                style={{
                  width: `${Math.round((1 - view.stealth.reflexProgress) * 100)}%`,
                }}
              />
            </span>
          </span>
        )}
      </div>

      {/* The precision beat's panel is a surface of its own — a big holographic
          whack-a-mole the player clicks — so it lives in `MissionBeatPanel`,
          rendered by the container beside this HUD, not on this read-only overlay. */}

      {/* Generated from the binding table the key handler reads, so the two
          cannot disagree. The list used to be a hand-written string, which is
          how the dash came to be documented nowhere and bound to nothing. */}
      <footer className="msn-hud-keys" aria-hidden="true">
        {MISSION_LEGEND.map((row) => (
          <span className="msn-hud-key" key={row.keys}>
            <kbd>{row.keys}</kbd>
            {row.does.split(" — ")[0]}
          </span>
        ))}
      </footer>
    </div>
  );
}
