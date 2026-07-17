import {
  type PresenterEvent,
  type ExecutionPlan,
  type PresentationDirective,
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
  transcript: PresentationDirective[] = [];
  committedEvents: PresenterEvent[] = [];

  constructor(ctx: Ctx, flowFactory: (ctx: Ctx) => Flow, priorEvents: PresenterEvent[] = []) {
    this.ctx = ctx;
    this.g = flowFactory(ctx);
    const first = this.g.next();
    if (!first.done) {
      this.transcript.push(...first.value.present);
      this.currentPlan = { present: first.value.present, request: first.value.request };
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
      return { newDirectives: [], plan: null, done: true };
    }
    const before = this.transcript.length;
    this.applyInternal(ev);
    const newDirectives = this.transcript.slice(before);
    return { newDirectives, plan: this.currentPlan, done: this.done };
  }

  private applyInternal(ev: PresenterEvent): void {
    const r = this.g.next(ev);
    this.committedEvents.push(ev);
    if (r.done) {
      this.done = true;
      this.currentPlan = null;
      return;
    }
    this.transcript.push(...r.value.present);
    this.currentPlan = { present: r.value.present, request: r.value.request };
  }
}
