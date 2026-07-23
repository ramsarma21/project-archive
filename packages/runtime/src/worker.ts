/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from "@pa/contracts";
import {
  createChapterSession,
  type ChapterRegistry,
} from "./engine/chapter.js";
import type { Session } from "./engine/driver.js";
import { buildMasteryReport } from "./report.js";

// The headless runtime worker. It imports NO React/DOM/Three code. The main
// thread posts presenter events; the worker replies with execution plans.
// Chapters are injected: the presenter's worker entry registers its chapter
// package(s) and calls startRuntimeWorker with the registry.

export function startRuntimeWorker(registry: ChapterRegistry): void {
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
          const chapter = registry.get(req.payload.chapterId);
          if (!chapter) {
            post({
              id: req.id,
              type: "ERROR",
              code: "CHAPTER_UNKNOWN",
              message: `no registered chapter for ${req.payload.chapterId}`,
            });
            return;
          }
          profileId = req.payload.profileId;
          chapterId = req.payload.chapterId;
          seedHex = req.payload.variationRootSeedHex;
          session = createChapterSession(chapter, {
            variationRootSeedHex: req.payload.variationRootSeedHex,
            priorEvents: req.payload.priorEvents,
            assessmentMode: req.payload.assessmentMode,
            openResponseContentMode: req.payload.openResponseContentMode,
          });
          post({
            id: req.id,
            type: "READY",
            plan: session.plan ?? {
              present: [],
              request: { kind: "DAY_END" },
              cueId: chapter.content.cues.dayEndCue(),
            },
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
        case "FIELD_EVENT": {
          if (!session) throw new Error("RUNTIME_DEADLOCK: no session");
          const r = session.emitFieldEvent(req.payload);
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
          const chapter = registry.require(chapterId);
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
              report: buildMasteryReport(
                session.ctx.learner,
                {
                  profileId,
                  packageId: chapter.packageId,
                  chapterId,
                  variationRootSeedHex: seedHex,
                  committedEventCount: session.committedEvents.length,
                  generatedAt: new Date().toISOString(),
                },
                session.ctx.checkpoint,
                session.ctx.field.engagedMicroIds,
                chapter.report,
              ),
            },
          });
          return;
        }
      }
    } catch (err) {
      post({ id: req.id, type: "ERROR", code: "RUNTIME_DEADLOCK", message: String(err instanceof Error ? err.message : err) });
    }
  };
}
