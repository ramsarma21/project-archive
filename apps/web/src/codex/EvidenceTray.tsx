import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArchiveCard, type ArchiveCardData } from "./ArchiveCard.js";
import { cardIdentityFor } from "./cardIdentity.js";
import { M1_CODEX_CARD_BY_ID } from "./m1Codex.js";
import "./evidenceTray.css";

// The evidence hand and tray, shared by the PvE boss duel and PvP.
//
// A duel answer is now two things: the prose the player writes, and the Codex cards
// they place to support it. This is the surface for the second, redesigned for
// density: the question and the answer box stay the focus, and the evidence reads as
// a compact HAND of collectible cards played into a short row of SLOTS — not a wall
// of full-size cards and paragraphs.
//
// COMPACT FACE, FULL CARD ON DEMAND. The hand and the slots render a small card FACE
// (`ev-mini`): the same category colour, glyph, art sliver and title as the Codex
// collectible, shrunk to a strip tile. The full premium `ArchiveCard` — art, claim,
// provenance — is reserved for the INSPECT overlay and the Codex binder, so the
// always-on surface stays scannable while the collectible identity is one tap away.
//
// THREE WAYS TO MOVE A CARD, all equal:
//   * TAP / CLICK a face toggles it between the hand and a slot (pointer and touch);
//   * DRAG a face between the hand and the slots (mouse, and the lower-level drag
//     events a test drives);
//   * FOCUS a face and press Enter or Space (keyboard), with a live-region
//     announcement of what moved and how many are now placed.
// A separate INSPECT control on each face opens the full card without placing it.
//
// WHAT IT NEVER DOES. It does not decide relevance. Every offered card looks and
// reads identically — same frame, same footprint, same affordances, same order — so
// nothing here tells the player which cards are the "right" ones before they answer.
// Relevance is the server's, graded after submission; this component only reports
// which cards were placed. `minSupport` is shown as a compact "n / m" counter and a
// short "place at least N" line, never "these N".
//
// LOCKING. After submission `locked` freezes the tray: the placed cards stay visible
// as a record, nothing can be added or removed, and the same locked state is what a
// reconnect restores. A fresh round (new `offeredCardIds`) resets it.

export interface EvidenceTrayProps {
  /** The server's offered hand, in its deterministic order. */
  readonly offeredCardIds: readonly string[];
  /** How many supporting cards the player must place. Shown, never as "which". */
  readonly minSupport: number;
  /** The most cards that may be placed. Usually the whole hand. */
  readonly maxSelectable: number;
  /** The placed selection, controlled by the parent so it can submit and lock it. */
  readonly selected: readonly string[];
  readonly onChange: (selected: readonly string[]) => void;
  /** Freeze the tray after submission (and on a reconnected already-answered round). */
  readonly locked?: boolean;
  readonly reducedMotion?: boolean;
}

/** The one-line instruction. A minimum and a plain verb — never which cards. */
export function evidenceInstruction(_selectedCount: number, minSupport: number): string {
  return minSupport <= 1
    ? "Place at least one card that backs your answer."
    : `Place at least ${minSupport} cards that back your answer.`;
}

/** The client's view of whether enough is placed. The server is the authority. */
export function evidenceMinimumMet(selectedCount: number, minSupport: number): boolean {
  return selectedCount >= minSupport;
}

/**
 * A short, player-facing account of WHY the placed evidence fell short, for a round
 * that graded WRONG. It maps the server's misconception CLASS to a sentence about the
 * KIND of evidence that was missing — never which card. It says "you needed more than
 * one piece" or "a card you placed cut against you"; it never says which piece. Any
 * class that is not a genuine shortfall (or a clean pass) returns null, so the surface
 * only speaks when there is something honest and safe to say.
 */
export function evidenceShortfallHint(feedback: string | null | undefined): string | null {
  switch (feedback) {
    case "TOO_FEW":
      return "Your evidence was thin. An answer like this has to rest on more than one piece to stand up.";
    case "MISSING":
      return "You placed no evidence. Back your answer with the cards it rests on.";
    case "INCOMPATIBLE":
      return "One of the cards you placed cuts against your own answer.";
    default:
      return null;
  }
}

/** An offered id that has no authored card resolves to a titled placeholder, never a crash. */
function cardDataFor(cardId: string): ArchiveCardData {
  const card = M1_CODEX_CARD_BY_ID.get(cardId);
  if (card) {
    return {
      cardId: card.cardId,
      title: card.title,
      claim: card.proposition,
      conceptId: card.conceptId,
      sourceCueId: card.sourceCueId,
    };
  }
  return {
    cardId,
    title: "Unknown card",
    claim: "This card is not in the loaded Codex.",
    conceptId: "UNKNOWN",
  };
}

const DRAG_MIME = "application/x-pa-evidence-card";

/**
 * The compact collectible face used in the hand and the slots. Keeps the card's
 * category colour, glyph and a sliver of its art so it still reads as a collectible,
 * at a fraction of the full card's footprint. Every face is identical treatment —
 * no relevance ever shows here. The whole face is the add/remove control; a small
 * corner button opens the full card.
 */
function EvidenceMini(props: {
  readonly cardId: string;
  readonly where: "hand" | "tray";
  readonly locked: boolean;
  readonly disabled: boolean;
  readonly reducedMotion: boolean;
  readonly onToggle: () => void;
  readonly onInspect: () => void;
  readonly onDragStart: (event: React.DragEvent) => void;
  readonly onDragEnd: () => void;
}) {
  const inTray = props.where === "tray";
  const data = cardDataFor(props.cardId);
  const identity = cardIdentityFor(data);
  const cat = identity.category;
  const label = inTray
    ? `Remove ${data.title} from your evidence`
    : `Add ${data.title} as evidence`;
  return (
    <div
      className={`ev-card-wrap${props.locked ? " is-locked" : ""}`}
      draggable={!props.locked}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      data-testid={`ev-${props.where}-${props.cardId}`}
    >
      <div
        className={`ev-mini ev-cat-${cat.id.toLowerCase()}${inTray ? " is-placed" : ""}${
          props.reducedMotion ? " is-reduced" : ""
        }`}
        style={
          {
            ["--ev-accent"]: cat.accent,
            ["--ev-accent-deep"]: cat.accentDeep,
          } as React.CSSProperties
        }
      >
        <button
          type="button"
          className="ev-mini-face"
          aria-label={label}
          aria-pressed={inTray}
          disabled={props.disabled}
          data-card-id={props.cardId}
          onClick={props.onToggle}
        >
          <span className="ev-mini-art" aria-hidden="true">
            {identity.art ? (
              <img
                className="ev-mini-art-img"
                src={identity.art.src}
                alt=""
                loading="lazy"
                style={{ objectPosition: identity.art.focus }}
              />
            ) : (
              <span className="ev-mini-art-fallback" />
            )}
            <span className="ev-mini-glyph">{cat.glyph}</span>
          </span>
          <span className="ev-mini-body">
            <span className="ev-mini-cat">{cat.label}</span>
            <span className="ev-mini-title">{data.title}</span>
          </span>
          {inTray && (
            <span className="ev-mini-tick" aria-hidden="true">
              ✓
            </span>
          )}
        </button>
        <button
          type="button"
          className="ev-mini-info"
          aria-label={`Inspect ${data.title}`}
          data-testid={`ev-inspect-${props.cardId}`}
          onClick={props.onInspect}
        >
          <span aria-hidden="true">i</span>
        </button>
      </div>
    </div>
  );
}

export function EvidenceTray(props: EvidenceTrayProps) {
  const {
    offeredCardIds,
    minSupport,
    maxSelectable,
    selected,
    onChange,
    locked = false,
    reducedMotion = false,
  } = props;

  const [announce, setAnnounce] = useState("");
  const [dragOver, setDragOver] = useState<"hand" | "tray" | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const liveId = useId();
  const trayRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  // The face that opened the inspect overlay, so focus returns there on close.
  const inspectOrigin = useRef<HTMLElement | null>(null);

  const selectedSet = new Set(selected);
  const trayCards = selected;
  const handCards = offeredCardIds.filter((id) => !selectedSet.has(id));
  const atMax = selected.length >= maxSelectable;
  // The slots the player is filling: the required minimum, or more if they placed
  // extra. Empty slots read as drop targets and shrink as cards land.
  const slotCount = Math.max(minSupport, trayCards.length);

  const titleOf = (cardId: string): string => cardDataFor(cardId).title;

  const add = useCallback(
    (cardId: string) => {
      if (locked) return;
      if (selectedSet.has(cardId)) return;
      if (!offeredCardIds.includes(cardId)) return;
      if (selected.length >= maxSelectable) {
        setAnnounce(`You can place at most ${maxSelectable} cards.`);
        return;
      }
      const next = [...selected, cardId];
      onChange(next);
      setAnnounce(
        `Placed ${titleOf(cardId)}. ${next.length} of at least ${minSupport} selected.`,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locked, offeredCardIds, selected, maxSelectable, minSupport, onChange],
  );

  const remove = useCallback(
    (cardId: string) => {
      if (locked) return;
      if (!selectedSet.has(cardId)) return;
      const next = selected.filter((id) => id !== cardId);
      onChange(next);
      setAnnounce(
        `Removed ${titleOf(cardId)}. ${next.length} of at least ${minSupport} selected.`,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locked, selected, minSupport, onChange],
  );

  const onDrop = (zone: "hand" | "tray") => (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(null);
    if (locked) return;
    const cardId =
      event.dataTransfer.getData(DRAG_MIME) || event.dataTransfer.getData("text/plain");
    if (!cardId) return;
    if (zone === "tray") add(cardId);
    else remove(cardId);
  };

  const allowDrop = (zone: "hand" | "tray") => (event: React.DragEvent) => {
    if (locked) return;
    event.preventDefault();
    setDragOver(zone);
  };

  const startDrag = (cardId: string) => (event: React.DragEvent) => {
    if (locked) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(DRAG_MIME, cardId);
    event.dataTransfer.setData("text/plain", cardId);
    event.dataTransfer.effectAllowed = "move";
  };

  const closeInspect = useCallback(() => {
    setInspectId(null);
    // Return focus to the control that opened the overlay.
    const origin = inspectOrigin.current;
    inspectOrigin.current = null;
    if (origin && typeof origin.focus === "function") origin.focus();
  }, []);

  const renderMiniWithInspect = (cardId: string, where: "hand" | "tray") => {
    const inTray = where === "tray";
    const disabled = locked || (!inTray && atMax);
    return (
      <EvidenceMini
        cardId={cardId}
        where={where}
        locked={locked}
        disabled={disabled}
        reducedMotion={reducedMotion}
        onToggle={() => (inTray ? remove(cardId) : add(cardId))}
        onInspect={() => {
          inspectOrigin.current = document.activeElement as HTMLElement | null;
          setInspectId(cardId);
        }}
        onDragStart={startDrag(cardId)}
        onDragEnd={() => setDragOver(null)}
      />
    );
  };

  const met = evidenceMinimumMet(selected.length, minSupport);

  return (
    <div className={`ev-tray-root${reducedMotion ? " is-reduced" : ""}`}>
      <div className="ev-section ev-section-tray">
        <div className="ev-section-head">
          <span className="ev-section-title">
            {locked ? "Evidence submitted" : "Evidence"}
          </span>
          <span
            className={`ev-count${met ? " is-met" : ""}`}
            data-testid="ev-count"
            aria-label={`${selected.length} of ${minSupport} evidence cards placed${
              met ? ", enough to submit" : ""
            }`}
          >
            <span className="ev-count-num">
              {selected.length} / {minSupport}
            </span>
            <span className="ev-count-word">{met ? "ready" : "needed"}</span>
          </span>
        </div>
        <div
          ref={trayRef}
          className={`ev-slots${dragOver === "tray" ? " is-drop" : ""}${
            locked ? " is-locked" : ""
          }`}
          data-testid="ev-tray"
          role="list"
          aria-label="Evidence you have placed"
          onDragOver={allowDrop("tray")}
          onDragLeave={() => setDragOver(null)}
          onDrop={onDrop("tray")}
        >
          {slotCount === 0 && trayCards.length === 0 ? (
            <p className="ev-empty">No cards were placed.</p>
          ) : (
            Array.from({ length: slotCount }).map((_, index) => {
              const cardId = trayCards[index];
              if (cardId) {
                return (
                  <div role="listitem" key={cardId}>
                    {renderMiniWithInspect(cardId, "tray")}
                  </div>
                );
              }
              return (
                <div
                  key={`slot-${index}`}
                  className="ev-slot"
                  aria-hidden="true"
                >
                  <span className="ev-slot-plus">+</span>
                  <span className="ev-slot-hint">evidence</span>
                </div>
              );
            })
          )}
        </div>
        <p className="ev-instruction" data-testid="ev-instruction">
          {evidenceInstruction(selected.length, minSupport)}
        </p>
      </div>

      {!locked && (
        <div className="ev-section ev-section-hand">
          <div className="ev-section-head">
            <span className="ev-section-title">Your hand</span>
            <span className="ev-hand-hint" aria-hidden="true">
              tap to place
            </span>
          </div>
          <div
            ref={handRef}
            className={`ev-hand${dragOver === "hand" ? " is-drop" : ""}`}
            data-testid="ev-hand"
            role="list"
            aria-label="Cards offered for this question"
            onDragOver={allowDrop("hand")}
            onDragLeave={() => setDragOver(null)}
            onDrop={onDrop("hand")}
          >
            {handCards.length === 0 ? (
              <p className="ev-empty">Every offered card is placed.</p>
            ) : (
              handCards.map((cardId) => (
                <div role="listitem" key={cardId}>
                  {renderMiniWithInspect(cardId, "hand")}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div
        id={liveId}
        className="ev-sr-only"
        role="status"
        aria-live="polite"
        data-testid="ev-live"
      >
        {announce}
      </div>

      {inspectId && (
        <EvidenceInspect
          cardId={inspectId}
          placed={selectedSet.has(inspectId)}
          locked={locked}
          atMax={atMax}
          reducedMotion={reducedMotion}
          onAdd={() => {
            add(inspectId);
            closeInspect();
          }}
          onRemove={() => {
            remove(inspectId);
            closeInspect();
          }}
          onClose={closeInspect}
        />
      )}
    </div>
  );
}

/**
 * The on-demand detail view: the full collectible `ArchiveCard` in a small dialog,
 * with the same add/remove action the face carries. This is where the premium card
 * presentation lives, so the always-on hand can stay compact. Escape and a click on
 * the scrim close it, and focus returns to the face that opened it.
 */
function EvidenceInspect(props: {
  readonly cardId: string;
  readonly placed: boolean;
  readonly locked: boolean;
  readonly atMax: boolean;
  readonly reducedMotion: boolean;
  readonly onAdd: () => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}) {
  const data = cardDataFor(props.cardId);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstBtn.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canAct = !props.locked && (props.placed || !props.atMax);

  return (
    <div
      className={`ev-inspect-scrim${props.reducedMotion ? " is-reduced" : ""}`}
      onClick={props.onClose}
    >
      <div
        ref={dialogRef}
        className="ev-inspect"
        role="dialog"
        aria-modal="true"
        aria-label={`${data.title} — evidence detail`}
        onClick={(event) => event.stopPropagation()}
      >
        <ArchiveCard
          card={data}
          size="full"
          reducedMotion={props.reducedMotion}
          selected={props.placed}
          showClaim
          {...(props.placed
            ? { chip: <span className="ev-tag ev-tag-placed">Placed</span> }
            : {})}
        />
        <div className="ev-inspect-actions">
          {canAct && (
            <button
              ref={firstBtn}
              type="button"
              className="ev-inspect-act"
              onClick={props.placed ? props.onRemove : props.onAdd}
            >
              {props.placed ? "Remove from evidence" : "Add as evidence"}
            </button>
          )}
          <button
            ref={canAct ? undefined : firstBtn}
            type="button"
            className="ev-inspect-close"
            onClick={props.onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
