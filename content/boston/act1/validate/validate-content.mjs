#!/usr/bin/env node
/**
 * Isolated content validator for the Boston Act 1 open-response package.
 *
 * DESIGN: This script is deliberately self-contained. It imports NOTHING from
 * `packages/*` or `apps/*`, so it cannot conflict with the runtime/API/web
 * integration work owned by another worker. It reads only the JSON under
 * content/boston/act1/ and validates structural + curriculum + fiction rules.
 *
 * Run:  node content/boston/act1/validate/validate-content.mjs
 * Exit: 0 = all checks pass (blockers are informational), 1 = hard failures.
 *
 * Checks (from the authoring brief):
 *  - unique IDs across items/prompts/packets/claims/evidence/rubrics/feedback/cards/dialogue
 *  - known concepts (macro/micro against the allowlist that mirrors @pa/contracts)
 *  - known sources (backingRefs in the asset registry; item source packets exist)
 *  - 2+ evidence sources for comparisons (COMPARE, CAUSAL_SYNTHESIS)
 *  - no unsupported claims (cited claim/evidence IDs resolve; inference/representative flagged)
 *  - forbidden score/mastery language in player-facing + educator-label text
 *  - response length within 35..90 (and min < max)
 *  - no em dash in player-facing text (fiction rule)
 *  - no prompt immediately after source (minSpacingInteractions >= 2)
 *  - no raw model-generated feedback (all feedback authored=true; classifier is enum-only)
 *  - rubric criteria allowlisted; no grammar/spelling criterion
 *  - never claims SME approval (forbidden approval statuses absent)
 *  - Act 1 exposure cap present and <= 4
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const errors = [];
const warnings = [];
const blockers = [];
const stats = {};

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }
function blocker(msg) { blockers.push(msg); }

function load(rel) {
  const p = join(ROOT, rel);
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    fail(`Cannot read/parse ${rel}: ${e.message}`);
    return null;
  }
}

const allow = load("allowlists.json");
const manifest = load("package.manifest.json");
const sources = load("sources/sources.json");
const rubricsDoc = load("rubrics/rubrics.json");
const feedbackDoc = load("feedback/feedback.json");
const classifier = load("classifier/classifier-schema.json");
const itemsDoc = load("prompts/open-response-items.json");
const connections = load("archive/connections.json");
const dialogue = load("dialogue/npc-followups.json");

if (!allow || !manifest || !sources || !rubricsDoc || !feedbackDoc || !classifier || !itemsDoc || !connections || !dialogue) {
  report();
  process.exit(1);
}

const macroSet = new Set(allow.macroConceptIds);
const microSet = new Set(allow.microConceptIds);
const opSet = new Set(allow.reasoningOperations);
const criterionLabelSet = new Set(Object.keys(allow.rubricCriterionLabels));
const forbiddenCriteria = new Set(allow.forbiddenRubricCriteria);
const feedbackCatSet = new Set(allow.feedbackCategories);
const educatorLabelSet = new Set(Object.keys(allow.educatorEvidenceLabels));
const forbiddenApproval = new Set(allow.forbiddenApprovalStatuses.map((s) => s.toUpperCase()));
const forbiddenTerms = allow.forbiddenPlayerFacingLanguage.terms.map((t) => t.toLowerCase());
const emDashChars = allow.playerFacingEmDashRule.forbiddenCharacters;
const wordBounds = allow.expectedResponseWordBounds;
const spacingFloor = allow.minSpacingInteractionsFloor;

// ---- ID uniqueness registry ----
const idSeen = new Map(); // id -> kind
function registerId(id, kind) {
  if (id === undefined || id === null || id === "") { fail(`Empty ${kind} id`); return; }
  if (idSeen.has(id)) fail(`Duplicate id ${id} (${kind}) collides with ${idSeen.get(id)}`);
  else idSeen.set(id, kind);
}

// ---- player-facing text checks ----
function checkPlayerFacing(text, where) {
  if (typeof text !== "string") return;
  for (const ch of emDashChars) {
    if (text.includes(ch)) fail(`Em dash / bar (U+${ch.codePointAt(0).toString(16).toUpperCase()}) in player-facing text at ${where}`);
  }
  const lower = text.toLowerCase();
  for (const term of forbiddenTerms) {
    // word-ish boundary check
    const re = new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}([^a-z]|$)`, "i");
    if (re.test(lower)) fail(`Forbidden score/mastery language "${term}" in player-facing text at ${where}`);
  }
}

// ---- Sources: packets, claims, evidence ----
const assetRefs = new Set();
for (const group of Object.values(sources.assetRefRegistry)) {
  if (Array.isArray(group)) for (const r of group) assetRefs.add(r);
}
const packetById = new Map();
const evidenceById = new Map();
const claimById = new Map();
for (const pkt of sources.packets) {
  registerId(pkt.packetId, "sourcePacket");
  packetById.set(pkt.packetId, pkt);
  for (const b of pkt.backingRefs ?? []) {
    if (!assetRefs.has(b)) warn(`Packet ${pkt.packetId} backingRef "${b}" is not in assetRefRegistry (known-source check)`);
  }
  const evIds = new Set();
  for (const ev of pkt.evidence ?? []) {
    registerId(ev.evidenceId, "evidence");
    evidenceById.set(ev.evidenceId, { ...ev, packetId: pkt.packetId });
    evIds.add(ev.evidenceId);
  }
  for (const cl of pkt.claims ?? []) {
    registerId(cl.claimId, "claim");
    claimById.set(cl.claimId, { ...cl, packetId: pkt.packetId });
    if (!allow.claimTypes.includes(cl.claimType)) fail(`Claim ${cl.claimId} has unknown claimType ${cl.claimType}`);
    if ((cl.claimType === "INFERENCE" || cl.claimType === "REPRESENTATIVE") && !cl.citationHint) {
      blocker(`Claim ${cl.claimId} is ${cl.claimType} but has no citationHint/note flagging it`);
    }
    for (const e of cl.evidenceIds ?? []) {
      if (!evIds.has(e)) fail(`Claim ${cl.claimId} references evidence ${e} not in its packet`);
    }
  }
}
stats.sourcePackets = sources.packets.length;
stats.claims = claimById.size;
stats.evidence = evidenceById.size;

// ---- Rubrics ----
const rubricById = new Map();
for (const r of rubricsDoc.rubrics) {
  registerId(r.rubricId, "rubric");
  rubricById.set(r.rubricId, r);
  if (!opSet.has(r.reasoningOperation)) fail(`Rubric ${r.rubricId} has unknown reasoningOperation ${r.reasoningOperation}`);
  for (const c of r.criteria) {
    if (forbiddenCriteria.has(c.criterionId)) fail(`Rubric ${r.rubricId} uses forbidden criterion ${c.criterionId} (no grammar/spelling/length allowed)`);
    if (!criterionLabelSet.has(c.criterionId)) fail(`Rubric ${r.rubricId} criterion ${c.criterionId} not in allowlist`);
    if (allow.rubricCriterionLabels[c.criterionId] !== c.label) warn(`Rubric ${r.rubricId} criterion ${c.criterionId} label "${c.label}" differs from allowlist`);
  }
  for (const el of r.educatorLabels ?? []) {
    if (!educatorLabelSet.has(el)) fail(`Rubric ${r.rubricId} educatorLabel ${el} not in allowlist`);
    checkPlayerFacing(allow.educatorEvidenceLabels[el] ?? "", `educatorLabel ${el}`);
  }
}
stats.rubrics = rubricById.size;

// educator labels text: never mastery/grade
for (const [k, v] of Object.entries(allow.educatorEvidenceLabels)) checkPlayerFacing(v, `educatorEvidenceLabels.${k}`);

// ---- Feedback ----
const feedbackById = new Map();
for (const f of feedbackDoc.entries) {
  registerId(f.feedbackId, "feedback");
  feedbackById.set(f.feedbackId, f);
  if (f.authored !== true) fail(`Feedback ${f.feedbackId} is not marked authored=true (no raw model feedback allowed)`);
  if (!feedbackCatSet.has(f.category)) fail(`Feedback ${f.feedbackId} category ${f.category} not in allowlist`);
  checkPlayerFacing(f.text, `feedback ${f.feedbackId}`);
  if (/\d/.test(f.text)) fail(`Feedback ${f.feedbackId} contains a digit (feedback must be nonnumeric)`);
}
stats.feedback = feedbackById.size;

// ---- Classifier schema: enum-only, no free text field ----
(() => {
  const props = classifier.outputSchema?.properties ?? {};
  if (classifier.outputSchema?.additionalProperties !== false) fail("Classifier outputSchema must set additionalProperties:false");
  // ensure no property permits free display text
  for (const [name, def] of Object.entries(props)) {
    if (/feedback|message|comment|prose|explanation|text$/i.test(name)) {
      fail(`Classifier schema exposes a free-text-like property "${name}" (must be enum-only)`);
    }
  }
  const critLevel = props.criteria?.items?.properties?.level?.enum ?? [];
  for (const lv of critLevel) if (!allow.classifierCriterionLevels.includes(lv)) fail(`Classifier level enum has non-allowlisted ${lv}`);
  const obs = props.topicality?.enum ?? [];
  for (const o of obs) if (!allow.classifierObservationLabels.includes(o)) fail(`Classifier observation enum has non-allowlisted ${o}`);
  const confidence = props.technical?.properties?.confidence?.enum ?? [];
  for (const value of confidence) {
    if (!["LOW", "MEDIUM", "HIGH"].includes(value)) fail(`Classifier technical confidence has non-allowlisted ${value}`);
  }
  if (!Array.isArray(classifier.adversarialExamples) || classifier.adversarialExamples.length < 4) {
    blocker("Classifier schema should include several adversarial examples (found fewer than 4)");
  }
})();

// ---- Approval-status sweep: never claims SME approval ----
function sweepApproval(obj, where) {
  if (obj === null || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && forbiddenApproval.has(v.toUpperCase()) && /status|approv/i.test(k)) {
      fail(`Forbidden approval status "${v}" at ${where}.${k} (package must not claim SME approval)`);
    }
    if (v && typeof v === "object") sweepApproval(v, `${where}.${k}`);
  }
}
sweepApproval(manifest, "manifest");
sweepApproval(itemsDoc, "items");
sweepApproval(sources, "sources");

// ---- Items ----
const items = itemsDoc.items;
stats.items = items.length;
if (items.length < 10 || items.length > 14) blocker(`Item count ${items.length} is outside the 10..14 target`);
if ((itemsDoc.act1ExposureCap ?? 99) > 4) fail(`act1ExposureCap ${itemsDoc.act1ExposureCap} exceeds 4`);
if ((manifest.act1ExposureCap ?? 99) > 4) fail(`manifest act1ExposureCap exceeds 4`);

const opCount = {};
for (const it of items) {
  const w = `item ${it.itemId}`;
  registerId(it.itemId, "item");
  registerId(it.promptId, "prompt");
  if (!opSet.has(it.reasoningOperation)) fail(`${w} unknown reasoningOperation ${it.reasoningOperation}`);
  opCount[it.reasoningOperation] = (opCount[it.reasoningOperation] ?? 0) + 1;

  // concepts known
  for (const m of it.concepts?.macro ?? []) if (!macroSet.has(m)) fail(`${w} unknown macro concept ${m}`);
  for (const m of it.concepts?.micro ?? []) if (!microSet.has(m)) fail(`${w} unknown micro concept ${m}`);

  // player-facing text
  checkPlayerFacing(it.studentPrompt, `${w}.studentPrompt`);
  checkPlayerFacing(it.accessiblePrompt, `${w}.accessiblePrompt`);
  if (!it.accessiblePrompt || it.accessiblePrompt === it.studentPrompt) blocker(`${w} accessiblePrompt missing or identical to studentPrompt`);

  // response length
  const b = it.expectedResponseWords ?? {};
  if (b.min !== wordBounds.min || b.max !== wordBounds.max) warn(`${w} expectedResponseWords ${b.min}..${b.max} not the standard ${wordBounds.min}..${wordBounds.max}`);
  if (!(b.min < b.max)) fail(`${w} expectedResponseWords min must be < max`);
  if (b.min < wordBounds.min || b.max > wordBounds.max) fail(`${w} expectedResponseWords outside ${wordBounds.min}..${wordBounds.max}`);

  // spacing: no prompt immediately after source
  if ((it.minSpacingInteractions ?? 0) < spacingFloor) fail(`${w} minSpacingInteractions ${it.minSpacingInteractions} below floor ${spacingFloor} (no prompt right after a source)`);

  // source packets exist
  const pktIds = it.sourcePacketIds ?? [];
  for (const p of pktIds) if (!packetById.has(p)) fail(`${w} references unknown source packet ${p}`);
  for (const p of it.prerequisites?.sourcePacketIds ?? []) if (!packetById.has(p)) fail(`${w} prerequisite unknown source packet ${p}`);

  // 2+ evidence sources for comparisons / synthesis
  const distinctPackets = new Set(pktIds);
  if (it.reasoningOperation === "COMPARE" || it.reasoningOperation === "CAUSAL_SYNTHESIS") {
    if (distinctPackets.size < 2) fail(`${w} is ${it.reasoningOperation} but cites fewer than 2 distinct source packets`);
  }

  // no unsupported claims: cited claim/evidence resolve and belong to referenced packets
  const citedPackets = new Set();
  for (const ce of it.claimEvidenceIds ?? []) {
    const cl = claimById.get(ce.claimId);
    if (!cl) { fail(`${w} cites unknown claim ${ce.claimId}`); continue; }
    citedPackets.add(cl.packetId);
    if (!pktIds.includes(cl.packetId)) fail(`${w} cites claim ${ce.claimId} from packet ${cl.packetId} not in item sourcePacketIds`);
    if (ce.flag && !allow.claimTypes.includes(ce.flag)) fail(`${w} claim flag ${ce.flag} invalid`);
    if (ce.flag && cl.claimType !== ce.flag) warn(`${w} claim ${ce.claimId} flagged ${ce.flag} but source says ${cl.claimType}`);
    for (const e of ce.evidenceIds ?? []) {
      const ev = evidenceById.get(e);
      if (!ev) fail(`${w} cites unknown evidence ${e}`);
      else if (ev.packetId !== cl.packetId) fail(`${w} evidence ${e} does not belong to claim packet ${cl.packetId}`);
    }
  }
  // inference/representative marking present when such claims are cited
  const hasSoftClaim = (it.claimEvidenceIds ?? []).some((c) => c.flag === "INFERENCE" || c.flag === "REPRESENTATIVE");
  if (hasSoftClaim && !it.inferenceNote) blocker(`${w} cites inference/representative claims but has no inferenceNote`);

  // rubric exists + operation matches
  const rub = rubricById.get(it.rubricId);
  if (!rub) fail(`${w} references unknown rubric ${it.rubricId}`);
  else if (rub.reasoningOperation !== it.reasoningOperation) fail(`${w} rubric operation ${rub.reasoningOperation} != item ${it.reasoningOperation}`);

  // classifier reference
  if (it.classifierSchemaId !== classifier.classifierSchemaId) fail(`${w} classifierSchemaId mismatch`);

  // feedback coverage: all 5 categories resolve to authored feedback
  const fb = it.feedbackIds ?? {};
  for (const cat of ["STRONG_EVIDENCE", "PARTIAL_EVIDENCE", "MISSING_EVIDENCE", "OFF_TOPIC", "UNCLASSIFIED"]) {
    const id = fb[cat];
    if (!id) fail(`${w} missing feedback for ${cat}`);
    else if (!feedbackById.has(id)) fail(`${w} feedback ${id} for ${cat} not authored`);
  }

  // educator labels allowlisted, never mastery/grade
  for (const el of it.educatorEvidenceLabels ?? []) if (!educatorLabelSet.has(el)) fail(`${w} educator label ${el} not in allowlist`);

  // offline fallback present
  if (!it.offlineFallback?.feedbackId || !it.offlineFallback?.activity) fail(`${w} missing deterministic offlineFallback`);
  else if (!feedbackById.has(it.offlineFallback.feedbackId)) fail(`${w} offlineFallback feedback not authored`);

  // review/approval fields + never SME approved
  const rv = it.review ?? {};
  if (rv.authorStatus !== "AUTHOR_DRAFT") blocker(`${w} authorStatus should be AUTHOR_DRAFT`);
  if (rv.historicalReview !== "HISTORICAL_REVIEW_PENDING") blocker(`${w} historicalReview should be HISTORICAL_REVIEW_PENDING`);
  if (rv.approvedBy) fail(`${w} has approvedBy set (must not claim approval)`);
  if (!Array.isArray(rv.teksPlaceholders)) blocker(`${w} missing teksPlaceholders (placeholders only until approved)`);
}
stats.byOperation = opCount;
// require all five operations represented
for (const op of allow.reasoningOperations) if (!opCount[op]) blocker(`No item uses reasoning operation ${op}`);

// ---- Archive Connections ----
stats.archiveCards = connections.cards.length;
const promptIds = new Set(items.map((i) => i.promptId));
for (const card of connections.cards) {
  registerId(card.cardId, "archiveCard");
  checkPlayerFacing(card.title, `card ${card.cardId}.title`);
  checkPlayerFacing(card.body, `card ${card.cardId}.body`);
  for (const c of card.citations ?? []) if (!packetById.has(c)) fail(`Card ${card.cardId} citation unknown packet ${c}`);
  const reqAll = card.unlock?.sourcePacketIds ?? [];
  const reqAny = card.unlock?.anyOf ?? [];
  if (reqAll.length === 0 && reqAny.length === 0) fail(`Card ${card.cardId} has no unlock source combination`);
  for (const p of [...reqAll, ...reqAny]) if (!packetById.has(p)) fail(`Card ${card.cardId} unlock unknown packet ${p}`);
  if (card.linkedPromptId && !promptIds.has(card.linkedPromptId)) fail(`Card ${card.cardId} linkedPromptId ${card.linkedPromptId} unknown`);
}

// ---- NPC follow-up dialogue ----
stats.dialogueNodes = dialogue.followups.length;
const eligibleNpc = new Set(allow.eligibleNpcIds);
for (const node of dialogue.followups) {
  registerId(node.nodeId, "dialogueNode");
  if (!eligibleNpc.has(node.npcId)) fail(`Dialogue ${node.nodeId} npcId ${node.npcId} not eligible`);
  for (const l of node.openingLines ?? []) checkPlayerFacing(l, `dialogue ${node.nodeId} line`);
  const opts = node.options ?? [];
  if (opts.length > 3) fail(`Dialogue ${node.nodeId} has ${opts.length} options (max 3)`);
  for (const o of opts) {
    checkPlayerFacing(o.text, `dialogue ${node.nodeId} option text`);
    checkPlayerFacing(o.reply, `dialogue ${node.nodeId} option reply`);
    if (o.leadsToPromptId && !promptIds.has(o.leadsToPromptId)) fail(`Dialogue ${node.nodeId} leadsToPromptId ${o.leadsToPromptId} unknown`);
  }
  // gate must reference known source packets
  for (const p of node.gate?.completedSources ?? []) if (!packetById.has(p)) fail(`Dialogue ${node.nodeId} gate unknown packet ${p}`);
  for (const p of node.gate?.anyOf ?? []) if (!packetById.has(p)) fail(`Dialogue ${node.nodeId} gate anyOf unknown packet ${p}`);
  if (!node.spacingNote) blocker(`Dialogue ${node.nodeId} missing spacingNote (no immediate post-read quizzing)`);
}

report();
process.exit(errors.length > 0 ? 1 : 0);

function report() {
  const line = "=".repeat(64);
  console.log(line);
  console.log("Boston Act 1 open-response content validation");
  console.log(line);
  console.log("Stats:", JSON.stringify(stats, null, 2));
  console.log(`\nHARD ERRORS: ${errors.length}`);
  for (const e of errors) console.log(`  [ERROR] ${e}`);
  console.log(`\nREVIEW BLOCKERS (informational, expected while AUTHOR_DRAFT): ${blockers.length}`);
  for (const b of blockers) console.log(`  [BLOCKER] ${b}`);
  console.log(`\nWARNINGS: ${warnings.length}`);
  for (const w of warnings) console.log(`  [WARN] ${w}`);
  console.log(line);
  console.log(errors.length === 0 ? "RESULT: PASS (no hard errors)" : "RESULT: FAIL");
  console.log(line);
}
