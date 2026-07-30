import { useEffect, useMemo, useRef, useState } from "react";
import { M1_CODEX } from "./m1Codex.js";
import {
  codexGroupsView,
  codexStatusLabel,
  M1_PVP_TRIAL_ACCESS,
  type CodexCardView,
  type CodexStandingLike,
} from "./codexView.js";
import { ArchiveCard, type ArchiveCardData } from "./ArchiveCard.js";
import { cardCategory, type CardCategoryId } from "./cardIdentity.js";
import "./codex.css";

// The Codex: Mission 1's nine cards as a collectible binder.
//
// This is a study surface, not a dashboard. The cards are the same `ArchiveCard` a
// duel deals into the evidence hand, so a player recognises a card they have studied
// the instant it appears under fire. It obeys the dialog contract a keyboard and a
// screen reader expect — a labelled title, an always-reachable close, Escape to
// dismiss, focus moved in on open and restored on close — and adds a binder grid with
// arrow-key roving, category filters, and a front/detail inspection view.
//
// State comes from `progression.view.codex` and nothing here mutates it: a signed-out
// preview reads the definitions but holds nothing, so every card shows LOCKED rather
// than claiming one was learned. The temporary M1 PvP trial access is shown as its own
// chip and never fakes learning.

export interface CodexOverlayProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly codex: CodexStandingLike;
  readonly reducedMotion?: boolean;
}

type Filter = "ALL" | CardCategoryId;

const FILTERS: readonly { readonly id: Filter; readonly label: string }[] = [
  { id: "ALL", label: "All cards" },
  { id: "INTOLERABLE_ACTS", label: "The Coercive Acts" },
  { id: "REPRESENTATION", label: "Representation" },
  { id: "MERCANTILISM", label: "Non-importation" },
];

function toCardData(card: CodexCardView): ArchiveCardData {
  return {
    cardId: card.cardId,
    title: card.title,
    claim: card.proposition,
    conceptId: card.conceptId,
    sourceCueId: card.sourceCueId,
  };
}

function StatusChips(props: { card: CodexCardView }) {
  const { card } = props;
  return (
    <span className="codex-chips">
      <span className={`codex-chip chip-${card.status.toLowerCase()}`}>
        {codexStatusLabel(card.status)}
      </span>
      {card.trialAccess && (
        <span
          className="codex-chip chip-trial"
          title="Temporary playtest access: usable in PvP now, not yet earned."
        >
          PvP trial
        </span>
      )}
    </span>
  );
}

export function CodexOverlay(props: CodexOverlayProps) {
  const { open, onClose, codex, reducedMotion = false } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const detailBackRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const [filter, setFilter] = useState<Filter>("ALL");
  const [inspecting, setInspecting] = useState<string | null>(null);

  const groups = useMemo(
    () => codexGroupsView(codex, M1_PVP_TRIAL_ACCESS),
    [codex],
  );
  const allCards = useMemo(() => groups.flatMap((group) => group.cards), [groups]);
  const visible = useMemo(
    () =>
      filter === "ALL"
        ? allCards
        : allCards.filter((card) => cardCategory(card.conceptId).id === filter),
    [allCards, filter],
  );
  const inspected = useMemo(
    () => allCards.find((card) => card.cardId === inspecting) ?? null,
    [allCards, inspecting],
  );

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus?.();
    };
  }, [open]);

  // Move focus into the detail view when it opens, and back to its tile when it closes.
  useEffect(() => {
    if (inspecting) detailBackRef.current?.focus();
    else if (open && inspecting === null) {
      const tile = gridRef.current?.querySelector<HTMLButtonElement>(
        `[data-card-id="${cssEscape(lastInspectedRef.current ?? "")}"]`,
      );
      tile?.focus();
    }
  }, [inspecting, open]);

  const lastInspectedRef = useRef<string | null>(null);

  if (!open) return null;

  const unavailable = !M1_CODEX.ok;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (inspecting) setInspecting(null);
      else onClose();
    }
  };

  // Arrow-key roving across the binder grid: a player never has to Tab through nine
  // cards to reach the tenth control.
  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const tiles = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>(".arc-card") ?? [],
    );
    if (tiles.length === 0) return;
    const current = tiles.indexOf(document.activeElement as HTMLButtonElement);
    const columns = columnCount(gridRef.current);
    let next = current;
    switch (event.key) {
      case "ArrowRight":
        next = current < 0 ? 0 : Math.min(tiles.length - 1, current + 1);
        break;
      case "ArrowLeft":
        next = current < 0 ? 0 : Math.max(0, current - 1);
        break;
      case "ArrowDown":
        next = current < 0 ? 0 : Math.min(tiles.length - 1, current + columns);
        break;
      case "ArrowUp":
        next = current < 0 ? 0 : Math.max(0, current - columns);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tiles.length - 1;
        break;
    }
    if (next !== current) {
      event.preventDefault();
      tiles[next]?.focus();
    }
  };

  const inspect = (cardId: string) => {
    lastInspectedRef.current = cardId;
    setInspecting(cardId);
  };

  return (
    <div
      className={`codex-scrim${reducedMotion ? " is-reduced" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="codex-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="codex-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="codex-head">
          <div className="codex-head-copy">
            <span className="codex-kicker">Archive // Codex</span>
            <h2 id="codex-title" className="codex-title">
              Mission 1 · Your card collection
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="codex-close"
            onClick={onClose}
            aria-label="Close the Codex"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="codex-body">
          {unavailable ? (
            <p className="codex-empty" role="alert">
              The Codex could not be loaded. Its definition file is malformed, so
              nothing is shown rather than a partial list.
            </p>
          ) : inspected ? (
            <CodexDetail
              card={inspected}
              reducedMotion={reducedMotion}
              backRef={detailBackRef}
              onBack={() => setInspecting(null)}
            />
          ) : (
            <>
              <p className="codex-lede">
                Every card is a claim a duel can ask you about. Study it here; in a
                duel you will pick the cards that back your answer before you write it.
              </p>

              <div className="codex-filters" role="group" aria-label="Filter by category">
                {FILTERS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`codex-filter${filter === option.id ? " is-active" : ""}`}
                    aria-pressed={filter === option.id}
                    onClick={() => setFilter(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div
                ref={gridRef}
                className="codex-grid"
                role="list"
                aria-label="Codex cards"
                onKeyDown={onGridKeyDown}
              >
                {visible.map((card) => (
                  <div role="listitem" key={card.cardId} className="codex-grid-cell">
                    <ArchiveCard
                      card={toCardData(card)}
                      size="tile"
                      reducedMotion={reducedMotion}
                      chip={<StatusChips card={card} />}
                      onActivate={() => inspect(card.cardId)}
                      ariaLabel={`${card.title}. ${codexStatusLabel(card.status)}. Inspect card.`}
                      className={`codex-tile is-${card.status.toLowerCase()}`}
                      dataCardId={card.cardId}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CodexDetail(props: {
  readonly card: CodexCardView;
  readonly reducedMotion: boolean;
  readonly backRef: React.RefObject<HTMLButtonElement>;
  readonly onBack: () => void;
}) {
  const { card, reducedMotion, backRef, onBack } = props;
  return (
    <div className="codex-detail">
      <button ref={backRef} type="button" className="codex-back" onClick={onBack}>
        <span aria-hidden="true">‹</span> Back to binder
      </button>
      <div className="codex-detail-body">
        <ArchiveCard
          card={toCardData(card)}
          size="full"
          reducedMotion={reducedMotion}
          chip={<StatusChips card={card} />}
        />
        <div className="codex-detail-notes">
          <h3 className="codex-detail-title">{card.title}</h3>
          <p className="codex-detail-status">
            {card.status === "PVP_LEGAL"
              ? "Mastered. PvP-legal for keeps."
              : card.status === "LEARNED"
                ? "Learned in the mission."
                : "Not yet learned."}
            {card.trialAccess ? " Usable in PvP now on temporary playtest access." : ""}
          </p>
          <p className="codex-detail-claim">{card.proposition}</p>
        </div>
      </div>
    </div>
  );
}

/** The rendered column count of the grid, for arrow-key row jumps. */
function columnCount(grid: HTMLElement | null): number {
  if (!grid) return 1;
  const style = window.getComputedStyle(grid);
  const columns = style.gridTemplateColumns.split(" ").filter(Boolean).length;
  return Math.max(1, columns);
}

/** A minimal CSS.escape, so a selector built from a card id is always valid. */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
