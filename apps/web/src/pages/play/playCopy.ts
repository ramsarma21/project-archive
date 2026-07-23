import type { InputRequest, OnboardingPreferences } from "@pa/contracts";

// ---------------------------------------------------------------------------
// Play-shell COPY BLOCKS (content). The presenter components that render
// these (PrimerCard / DayEnd / ArchiveManual in Play.tsx) stay engine; only
// the authored strings and their request-kind mappings live here.
// ---------------------------------------------------------------------------

// First-encounter hints (design1 kill list): the three stacked ACKNOWLEDGE
// primer modals became contextual one-line hints — non-modal, non-stacking,
// no "!" iconography, shown once per id. The persistence contract is
// unchanged: the same PrimerId set lands in onboarding.primersSeen and the
// pause menu's replay control clears it.
export type PrimerId = "ARCHIVE" | "MOVEMENT" | "READ" | "WORK" | "CHOICE";
export interface Primer {
  id: PrimerId;
  /** One line, player voice. */
  hint: string;
}

const PRIMER_COPY: Record<PrimerId, Primer> = {
  ARCHIVE: {
    id: "ARCHIVE",
    hint: "The blue voice is your Archive — context and directions, never your choices.",
  },
  MOVEMENT: {
    id: "MOVEMENT",
    hint: "WASD to walk, Shift to run, F to use things. Wandering costs no daylight.",
  },
  READ: {
    id: "READ",
    hint: "You can step in and read it, or keep moving — your call.",
  },
  WORK: {
    id: "WORK",
    hint: "Follow your hands: one committed action finishes the job.",
  },
  CHOICE: {
    id: "CHOICE",
    hint: "The small tags under each choice are the cost, up front.",
  },
};

export function primerFor(request: InputRequest | null, seen: ReadonlySet<PrimerId>): Primer | null {
  if (!request) return null;
  let primer: Primer | null = null;
  switch (request.kind) {
    case "CONTINUE":
    case "ACK":
      primer = PRIMER_COPY.ARCHIVE;
      break;
    case "FREE_ROAM":
      primer = PRIMER_COPY.MOVEMENT;
      break;
    case "FOCUS_READ":
      primer = PRIMER_COPY.READ;
      break;
    case "MECHANIC":
      primer = PRIMER_COPY.WORK;
      break;
    case "CHOICE":
      primer = PRIMER_COPY.CHOICE;
      break;
    case "BREATHER":
    case "DAY_END":
    case "CHECKPOINT_DEBRIEF":
      break;
  }
  return primer && !seen.has(primer.id) ? primer : null;
}

export function objectiveLabel(request: InputRequest | null): string {
  if (!request) return "Synchronizing field record…";
  switch (request.kind) {
    case "FREE_ROAM": return "Reach a marked destination";
    case "CHOICE": return request.frame;
    case "MECHANIC": return request.params.prompt;
    case "FOCUS_READ": return `Examine ${request.title}`;
    case "ACK": return request.text;
    case "BREATHER": return "Move through the world";
    case "DAY_END": return "Complete the day";
    case "CHECKPOINT_DEBRIEF": return "Complete Checkpoint One";
    case "CONTINUE": return request.label ?? "Continue the current scene";
  }
}

// The end-of-day record is the one moment the System window goes big: a
// full celebratory readout of the day, filed as an Archive record (Day-1 B13).
export const DAY_END_COPY = {
  heading: "ARCHIVE // DAY ONE FILED",
  artifactKicker: "ARTIFACT OF RECORD",
  notesTitle: "RECORDS ADDED TO NOTES",
  peopleLabel: "PEOPLE MET",
  peopleEmpty: "No one new today",
  routesLabel: "ROUTES UNLOCKED",
  routesEmpty: "None today",
  defaultDone: "Back to profiles",
} as const;

export interface ManualRow {
  term: string;
  description: string;
}

// The pause surface (design1 kill list): the Archive Manual folded in here.
// Reading-pace and accessibility tuning live behind "Interface &
// accessibility" (the full interview, reachable any time) with smart
// defaults applied at first play.
export const MANUAL_COPY = {
  kicker: "PAUSED // THE STREET WAITS",
  heading: "Catch your breath",
  close: "Back to the street",
  objectiveKicker: "WHERE YOU LEFT IT",
  moveSection: "Getting around",
  archiveSection: "Your Archive",
  settingsSection: "Tuned for you",
  settingsNote:
    "Started with smart defaults. Reading pace, captions, contrast, motion, and chase assists are yours to change here, any time.",
  adjustButton: "Interface & accessibility",
  replayButton: "Replay first-time hints",
  footnote: "Pausing never changes progress, evidence, or your record.",
} as const;

export function manualMoveRows(
  settings: OnboardingPreferences | undefined,
): ManualRow[] {
  return [
    { term: "Walk", description: "WASD or arrow keys" },
    { term: "Run", description: "Hold Shift while moving" },
    {
      term: "Look",
      description:
        settings?.inputMethod === "KEYBOARD_ONLY"
          ? "Fixed follow camera"
          : "Drag on the world",
    },
    {
      term: "Interact",
      description: "F uses the nearest contextual object; enter quest markers to arrive",
    },
    {
      term: "Inspect",
      description: "F opens optional teal Archive context when no traversal action has priority",
    },
  ];
}

export function manualArchiveRows(
  settings: OnboardingPreferences | undefined,
): ManualRow[] {
  return [
    { term: "Choose", description: "Click, or Tab then Enter" },
    { term: "Read", description: "Open highlighted records when prompted" },
    { term: "Log", description: "Review recent dialogue from the world panel" },
    {
      term: "Assist",
      description: settings?.archiveAssistAutoOffer
        ? "May offer help after a pause"
        : "Manual request only",
    },
  ];
}
