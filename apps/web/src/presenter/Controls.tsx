import { useEffect, useRef, useState } from "react";
import type { InputRequest, PresenterEvent, MechanicParams } from "@pa/contracts";

export function Controls(props: { request: InputRequest; onEvent: (e: PresenterEvent) => void; busy: boolean }) {
  const { request, onEvent, busy } = props;
  switch (request.kind) {
    case "CONTINUE":
      return <button className="btn-primary" disabled={busy} onClick={() => onEvent({ type: "CONTINUE" })}>{request.label ?? "Continue"}</button>;
    case "ACK":
      return (
        <div>
          <div className="frame archive">▲ Archive · {request.text}</div>
          <button className="btn-primary" disabled={busy} onClick={() => onEvent({ type: "ACK" })}>Understood</button>
        </div>
      );
    case "FOCUS_READ":
      return (
        <div>
          <div className="frame">{request.title} — {request.teaser}</div>
          <div className="row">
            <button className="btn-primary" disabled={busy} onClick={() => onEvent({ type: "FOCUS_READ_OPENED", objectId: request.objectId })}>Read it (1st person)</button>
            <button className="btn-ghost" disabled={busy} onClick={() => onEvent({ type: "FOCUS_READ_SKIPPED", objectId: request.objectId })}>Skip</button>
          </div>
        </div>
      );
    case "FREE_ROAM":
      return (
        <div>
          <div className="frame muted small">Free roam — choose where to go.</div>
          <div className="choices">
            {request.targets.map((t) => (
              <button key={t.targetId} className="choice" disabled={busy} onClick={() => onEvent({ type: "FREE_ROAM_GOTO", targetId: t.targetId })}>
                <span className="row"><span className={`dot ${t.marker.toLowerCase()}`} /> <span className="clabel">{t.label}</span></span>
              </button>
            ))}
            {request.canProceed && <button className="btn-ghost" disabled={busy} onClick={() => onEvent({ type: "FREE_ROAM_IDLE" })}>Wait a moment</button>}
          </div>
        </div>
      );
    case "CHOICE":
      return (
        <div>
          <div className="frame">{request.frame}</div>
          <div className="choices">
            {request.options.map((o) => (
              <button key={o.choiceId} className="choice" disabled={busy || o.disabled} onClick={() => onEvent({ type: "CHOICE_SELECTED", promptId: request.promptId, choiceId: o.choiceId })}>
                <span className="clabel">{o.label}</span>
                {o.tags.length > 0 && <span className="ctags">{o.tags.map((t) => <span key={t} className="tag">{t}</span>)}</span>}
              </button>
            ))}
          </div>
        </div>
      );
    case "MECHANIC":
      return <Mechanic promptId={request.promptId} params={request.params} onEvent={onEvent} busy={busy} />;
    case "DAY_END":
      return <button className="btn-primary" disabled={busy} onClick={() => onEvent({ type: "CONTINUE" })}>Finish the day</button>;
  }
}

function Mechanic(props: { promptId: string; params: MechanicParams; onEvent: (e: PresenterEvent) => void; busy: boolean }) {
  const { params, promptId, onEvent, busy } = props;
  if (params.kind === "PRESS") return <PressControl prompt={params.prompt} onDone={(stopOffset) => onEvent({ type: "MECHANIC_RESULT", promptId, result: { kind: "PRESS", stopOffset } })} busy={busy} />;
  if (params.kind === "EFFORT") return <EffortControl prompt={params.prompt} onDone={(holdMs) => onEvent({ type: "MECHANIC_RESULT", promptId, result: { kind: "EFFORT", holdMs } })} busy={busy} />;
  if (params.kind === "PLACE") return <PlaceControl prompt={params.prompt} onDone={(alignment) => onEvent({ type: "MECHANIC_RESULT", promptId, result: { kind: "PLACE", alignment } })} busy={busy} />;
  return <SortControl params={params} onDone={(assignments) => onEvent({ type: "MECHANIC_RESULT", promptId, result: { kind: "SORT", assignments } })} busy={busy} />;
}

// Oscillating + accelerating needle. Stop near center for a clean pull.
function PressControl(props: { prompt: string; onDone: (o: number) => void; busy: boolean }) {
  const [pos, setPos] = useState(0.5);
  const posRef = useRef(0.5);
  const dirRef = useRef(1);
  const speedRef = useRef(0.004);
  const raf = useRef(0);
  useEffect(() => {
    const tick = () => {
      let p = posRef.current + dirRef.current * speedRef.current;
      if (p >= 1) { p = 1; dirRef.current = -1; }
      if (p <= 0) { p = 0; dirRef.current = 1; }
      speedRef.current = Math.min(0.03, speedRef.current + 0.00008);
      posRef.current = p;
      setPos(p);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);
  return (
    <div>
      <div className="frame">{props.prompt}</div>
      <div className="press-track">
        <div className="press-center" />
        <div className="press-needle" style={{ left: `calc(${pos * 100}% - 2px)` }} />
      </div>
      <button className="btn-primary" style={{ marginTop: 10 }} disabled={props.busy} onClick={() => { cancelAnimationFrame(raf.current); props.onDone(posRef.current); }}>Stop the press</button>
    </div>
  );
}

function EffortControl(props: { prompt: string; onDone: (ms: number) => void; busy: boolean }) {
  const [fill, setFill] = useState(0);
  const startRef = useRef<number | null>(null);
  const raf = useRef(0);
  const TARGET = 1200;
  function begin() {
    startRef.current = performance.now();
    const tick = () => {
      const held = performance.now() - (startRef.current ?? 0);
      setFill(Math.min(100, (held / TARGET) * 100));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }
  function end() {
    cancelAnimationFrame(raf.current);
    const held = startRef.current ? performance.now() - startRef.current : 0;
    startRef.current = null;
    props.onDone(Math.round(held));
  }
  return (
    <div>
      <div className="frame">{props.prompt}</div>
      <div className="effort-bar"><div style={{ width: `${fill}%` }} /></div>
      <button className="btn-primary" style={{ marginTop: 10 }} disabled={props.busy}
        onMouseDown={begin} onMouseUp={end} onMouseLeave={() => startRef.current && end()}
        onTouchStart={begin} onTouchEnd={end}>
        Hold to work
      </button>
    </div>
  );
}

function PlaceControl(props: { prompt: string; onDone: (a: number) => void; busy: boolean }) {
  const [val, setVal] = useState(0.5);
  return (
    <div>
      <div className="frame">{props.prompt}</div>
      <input type="range" min={0} max={100} value={val * 100} onChange={(e) => setVal(Number(e.target.value) / 100)} style={{ width: 480 }} />
      <div><button className="btn-primary" style={{ marginTop: 10 }} disabled={props.busy} onClick={() => props.onDone(val)}>Tack it up</button></div>
    </div>
  );
}

function SortControl(props: { params: MechanicParams; onDone: (a: { itemId: string; bucketId: string }[]) => void; busy: boolean }) {
  const items = props.params.sortItems ?? [];
  const buckets = props.params.sortBuckets ?? [];
  const [assign, setAssign] = useState<Record<string, string>>({});
  const allAssigned = items.every((i) => assign[i.itemId]);
  return (
    <div>
      <div className="frame">{props.params.prompt}</div>
      {items.map((it) => (
        <div className="obj" key={it.itemId} style={{ justifyContent: "space-between" }}>
          <span>{it.label}</span>
          <span className="row">
            {buckets.map((b) => (
              <button key={b.bucketId} className={assign[it.itemId] === b.bucketId ? "" : "btn-ghost"} onClick={() => setAssign((a) => ({ ...a, [it.itemId]: b.bucketId }))}>{b.label}</button>
            ))}
          </span>
        </div>
      ))}
      <button className="btn-primary" style={{ marginTop: 10 }} disabled={props.busy || !allAssigned}
        onClick={() => props.onDone(items.map((i) => ({ itemId: i.itemId, bucketId: assign[i.itemId]! })))}>
        Submit
      </button>
    </div>
  );
}
