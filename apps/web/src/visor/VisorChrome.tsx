import { MISSION_LEGEND } from "../mission/missionInput.js";
import type { MissionBriefing } from "../mission/levelPort.js";
import type { VisorAnswers } from "./visorPlan.js";

// ---------------------------------------------------------------------------
// The inside of the visor.
//
// Screen-space, and diegetically so: this is the instrument the player is looking
// THROUGH, so its frame belongs to the glass rather than to the street. What that
// buys is the difference between a visor and a dialogue box — the aperture
// brackets, the ident and the readouts hug the edges and never take the middle of
// the screen, and there is no scrim, no centred panel, and nothing to dismiss. The
// player is looking at 1765 Boston the entire time.
//
// It answers exactly the four questions the held moment exists to answer, in the
// four corners, and nothing else:
//
//   top left      who is talking, and where and when this is
//   top right     where am I going, and what am I doing when I get there
//   bottom left   what is dangerous, and what the System has drawn about it
//   bottom strip  what my body can do
//
// The control legend is generated from `MISSION_LEGEND`, which is generated from
// the key bindings the handler actually binds. It cannot drift from the controls,
// and that is not tidiness: the dash spent a whole build bound to nothing because
// a legend and a key table were two lists.
//
// Nothing here is gated behind an animation. Every line is present from the first
// frame and merely fades in on a stagger, so a player who releases the visor
// immediately has not been denied anything, and reduced motion removes the fade
// without removing a word.
// ---------------------------------------------------------------------------

/** Splits "Run — and running is what lets the world vault" into its two halves. */
function splitDoes(does: string): { verb: string; clause: string | null } {
  const at = does.indexOf(" — ");
  if (at < 0) return { verb: does, clause: null };
  return { verb: does.slice(0, at), clause: does.slice(at + 3) };
}

function Row(props: {
  kicker: string;
  children: React.ReactNode;
  delay: number;
}) {
  return (
    <div
      className="visor-row"
      style={{ ["--visor-delay" as string]: `${props.delay}ms` }}
    >
      <span className="visor-row-kicker">{props.kicker}</span>
      <div className="visor-row-body">{props.children}</div>
    </div>
  );
}

export function VisorChrome(props: {
  briefing: MissionBriefing;
  answers: VisorAnswers;
  /** True once the player has asked to go. Drives the chrome's own dissolve. */
  releasing: boolean;
  onRelease: () => void;
}) {
  const { answers } = props;

  return (
    <div className={`visor-chrome${props.releasing ? " is-releasing" : ""}`}>
      {/* The aperture. Four corner brackets and a faint wash, so the chrome and
          the world sit in one projected image rather than looking like DOM over
          a photograph. Straight out of the hub's own vignette. */}
      <div className="visor-aperture" aria-hidden="true">
        <span className="visor-corner is-tl" />
        <span className="visor-corner is-tr" />
        <span className="visor-corner is-bl" />
        <span className="visor-corner is-br" />
      </div>
      <div className="visor-wash" aria-hidden="true" />

      <header className="visor-ident" style={{ ["--visor-delay" as string]: "0ms" }}>
        <span className="visor-sigil" aria-hidden="true">
          ◆
        </span>
        <span className="visor-ident-text">
          <span className="visor-wordmark">THE SYSTEM</span>
          <span className="visor-ident-mode">Visor · reconnaissance overlay</span>
        </span>
      </header>

      <section className="visor-panel visor-panel-brief" aria-live="polite">
        <p
          className="visor-where"
          style={{ ["--visor-delay" as string]: "120ms" }}
        >
          {props.briefing.headline}
        </p>
        {props.briefing.lines.map((line, index) => (
          <p
            key={index}
            className="visor-voice"
            style={{ ["--visor-delay" as string]: `${260 + index * 180}ms` }}
          >
            {line}
          </p>
        ))}
      </section>

      <section className="visor-panel visor-panel-plan">
        <Row kicker="Destination" delay={620}>
          <span className="visor-strong">{answers.destination}</span>
          <span className="visor-metric">
            {answers.destinationRange} · {answers.bearing}
          </span>
        </Row>
        <Row kicker="On arrival" delay={760}>
          <ol className="visor-list">
            {answers.objectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ol>
        </Row>
      </section>

      <section className="visor-panel visor-panel-threat">
        <Row kicker="Opposition" delay={900}>
          <span className="visor-strong is-warn">{answers.dangerHeadline}</span>
          <span className="visor-metric">{answers.dangerDetail}</span>
        </Row>
        {/* What the areas out there are worth. One row per area the visor
            actually drew, in the level's own words, so a sentence here always
            has a shape in the street to belong to. */}
        {answers.cover.length > 0 && (
          <Row kicker="Ground" delay={980}>
            <ul className="visor-lines">
              {answers.cover.map((area) => (
                <li key={area.label} className={`is-${area.kind.toLowerCase()}`}>
                  <span className="visor-line-tag">{area.label}</span>
                  <span className="visor-line-promise">{area.detail}</span>
                </li>
              ))}
            </ul>
          </Row>
        )}
        {answers.lines.length > 0 && (
          <Row kicker="Lines drawn" delay={1060}>
            <ul className="visor-lines">
              {answers.lines.map((line) => (
                <li key={line.line} className={`is-${line.line.toLowerCase()}`}>
                  <span className="visor-line-tag">{line.line}</span>
                  <span className="visor-line-promise">{line.promise}</span>
                </li>
              ))}
            </ul>
          </Row>
        )}
      </section>

      <section className="visor-legend">
        <span className="visor-legend-kicker">What your body does</span>
        <ul className="visor-legend-keys">
          {MISSION_LEGEND.map((entry, index) => {
            const { verb, clause } = splitDoes(entry.does);
            return (
              <li
                key={entry.keys}
                style={{ ["--visor-delay" as string]: `${1120 + index * 55}ms` }}
              >
                <kbd>{entry.keys}</kbd>
                <span className="visor-legend-verb">{verb}</span>
                {clause && <span className="visor-legend-clause">{clause}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="visor-release">
        <span className="visor-look-hint">Drag to look around</span>
        <button
          type="button"
          className="visor-release-button"
          onClick={props.onRelease}
          autoFocus
        >
          <kbd>Space</kbd>
          <span>
            Release the visor
            <em>The clock starts when you do</em>
          </span>
        </button>
      </div>
    </div>
  );
}
