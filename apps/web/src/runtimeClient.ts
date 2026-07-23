import type {
  WorkerRequest,
  WorkerResponse,
  FieldCommittedEvent,
  PresenterEvent,
  ExecutionPlan,
  PresentationDirective,
  RuntimeSnapshot,
} from "@pa/contracts";

// Main-thread client for the headless runtime worker. Promise-per-request via
// a monotonic id. The presenter never touches game state directly.
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export class RuntimeClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (r: WorkerResponse) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  constructor() {
    this.worker = new Worker(new URL("./runtime.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const request = this.pending.get(e.data.id);
      if (request) {
        clearTimeout(request.timeout);
        this.pending.delete(e.data.id);
        request.resolve(e.data);
      }
    };
    this.worker.onerror = () => {
      this.rejectAll(new Error("The game worker stopped unexpectedly."));
    };
  }

  private send(req: DistributiveOmit<WorkerRequest, "id">): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The game worker did not respond."));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.worker.postMessage({ ...req, id } as WorkerRequest);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error("Could not contact the game worker."));
      }
    });
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  async init(payload: {
    profileId: string;
    chapterId: string;
    variationRootSeedHex: string;
    priorEvents: PresenterEvent[];
    assessmentMode?: "PRODUCTION" | "QA_DRAFT";
    openResponseContentMode?: "PRODUCTION" | "AUTHOR_DRAFT_QA";
  }): Promise<{ plan: ExecutionPlan; transcript: PresentationDirective[]; committedEventCount: number }> {
    const r = await this.send({ type: "INIT", payload });
    if (r.type === "READY") return { plan: r.plan, transcript: r.transcript, committedEventCount: r.committedEventCount };
    throw new Error(r.type === "ERROR" ? r.message : "init failed");
  }

  async advance(ev: PresenterEvent): Promise<{ plan: ExecutionPlan | null; newDirectives: PresentationDirective[]; done: boolean; committedEventCount: number }> {
    const r = await this.send({ type: "EVENT", payload: ev });
    if (r.type === "STEP") return { plan: r.plan, newDirectives: r.newDirectives, done: r.done, committedEventCount: r.committedEventCount };
    throw new Error(r.type === "ERROR" ? r.message : "advance failed");
  }

  async submitFieldEvent(
    event: FieldCommittedEvent,
  ): Promise<{
    plan: ExecutionPlan | null;
    newDirectives: PresentationDirective[];
    done: boolean;
    committedEventCount: number;
  }> {
    const r = await this.send({ type: "FIELD_EVENT", payload: event });
    if (r.type === "STEP") {
      return {
        plan: r.plan,
        newDirectives: r.newDirectives,
        done: r.done,
        committedEventCount: r.committedEventCount,
      };
    }
    throw new Error(r.type === "ERROR" ? r.message : "field event failed");
  }

  async snapshot(): Promise<RuntimeSnapshot> {
    const r = await this.send({ type: "SNAPSHOT" });
    if (r.type === "SNAPSHOT") return r.snapshot;
    throw new Error("snapshot failed");
  }

  dispose(): void {
    this.worker.terminate();
    this.rejectAll(new Error("The game session was closed."));
  }
}
