import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import type { RuntimeView } from "@pa/contracts";
import { SystemWindow } from "./Controls.js";
import { OBJ_LABELS } from "./Side.js";
import { RiggedCharacter } from "../world/Character.js";
import { authoredFeedback } from "@pa/chapter-boston";
import {
  engagedConnections,
  metThreadPeople,
  routeRumors,
  type ThreadPersonEntry,
} from "./archiveSelectors.js";

// The full Archive interface: the holo task strip's expanded state (Day-1 §4A,
// Interaction-Spec §1.5). A free pause view: opening it never advances the
// world or the clock; it only reads the current RuntimeView.

type ArchiveTab =
  | "TODAY"
  | "PEOPLE"
  | "THREADS"
  | "NOTES"
  | "CONNECTIONS"
  | "ROUTES";

const TABS: { id: ArchiveTab; label: string }[] = [
  { id: "TODAY", label: "Today" },
  { id: "PEOPLE", label: "People" },
  { id: "THREADS", label: "Threads" },
  { id: "NOTES", label: "Notes" },
  { id: "CONNECTIONS", label: "Connections" },
  { id: "ROUTES", label: "Routes" },
];

// ---- People roster (authored, per Day-1 §4A) -------------------------------
// Band words are authored, four per magnitude dimension. Obligation has three
// authored words; its top band spans the last two segments. Banding is
// nearest-quarter of the 0..100 scale so the authored anchors read correctly:
// the guarded baseline (35) lands in band 1, and Thomas's earned favor (40,
// the value that opens his dock route) lands in "in your debt".
type BandWords = [string, string, string, string];
const TRUST_BANDS: BandWords = ["wary", "guarded", "steady", "trusted"];
const RESPECT_BANDS: BandWords = ["green", "capable", "sound", "relied-on"];
const WARMTH_BANDS: BandWords = ["distant", "civil", "warm", "close"];
const OBLIGATION_BANDS: BandWords = ["nothing owed", "a small favor", "in your debt", "in your debt"];

interface DimensionSpec {
  label: string;
  relKey: string;
  kind: "MAGNITUDE" | "DIVERGING";
  words?: BandWords;
}

interface PersonSpec {
  id: string;
  name: string;
  role: string;
  matchKey: string; // loose match against view.peopleMet display names
  glbKey: string;
  dims: DimensionSpec[];
}

const ROSTER: PersonSpec[] = [
  {
    id: "abigail", name: "Abigail Mercer", role: "Print shop owner",
    matchKey: "abigail", glbKey: "abigail-rigged",
    dims: [
      { label: "Trust", relKey: "ABIGAIL_TRUST", kind: "MAGNITUDE", words: TRUST_BANDS },
      { label: "Respect", relKey: "ABIGAIL_RESPECT", kind: "MAGNITUDE", words: RESPECT_BANDS },
      { label: "Warmth", relKey: "ABIGAIL_WARMTH", kind: "MAGNITUDE", words: WARMTH_BANDS },
    ],
  },
  {
    id: "thomas", name: "Thomas", role: "Merchant",
    matchKey: "thomas", glbKey: "thomas-rigged",
    dims: [{ label: "Obligation", relKey: "THOMAS_OBLIGATION", kind: "MAGNITUDE", words: OBLIGATION_BANDS }],
  },
  {
    id: "pike", name: "Pike", role: "Court clerk",
    matchKey: "pike", glbKey: "pike-rigged",
    dims: [{ label: "Respect", relKey: "PIKE_RESPECT", kind: "MAGNITUDE", words: RESPECT_BANDS }],
  },
  {
    id: "clarke", name: "Clarke", role: "Loyalist shopkeeper",
    matchKey: "clarke", glbKey: "clarke-rigged",
    dims: [{ label: "Political read", relKey: "CLARKE_POLITICAL_READ", kind: "DIVERGING" }],
  },
  {
    id: "rider", name: "The rider", role: "Post rider",
    matchKey: "rider", glbKey: "rider-rigged",
    dims: [{ label: "Trust", relKey: "RIDER_TRUST", kind: "MAGNITUDE", words: TRUST_BANDS }],
  },
];

// Routes cause map (authored). Any label without an entry opened in the field.
const ROUTE_CAUSES: Record<string, string> = {
  "Thomas's dock shortcut": "Opened by a favor from Thomas",
};

function bandIndexFor(value: number): number {
  return Math.max(0, Math.min(3, Math.round(value / 25)));
}

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

function statusWord(status: string): string {
  switch (status) {
    case "SELECTED": return "Active route";
    case "COMPLETED": return "Done";
    case "MISSED":
    case "FAILED": return "Closed";
    default: return "Available";
  }
}

function phaseLabel(p: string): string {
  switch (p) {
    case "MIDDAY": return "Midday";
    case "AFTERNOON": return "Afternoon";
    case "DUSK": return "Dusk";
    default: return "Morning";
  }
}

export function ArchiveOverlay(props: {
  view: RuntimeView;
  onClose: () => void;
  onStartReflection?: (promptId: string) => void;
}) {
  const { view, onClose } = props;
  const [tab, setTab] = useState<ArchiveTab>("TODAY");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="archive-ov-backdrop" onClick={onClose}>
      <div
        className="archive-ov"
        role="dialog"
        aria-modal="true"
        aria-label="Archive field interface"
        onClick={(event) => event.stopPropagation()}
      >
        <SystemWindow heading="ARCHIVE // FIELD INTERFACE">
          <nav className="archive-ov-tabs" aria-label="Archive sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`archive-ov-tab${tab === t.id ? " active" : ""}`}
                aria-pressed={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="archive-ov-pane">
            {tab === "TODAY" && <TodayPane view={view} />}
            {tab === "PEOPLE" && <PeoplePane view={view} />}
            {tab === "THREADS" && <ThreadsPane view={view} />}
            {tab === "NOTES" && <NotesPane view={view} />}
            {tab === "CONNECTIONS" && (
              <ConnectionsPane
                view={view}
                onStartReflection={props.onStartReflection}
              />
            )}
            {tab === "ROUTES" && <RoutesPane view={view} />}
          </div>
        </SystemWindow>
        <button className="archive-ov-close" onClick={onClose} aria-label="Collapse the Archive">
          ✕ COLLAPSE <kbd>ESC</kbd>
        </button>
      </div>
    </div>
  );
}

// ---- Today ------------------------------------------------------------------

function TodayPane(props: { view: RuntimeView }) {
  const v = props.view;
  const rows = Object.entries(v.objectives).filter(
    ([, s]) => s !== "NOT_YET_ELIGIBLE" && s !== "HIDDEN",
  );
  const pct = Math.min(100, (v.clock.spentUnits / v.clock.fixedEventBoundary) * 100);
  return (
    <div className="archive-ov-today">
      <StandingCard band={v.field.standing.band} />
      <div className="archive-ov-meter" aria-label="Daylight remaining">
        <span className="archive-ov-phase">{phaseLabel(v.clock.phase)}</span>
        <div className="archive-ov-daymeter"><i style={{ width: `${pct}%` }} /></div>
        <small>{v.clock.warningStage !== "NONE" ? "☀ light is going" : "daylight holds"}</small>
      </div>
      {rows.length === 0 ? (
        <p className="archive-ov-empty">No field tasks on record yet.</p>
      ) : (
        <div className="archive-ov-objectives">
          {rows.map(([id, status]) => (
            <div key={id} className={`archive-ov-obj ${markerClass(status)}`}>
              <span className={`dot ${markerClass(status)}`} />
              <span className={status === "MISSED" || status === "FAILED" ? "muted" : ""}>
                {id === "RIDER_HANDBILLS" && <b className="timed-glyph">☼</b>}
                {OBJ_LABELS[id] ?? id}
              </span>
              <small>{statusWord(status)}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StandingCard(props: {
  band: RuntimeView["field"]["standing"]["band"];
}) {
  const copy: Record<typeof props.band, string> = {
    MARKED: "The town recognizes you for the wrong reasons.",
    NEUTRAL: "You are another face in Boston's streets.",
    FAMILIAR: "People are beginning to know your face.",
    TRUSTED: "Local goodwill gives your word weight.",
  };
  return (
    <section
      className={`archive-standing standing-${props.band.toLowerCase()}`}
      aria-label={`Standing: ${props.band}`}
    >
      <span>Town standing</span>
      <strong>{props.band}</strong>
      <small>{copy[props.band]}</small>
    </section>
  );
}

// ---- People -----------------------------------------------------------------

function PeoplePane(props: { view: RuntimeView }) {
  const v = props.view;
  const metRoster = ROSTER.filter((spec) =>
    v.peopleMet.some((name) => name.toLowerCase().includes(spec.matchKey)),
  );
  // Field-thread figures (Ned, Sarah) register through durable thread MET
  // flags, not the authored-flow peopleMet list. Without them PEOPLE said
  // "no one met" while THREADS narrated the meeting (feel-audit-1 P1-9).
  const threadPeople = metThreadPeople(v).filter(
    (person) => !metRoster.some((spec) => spec.id === person.id),
  );
  if (metRoster.length === 0 && threadPeople.length === 0) {
    return <p className="archive-ov-empty">No one met yet.</p>;
  }
  return (
    <div className="archive-ov-people">
      {metRoster.map((spec) => (
        <PersonCard key={spec.id} spec={spec} relationships={v.relationships} />
      ))}
      {threadPeople.map((person) => (
        <ThreadPersonCard key={person.id} person={person} />
      ))}
    </div>
  );
}

// Thread trust runs -10..10; map onto the four-band track.
function threadTrustBandIndex(trust: number): number {
  if (trust <= 0) return 0;
  if (trust <= 2) return 1;
  if (trust <= 5) return 2;
  return 3;
}

function ThreadPersonCard(props: { person: ThreadPersonEntry }) {
  const { person } = props;
  const idx = threadTrustBandIndex(person.trust);
  return (
    <article className="archive-ov-card">
      <Portrait glbKey={person.glbKey} name={person.name} />
      <header className="archive-ov-card-head">
        <strong>{person.name}</strong>
        <small>{person.role}</small>
      </header>
      <div className="archive-ov-bands">
        <div className={`archive-ov-band${idx === 0 ? " low" : ""}`}>
          <div className="archive-ov-band-head">
            <span>Trust</span>
            <strong>{TRUST_BANDS[idx]}</strong>
          </div>
          <div className="archive-ov-band-track" aria-label={`Trust: ${TRUST_BANDS[idx]}`}>
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className={i < idx ? "lit" : i === idx ? "band" : ""} />
            ))}
          </div>
        </div>
        {person.breadcrumb && <small className="archive-ov-person-note">{person.breadcrumb}</small>}
      </div>
      <i className="archive-ov-card-corner tl" aria-hidden="true" />
      <i className="archive-ov-card-corner br" aria-hidden="true" />
    </article>
  );
}

function PersonCard(props: { spec: PersonSpec; relationships: Record<string, number> }) {
  const { spec, relationships } = props;
  return (
    <article className="archive-ov-card">
      <Portrait glbKey={spec.glbKey} name={spec.name} />
      <header className="archive-ov-card-head">
        <strong>{spec.name}</strong>
        <small>{spec.role}</small>
      </header>
      <div className="archive-ov-bands">
        {spec.dims.map((dim) =>
          dim.kind === "DIVERGING" ? (
            <DivergingBar key={dim.relKey} label={dim.label} value={relationships[dim.relKey] ?? 0} />
          ) : (
            <BandBar key={dim.relKey} label={dim.label} value={relationships[dim.relKey] ?? 0} words={dim.words!} />
          ),
        )}
      </div>
      <i className="archive-ov-card-corner tl" aria-hidden="true" />
      <i className="archive-ov-card-corner br" aria-hidden="true" />
    </article>
  );
}

// Live head-and-shoulders portrait: a tiny scene reusing the world's cached
// character GLBs. The default camera looks at the origin, so the rig is
// dropped by face height (~1.45 of a 1.66 m body) to center the face; a
// narrow fov gives the head-and-shoulders crop. Teal key and rim lights match
// the holo language; transparent background so the card's glass shows through.
function Portrait(props: { glbKey: string; name: string }) {
  return (
    <div className="archive-ov-portrait" aria-label={`Field image of ${props.name}`}>
      <Canvas
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        camera={{ fov: 26, near: 0.05, far: 12, position: [0, 0.04, 1.08] }}
      >
        <ambientLight intensity={0.8} color="#bfeee8" />
        <directionalLight position={[1.4, 2.2, 1.8]} intensity={1.6} color="#eafffb" />
        <directionalLight position={[-1.8, 1.9, -1.4]} intensity={2.4} color="#7ee3d8" />
        <group position={[0, -1.45, 0]} rotation={[0, -0.14, 0]}>
          <RiggedCharacter glbKey={props.glbKey} height={1.66} clip="idle" castShadow={false} />
        </group>
      </Canvas>
      <i className="archive-ov-portrait-scan" aria-hidden="true" />
    </div>
  );
}

// Magnitude dimension: four glowing segments; the current band's segment burns
// gold and its band word is the label. Lowest band shifts red (a bar that has
// fallen, or never risen, reads as a warning).
function BandBar(props: { label: string; value: number; words: BandWords }) {
  const idx = bandIndexFor(props.value);
  return (
    <div className={`archive-ov-band${idx === 0 ? " low" : ""}`}>
      <div className="archive-ov-band-head">
        <span>{props.label}</span>
        <strong>{props.words[idx]}</strong>
      </div>
      <div className="archive-ov-band-track" aria-label={`${props.label}: ${props.words[idx]}`}>
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={i < idx ? "lit" : i === idx ? "band" : ""} />
        ))}
      </div>
    </div>
  );
}

// Political read: a diverging bar centered on neutral, marker offset from the
// center. threat ◄ wary ◄ neutral ► curious ► ally.
function DivergingBar(props: { label: string; value: number }) {
  const v = Math.max(-100, Math.min(100, props.value));
  const zone = v < -60 ? "threat" : v < -20 ? "wary" : v <= 20 ? "neutral" : v <= 60 ? "curious" : "ally";
  const pct = ((v + 100) / 200) * 100;
  return (
    <div className={`archive-ov-diverge${v < -20 ? " cold" : v > 20 ? " ally" : ""}`}>
      <div className="archive-ov-band-head">
        <span>{props.label}</span>
        <strong>{zone}</strong>
      </div>
      <div className="archive-ov-diverge-track" aria-label={`${props.label}: ${zone}`}>
        <i className="archive-ov-diverge-center" />
        <i className="archive-ov-diverge-marker" style={{ left: `${pct}%` }} />
      </div>
      <div className="archive-ov-diverge-scale" aria-hidden="true">
        <span>threat ◄</span><span>neutral</span><span>► ally</span>
      </div>
    </div>
  );
}

// ---- Notes ------------------------------------------------------------------

function NotesPane(props: { view: RuntimeView }) {
  const notes = props.view.notes;
  // Micro-concept records live under CONNECTIONS (their completion chips say
  // "Connection added" — feel-audit-1 P1-9); NOTES keeps the macro records.
  if (notes.length === 0) {
    return <p className="archive-ov-empty">No records earned yet.</p>;
  }
  return (
    <div className="archive-ov-notes">
      {notes.map((n) => (
        <div className="archive-ov-record" key={n.concept}>
          <span className="archive-ov-record-sigil" aria-hidden="true" />
          <span className="archive-ov-record-copy">
            <strong>{n.concept}</strong>
            <small>{n.body}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

// ---- Threads ---------------------------------------------------------------

function ThreadsPane(props: { view: RuntimeView }) {
  const threads = Object.values(props.view.field.threads).filter(
    (thread) => thread.status !== "UNMET" || thread.breadcrumb,
  );
  const activities = Object.values(props.view.field.activities).filter(
    (activity) => activity.breadcrumb,
  );
  return (
    <div className="archive-ov-threads">
      {threads.map((thread) => (
        <article className="archive-thread" key={thread.threadId}>
          <span className="archive-thread-mark" aria-hidden="true" />
          <div>
            <strong>
              {thread.threadId.includes("NED")
                ? "The Apprentice"
                : "The Wharf Widow"}
            </strong>
            <small>{thread.status.toLowerCase()}</small>
            <p>{thread.breadcrumb}</p>
          </div>
        </article>
      ))}
      {activities.map((activity) => (
        <article className="archive-thread activity" key={activity.activityId}>
          <span className="archive-thread-mark" aria-hidden="true" />
          <div>
            <strong>
              {({
                "SJ-tavern-note": "A quiet note",
                "SJ-dock-haul": "A barrel before the tide",
                "SJ-roof-kid": "The boy on the scaffold",
                "SJ-crier": "Take up the cry",
                "SJ-ropewalk": "A strand down the walk",
                "CH-agitator-dare": "The watched crossing",
                "CH-rooftop-run": "The short roof-board run",
                "CH-lose-the-watch": "Lose the watch",
              } as Record<string, string>)[activity.activityId] ?? activity.activityId}
            </strong>
            <small>{activity.stage.toLowerCase().replaceAll("_", " ")}</small>
            <p>{activity.breadcrumb}</p>
          </div>
        </article>
      ))}
      {props.view.field.rumors.map((rumor) => (
        <p className="archive-rumor" key={rumor}>
          Rumor // {rumor}
        </p>
      ))}
    </div>
  );
}

// ---- Routes -----------------------------------------------------------------

function RoutesPane(props: { view: RuntimeView }) {
  const routes = props.view.routesUnlocked;
  const leads = routeRumors(props.view);
  return (
    <div className="archive-ov-routes">
      {routes.length === 0 && leads.length === 0 && (
        <p className="archive-ov-empty">No alternate ways opened yet.</p>
      )}
      {routes.map((label) => (
        <div className="archive-ov-record gold" key={label}>
          <span className="archive-ov-record-sigil gold" aria-hidden="true" />
          <span className="archive-ov-record-copy">
            <strong>{label}</strong>
            <small>{ROUTE_CAUSES[label] ?? "Opened in the field"}</small>
          </span>
        </div>
      ))}
      {leads.map((rumor) => (
        <div className="archive-ov-record" key={rumor}>
          <span className="archive-ov-record-sigil" aria-hidden="true" />
          <span className="archive-ov-record-copy">
            <strong>Route lead (rumor)</strong>
            <small>{rumor}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function ConnectionsPane(props: {
  view: RuntimeView;
  onStartReflection?: (promptId: string) => void;
}) {
  const { view } = props;
  const cards = view.openResponse.archiveConnections;
  // The micro-concept connections the "CONNECTION ADDED" completion chips
  // announce. They used to land under NOTES while this tab stayed empty
  // (feel-audit-1 P1-9 / the audited "rewards never appear" P0 class).
  const micros = engagedConnections(view);
  return (
    <div className="archive-ov-notes">
      {cards.length === 0 &&
        micros.length === 0 &&
        view.openResponse.evidence.length === 0 && (
          <p className="archive-ov-empty">
            Connections appear after related sources have been encountered.
          </p>
        )}
      {micros.map((micro) => (
        <div className="archive-ov-record micro" key={micro.id}>
          <span className="archive-ov-record-sigil" aria-hidden="true" />
          <span className="archive-ov-record-copy">
            <strong>{micro.label}</strong>
            {/* A quotable memory with its place/person, not metadata
                (design1 kill list). */}
            <small>{micro.memory}</small>
          </span>
        </div>
      ))}
      {cards.map((card) => (
        <div className="archive-ov-record gold" key={card.cardId}>
          <span className="archive-ov-record-sigil gold" aria-hidden="true" />
          <span className="archive-ov-record-copy">
            <strong>{card.title}</strong>
            {card.artifactRefs.length > 0 && (
              <span
                className="archive-connection-artifacts"
                aria-label={`Source artifacts for ${card.title}`}
              >
                {card.artifactRefs.map((artifactRef) => (
                  <img
                    key={artifactRef}
                    src={`/world/posters/${artifactRef}.png`}
                    alt=""
                  />
                ))}
              </span>
            )}
            <small>{card.body}</small>
            <small>
              Sources: {card.citations.join(" · ")}
            </small>
            {view.openResponse.eligible.some(
              (prompt) => prompt.promptId === card.linkedPromptId,
            ) &&
              props.onStartReflection && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() =>
                    props.onStartReflection?.(card.linkedPromptId)
                  }
                >
                  Start optional reflection
                </button>
              )}
          </span>
        </div>
      ))}
      {view.openResponse.evidence.map((record) => (
        <article
          className="archive-thread"
          key={record.response.responseId}
        >
          <span className="archive-thread-mark" aria-hidden="true" />
          <div>
            <strong>Your line, filed</strong>
            <small>Kept with the day. Never a mark, never a score.</small>
            {record.resolution.feedbackIds.map((feedbackId) => (
              <p key={feedbackId}>
                {authoredFeedback(feedbackId) ??
                  "Your reflection was recorded."}
              </p>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
