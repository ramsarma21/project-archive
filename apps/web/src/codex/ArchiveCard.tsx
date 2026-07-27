import { forwardRef, type ReactNode } from "react";
import { cardIdentityFor } from "./cardIdentity.js";
import "./archiveCard.css";

// The one collectible card, used by the Codex binder, the PvE duel hand and the PvP
// duel hand. An original Project Archive frame: an ornate archival plate minted over
// a provenanced period image, with a category colour language, a foil sheen that
// only moves when motion is allowed, and states for selected / hovered / disabled.
//
// It is deliberately dumb: it renders the data it is handed and reports activation.
// It never decides relevance, never reads progression, never fetches. Whether a card
// is "learned", "selected as evidence" or "the answer" is the caller's business, and
// the caller passes it down as `selected`, `disabled`, a status chip or an action
// label. That is what lets the same component be a study card in the Codex and an
// evidence card in a duel without either surface knowing about the other.

export interface ArchiveCardData {
  readonly cardId: string;
  readonly title: string;
  /** The proposition / claim-and-evidence text. Shown when `showClaim` is set. */
  readonly claim: string;
  readonly conceptId: string;
  readonly sourceCueId?: string;
}

export interface ArchiveCardProps {
  readonly card: ArchiveCardData;
  /** `tile` for a grid or a hand; `full` for the inspection view. */
  readonly size?: "tile" | "full";
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly reducedMotion?: boolean;
  /** Whether to render the claim text. The Codex does; a face-down decoy might not. */
  readonly showClaim?: boolean;
  /** Status/trial chips (Codex) or an evidence tag (duel), rendered in the header. */
  readonly chip?: ReactNode;
  /** A line under the card: a source note, an evidence hint, a "placed" mark. */
  readonly footnote?: ReactNode;
  /**
   * Makes the whole card an activatable control. When set the card renders as a
   * button, is keyboard-focusable, and calls `onActivate` on click / Enter / Space.
   */
  readonly onActivate?: () => void;
  /** The accessible name and action for the control, e.g. "Add ‘The war’s bill’ as evidence". */
  readonly ariaLabel?: string;
  /** Marks the pressed/selected state to assistive tech on a toggle control. */
  readonly ariaPressed?: boolean;
  readonly className?: string;
  /** Stamped onto the control as `data-card-id`, so a caller can find it to focus. */
  readonly dataCardId?: string;
}

/**
 * Render as a `<button>` when it is activatable and a `<div>` otherwise, so a static
 * binder tile is not announced as a control and an evidence card is.
 */
export const ArchiveCard = forwardRef<HTMLElement, ArchiveCardProps>(function ArchiveCard(
  props,
  ref,
) {
  const {
    card,
    size = "tile",
    selected = false,
    disabled = false,
    reducedMotion = false,
    showClaim = true,
    chip,
    footnote,
    onActivate,
    ariaLabel,
    ariaPressed,
    className,
    dataCardId,
  } = props;

  const identity = cardIdentityFor(card);
  const interactive = typeof onActivate === "function";

  const classes = [
    "arc-card",
    `arc-${size}`,
    `arc-cat-${identity.category.id.toLowerCase()}`,
    selected ? "is-selected" : "",
    disabled ? "is-disabled" : "",
    reducedMotion ? "is-reduced" : "",
    interactive ? "is-interactive" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const style = {
    ["--arc-accent" as string]: identity.category.accent,
    ["--arc-accent-deep" as string]: identity.category.accentDeep,
  } as React.CSSProperties;

  const inner = (
    <>
      <div className="arc-frame" aria-hidden="true" />
      <div className="arc-foil" aria-hidden="true" />
      <div className="arc-top">
        <span className="arc-category">
          <span className="arc-glyph" aria-hidden="true">
            {identity.category.glyph}
          </span>
          {identity.category.label}
        </span>
        <span className="arc-date">{identity.date}</span>
      </div>

      <div className="arc-art" aria-hidden="true">
        {identity.art ? (
          <img
            className="arc-art-img"
            src={identity.art.src}
            alt=""
            loading="lazy"
            style={{ objectPosition: identity.art.focus }}
          />
        ) : (
          <div className="arc-art-fallback" />
        )}
        <div className="arc-art-scrim" />
      </div>

      <div className="arc-body">
        <div className="arc-heading">
          <h4 className="arc-title">{card.title}</h4>
          {chip ? <span className="arc-chip-slot">{chip}</span> : null}
        </div>
        <span className="arc-perspective">{identity.perspective}</span>
        {showClaim ? <p className="arc-claim">{card.claim}</p> : null}
      </div>

      <div className="arc-foot">
        <span className="arc-source">
          {identity.art ? identity.art.credit : identity.sourceLabel}
        </span>
        {footnote ? <span className="arc-footnote">{footnote}</span> : null}
      </div>
    </>
  );

  if (interactive) {
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        className={classes}
        style={style}
        disabled={disabled}
        aria-pressed={ariaPressed}
        aria-label={ariaLabel}
        data-card-id={dataCardId}
        onClick={() => {
          if (!disabled) onActivate?.();
        }}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className={classes}
      style={style}
      aria-label={ariaLabel}
    >
      {inner}
    </div>
  );
});
