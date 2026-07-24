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
  type AssessmentQuestionBank,
  type Cp1CheckpointState,
  type DeterministicResolution,
} from "@pa/contracts";
import { advanceClock, bumpInteractionOrdinal } from "../world.js";
import { initialLearnerState, commitExposure } from "../learner.js";
import {
  applyFieldEvent,
  assertFieldEventPayload,
  compileFieldVocabulary,
  initialFieldState,
  projectFieldRuntimeView,
  syncLegacyFieldCompatibility,
  type CompiledFieldVocabulary,
} from "../fieldState.js";
import { deriveFieldSeedHex } from "../seed.js";
import { resolutionMatchesPackage } from "../assessment/rubricResolver.js";
import type { ChapterDefinition } from "./chapter.js";

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
// determinism depends only on the seed + committed events. All chapter
// content arrives through the injected ChapterDefinition; this module never
// imports from a content package.
export class Ctx {
  readonly chapter: ChapterDefinition;
  world: WorldState;
  learner: LearnerState;
  field: FieldDurableState;
  attemptSeed: Uint8Array;
  readonly fieldSeedHex: string;
  readonly assessment: AssessmentRuntimeConfig;
  readonly fieldVocab: CompiledFieldVocabulary;
  checkpoint: Cp1CheckpointState;

  buffer: PresentationDirective[] = [];
  interactionsSinceLastSync = 0;
  peopleMet: string[] = [];
  routesUnlocked: string[] = [];
  notesEntries: { concept: string; body: string }[] = [];
  selectedHeadline: string;
  pressQuality?: "CRISP" | "USABLE" | "SMUDGED";
  private txCounter = 0;
  private fieldEventIds = new Set<string>();
  private activeFieldInterrupt: FieldInterruptPlan | null = null;

  constructor(
    attemptSeed: Uint8Array,
    chapter: ChapterDefinition,
    assessment?: AssessmentRuntimeConfig,
  ) {
    this.chapter = chapter;
    this.fieldVocab = compileFieldVocabulary(chapter.fieldVocabulary);
    this.world = chapter.content.createInitialWorldState();
    this.learner = initialLearnerState(chapter.content.learnerConceptIds);
    this.field = initialFieldState(this.world, this.fieldVocab);
    this.attemptSeed = attemptSeed;
    this.fieldSeedHex = deriveFieldSeedHex(attemptSeed);
    this.selectedHeadline = chapter.content.defaultHeadline;
    this.assessment = assessment ?? {
      mode: "PRODUCTION",
      openResponseContentMode: "PRODUCTION",
      activeBankVersion: chapter.assessment.productionBankVersion,
      banks: chapter.assessment.banks,
    };
    this.checkpoint = {
      checkpointId: chapter.assessment.checkpoint.checkpointId,
      status: "NOT_STARTED",
      selection: null,
      responses: [],
      currentItemIndex: 0,
      macroOutcomes: [],
      enrichmentOutcomes: [],
      bankVersion: null,
      committedEventId: null,
      transitionEventId: null,
      annotation: null,
      nextInsertion: null,
      carryover: null,
    };
  }

  applyFieldEvent(event: FieldCommittedEvent): void {
    if (
      event.type === "FIELD_REACTIVE_OUTCOME_SELECTED" &&
      event.sourceId.startsWith(this.chapter.content.authorDraftSourcePrefix) &&
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
            completion: this.chapter.content.reactiveOutcomeResolver({
              field: this.field,
              interactionId: event.interactionId,
              sourceId: event.sourceId,
              outcomeId: event.outcomeId,
            }),
          }
        : event;
    assertFieldEventPayload(appliedEvent, this.field, this.world, this.fieldVocab);
    if (this.fieldEventIds.has(event.eventId)) {
      throw new Error(`FIELD_EVENT_INVALID: duplicate eventId ${event.eventId}`);
    }
    applyFieldEvent(this.field, this.world, appliedEvent, this.fieldVocab);
    this.fieldEventIds.add(event.eventId);
    // Found-History Tier-A bridge: a free-roam knowledge inspect that supports
    // a required macro also commits the mapped tracked exposure (with
    // provenance). Idempotent by exposureId; deterministic on replay because
    // field events replay in committed order.
    if (appliedEvent.type === "FIELD_REACTIVE_COMPLETED") {
      const support =
        this.chapter.content.loreMacroSupport[appliedEvent.completion.sourceId];
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
      for (const sourceId of this.chapter.content.canonicalSourceIds(
        completion.sourceId,
      )) {
        sourceInteractions[sourceId] = Math.min(
          sourceInteractions[sourceId] ?? Number.POSITIVE_INFINITY,
          completion.interactionOrdinal,
        );
      }
    }
    for (const engagement of Object.values(this.field.microEngagements)) {
      for (const sourceId of this.chapter.content.canonicalSourceIds(
        engagement.sourceId,
      )) {
        sourceInteractions[sourceId] = Math.min(
          sourceInteractions[sourceId] ?? Number.POSITIVE_INFINITY,
          engagement.interactionOrdinal,
        );
      }
    }
    const allowAuthorDraft =
      this.assessment.openResponseContentMode === "AUTHOR_DRAFT_QA";
    return this.chapter.content.openResponse.eligible({
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
    const requested = this.chapter.content.openResponse.package(promptId, {
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
    const entry = this.chapter.content.openResponse.package(promptId, {
      allowAuthorDraft:
        this.assessment.openResponseContentMode === "AUTHOR_DRAFT_QA",
    });
    if (
      !entry ||
      !resolutionMatchesPackage(entry.rubric, resolution, {
        legacyRubricIds: this.chapter.assessment.legacyRubricIds,
      })
    ) {
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
    if (stage === "NONE") return;
    this.archive(this.chapter.content.clockWarningLines[stage]);
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
      const name = this.chapter.content.conceptShortNames[k] ?? k;
      learner[name] = {
        understanding: v.understanding,
        demonstration: v.demonstration,
        occasions: v.distinctOccasionCount,
        types: v.exposureTypes.length,
      };
    }
    const allowAuthorDraft =
      this.assessment.openResponseContentMode === "AUTHOR_DRAFT_QA";
    const openResponse = this.chapter.content.openResponse;
    const visibleNpcFollowups = allowAuthorDraft
      ? [...openResponse.eligibleNpcFollowupsForField(this.field)]
      : [];
    if (
      allowAuthorDraft &&
      this.activeFieldInterrupt?.kind === "REACTIVE_EXCHANGE" &&
      this.activeFieldInterrupt.sourceId?.startsWith(
        this.chapter.content.authorDraftSourcePrefix,
      ) &&
      !visibleNpcFollowups.some(
        (node) => node.nodeId === this.activeFieldInterrupt?.sourceId,
      )
    ) {
      const active = openResponse
        .npcFollowups({ allowAuthorDraft: true })
        .find((node) => node.nodeId === this.activeFieldInterrupt?.sourceId);
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
      printWorkshop: structuredClone(this.world.printWorkshop),
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
        this.fieldVocab,
      ),
      checkpoint: structuredClone(this.checkpoint),
      openResponse: {
        eligible: this.eligibleOpenResponsePrompts().map((prompt) =>
          structuredClone(prompt),
        ),
        activePrompt:
          this.activeFieldInterrupt?.kind === "OPEN_RESPONSE"
            ? structuredClone(
                openResponse.package(
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
            artifact: structuredClone(record.artifact),
            resolution: structuredClone(record.resolution),
          })),
        npcFollowups: visibleNpcFollowups.map((node) =>
          structuredClone(node),
        ),
        archiveConnections: openResponse
          .archiveConnections({
            engagedSourcePacketIds,
            allowAuthorDraft,
          })
          .map((card) => ({
            ...structuredClone(card),
            artifactRefs: [
              ...new Set(
                card.citations.flatMap((sourceId) =>
                  openResponse
                    .sourcePacketBackingRefs(sourceId)
                    .filter((ref) => ref.startsWith("poster-")),
                ),
              ),
            ],
          })),
      },
    };
  }
}
