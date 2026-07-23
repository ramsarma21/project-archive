import type { MasteryReport, MasteryStage } from "@pa/contracts";
import { DAY1_COVERAGE, DAY1_CLAUSE_STATUS, TEKS_8_4_A, TEKS_8_4_B_INDIVIDUALS } from "@pa/contracts";

const STAGE_LABEL: Record<MasteryStage, string> = {
  NOT_STARTED: "Not started",
  LEARNING: "Learning",
  UNDERSTOOD: "Understood",
  MASTERED: "Mastered",
};

function stageClass(stage: MasteryStage): string {
  return `badge badge-${stage.toLowerCase()}`;
}

// Two teacher-facing artifacts that back POV 6:
//  1. Mastery report  -> "hand a teacher the receipts"
//  2. TEKS coverage map -> "the whole standard gets taught"
export function MasteryPanel(props: { report: MasteryReport | null; onClose?: () => void }) {
  const r = props.report;
  return (
    <div className="mastery">
      <div className="mastery-head">
        <h2>Mastery report</h2>
        {props.onClose && <button className="btn-ghost" onClick={props.onClose}>Close</button>}
      </div>

      {r ? (
        <>
          <p className="small muted">
            {r.chapterId} · {r.masteredCount}/{r.requiredCount} concepts mastered
            {r.dayComplete ? " · day complete" : ""}
          </p>
          <table className="report-table">
            <thead>
              <tr><th>TEKS</th><th>Concept</th><th>Stage</th><th>Exposures</th><th>Understood</th><th>Demonstrated</th></tr>
            </thead>
            <tbody>
              {r.concepts.map((c) => (
                <tr key={c.conceptId}>
                  <td className="mono">{c.teksCode}</td>
                  <td>{c.conceptName}<div className="small muted">{c.teksClause}</div></td>
                  <td><span className={stageClass(c.stage)}>{STAGE_LABEL[c.stage]}</span></td>
                  <td>{c.exposureCount} · {c.exposureTypes.length} types</td>
                  <td>{c.understandingPassed ? `yes (try ${c.understandingAttempts})` : "not yet"}</td>
                  <td>{c.demonstrated ? "yes" : "not yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.engagedMicros && r.engagedMicros.length > 0 && (
            <div className="engaged-micros">
              <h3>From what this student explored</h3>
              <p className="small muted">
                Optional enrichment concepts the world delivered through this
                student's own interactions (never required, never gating).
              </p>
              <div className="engaged-micro-chips">
                {r.engagedMicros.map((m) => (
                  <span className="badge badge-understood" key={m.microId}>{m.label}</span>
                ))}
              </div>
            </div>
          )}
          {r.checkpoint && (
            <div className="checkpoint-evidence">
              <h3>Checkpoint One evidence</h3>
              <ul className="clause-list">
                {r.checkpoint.macroEvidence.map((row) => (
                  <li key={row.conceptId} className="small">
                    <span className={row.outcome === "SUPPORTED" ? "badge badge-mastered" : "badge badge-learning"}>
                      {row.outcome === "SUPPORTED" ? "supported" : "revisit"}
                    </span>{" "}
                    <span className="mono">{row.conceptId}</span>
                    {typeof row.hintsUsed === "number" && row.hintsUsed > 0
                      ? ` · ${row.hintsUsed} hint${row.hintsUsed === 1 ? "" : "s"}`
                      : " · clean"}
                  </li>
                ))}
                {r.checkpoint.enrichment.included && (
                  <li className="small muted">
                    Enrichment answered: {r.checkpoint.enrichment.correctCount ?? 0}/
                    {r.checkpoint.enrichment.responseCount} (bonus only)
                  </li>
                )}
              </ul>
            </div>
          )}
          <div className="integrity">
            <strong>Integrity</strong>
            <div className="small muted">Run seed: <span className="mono">{r.integrity.variationRootSeedHex.slice(0, 16)}…</span></div>
            <div className="small muted">Committed steps: {r.integrity.committedEventCount} · deterministic</div>
            <div className="small muted">{r.integrity.note}</div>
          </div>
        </>
      ) : (
        <p className="small muted">No report yet.</p>
      )}

      <div className="coverage">
        <h3>TEKS coverage — {TEKS_8_4_A.code}</h3>
        <p className="small muted">{TEKS_8_4_A.statement}</p>
        <ul className="clause-list">
          {TEKS_8_4_A.clauses.map((cl) => {
            const status = DAY1_CLAUSE_STATUS[cl.id] ?? "SCHEDULED_LATER";
            return (
              <li key={cl.id}>
                <span className={status === "GATED_DAY1" ? "badge badge-mastered" : "badge badge-not_started"}>
                  {status === "GATED_DAY1" ? "Day 1" : "later"}
                </span>{" "}
                {cl.text}
              </li>
            );
          })}
        </ul>
        <div className="coverage-detail">
          {DAY1_COVERAGE.map((row) => (
            <div className="coverage-row" key={row.conceptId}>
              <strong>{row.conceptName}</strong> <span className="mono small">{row.teks.code}</span>
              <ul>
                {row.exposures.map((e) => (
                  <li key={e.beat} className="small"><span className="mono">{e.beat}</span> · {e.type.toLowerCase()} · {e.label}</li>
                ))}
                <li className="small muted">Understanding: {row.understandingSync}</li>
                <li className="small muted">Demonstration: {row.demonstration}</li>
              </ul>
            </div>
          ))}
        </div>
        <p className="small muted">8.4(B) individuals surfaced as context: {TEKS_8_4_B_INDIVIDUALS.join(", ")}.</p>
      </div>
    </div>
  );
}
