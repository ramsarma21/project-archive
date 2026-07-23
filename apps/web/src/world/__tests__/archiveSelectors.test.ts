import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeView } from "@pa/contracts";
import { MICRO_CONCEPT_IDS, THREAD_IDS } from "@pa/chapter-boston";
import {
  engagedConnections,
  metThreadPeople,
  routeRumors,
} from "../../presenter/archiveSelectors.js";

// Feel-audit-1 P1-9 (and the audited "CONNECTION ADDED but Connections tab
// empty" P0 class): the Archive tabs must agree with the game state.

function viewWith(field: Partial<RuntimeView["field"]>): RuntimeView {
  return {
    field: {
      threads: {
        [THREAD_IDS.NED]: {
          threadId: THREAD_IDS.NED,
          flags: {},
          status: "UNMET",
          trust: 0,
          breadcrumb: null,
        },
        [THREAD_IDS.SARAH]: {
          threadId: THREAD_IDS.SARAH,
          flags: {},
          status: "UNMET",
          trust: 0,
          breadcrumb: null,
        },
      },
      engagedMicroIds: [],
      rumors: [],
      ...field,
    },
  } as unknown as RuntimeView;
}

test("thread figures with the MET flag appear as met people", () => {
  const view = viewWith({
    threads: {
      [THREAD_IDS.NED]: {
        threadId: THREAD_IDS.NED,
        flags: {},
        status: "UNMET",
        trust: 0,
        breadcrumb: null,
      },
      [THREAD_IDS.SARAH]: {
        threadId: THREAD_IDS.SARAH,
        flags: { MET: true, OPENED: true },
        status: "ACTIVE",
        trust: 3,
        breadcrumb: "You helped Sarah at the market.",
      },
    } as unknown as RuntimeView["field"]["threads"],
  });
  const people = metThreadPeople(view);
  assert.equal(people.length, 1);
  assert.equal(people[0]!.name, "Goodwife Sarah");
  assert.equal(people[0]!.trust, 3);
});

test("unmet threads never appear as people", () => {
  assert.equal(metThreadPeople(viewWith({})).length, 0);
});

test("engaged micros surface as Connections entries (chip vocabulary)", () => {
  const view = viewWith({
    engagedMicroIds: [
      MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON,
      MICRO_CONCEPT_IDS.LOYAL_NINE,
    ],
  });
  const connections = engagedConnections(view);
  assert.deepEqual(
    connections.map((c) => c.id),
    [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON, MICRO_CONCEPT_IDS.LOYAL_NINE],
  );
  assert.equal(connections[0]!.label, "Boston as a port town");
});

test("route-flavored rumors surface as route leads", () => {
  const view = viewWith({
    rumors: [
      "Dock workers know a scaffold route toward the central roofs.",
      "The keeper pours for the Loyal Nine.",
    ],
  });
  assert.deepEqual(routeRumors(view), [
    "Dock workers know a scaffold route toward the central roofs.",
  ]);
});
