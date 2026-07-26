import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import { FIELD_TICK_HZ, STEALTH_TUNING } from "@pa/engine-world";
import type { BeatPresentation } from "@pa/beat";
import {
  crowdLabel,
  dawnSky,
  dawnStageLabel,
  shadowLabel,
  type DawnRead,
} from "./dawn.js";
import { MISSION_BINDINGS, MISSION_LEGEND } from "./missionInput.js";
import type { MissionPresentation } from "./traversal.js";

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

const ALERT_COPY: Readonly<Record<string, string>> = {
  UNAWARE: "Unnoticed",
  CURIOUS: "Something heard",
  INVESTIGATING: "Being looked for",
  SEARCHING: "Searched",
  ALERTED: "Seen",
};

/**
 * The beat, as one convergence per pending mark against one fixed line.
 *
 * Deliberately not a ring, an arc or a sweeping needle. Every one of those has
 * to be explained before it means anything, and the player is thirteen and has
 * never played osu. Two things touching is pre-verbal — it is the same read as
 * catching a ball — and there is exactly one moment when the mark is ON the
 * line, which everybody can see coming.
 *
 * `approach01` does all the work: 0 when a mark first becomes readable, exactly
 * 1.0 on its tick. The judgement bands arrive in the same normalised space, so
 * the target's width is a direct conversion and never a second tuning.
 */
function BeatPanel(props: { beat: BeatPresentation; inStance: boolean }) {
  const { beat } = props;
  const armed = beat.phase === "STRIKING" || beat.phase === "SETTLING";
  const done = beat.phase === "RESOLVED";
  if (!props.inStance && !armed) return null;

  const offset = beat.lastOffsetTicks;
  const direction =
    offset === null || beat.lastJudgement === null
      ? null
      : offset === 0
        ? "dead on"
        : `${Math.abs((offset / FIELD_TICK_HZ) * 1000).toFixed(0)}ms ${offset < 0 ? "early" : "late"}`;

  return (
    <section className="msn-beat" aria-label="The work">
      <span className="msn-beat-kicker">
        {/* Once the tacks are in there is nothing left to press, so the panel
            stops asking. A prompt that survives the thing it prompted for is how
            a player comes to believe they missed something. */}
        {done
          ? `The sheet is up · ${beat.grade.toLowerCase()}`
          : armed
            ? `${beat.struck} of ${beat.struck + beat.remaining} struck`
            : `Press ${MISSION_BINDINGS.strike.label} to start`}
      </span>

      <div className="msn-beat-lane" role="presentation">
        {/* The line does not move. Everything else arrives at it. */}
        <span
          className="msn-beat-window"
          style={{ width: `${beat.bands.glancing01 * 200}%` }}
        />
        <span
          className="msn-beat-window is-true"
          style={{ width: `${beat.bands.true01 * 200}%` }}
        />
        <span
          className="msn-beat-window is-flush"
          style={{ width: `${beat.bands.flush01 * 200}%` }}
        />
        <span className="msn-beat-line" />
        {armed
          ? beat.marks.map((mark) => (
              <span
                key={mark.index}
                className={`msn-beat-mark${mark.resolved ? " is-resolved" : ""}`}
                style={{ left: `${Math.min(100, mark.approach01 * 100)}%` }}
              />
            ))
          : /* In stance, the whole chart laid out at its real spacing, so the
               double is visible as a pair before a single stroke is made. */
            beat.preview.map((at, index) => (
              <span
                key={index}
                className="msn-beat-preview"
                style={{ left: `${at * 100}%` }}
              />
            ))}
      </div>

      {/* Early or late, not merely a grade. Which way a player missed is the
          only feedback that makes practice pay. */}
      <span className={`msn-beat-read${beat.heard ? " is-heard" : ""}`}>
        {direction
          ? `${beat.lastJudgement} · ${direction}`
          : "Six strokes. Off the beat is loud."}
      </span>
      <span className="msn-beat-heard">
        {beat.heard ? "He heard that" : "Nothing heard"}
      </span>
    </section>
  );
}

export function MissionHud(props: {
  title: string;
  attemptOrdinal: number;
  presentation: MissionPresentation;
  onAbandon: () => void;
}) {
  const view = props.presentation;
  const required = view.objectives.filter((objective) => objective.required);
  const metCount = required.filter((objective) => objective.met).length;

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
        <section className="msn-hud-card" aria-label="Route">
          <span className="msn-hud-card-kicker">
            Route · {metCount} of {required.length}
          </span>
          <ul className="msn-hud-objectives">
            {view.objectives.map((objective) => (
              <li
                key={objective.id}
                className={`msn-hud-objective${objective.met ? " is-met" : ""}${
                  objective.required ? "" : " is-optional"
                }`}
              >
                <span className="msn-hud-objective-mark" aria-hidden="true">
                  {objective.met ? "●" : "○"}
                </span>
                <span>{objective.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="msn-hud-card" aria-label="Exposure">
          <span className="msn-hud-card-kicker">
            {ALERT_COPY[view.stealth.squadState] ?? view.stealth.squadState}
          </span>
          <div className="msn-hud-meter" role="presentation">
            <span
              className="msn-hud-meter-fill"
              style={{ width: `${Math.round(view.stealth.suspicion * 100)}%` }}
            />
          </div>
          <span className="msn-hud-note">
            {view.detections === 0
              ? "Not yet read"
              : `Read ${view.detections}×· position lost`}
          </span>
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

      {view.beat && <BeatPanel beat={view.beat} inStance={view.inBeatStance} />}

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
