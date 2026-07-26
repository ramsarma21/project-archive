import { useMemo } from "react";
import { SystemPanel } from "./SystemPanel.js";
import { TypedLines } from "./TypedLines.js";
import {
  missionKindLabel,
  missionLine,
  missionStatusLabel,
  type MissionNode,
} from "./hubState.js";

/**
 * What the System has to say about the operation under the cursor, and the
 * button that commits to it. There is one difficulty, so there is nothing here
 * to weigh: the panel names the operation, states whether it is open, and
 * offers Deploy.
 *
 * `preview` is true while the read comes from a hovered/focused node rather
 * than the committed selection.
 */
export function AssessmentPanel(props: {
  mission: MissionNode | undefined;
  preview: boolean;
  delay: number;
  reducedMotion: boolean;
  onDeploy: (missionId: string) => void;
}) {
  const { mission } = props;
  const status = mission?.status;

  // The System speaks when its reading changes, not on every hover: keying the
  // typed line on the status alone keeps a scrub across locked nodes silent.
  const spokenLines = useMemo(
    () => (status ? [missionLine(status)] : []),
    [status],
  );

  if (!mission) {
    return (
      <SystemPanel kicker="Assessment" from="right" delay={props.delay} className="hub-panel-assess">
        <p className="hub-assess-empty">Select an operation on the map.</p>
      </SystemPanel>
    );
  }

  const locked = mission.status === "LOCKED";

  return (
    <SystemPanel
      kicker={props.preview ? "Assessment · preview" : "Assessment"}
      from="right"
      delay={props.delay}
      className="hub-panel-assess"
      meta={
        <span className={`hub-assess-status is-${mission.status.toLowerCase()}`}>
          {missionStatusLabel(mission.status)}
        </span>
      }
    >
      <div className="hub-assess-head">
        <h3 className="hub-assess-title">{mission.title}</h3>
        <span className="hub-assess-kind">{missionKindLabel(mission.kind)}</span>
      </div>

      {/* The System's own words about this operation, typed as it speaks. */}
      <TypedLines
        lines={spokenLines}
        reducedMotion={props.reducedMotion}
        className="hub-assess-voice"
      />

      <div className="hub-assess-actions">
        <button
          type="button"
          className="hub-deploy"
          disabled={locked}
          onClick={() => props.onDeploy(mission.id)}
        >
          {locked ? "Locked" : "Deploy"}
        </button>
      </div>
    </SystemPanel>
  );
}
