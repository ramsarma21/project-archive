/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from "@pa/contracts";
import { PACKAGE_ID } from "@pa/contracts";
import { createDay1Session, buildMasteryReport } from "./index.js";
import type { Session } from "./engine/driver.js";

// The headless runtime worker. It imports NO React/DOM/Three code. The main
// thread posts presenter events; the worker replies with execution plans.

let session: Session | null = null;
let profileId = "";
let chapterId = "";
let seedHex = "";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerResponse): void {
  ctx.postMessage(msg);
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    switch (req.type) {
      case "INIT": {
        profileId = req.payload.profileId;
        chapterId = req.payload.chapterId;
        seedHex = req.payload.variationRootSeedHex;
        session = createDay1Session({
          variationRootSeedHex: req.payload.variationRootSeedHex,
          priorEvents: req.payload.priorEvents,
        });
        post({
          id: req.id,
          type: "READY",
          plan: session.plan ?? { present: [], request: { kind: "DAY_END" } },
          transcript: session.transcript,
          committedEventCount: session.committedEvents.length,
        });
        return;
      }
      case "EVENT": {
        if (!session) throw new Error("RUNTIME_DEADLOCK: no session");
        const r = session.advance(req.payload);
        post({
          id: req.id,
          type: "STEP",
          plan: r.plan,
          newDirectives: r.newDirectives,
          committedEventCount: session.committedEvents.length,
          done: r.done,
        });
        return;
      }
      case "SNAPSHOT": {
        if (!session) throw new Error("RUNTIME_DEADLOCK: no session");
        post({
          id: req.id,
          type: "SNAPSHOT",
          snapshot: {
            profileId,
            chapterId,
            committedEvents: session.committedEvents,
            worldRevision: session.ctx.world.revision,
            done: session.isDone,
            view: session.ctx.view(),
            report: buildMasteryReport(session.ctx.learner, {
              profileId,
              packageId: PACKAGE_ID,
              chapterId,
              variationRootSeedHex: seedHex,
              committedEventCount: session.committedEvents.length,
              generatedAt: new Date().toISOString(),
            }),
          },
        });
        return;
      }
    }
  } catch (err) {
    post({ id: req.id, type: "ERROR", code: "RUNTIME_DEADLOCK", message: String(err instanceof Error ? err.message : err) });
  }
};
