import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { CHAPTER_BOSTON, UnknownChapterError } from "@pa/reporting";

import {
  registerReportingRoutes,
  type ReportingPort,
} from "../src/routes/reporting.js";

// The chapter id in a reporting URL, and the 500 it used to be able to become.
//
// A chapter-keyed lookup once answered an unknown key with an empty list, so a
// typo'd chapter rendered a roster on which thirty students owed nothing. The
// registry now throws instead — which is right, and which converts every
// unvalidated entry point into a 500 over an ordinary client mistake. All three
// reporting routes read their chapter id straight out of the path, so all three
// are checked here.
//
// NO DATABASE. Every case below is answered before `resolveViewer` runs or, for
// the chapter the registry does hold, by an authorisation stub that refuses with
// `persist: false` — the one decision the route does not audit. Nothing reaches
// `query`.

const PROFILE = "44444444-4444-4444-8444-444444444444";

/** The three URLs, with the chapter id left as a hole. */
const urls = (chapterId: string): readonly string[] => [
  `/v1/profiles/${PROFILE}/reporting/chapters/${chapterId}`,
  `/v1/educator/reporting/chapters/${chapterId}/roster`,
  `/v1/educator/reporting/chapters/${chapterId}/export`,
];

const refusal = (action: string) =>
  ({
    kind: "REFUSED",
    reason: "AUTHENTICATION_REQUIRED",
    audit: {
      at: "2026-03-01T00:00:00.000Z",
      action,
      actorAccountId: null,
      actorKind: "ANONYMOUS",
      subjectProfileIds: [],
      outcome: "REFUSED",
      refusal: "AUTHENTICATION_REQUIRED",
      // False so `recordAudit` writes nothing and this test needs no database.
      persist: false,
    },
  }) as const;

function stubPort(): ReportingPort {
  return {
    // The real registry's behaviour, which is the whole reason the guard exists:
    // an unknown key throws rather than answering with nothing. If a route stops
    // checking, this is what turns the omission into a 500 the test can see.
    chapterConceptIds: (chapterId) => {
      if (chapterId !== CHAPTER_BOSTON) throw new UnknownChapterError(chapterId);
      return ["BOS.CONCEPT.POSTWAR_REVENUE.v1"];
    },
    authoriseStudentReport: () => refusal("STUDENT_REPORT_READ"),
    authoriseRoster: () => refusal("ROSTER_READ"),
    studentReport: () => ({}),
    roster: () => ({}),
    export: () => ({ filename: "x.csv", contentType: "text/csv", body: "" }),
  };
}

async function routes(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  await registerReportingRoutes(app, stubPort());
  return app;
}

test("a chapter the registry does not hold is 404, never a 500", async () => {
  const app = await routes();
  try {
    for (const url of urls("boston-1764")) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 404, url);
      assert.equal(
        (response.json() as { error?: string }).error,
        "CHAPTER_NOT_FOUND",
        url,
      );
    }
  } finally {
    await app.close();
  }
});

test("a superseded chapter spelling is refused too, because no row carries one", async () => {
  // `BOSTON` canonicalises inside the registry so a lookup does not miss every
  // row — but it is not a chapter anybody is in, and a URL naming it is asking
  // for a roster that does not exist rather than for Boston's.
  const app = await routes();
  try {
    for (const url of urls("BOSTON")) {
      assert.equal((await app.inject({ method: "GET", url })).statusCode, 404, url);
    }
  } finally {
    await app.close();
  }
});

test("a malformed id is still 400, so the two mistakes stay distinguishable", async () => {
  const app = await routes();
  try {
    for (const url of urls("boston~1765")) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 400, url);
      assert.equal((response.json() as { error?: string }).error, "BAD_REQUEST", url);
    }
  } finally {
    await app.close();
  }
});

test("the chapter that exists passes the guard and reaches authorisation", async () => {
  // The assertion that stops the guard being a blanket refusal: the real chapter
  // gets the 401 the stub refuses with, not a 404.
  const app = await routes();
  try {
    for (const url of urls(CHAPTER_BOSTON)) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 401, url);
      assert.equal(
        (response.json() as { error?: string }).error,
        "AUTHENTICATION_REQUIRED",
        url,
      );
    }
  } finally {
    await app.close();
  }
});
