import type {
  WorkerRequest,
  WorkerResponse,
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
  private pending = new Map<number, (r: WorkerResponse) => void>();

  constructor() {
    this.worker = new Worker(new URL("./runtime.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const cb = this.pending.get(e.data.id);
      if (cb) {
        this.pending.delete(e.data.id);
        cb(e.data);
      }
    };
  }

  private send(req: DistributiveOmit<WorkerRequest, "id">): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ ...req, id } as WorkerRequest);
    });
  }

  async init(payload: {
    profileId: string;
    chapterId: string;
    variationRootSeedHex: string;
    priorEvents: PresenterEvent[];
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

  async snapshot(): Promise<RuntimeSnapshot> {
    const r = await this.send({ type: "SNAPSHOT" });
    if (r.type === "SNAPSHOT") return r.snapshot;
    throw new Error("snapshot failed");
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
