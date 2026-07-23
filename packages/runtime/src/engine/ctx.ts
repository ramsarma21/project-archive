import {
  type WorldState,
  type LearnerState,
  type PresentationDirective,
  type InputRequest,
  type PresenterEvent,
  type WarningStage,
  type Speaker,
  type FieldCommittedEvent,
  type FieldDurableState,
  type FieldInterruptPlan,
  CP1_CHECKPOINT_ID,
  type AssessmentQuestionBank,
  type Cp1CheckpointState,
  type DeterministicResolution,
} from "@pa/contracts";
import { initialWorldState, advanceClock, bumpInteractionOrdinal } from "../world.js";
import { initialLearnerState, commitExposure } from "../learner.js";
import { LORE_MACRO_SUPPORT } from "../content/day1/tables.js";
import { TEXT } from "../content/day1/text.js";
import {
  applyFieldEvent,
  assertFieldEventPayload,
  initialFieldState,
  projectFieldRuntimeView,
  syncLegacyFieldCompatibility,
} from "../fieldState.js";
import { deriveFieldSeedHex } from "../seed.js";
import {
  CP1_BANK_REGISTRY,
  CP1_PRODUCTION_BANK,
} from "../assessment/questionBank.js";
import {
  eligibleOpenResponses,
  eligibleArchiveConnections,
  npcFollowups,
  openResponsePackage,
  sourcePacket,
} from "../assessment/openResponseRegistry.js";
import { canonicalSourceIds } from "../content/provenance.js";
import { resolutionMatchesPackage } from "../assessment/rubricResolver.js";
import {
  eligibleNpcFollowupsForField,
  resolveRegisteredReactiveOutcome,
} from "../content/day1/reactive.js";

export interface Yielded {
  present: PresentationDirective[];
  request: InputRequest;
  cueId: string;
}

export type Flow = Generator<Yielded, void, PresenterEvent>;
export type Sub<T> = Generator<Yielded, T, PresenterEvent>;

export interface AssessmentRuntimeConfig {
  mode: "PRODUCTION" | "QA_DRAFT";
  openResponseContentMode?: "PRODUCTION" | "AUTHOR_DRAFT_QA";
  activeBankVersion: string;
  banks: ReadonlyMap<string, AssessmentQuestionBank>;
}

// Mutable run context. Rebuilt from scratch and replayed on every resume, so
// determinism depends only on the seed + committed events.
export class Ctx {
  world: WorldState;
  learner: LearnerState;
  field: FieldDurableState;
  attemptSeed: Uint8Array;
  readonly fieldSeedHex: string;
  readonly assessment: AssessmentRuntimeConfig;
  checkpoint: Cp1CheckpointState;

  buffer: PresentationDirective[] = [];
  interactionsSinceLastSync = 0;
  peopleMet: string[] = [];
  routesUnlocked: string[] = [];
  notesEntries: { concept: string; body: string }[] = [];
  selectedHeadline = "TAXED WITHOUT A VOICE";
  pressQuality?: "CRISP" | "USABLE" | "SMUDGED";
  private txCounter = 0;
  private fieldEventIds = new Set<string>();
  private activeFieldInterrupt: FieldInterruptPlan | null = null;

  constructor(
    attemptSeed: Uint8Array,
    assessment: AssessmentRuntimeConfig = {
      mode: "PRODUCTION",
      openResponseContentMode: "PRODUCTION",
      activeBankVersion: CP1_PRODUCTION_BANK.bankVersion,
      banks: CP1_BANK_REGISTRY,
    },
  ) {
    this.world = initialWorldState();
    this.learner = initialLearnerState();
    this.field = initialFieldState(this.world);
    this.attemptSeed = attemptSeed;
    this.fieldSeedHex = deriveFieldSeedHex(attemptSeed);
    this.assessment = assessment;
    this.checkpoint = {
      checkpointId: CP1_CHECKPOINT_ID,
      status: "NOT_STARTED",
      selection: null,
      responses: [],
      currentItemIndex: 0,
      macroOutcomes: [],
      enrichmentOutcomes: [],
      bankVersion: null,
      committedEventId: null,
      transitionEventId: null,
      nextInsertion: null,
      carryover: null,
    };
  }

  applyFieldEvent(event: FieldCommittedEvent): void {
    if (
      event.type === "FIELD_REACTIVE_OUTCOME_SELECTED" &&
      event.sourceId.startsWith("BOS.ACT01.DLG.") &&
      this.assessment.openResponseContentMode !== "AUTHOR_DRAFT_QA"
    ) {
      throw new Error(
        "FIELD_EVENT_INVALID: author-draft interaction is disabled",
      );
    }
    const appliedEvent: FieldCommittedEvent =
      event.type === "FIELD_REACTIVE_OUTCOME_SELECTED"
        ? {
            type: "FIELD_REACTIVE_COMPLETED",
            eventId: event.eventId,
            interruptId: event.interruptId,
            completion: resolveRegisteredReactiveOutcome({
              field: this.field,
              interactionId: event.interactionId,
              sourceId: event.sourceId,
              outcomeId: event.outcomeId,
            }),
          }
        : event;
    assertFieldEventPayload(appliedEvent, this.field, this.world);
    if (this.fieldEventIds.has(event.eventId)) {
      throw new Error(`FIELD_EVENT_INVALID: duplicate eventId ${event.eventId}`);
    }
    applyFieldEvent(this.field, this.world, appliedEvent);
    this.fieldEventIds.add(event.eventId);
    // Found-History Tier-A bridge: a free-roam knowledge inspect that supports
    // a required macro also commits the mapped tracked exposure (with
    // provenance). Idempotent by exposureId; deterministic on replay because
    // field events replay in committed order.
    if (appliedEvent.type === "FIELD_REACTIVE_COMPLETED") {
      const support = LORE_MACRO_SUPPORT[appliedEvent.completion.sourceId];
      if (support) {
        for (const def of support) {
          commitExposure(
            this.learner,
            def.concept,
            def.exposureId,
            def.type,
            this.world.currentInteractionOrdinal,
            def.provenance,
          );
        }
      }
      // Owned-route labels for the Archive ROUTES pane (the route flag itself
      // was applied to world.routes by the field reducer above).
      for (const route of appliedEvent.completion.routes ?? []) {
        if (!this.routesUnlocked.includes(route.label)) {
          this.routesUnlocked.push(route.label);
        }
      }
    }
  }

  syncLegacyFieldCompatibility(): void {
    syncLegacyFieldCompatibility(this.field, this.world);
  }

  setActiveFieldInterrupt(interrupt: FieldInterruptPlan | null): void {
    this.activeFieldInterrupt = interrupt ? { ...interrupt } : null;
  }

  eligibleOpenResponsePrompts() {
    const sourceInteractions: Record<string, number> = {};
    for (const engagement of Object.values(this.field.sourceEngagements)) {
      sourceInteractions[engagement.sourcePacketId] = Math.min(
        sourceInteractions[engagement.sourcePacketId] ??
          Number.POSITIVE_INFINITY,
        engagement.interactionOrdinal,
      );
    }
    for (const completion of Object.values(this.field.reactiveCompletions)) {
      for (const sourceId of canonicalSourceIds(completion.sourceId)) {
        sourceInteractions[sourceId] = Math.min(
          sourceInteractions[sourceId] ?? Number.POSITIVE_INFINITY,
          completion.interactionOrdinal,
        );
      }
    }
    for (const engagement of Object.values(this.field.microEngagements)) {
      for (const sourceId of canonicalSourceIds(engagement.sourceId)) {
        sourceInteractions[sourceId] = Math.min(
          sourceInteractions[sourceId] ?? Number.POSITIVE_INFINITY,
          engagement.interactionOrdinal,
        );
      }
    }
    const allowAuthorDraft =
      this.assessment.openResponseContentMode === "AUTHOR_DRAFT_QA";
    return eligibleOpenResponses({
      sourceInteractions,
      engagedMicroConceptIds: new Set(this.field.engagedMicroIds),
      currentInteractionOrdinal: this.world.currentInteractionOrdinal,
      completedPromptIds: new Set(
        Object.keys(this.field.openResponseCompletions),
      ),
      actCompletionCount: Object.keys(this.field.openResponseCompletions).length,
      allowAuthorDraft,
    });
  }

  assertOpenResponseEligible(promptId: string): void {
    const requested = openResponsePackage(promptId, {
      allowAuthorDraft:
        this.assessment.openResponseContentMode === "AUTHOR_DRAFT_QA",
    });
    if (
      !requested ||
      !this.eligibleOpenResponsePrompts().some(
        (prompt) => prompt.promptId === requested.prompt.promptId,
      )
    ) {
      throw new Error(
        `OPEN_RESPONSE_INVALID: prompt ${promptId} is not eligible`,
      );
    }
  }

  assertOpenResponseResolution(
    promptId: string,
    resolution: DeterministicResolution,
  ): void {
    const entry = openResponsePackage(promptId, {
      allowAuthorDraft:
        this.assessment.openResponseContentMode === "AUTHOR_DRAFT_QA",
    });
    if (!entry || !resolutionMatchesPackage(entry.rubric, resolution)) {
      throw new Error(
        `OPEN_RESPONSE_INVALID: resolution is not in the authored package`,
      );
    }
  }

  nextTxId(): string {
    this.txCounter += 1;
    return `tx-${this.txCounter}`;
  }

  emit(d: PresentationDirective): void {
    this.buffer.push({
      ...d,
      locationId: d.locationId ?? this.world.locationId,
    } as PresentationDirective);
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

  // Commit a unit of activity time. Emits a clock update and every newly
  // crossed warning in order. Returns whether the fixed-event boundary was
  // reached during this commit.
  spendTime(units: number): boolean {
    const res = advanceClock(this.world, units);
    if (units > 0) this.emitClock();
    for (const stage of res.crossedWarnings) this.emitWarning(stage);
    return res.reachedBoundary;
  }

  // True once the authored activity clock has consumed the whole day. After
  // this, optional work must stop being offered; only the closure/crowd path
  // remains.
  dayBoundaryReached(): boolean {
    return this.world.clock.spentUnits >= this.world.clock.fixedEventBoundary;
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
    const allowAuthorDraft =
      this.assessment.openResponseContentMode === "AUTHOR_DRAFT_QA";
    const visibleNpcFollowups = allowAuthorDraft
      ? [...eligibleNpcFollowupsForField(this.field)]
      : [];
    if (
      allowAuthorDraft &&
      this.activeFieldInterrupt?.kind === "REACTIVE_EXCHANGE" &&
      this.activeFieldInterrupt.sourceId?.startsWith("BOS.ACT01.DLG.") &&
      !visibleNpcFollowups.some(
        (node) => node.nodeId === this.activeFieldInterrupt?.sourceId,
      )
    ) {
      const active = npcFollowups({ allowAuthorDraft: true }).find(
        (node) => node.nodeId === this.activeFieldInterrupt?.sourceId,
      );
      if (active) visibleNpcFollowups.push(active);
    }
    const engagedSourcePacketIds = new Set(
      Object.values(this.field.sourceEngagements).map(
        (record) => record.sourcePacketId,
      ),
    );
    return {
      locationId: this.world.locationId,
      clock: {
        spentUnits: this.world.clock.spentUnits,
        fixedEventBoundary: this.world.clock.fixedEventBoundary,
        phase: this.world.clock.phase,
        warningStage: this.world.clock.warningStage,
      },
      objectives: { ...this.world.objectives },
      printJobs: structuredClone(this.world.printJobs),
      relationships: { ...this.world.relationships },
      routes: { ...this.world.routes },
      learner,
      notes: [...this.notesEntries],
      peopleMet: [...this.peopleMet],
      routesUnlocked: [...this.routesUnlocked],
      field: projectFieldRuntimeView(
        this.field,
        this.world,
        this.fieldSeedHex,
        this.activeFieldInterrupt,
      ),
      checkpoint: structuredClone(this.checkpoint),
      openResponse: {
        eligible: this.eligibleOpenResponsePrompts().map((prompt) =>
          structuredClone(prompt),
        ),
        activePrompt:
          this.activeFieldInterrupt?.kind === "OPEN_RESPONSE"
            ? structuredClone(
                openResponsePackage(
                  this.activeFieldInterrupt.sourceId ?? "",
                  {
                    allowAuthorDraft:
                      this.assessment.openResponseContentMode ===
                      "AUTHOR_DRAFT_QA",
                  },
                )?.prompt ?? null,
              )
            : null,
        evidence: Object.values(this.field.openResponseCompletions)
          .sort((a, b) => a.interactionOrdinal - b.interactionOrdinal)
          .map((record) => ({
            response: structuredClone(record.response),
            resolution: structuredClone(record.resolution),
          })),
        npcFollowups: visibleNpcFollowups.map((node) =>
          structuredClone(node),
        ),
        archiveConnections: eligibleArchiveConnections({
          engagedSourcePacketIds,
          allowAuthorDraft,
        }).map((card) => ({
          ...structuredClone(card),
          artifactRefs: [
            ...new Set(
              card.citations.flatMap(
                (sourceId) =>
                  sourcePacket(sourceId)?.backingRefs.filter((ref) =>
                    ref.startsWith("poster-"),
                  ) ?? [],
              ),
            ),
          ],
        })),
      },
    };
  }
}
