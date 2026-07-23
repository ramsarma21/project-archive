import type { InteriorInspectHotspotDef } from "../world/interiorManifest.js";
import { INTERIOR_SOURCES } from "../world/interiorSources.js";

export function ContextInspectPrompt(props: {
  title: string;
  onInspect: () => void;
}) {
  return (
    <button
      className="context-inspect-prompt"
      type="button"
      onClick={props.onInspect}
      aria-label={`Inspect ${props.title}`}
    >
      <kbd>F</kbd>
      <span>Inspect</span>
      <small>{props.title}</small>
    </button>
  );
}

// The Found-History inspect card: the Archive projecting its reading of a real
// object in the room. Same holographic grammar as the document reads (beam,
// scan sweep, corner brackets) so "the Archive is showing you something" is
// one consistent visual language; the copy sits on dark glass with lore-item
// typography. Citations stay available but recede into a quiet PROVENANCE
// footnote — the object is the point, the bibliography is backstage.
export function ContextInspectCard(props: {
  hotspot: InteriorInspectHotspotDef;
  onClose: () => void;
}) {
  const sources = props.hotspot.sourceRefs
    .map((id) => INTERIOR_SOURCES[id])
    .filter((source): source is NonNullable<typeof source> => Boolean(source));
  const claim = props.hotspot.claimType;
  return (
    <div className="context-inspect-backdrop" role="presentation">
      <figure className="holo-doc holo-doc-context">
        <i className="holo-beam" aria-hidden="true" />
        <article
          className="context-inspect-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`inspect-${props.hotspot.id}`}
        >
          <header>
            <span>ARCHIVE // CONTEXT</span>
            <small
              className={`claim-chip claim-${claim.toLowerCase()}`}
              title={
                claim === "DOCUMENTED"
                  ? "Attested for this place and period"
                  : "Typical of the period; reconstructed from comparable rooms"
              }
            >
              {claim}
            </small>
          </header>
          <h2 id={`inspect-${props.hotspot.id}`}>{props.hotspot.title}</h2>
          <div className="context-rule" aria-hidden="true" />
          <p className="context-body">{props.hotspot.body}</p>
          {props.hotspot.comparePrompt && (
            <blockquote>{props.hotspot.comparePrompt}</blockquote>
          )}
          {sources.length > 0 && (
            <details className="context-provenance">
              <summary>
                Provenance · {sources.length}{" "}
                {sources.length === 1 ? "source" : "sources"}
              </summary>
              <ul>
                {sources.map((source) => (
                  <li key={source.id}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.organization}: {source.label}
                    </a>
                    <span>{source.note}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button type="button" onClick={props.onClose}>
            Return to the room <kbd>Esc</kbd>
          </button>
        </article>
        <i className="holo-scan" aria-hidden="true" />
        <i className="holo-corner tl" aria-hidden="true" />
        <i className="holo-corner tr" aria-hidden="true" />
        <i className="holo-corner bl" aria-hidden="true" />
        <i className="holo-corner br" aria-hidden="true" />
      </figure>
    </div>
  );
}
