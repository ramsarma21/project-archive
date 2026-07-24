import test from "node:test";
import assert from "node:assert/strict";
import {
  consequenceReceipt,
  reactiveEffectPreview,
  stakeTags,
} from "../consequenceReceipts.js";
import { PresentationNoticeArbiter } from "../noticeArbiter.js";

test("stake tags and receipt share one authored effect record", () => {
  const effects = {
    time: 2,
    heat: "DOWN",
    trust: { person: "Ned", direction: "UP" },
    goods: "RISK",
    receiptLead: "Back lane",
  } as const;
  assert.deepEqual(stakeTags(effects), [
    "TIME −2",
    "HEAT ▼",
    "TRUST Ned ▲",
    "GOODS ?",
  ]);
  assert.equal(
    consequenceReceipt(effects),
    "Back lane: you stayed unseen, but the bell cost you, but Ned will remember, but the goods stayed at risk",
  );
});

test("reactive receipts are derived from committed effect payloads", () => {
  const preview = reactiveEffectPreview(
    {
      clockUnits: 1,
      standing: { delta: 2, causeId: "sarah-help" },
      threads: [
        {
          threadId: "BOS.THREAD.SARAH.v1" as never,
          trustDelta: 2,
        },
      ],
    },
    "Helped at Sarah's stall",
  );
  assert.deepEqual(stakeTags(preview), [
    "TIME −1",
    "STANDING ▲",
    "TRUST Sarah ▲",
  ]);
});

test("receipt notices dedupe across repeated presentation and replay", () => {
  const arbiter = new PresentationNoticeArbiter();
  const notice = {
    id: "receipt:route:back",
    dedupeKey: "receipt:route",
    kind: "ARCHIVE_NOTICE" as const,
    text: "Back lane: you stayed unseen, but the bell cost you",
    captions: true,
  };
  assert.equal(arbiter.offer(notice, 100)?.id, notice.id);
  assert.equal(arbiter.offer({ ...notice, id: `${notice.id}:replay` }, 200)?.id, notice.id);
});
