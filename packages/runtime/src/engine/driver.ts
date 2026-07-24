import {
  type PresenterEvent,
  type OrdinaryPresenterEvent,
  type ExecutionPlan,
  type PresentationDirective,
  type FieldCommittedEvent,
  type FieldInterruptPlan,
  isFieldCommittedEvent,
  isFieldEventLike,
} from "@pa/contracts";
import type { Ctx, Flow } from "./ctx.js";

export interface AdvanceResult {
  newDirectives: PresentationDirective[];
  plan: ExecutionPlan | null;
  done: boolean;
}

// A live, resumable run. Determinism comes from replaying committed events
// against a freshly-seeded Ctx; the worker keeps one Session alive in memory.
export class Session {
  readonly ctx: Ctx;
  private g: Flow;
  private done = false;
  private currentPlan: ExecutionPlan | null = null;
  private suspendedPlan: ExecutionPlan | null = null;
  private activeInterrupt: FieldInterruptPlan | null = null;
  transcript: PresentationDirective[] = [];
  committedEvents: PresenterEvent[] = [];

  constructor(ctx: Ctx, flowFactory: (ctx: Ctx) => Flow, priorEvents: PresenterEvent[] = []) {
    this.ctx = ctx;
    this.g = flowFactory(ctx);
    const first = this.g.next();
    if (!first.done) {
      this.transcript.push(...first.value.present);
      this.currentPlan = { present: first.value.present, request: first.value.request, cueId: first.value.cueId };
    } else {
      this.done = true;
    }
    for (const ev of priorEvents) {
      this.applyInternal(ev);
      if (this.done) break;
    }
  }

  get isDone(): boolean {
    return this.done;
  }

  get plan(): ExecutionPlan | null {
    return this.currentPlan;
  }

  advance(ev: PresenterEvent): AdvanceResult {
    if (this.done) {
      if (isFieldEventLike(ev)) {
        throw new Error("FIELD_EVENT_INVALID: cannot commit a field event after completion");
      }
      return { newDirectives: [], plan: null, done: true };
    }
    const before = this.transcript.length;
    this.applyInternal(ev);
    const newDirectives = this.transcript.slice(before);
    return { newDirectives, plan: this.currentPlan, done: this.done };
  }

  emitFieldEvent(event: FieldCommittedEvent): AdvanceResult {
    return this.advance(event);
  }

  private applyInternal(ev: PresenterEvent): void {
    if (isFieldEventLike(ev)) {
      if (!isFieldCommittedEvent(ev)) {
        throw new Error("FIELD_EVENT_INVALID: unknown or malformed field event type");
      }
      this.applyFieldInternal(ev);
      return;
    }
    if (this.activeInterrupt) {
      throw new Error(
        `FIELD_EVENT_INVALID: interrupt ${this.activeInterrupt.interruptId} must resolve before ordinary input`,
      );
    }
    const r = this.g.next(ev as OrdinaryPresenterEvent);
    this.committedEvents.push(ev);
    this.ctx.syncLegacyFieldCompatibility();
    if (r.done) {
      this.done = true;
      this.currentPlan = null;
      return;
    }
    this.transcript.push(...r.value.present);
    this.currentPlan = { present: r.value.present, request: r.value.request, cueId: r.value.cueId };
  }

  private applyFieldInternal(event: FieldCommittedEvent): void {
    switch (event.type) {
      case "FIELD_WATCHER_CHALLENGE": {
        this.assertCanStartInterrupt();
        this.ctx.applyFieldEvent(event);
        this.beginInterrupt({
          interruptId: event.interruptId,
          kind: "CONFRONTATION",
          phase: "ACTIVE",
          sourceId: event.watcherId,
        });
        break;
      }
      case "FIELD_INTERRUPT_STARTED": {
        this.assertCanStartInterrupt();
        this.ctx.applyFieldEvent(event);
        this.beginInterrupt({
          interruptId: event.interruptId,
          kind: event.interruptKind,
          phase: "ACTIVE",
          sourceId: event.sourceId,
        });
        break;
      }
      case "FIELD_OPEN_RESPONSE_STARTED": {
        this.assertCanStartOpenResponse();
        this.ctx.assertOpenResponseEligible(event.promptId);
        this.ctx.applyFieldEvent(event);
        this.beginInterrupt({
          interruptId: event.interruptId,
          kind: "OPEN_RESPONSE",
          phase: "ACTIVE",
          sourceId: event.promptId,
        });
        break;
      }
      case "FIELD_OPEN_RESPONSE_SUBMITTED": {
        this.assertInterrupt(event.interruptId, "OPEN_RESPONSE");
        if (this.activeInterrupt?.sourceId !== event.promptId) {
          throw new Error(
            "OPEN_RESPONSE_INVALID: submitted prompt does not match the active prompt",
          );
        }
        this.ctx.assertOpenResponseResolution(
          event.promptId,
          event.resolution,
        );
        this.ctx.applyFieldEvent(event);
        this.refreshInterruptPlan();
        break;
      }
      case "FIELD_CHASE_STARTED": {
        this.assertInterrupt(event.interruptId, "CONFRONTATION");
        this.ctx.applyFieldEvent(event);
        this.activeInterrupt = {
          interruptId: event.interruptId,
          kind: "CHASE",
          phase: "ACTIVE",
          sourceId: event.sourceId,
        };
        this.refreshInterruptPlan();
        break;
      }
      case "FIELD_CONFRONTATION_DECISION": {
        this.assertInterrupt(event.interruptId, "CONFRONTATION");
        this.ctx.applyFieldEvent(event);
        this.refreshInterruptPlan();
        break;
      }
      case "FIELD_CONFRONTATION_RESOLVED": {
        this.assertInterrupt(event.interruptId, "CONFRONTATION");
        this.ctx.applyFieldEvent(event);
        this.resumeSuspendedPlan();
        break;
      }
      case "FIELD_REACTIVE_COMPLETED": {
        this.assertInterrupt(event.interruptId, "REACTIVE_EXCHANGE");
        this.ctx.applyFieldEvent(event);
        this.refreshInterruptPlan();
        break;
      }
      case "FIELD_REACTIVE_OUTCOME_SELECTED": {
        this.assertInterrupt(event.interruptId, "REACTIVE_EXCHANGE");
        if (this.activeInterrupt?.sourceId !== event.sourceId) {
          throw new Error(
            "FIELD_EVENT_INVALID: reactive outcome source does not match the active interaction",
          );
        }
        this.ctx.applyFieldEvent(event);
        this.refreshInterruptPlan();
        break;
      }
      case "FIELD_CHASE_RESOLVED": {
        this.assertInterrupt(event.interruptId, "CHASE");
        this.ctx.applyFieldEvent(event);
        this.resumeSuspendedPlan();
        break;
      }
      case "FIELD_INTERRUPT_RESOLVED": {
        this.assertInterrupt(event.interruptId);
        if (this.activeInterrupt?.kind === "CHASE") {
          throw new Error("FIELD_EVENT_INVALID: a chase must use FIELD_CHASE_RESOLVED");
        }
        if (
          this.activeInterrupt?.kind === "OPEN_RESPONSE" &&
          !this.ctx.field.openResponseCompletions[
            this.activeInterrupt.sourceId ?? ""
          ]
        ) {
          throw new Error(
            "OPEN_RESPONSE_INVALID: submission is required before closing",
          );
        }
        this.ctx.applyFieldEvent(event);
        this.resumeSuspendedPlan();
        break;
      }
      case "FIELD_CUSTODY_CHANGED":
      case "FIELD_CLOCK_ADVANCED":
      case "FIELD_REPOSITION_INTENT":
        this.assertInterrupt(event.interruptId);
        this.ctx.applyFieldEvent(event);
        this.refreshInterruptPlan();
        break;
      case "FIELD_REPOSITION_APPLIED":
        this.ctx.applyFieldEvent(event);
        if (this.activeInterrupt) this.refreshInterruptPlan();
        break;
      case "FIELD_HEAT_TRANSITION":
      case "FIELD_HEAT_DECAY_CHECKPOINT":
      case "FIELD_IDENTITY_CHANGED":
      case "FIELD_STANDING_DELTA":
      case "FIELD_THREAD_PATCH":
      case "FIELD_MICRO_ENGAGED":
      case "FIELD_MAP_DISCOVERED":
        this.assertProjectionContext(event.interruptId);
        this.ctx.applyFieldEvent(event);
        if (this.activeInterrupt) this.refreshInterruptPlan();
        break;
    }
    this.committedEvents.push(event);
  }

  private assertCanStartInterrupt(): void {
    if (this.activeInterrupt || this.suspendedPlan) {
      throw new Error("FIELD_EVENT_INVALID: a field interrupt is already active");
    }
    if (!this.currentPlan || this.currentPlan.request.kind !== "FREE_ROAM") {
      throw new Error("FIELD_EVENT_INVALID: field interrupts can start only during FREE_ROAM");
    }
  }

  private assertCanStartOpenResponse(): void {
    if (this.activeInterrupt || this.suspendedPlan) {
      throw new Error("FIELD_EVENT_INVALID: a field interrupt is already active");
    }
    if (
      !this.currentPlan ||
      (this.currentPlan.request.kind !== "FREE_ROAM" &&
        this.currentPlan.request.kind !== "BREATHER")
    ) {
      throw new Error(
        "OPEN_RESPONSE_INVALID: reflections start only during FREE_ROAM or BREATHER",
      );
    }
  }

  private assertInterrupt(interruptId: string, kind?: FieldInterruptPlan["kind"]): void {
    if (!this.activeInterrupt || this.activeInterrupt.interruptId !== interruptId) {
      throw new Error(`FIELD_EVENT_INVALID: interrupt ${interruptId} is not active`);
    }
    if (kind && this.activeInterrupt.kind !== kind) {
      throw new Error(
        `FIELD_EVENT_INVALID: interrupt ${interruptId} is ${this.activeInterrupt.kind}, expected ${kind}`,
      );
    }
  }

  private assertProjectionContext(interruptId: string | undefined): void {
    if (this.activeInterrupt) {
      if (interruptId !== this.activeInterrupt.interruptId) {
        throw new Error("FIELD_EVENT_INVALID: interrupt-scoped field effect has the wrong interruptId");
      }
      return;
    }
    if (interruptId !== undefined) {
      throw new Error(`FIELD_EVENT_INVALID: interrupt ${interruptId} is not active`);
    }
    if (
      !this.currentPlan ||
      (this.currentPlan.request.kind !== "FREE_ROAM" &&
        this.currentPlan.request.kind !== "BREATHER")
    ) {
      throw new Error(
        "FIELD_EVENT_INVALID: durable field effects require FREE_ROAM, BREATHER, or an active interrupt",
      );
    }
  }

  private beginInterrupt(interrupt: FieldInterruptPlan): void {
    this.suspendedPlan = this.currentPlan;
    this.activeInterrupt = interrupt;
    this.refreshInterruptPlan();
  }

  private refreshInterruptPlan(): void {
    if (!this.activeInterrupt || !this.suspendedPlan) {
      throw new Error("RUNTIME_DEADLOCK: incomplete field interrupt state");
    }
    this.ctx.setActiveFieldInterrupt(this.activeInterrupt);
    this.currentPlan = {
      present: [],
      request: this.suspendedPlan.request,
      cueId: `PA.FIELD.INTERRUPT.${this.activeInterrupt.interruptId}`,
      fieldInterrupt: { ...this.activeInterrupt },
    };
  }

  private resumeSuspendedPlan(): void {
    if (!this.suspendedPlan) {
      throw new Error("RUNTIME_DEADLOCK: no suspended FREE_ROAM plan");
    }
    this.currentPlan = this.suspendedPlan;
    this.suspendedPlan = null;
    this.activeInterrupt = null;
    this.ctx.setActiveFieldInterrupt(null);
  }
}
