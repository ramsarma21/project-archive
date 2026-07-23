import type { InputRequest, OnboardingPreferences } from "@pa/contracts";

// ---------------------------------------------------------------------------
// Play-shell COPY BLOCKS (content). The presenter components that render
// these (PrimerCard / DayEnd / ArchiveManual in Play.tsx) stay engine; only
// the authored strings and their request-kind mappings live here.
// ---------------------------------------------------------------------------

export type PrimerId = "ARCHIVE" | "MOVEMENT" | "READ" | "WORK" | "CHOICE";
export interface Primer {
  id: PrimerId;
  title: string;
  body: string;
  control: string;
}

const PRIMER_COPY: Record<PrimerId, Primer> = {
  ARCHIVE: {
    id: "ARCHIVE",
    title: "Archive channel ready",
    body: "Archive records provide context and objectives. They never make a choice for you.",
    control: "Confirm once to continue.",
  },
  MOVEMENT: {
    id: "MOVEMENT",
    title: "Move through the field",
    body: "Follow the gold objective marker. Exploration costs no time until you commit to an activity.",
    control: "WASD/arrows walk; Shift sprints; Space jumps; Shift+Space running-jumps; C crouches; F uses marked objects.",
  },
  READ: {
    id: "READ",
    title: "Examine field evidence",
    body: "Important documents can be opened and read in place. Skippable records never hide required history.",
    control: "Open the highlighted record, or choose Skip.",
  },
  WORK: {
    id: "WORK",
    title: "Complete the work",
    body: "Job actions use a focused control. The result changes local details, not fixed historical events.",
    control: "Follow the prompt, then commit the action once.",
  },
  CHOICE: {
    id: "CHOICE",
    title: "Choose your approach",
    body: "Choices can change routes, time, and relationships. Short tags preview those immediate stakes.",
    control: "Select one response to commit it.",
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

export const PRIMER_CARD_COPY = {
  heading: "FIELD PRIMER // FIRST USE",
  confirm: "ACKNOWLEDGE",
} as const;

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

export const MANUAL_COPY = {
  kicker: "ARCHIVE // FIELD MANUAL",
  heading: "Insertion controls",
  close: "Close",
  objectiveKicker: "ACTIVE OBJECTIVE",
  moveSection: "Move and observe",
  archiveSection: "Archive interface",
  settingsSection: "Accessibility profile",
  adjustButton: "Adjust interface profile",
  replayButton: "Replay first-use primers",
  footnote: "Opening the Manual never changes progress, evidence, or assessment.",
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
