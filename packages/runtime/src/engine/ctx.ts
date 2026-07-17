import {
  type WorldState,
  type LearnerState,
  type PresentationDirective,
  type InputRequest,
  type PresenterEvent,
  type WarningStage,
  type Speaker,
} from "@pa/contracts";
import { initialWorldState, advanceClock, bumpInteractionOrdinal } from "../world.js";
import { initialLearnerState } from "../learner.js";
import { TEXT } from "../content/day1/text.js";

export interface Yielded {
  present: PresentationDirective[];
  request: InputRequest;
}

export type Flow = Generator<Yielded, void, PresenterEvent>;
export type Sub<T> = Generator<Yielded, T, PresenterEvent>;

// Mutable run context. Rebuilt from scratch and replayed on every resume, so
// determinism depends only on the seed + committed events.
export class Ctx {
  world: WorldState;
  learner: LearnerState;
  attemptSeed: Uint8Array;

  buffer: PresentationDirective[] = [];
  interactionsSinceLastSync = 0;
  peopleMet: string[] = [];
  routesUnlocked: string[] = [];
  notesEntries: { concept: string; body: string }[] = [];
  selectedHeadline = "TAXED WITHOUT A VOICE";
  pressQuality?: "CRISP" | "USABLE" | "SMUDGED";
  private txCounter = 0;

  constructor(attemptSeed: Uint8Array) {
    this.world = initialWorldState();
    this.learner = initialLearnerState();
    this.attemptSeed = attemptSeed;
  }

  nextTxId(): string {
    this.txCounter += 1;
    return `tx-${this.txCounter}`;
  }

  emit(d: PresentationDirective): void {
    this.buffer.push(d);
  }

  narrate(text: string): void {
    this.emit({ kind: "NARRATION", text });
  }

  archive(text: string): void {
    this.emit({ kind: "ARCHIVE", text });
  }

  scene(locationId: string, text: string): void {
    this.world.locationId = locationId;
    this.emit({ kind: "SCENE", locationId, text });
  }

  dialogue(speaker: Speaker, text: string, interactive = false): void {
    this.emit({ kind: "DIALOGUE", speaker, glyph: interactive ? "INTERACTION" : "SPEECH", text });
  }

  ambient(text: string): void {
    this.emit({ kind: "AMBIENT_CHATTER", text });
  }

  meet(name: string): void {
    if (!this.peopleMet.includes(name)) this.peopleMet.push(name);
  }

  unlockRoute(routeId: string, label: string): void {
    this.world.routes[routeId] = "UNLOCKED";
    if (!this.routesUnlocked.includes(label)) this.routesUnlocked.push(label);
    this.emit({ kind: "FLICKER", flicker: "ROUTE_UNLOCKED", label });
  }

  addNotes(entry: { concept: string; body: string }): void {
    if (!this.notesEntries.some((n) => n.concept === entry.concept)) {
      this.notesEntries.push(entry);
    }
    this.emit({ kind: "FLICKER", flicker: "NOTES_ADDED", label: entry.concept });
  }

  emitClock(): void {
    this.emit({
      kind: "CLOCK_UPDATE",
      spentUnits: this.world.clock.spentUnits,
      phase: this.world.clock.phase,
      warningStage: this.world.clock.warningStage,
    });
  }

  // Commit a unit of activity time. Emits a clock update and any newly crossed
  // warning. Returns whether the fixed-event boundary was reached.
  spendTime(units: number): boolean {
    const res = advanceClock(this.world, units);
    if (units > 0) this.emitClock();
    if (res.crossedWarning) this.emitWarning(res.crossedWarning);
    return res.reachedBoundary;
  }

  private emitWarning(stage: WarningStage): void {
    const line =
      stage === "FINAL" ? TEXT.clockWarnings.FINAL : stage === "SECOND" ? TEXT.clockWarnings.SECOND : TEXT.clockWarnings.FIRST;
    this.archive(line);
  }

  // Register one committed interaction that counts for Sync spacing.
  countSpacing(): void {
    bumpInteractionOrdinal(this.world);
    this.interactionsSinceLastSync += 1;
    for (const c of Object.values(this.learner)) {
      if (c.pendingReexposure && c.pendingReexposure.reexposureCommitted) {
        c.pendingReexposure.spacingInteractionsSince += 1;
      }
    }
  }

  resetSyncSpacing(): void {
    this.interactionsSinceLastSync = 0;
    this.world.lastSyncCompletionInteractionOrdinal = this.world.currentInteractionOrdinal;
  }

  view(): import("@pa/contracts").RuntimeView {
    const learner: Record<string, { understanding: string; demonstration: string; occasions: number; types: number }> = {};
    for (const [k, v] of Object.entries(this.learner)) {
      const name = k.includes("STAMP") ? "Stamp Act" : k.includes("REPRESENTATION") ? "Representation" : "Postwar revenue";
      learner[name] = {
        understanding: v.understanding,
        demonstration: v.demonstration,
        occasions: v.distinctOccasionCount,
        types: v.exposureTypes.length,
      };
    }
    return {
      locationId: this.world.locationId,
      clock: {
        spentUnits: this.world.clock.spentUnits,
        fixedEventBoundary: this.world.clock.fixedEventBoundary,
        phase: this.world.clock.phase,
        warningStage: this.world.clock.warningStage,
      },
      objectives: { ...this.world.objectives },
      relationships: { ...this.world.relationships },
      routes: { ...this.world.routes },
      learner,
      notes: [...this.notesEntries],
      peopleMet: [...this.peopleMet],
      routesUnlocked: [...this.routesUnlocked],
    };
  }
}
