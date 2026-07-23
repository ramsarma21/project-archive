import type { RuntimeView } from "@pa/contracts";
import { THREAD_IDS } from "@pa/chapter-boston";
import {
  DAY1_MICRO_DEFINITIONS,
  THREAD_FIGURES,
  type MicroDefinition,
} from "../world/reactiveManifest.js";

// ---------------------------------------------------------------------------
// Archive tab data selectors (pure, unit-tested). These reconcile the tab
// taxonomy with the reward vocabulary the game actually speaks
// (feel-audit-1 P1-9 / P0 "CONNECTION ADDED" class):
// - PEOPLE includes field-thread figures once their durable MET flag is set
//   (the runtime's peopleMet only records authored-flow meets, so PEOPLE
//   claimed "no one met" while THREADS listed Sarah).
// - CONNECTIONS lists the committed micro-concept connections — the exact
//   records the "Connection added: …" completion chips announce. They used
//   to land under NOTES while the Connections tab stayed empty.
// ---------------------------------------------------------------------------

export interface ThreadPersonEntry {
  id: string;
  name: string;
  role: string;
  glbKey: string;
  trust: number; // -10..10 thread trust
  status: string;
  breadcrumb: string | null;
}

const THREAD_PERSON_META: Record<
  string,
  { id: string; name: string; role: string; glbKey: string }
> = {
  [THREAD_IDS.NED]: {
    id: "ned",
    name: "Ned",
    role: "Printer's apprentice",
    glbKey: THREAD_FIGURES.NED.glb,
  },
  [THREAD_IDS.SARAH]: {
    id: "sarah",
    name: "Goodwife Sarah",
    role: "Market stallholder",
    glbKey: THREAD_FIGURES.SARAH.glb,
  },
};

// Thread figures the player has actually met (durable MET flag or any
// non-UNMET status), for the PEOPLE tab.
export function metThreadPeople(view: RuntimeView): ThreadPersonEntry[] {
  const out: ThreadPersonEntry[] = [];
  for (const thread of Object.values(view.field.threads)) {
    const met = Boolean(thread.flags.MET) || thread.status !== "UNMET";
    if (!met) continue;
    const meta = THREAD_PERSON_META[thread.threadId];
    if (!meta) continue;
    out.push({
      ...meta,
      trust: thread.trust,
      status: thread.status,
      breadcrumb: thread.breadcrumb,
    });
  }
  return out;
}

// Committed micro-concept connections, for the CONNECTIONS tab. One entry per
// engaged micro, in engagement order.
export function engagedConnections(view: RuntimeView): MicroDefinition[] {
  return view.field.engagedMicroIds
    .map((microId) =>
      DAY1_MICRO_DEFINITIONS.find((definition) => definition.id === microId),
    )
    .filter((definition): definition is MicroDefinition => Boolean(definition));
}

// Route leads heard as rumors but not yet opened, for the ROUTES tab
// (feel-audit-1 P1-9: ROUTES ignored the scaffold-route rumor).
export function routeRumors(view: RuntimeView): string[] {
  return view.field.rumors.filter((rumor) => /route|shortcut|lane\b/i.test(rumor));
}
