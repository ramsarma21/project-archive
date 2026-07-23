import type { RuntimeView } from "@pa/contracts";

export const OBJ_LABELS: Record<string, string> = {
  REPORT_TO_MERCER: "Report to Abigail Mercer",
  THOMAS_CIRCULAR: "Deliver circular to Thomas",
  PIKE_PROOF: "Bring Pike his proof",
  CUSTOMHOUSE_NOTICE: "Post the Custom House notice",
  RIDER_HANDBILLS: "Handbills to the rider",
  OBSERVE_CROWD: "See the gathering crowd",
  RETURN_TO_PRESS: "Return to the press",
  SET_HEADLINE: "Set tomorrow's headline",
};

const SIDE_JOB_LABELS: Record<string, string> = {
  "SJ-tavern-note": "A quiet note",
  "SJ-dock-haul": "A barrel before the tide",
  "SJ-roof-kid": "The boy on the scaffold",
  "SJ-crier": "Take up the cry",
  "SJ-ropewalk": "A strand down the walk",
  "CH-agitator-dare": "The watched crossing",
  "CH-rooftop-run": "The short roof-board run",
  "CH-lose-the-watch": "Lose the watch",
};

// Live (accepted, in-progress) side jobs for the task strip. Mid-job the HUD
// used to point 139m away at the main errand while the job's own breadcrumbs
// lived only in the Log (feel-audit-1 P1-10).
export function activeSideJobs(
  view: RuntimeView | null,
): { activityId: string; label: string; breadcrumb: string | null }[] {
  if (!view) return [];
  return Object.values(view.field.activities)
    .filter(
      (activity) =>
        activity.stage !== "AVAILABLE" &&
        activity.stage !== "DORMANT" &&
        activity.stage !== "COMPLETED",
    )
    .map((activity) => ({
      activityId: activity.activityId,
      label: SIDE_JOB_LABELS[activity.activityId] ?? activity.activityId,
      breadcrumb: activity.breadcrumb,
    }));
}

// Selected -> saturated gold; available (runtime "ACTIVE") -> neutral aged
// brass (never a literal blue world marker, per the marker replacement spec);
// finished work checks off; closed work greys out.
function markerClass(status: string): string {
  switch (status) {
    case "SELECTED": return "gold";
    case "ACTIVE": return "available";
    case "COMPLETED": return "done";
    case "MISSED":
    case "FAILED": return "missed";
    default: return "";
  }
}

// Persistent Iron-man style holographic task strip rendered over the world.
// It mirrors world markers one-to-one: the selected stop is gold, available
// stops are neutral aged brass, and finished work checks off. The strip is the Archive's
// collapsed state: when onExpand is wired it becomes clickable and blooms
// into the full Archive overlay (Day-1 §4A).
export function HoloTasks(props: {
  view: RuntimeView | null;
  hidden?: boolean;
  onExpand?: () => void;
}) {
  const v = props.view;
  if (!v || props.hidden) return null;
  const visible = Object.entries(v.objectives).filter(
    ([, s]) => s !== "NOT_YET_ELIGIBLE" && s !== "HIDDEN",
  );
  if (visible.length === 0) return null;
  const hasSelected = visible.some(([, status]) => status === "SELECTED");
  const rows = hasSelected
    ? visible.filter(([, status]) => status !== "ACTIVE")
    : visible;
  const expandable = Boolean(props.onExpand);
  return (
    <aside
      className={`holo-tasks${expandable ? " holo-tasks-expandable" : ""}`}
      aria-label="Today's tasks"
      onClick={expandable ? props.onExpand : undefined}
    >
      <div className="jarvis-objective-header">
        <span className="jarvis-orbit" aria-hidden="true"><i /></span>
        <span>
          <small>ARCHIVE // TODAY</small>
          <strong>Field tasks</strong>
        </span>
      </div>
      <div className="travel-objectives">
        {rows.map(([id, status]) => (
          <div key={id} className={`travel-objective ${markerClass(status)}`}>
            <span className={`dot ${markerClass(status)}`} />
            <span className={status === "MISSED" || status === "FAILED" ? "muted" : ""}>
              {id === "RIDER_HANDBILLS" && <b className="timed-glyph">☼</b>}
              {OBJ_LABELS[id] ?? id}
            </span>
            <small>
              {status === "SELECTED"
                ? "Active route"
                : status === "COMPLETED"
                  ? "Done"
                  : status === "MISSED" || status === "FAILED"
                    ? "Closed"
                    : "Available"}
            </small>
          </div>
        ))}
        {activeSideJobs(v).map((job) => (
          <div key={job.activityId} className="travel-objective side-job">
            <span className="dot side-job" />
            <span>{job.label}</span>
            <small>{job.breadcrumb ?? "Side job in progress"}</small>
          </div>
        ))}
      </div>
      {expandable && (
        <button
          type="button"
          className="holo-tasks-expand"
          aria-label="Expand the Archive"
          onClick={(event) => {
            event.stopPropagation();
            props.onExpand?.();
          }}
        >
          <i className="holo-tasks-chevron" aria-hidden="true" />
          <span>EXPAND ARCHIVE</span>
          <kbd>TAB</kbd>
        </button>
      )}
    </aside>
  );
}

export function Side(props: { view: RuntimeView | null }) {
  const v = props.view;
  if (!v) return <div className="side" />;
  const visible = Object.entries(v.objectives).filter(
    ([, s]) => s !== "NOT_YET_ELIGIBLE" && s !== "HIDDEN",
  );
  const hasSelectedTarget = visible.some(([, status]) => status === "SELECTED");
  const collapsed = hasSelectedTarget
    ? visible.filter(([, status]) => status !== "ACTIVE")
    : visible;
  return (
    <div className="side">
      <div className="panel-title">Today's tasks</div>
      {collapsed.map(([id, status]) => (
        <div className="obj" key={id}>
          <span className={`dot ${markerClass(status)}`} />
          <span className={status === "MISSED" || status === "FAILED" ? "muted" : ""}>{OBJ_LABELS[id] ?? id}</span>
        </div>
      ))}
    </div>
  );
}
