import { useEffect, useRef, useState } from "react";
import type { PresentationDirective, PresenterEvent, ExecutionPlan, RuntimeView, DayEndCard, MasteryReport } from "@pa/contracts";
import { PACKAGE_ID } from "@pa/contracts";
import { RuntimeClient } from "../runtimeClient.js";
import { getSave, putSave, type LocalProfile } from "../db.js";
import { pushSave } from "../api.js";
import { Feed } from "../presenter/Feed.js";
import { Hud } from "../presenter/Hud.js";
import { Side } from "../presenter/Side.js";
import { Controls } from "../presenter/Controls.js";
import { MasteryPanel } from "../presenter/MasteryPanel.js";
import { World3D } from "../world/World3D.js";

export function Play(props: { profile: LocalProfile; chapterId: string; apiUp: boolean; onExit: () => void }) {
  const { profile, chapterId } = props;
  const [transcript, setTranscript] = useState<PresentationDirective[]>([]);
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [view, setView] = useState<RuntimeView | null>(null);
  const [report, setReport] = useState<MasteryReport | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [busy, setBusy] = useState(true);
  const [done, setDone] = useState(false);
  const clientRef = useRef<RuntimeClient | null>(null);
  const eventsRef = useRef<PresenterEvent[]>([]);

  useEffect(() => {
    const client = new RuntimeClient();
    clientRef.current = client;
    let disposed = false;
    (async () => {
      const save = await getSave(profile.profileId);
      const prior = save?.status === "COMPLETE" ? [] : save?.committedEvents ?? [];
      eventsRef.current = [...prior];
      const r = await client.init({
        profileId: profile.profileId,
        chapterId,
        variationRootSeedHex: profile.variationRootSeedHex,
        priorEvents: prior,
      });
      if (disposed) return;
      setTranscript(r.transcript);
      setPlan(r.plan);
      const snap = await client.snapshot();
      setView(snap.view);
      setReport(snap.report);
      setDone(snap.done);
      setBusy(false);
    })();
    return () => {
      disposed = true;
      client.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.profileId]);

  async function persist(status: "IN_PROGRESS" | "COMPLETE") {
    const save = {
      profileId: profile.profileId,
      chapterId,
      packageId: PACKAGE_ID,
      committedEvents: eventsRef.current,
      revision: eventsRef.current.length,
      status,
      updatedAt: new Date().toISOString(),
    };
    await putSave(save);
    if (props.apiUp && profile.source === "GOOGLE") {
      await pushSave(profile.profileId, { baseRevision: save.revision - 1, record: { ...save, saveId: profile.profileId, variationRootSeedHex: profile.variationRootSeedHex } });
    }
  }

  async function onEvent(ev: PresenterEvent) {
    const client = clientRef.current;
    if (!client || busy) return;
    setBusy(true);
    eventsRef.current = [...eventsRef.current, ev];
    const r = await client.advance(ev);
    setTranscript((t) => [...t, ...r.newDirectives]);
    setPlan(r.plan);
    const snap = await client.snapshot();
    setView(snap.view);
    setReport(snap.report);
    setDone(r.done);
    await persist(r.done ? "COMPLETE" : "IN_PROGRESS");
    setBusy(false);
  }

  const dayEnd = transcript.find((d) => d.kind === "DAY_END_CARD") as (PresentationDirective & { kind: "DAY_END_CARD" }) | undefined;
  const [showLog, setShowLog] = useState(false);
  const subtitles = transcript
    .filter((d) => d.kind === "DIALOGUE" || d.kind === "NARRATION" || d.kind === "ARCHIVE" || d.kind === "AMBIENT_CHATTER")
    .slice(-3);
  const readPanel = [...transcript].reverse().find((d) => d.kind === "READ_PANEL") as (PresentationDirective & { kind: "READ_PANEL" }) | undefined;
  const showRead = readPanel && plan?.request.kind !== "FREE_ROAM" && transcript.slice(-4).some((d) => d === readPanel);

  return (
    <div className="play play3d">
      <Hud view={view} profileName={profile.displayName} onExit={props.onExit} />
      <div className="world-wrap">
        <World3D view={view} request={plan?.request ?? null} busy={busy} onEvent={onEvent} />
        <div className="subtitles">
          {subtitles.map((d, i) => (
            <div key={`${transcript.indexOf(d)}-${i}`} className={`sub sub-${d.kind.toLowerCase()}`}>
              {d.kind === "DIALOGUE" ? <strong>{d.speaker}: </strong> : d.kind === "ARCHIVE" ? <strong>▲ Archive · </strong> : null}
              {"text" in d ? d.text : null}
            </div>
          ))}
        </div>
        {showRead && (
          <div className="read-overlay">
            <div className="read-card">
              <div className="read-title">{readPanel.title}</div>
              <div className="read-body">{readPanel.body}</div>
            </div>
          </div>
        )}
        <button className="btn-ghost log-toggle" onClick={() => setShowLog((s) => !s)}>
          {showLog ? "Hide log" : "Log"}
        </button>
        {showLog && (
          <div className="log-panel">
            <Feed directives={transcript} />
          </div>
        )}
      </div>
      <Side view={view} />
      {showReport && (
        <div className="overlay" onClick={() => setShowReport(false)}>
          <div className="overlay-body" onClick={(e) => e.stopPropagation()}>
            <MasteryPanel report={report} onClose={() => setShowReport(false)} />
          </div>
        </div>
      )}
      <div className="dock">
        {done && dayEnd ? (
          <DayEnd card={dayEnd.card} report={report} onDone={props.onExit} />
        ) : plan ? (
          <>
            <Controls request={plan.request} onEvent={onEvent} busy={busy} />
            <button className="btn-ghost report-toggle" onClick={() => setShowReport(true)}>Mastery report</button>
          </>
        ) : (
          <span className="muted">…</span>
        )}
        {import.meta.env.VITE_ENABLE_DEBUG_PANEL === "true" && view && (
          <div className="debug">
            loc={view.locationId} · day={view.clock.spentUnits}/{view.clock.fixedEventBoundary} · steps={eventsRef.current.length}
            {"\n"}rel={JSON.stringify(view.relationships)}
          </div>
        )}
      </div>
      <div className="dock-side" />
    </div>
  );
}

function DayEnd(props: { card: DayEndCard; report: MasteryReport | null; onDone: () => void }) {
  const c = props.card;
  const [showReport, setShowReport] = useState(false);
  return (
    <div className="dayend">
      <h2>▲ Archive</h2>
      <p>{c.headerLine}</p>
      <div className="headline">{c.selectedHeadline}</div>
      {c.notes.map((n) => (
        <div className="note" key={n.concept}><strong>{n.concept}</strong><div className="small muted">{n.body}</div></div>
      ))}
      <p className="small muted">People met: {c.peopleMet.join(", ") || "—"}</p>
      <p className="small muted">Routes unlocked: {c.routesUnlocked.join(", ") || "—"}</p>
      {props.report && (
        <p className="small">
          Mastery: {props.report.masteredCount}/{props.report.requiredCount} concepts
          {props.report.dayComplete ? " · all TEKS demonstrated" : ""}
        </p>
      )}
      <div className="row">
        <button className="btn-ghost" onClick={() => setShowReport(true)}>View mastery report</button>
        <button className="btn-primary" onClick={props.onDone}>Back to profiles</button>
      </div>
      {showReport && (
        <div className="overlay" onClick={() => setShowReport(false)}>
          <div className="overlay-body" onClick={(e) => e.stopPropagation()}>
            <MasteryPanel report={props.report} onClose={() => setShowReport(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
