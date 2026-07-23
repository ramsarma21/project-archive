import {
  CONCEPTS,
  CONCEPT_PRIORITY,
  TIME_COST,
  normalizeConcealment,
  type ConceptId,
} from "@pa/contracts";
import type { Ctx, Flow, Sub } from "../../engine/ctx.js";
import { breathe, choose, freeRoam, focusRead, waitContinue, waitAck, waitDayEnd } from "../../engine/dsl.js";
import { setRelationship } from "../../relationships.js";
import {
  unlockDemonstration,
  markDemonstrated,
  dayCompletionSatisfied,
} from "../../learner.js";
import { resolveOutcome } from "../../outcome.js";
import { TEXT } from "./text.js";
import { EXPOSURES, DEFICIT_FALLBACKS, OUTCOME_WEIGHTS, AMBIENT_SLOTS, HEADLINE_CHOICES, CAUSE_CHOICES, EVIDENCE_CHOICES, type ExposureDef } from "./tables.js";
import { exposure, maybeRunSyncs, runInitialSync, runReexposureAndRetry } from "./learning.js";
import {
  correctedChoice,
  effortHold,
  haulJob,
  postJob,
  printJob,
  stampSort,
} from "./mechanics.js";
import { DAY1_CUES } from "./choreography.js";
import { cp1CheckpointFlow } from "../checkpoints/cp1.js";

const ERRANDS = ["THOMAS_CIRCULAR", "PIKE_PROOF", "CUSTOMHOUSE_NOTICE", "RIDER_HANDBILLS"] as const;
type Errand = (typeof ERRANDS)[number];
type ErrandOutcome = "COMPLETED" | "MISSED" | "FAILED";

const ERRAND_LABEL: Record<Errand, string> = {
  THOMAS_CIRCULAR: "Deliver the circular to Thomas",
  PIKE_PROOF: "Bring Pike his stamped proof",
  CUSTOMHOUSE_NOTICE: "Post the notice at the Custom House",
  RIDER_HANDBILLS: "Get the handbills to the rider before the bell",
};

function ambientPick(ctx: Ctx, slotId: string, candidates: readonly string[]): string {
  return resolveOutcome(
    ctx.attemptSeed,
    slotId,
    candidates.map((c) => ({ outcome: c, weight: 1 })),
  );
}

function playAmbient(ctx: Ctx, slot: { slotId: string; candidates: readonly string[] }): void {
  const pick = ambientPick(ctx, slot.slotId, slot.candidates);
  if (pick === "NO_ACTION") return;
  const line = (TEXT.ambient as Record<string, { text: string }>)[pick];
  if (line) ctx.ambient(line.text);
}

// ============================================================================
// The Boston Day 1 flow. One generator, resumable via event replay.
// ============================================================================
export function* day1Flow(ctx: Ctx): Flow {
  yield* opening(ctx);

  // ---- Four-errand loop ----
  const pending = new Set<Errand>(ERRANDS);
  const outcomes: Record<string, ErrandOutcome> = {};
  let firstSelection = true;
  let firstCompleted = false;
  let pressQuality: "CRISP" | "USABLE" | "SMUDGED" = ctx.pressQuality ?? "USABLE";
  pressQuality = ctx.pressQuality ?? "USABLE";

  while (pending.size > 0 && !ctx.dayBoundaryReached()) {
    ctx.world.controlState = "FREE_ROAM";
    const targets = [...pending].map((id) => ({
      targetId: id,
      label: ERRAND_LABEL[id],
      marker: (pending.size === 1 ? "GOLD" : "BLUE") as "GOLD" | "BLUE",
    }));
    const ev = yield* freeRoam(ctx, targets, false);
    if (ev.type === "FREE_ROAM_IDLE") {
      ctx.archive(
        pending.size === 1
          ? "One stop left on the board. Keep moving."
          : `Still ${pending.size} stops on the board. Pick one and move.`,
      );
      continue;
    }
    if (ev.type !== "FREE_ROAM_GOTO" || !pending.has(ev.targetId as Errand)) continue;
    const sel = ev.targetId as Errand;

    ctx.world.controlState = "INTERACTION";
    // B4.5: the official town notice is encountered on the early street, at
    // the door of the first stop the player chose. Selection comes first.
    if (firstSelection) {
      firstSelection = false;
      yield* townStampNoticeOffer(ctx);
    }
    const outcome = yield* dispatchStop(ctx, sel);
    if (
      sel === "THOMAS_CIRCULAR" ||
      sel === "PIKE_PROOF" ||
      sel === "CUSTOMHOUSE_NOTICE"
    ) {
      yield* leaveInterior(ctx, `BOS.MD01.CUE.LEAVE_${sel}.v1`);
    }
    outcomes[sel] = outcome;
    pending.delete(sel);
    ctx.world.objectives[sel] = outcome === "COMPLETED" ? "COMPLETED" : outcome;

    if (!firstCompleted && outcome === "COMPLETED" && !ctx.dayBoundaryReached()) {
      firstCompleted = true;
      ctx.world.firstErrandCompletionRecorded = true;
      yield* freshBroadsideOffer(ctx);
    }
    const resolved = ERRANDS.length - pending.size;
    if (resolved === 2) playAmbient(ctx, AMBIENT_SLOTS.MID);

    if (pending.size > 0 && !ctx.dayBoundaryReached()) {
      yield* breathe(ctx, `BOS.MD01.CUE.BREATHER_AFTER_${sel}.v1`);
    }
    // Once the boundary has passed, no further optional work (including a
    // street Sync) may be offered before the closure interrupt.
    if (!ctx.dayBoundaryReached()) yield* maybeRunSyncs(ctx, false);
  }

  // ---- Dusk / shops-closed if errands remain ----
  if (pending.size > 0) {
    yield* waitAck(ctx, TEXT.shopsClosed);
    for (const id of pending) {
      outcomes[id] = "MISSED";
      ctx.world.objectives[id] = "MISSED";
      applyMissedErrandConsequences(ctx, id);
    }
    pending.clear();
  }

  // ---- Crowd funnel (time-of-day driven) ----
  yield* crowdApproach(ctx);
  yield* eventOnramp(ctx);
  yield* fixedEvent(ctx);

  // ---- Return, page-setting (deficit closure folded in), demonstrations ----
  yield* returnToMercer(ctx, outcomes);
  yield* deficitClosure(ctx);
  yield* headlineDemonstrations(ctx);
  // ---- Street-level ending (design1 feature 3): final pull -> the page goes
  // to the town board with the crier shouting the player's headline -> the
  // compressed CP1 debrief -> the celebratory Day Record card LAST. The
  // session's final memory is the day, not paperwork.
  yield* dayClose(ctx);
  yield* streetHeadlineBeat(ctx);
  yield* cp1CheckpointFlow(ctx);
  yield* dayRecordCard(ctx);
}

// ---------------------------------------------------------------------------
function* opening(ctx: Ctx): Sub<void> {
  ctx.world.controlState = "ARCHIVE";
  ctx.archive(TEXT.b0.identity);
  ctx.emit({ kind: "READ_PANEL", objectId: "B0_ARTICLE", title: "Archive intake", body: `${TEXT.b0.context}\n\n${TEXT.b0.source}` });
  ctx.narrate(TEXT.b0.assignment);
  exposure(ctx, EXPOSURES.POLICY_B0);
  ctx.world.objectives.REPORT_TO_MERCER = "SELECTED";
  ctx.countSpacing();
  yield* waitContinue(ctx, "Synchronize", DAY1_CUES.ARCHIVE_INTAKE);
  ctx.emitClock();

  // traverse (free, 0 units)
  ctx.world.controlState = "FREE_ROAM";
  ctx.scene("BOSTON_STREET", TEXT.arrival);
  const ev = yield* freeRoam(
    ctx,
    [{ targetId: "MERCER_PRESS", label: "Mercer's Press", marker: "GOLD" }],
    false,
    DAY1_CUES.ARRIVE_BOSTON,
  );
  void ev;
  playAmbient(ctx, AMBIENT_SLOTS.EARLY);

  // Choose how to enter while still standing outside the door. The selected
  // approach animates the threshold; only then does the interior scene begin.
  ctx.world.controlState = "INTERACTION";
  const enter = yield* choose(ctx, "BOS.MD01.ACT.ENTER_MERCER.v1", "You reach the shop door.", [
    { choiceId: "KNOCK", label: "Knock first.", tags: [] },
    { choiceId: "WALK_IN", label: "Walk straight in.", tags: [] },
    { choiceId: "LOOK_FIRST", label: "Look through the window first.", tags: [] },
  ]);
  ctx.scene("MERCER_PRESS", TEXT.shopInside);
  ctx.meet("Abigail Mercer");
  ctx.dialogue("ABIGAIL", TEXT.enterLines[enter as keyof typeof TEXT.enterLines], true);
  // B2: she needs hands, not conversation. Walking straight in already got
  // "Good, catch." as the greeting; the other approaches still get the toss.
  if (enter !== "WALK_IN") ctx.dialogue("ABIGAIL", "Good, catch.", true);
  ctx.spendTime(TIME_COST.shortDialogue);
  ctx.countSpacing();

  // Compound print job (catch -> ink -> register -> pull -> peel). Abigail
  // witnesses the work, so her Respect
  // and her spoken read of the pull land immediately (B2). She never
  // pre-instructs a reprint: a smudged proof goes in the bag as-is.
  const print = yield* printJob(
    ctx,
    "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1",
    "PIKE_PROOF",
  );
  const quality = print.quality;
  // The atomic presenter result still represents the full catch beat plus the
  // press work; preserve the authored Day-1 clock and Sync spacing exactly.
  ctx.spendTime(TIME_COST.shortDialogue);
  ctx.countSpacing();
  ctx.pressQuality = quality;
  ctx.world.jobObjects.PIKE_PROOF = { custody: "PLAYER", condition: quality };
  ctx.dialogue(
    "ABIGAIL",
    quality === "CRISP"
      ? "Clean pull. Careful hands. Good."
      : quality === "USABLE"
        ? "It'll serve. Watch the sweep next time."
        : "Smudged. It goes in the bag as it is. Pike can take that up with you.",
    true,
  );
  const abRespect = quality === "CRISP" ? 45 : quality === "USABLE" ? 35 : 25;
  const dir = setRelationship(ctx.world, "ABIGAIL_RESPECT", abRespect);
  if (dir.changed) {
    ctx.emit({
      kind: "RELATIONSHIP_CARD",
      character: "Abigail",
      dimension: "Respect",
      direction: dir.direction,
      label: quality === "CRISP" ? "clean proof, steady hands" : "thin pull, smudged proof",
    });
  }
  ctx.world.pendingContingentEffects.push({ id: "PIKE_PROOF_QUALITY", relationshipId: "PIKE_RESPECT", cause: `proof ${quality}`, resolveOn: "MEET_PIKE" });
  ctx.spendTime(TIME_COST.gradedPressPull);
  ctx.countSpacing();

  // compare stamp proofs (focus read, tracked HANDS_ON). This is the day's
  // mandatory Stamp carrier: it banks in the shop so no later failure can lose
  // it. The read is still a deliberate action; declining just gets Abigail's
  // insistence and re-presents until the player actually looks. The teaser
  // invites; the difference itself is only revealed by actually reading.
  while (true) {
    const opened = yield* focusRead(
      ctx,
      "STAMP_PROOF_COMPARE",
      "Compare the two proofs",
      "Two proofs sit side by side on the stone.",
      DAY1_CUES.STAMP_PROOF_COMPARE,
    );
    if (opened) break;
    ctx.dialogue("ABIGAIL", "Look at them before you run anything anywhere. Side by side. Go on.");
  }
  ctx.emit({ kind: "READ_PANEL", objectId: "STAMP_PROOF_COMPARE", title: "The two proofs", body: TEXT.stampCompareBody });
  ctx.narrate(`FIELD TAG\n${TEXT.stampFieldTag}`);
  exposure(ctx, EXPOSURES.STAMP_B3);
  ctx.spendTime(TIME_COST.focusRead);
  ctx.countSpacing();

  // assign errands
  ctx.dialogue("ABIGAIL", TEXT.assignErrands, true);
  ctx.world.objectives.REPORT_TO_MERCER = "COMPLETED";
  for (const id of ERRANDS) ctx.world.objectives[id] = "ACTIVE";
  for (const k of ["THOMAS_CIRCULAR", "CARRIER_HANDBILLS", "CUSTOMHOUSE_NOTICE", "PLAIN_WRAP"]) {
    if (ctx.world.jobObjects[k]) ctx.world.jobObjects[k]!.custody = "PLAYER";
  }
  ctx.spendTime(TIME_COST.shortDialogue);
  ctx.countSpacing();

  yield* leaveInterior(ctx, DAY1_CUES.LEAVE_MERCER);
}

// ---------------------------------------------------------------------------
function* leaveInterior(ctx: Ctx, cueId: string): Sub<void> {
  ctx.world.controlState = "FREE_ROAM";
  yield* freeRoam(
    ctx,
    [{ targetId: "STREET", label: "Step outside", marker: "GOLD" }],
    false,
    cueId,
  );
  ctx.world.locationId = "BOSTON_STREET";
}

function* travelLeg(
  ctx: Ctx,
  targetId: string,
  label: string,
  cueId: string,
): Sub<void> {
  ctx.world.controlState = "FREE_ROAM";
  yield* freeRoam(ctx, [{ targetId, label, marker: "GOLD" }], false, cueId);
}

// ---------------------------------------------------------------------------
// Dusk closure applies each errand's authored terminal consequences. Learning
// reroutes elsewhere; these world results are never restored.
function applyMissedErrandConsequences(ctx: Ctx, errand: Errand): void {
  if (errand === "PIKE_PROOF") {
    // Pike was never met, so the morning proof-quality cascade is lost, not
    // deferred. He stays a locked silhouette at baseline.
    ctx.world.pendingContingentEffects = ctx.world.pendingContingentEffects.filter(
      (effect) => effect.id !== "PIKE_PROOF_QUALITY",
    );
  }
  if (errand === "RIDER_HANDBILLS") {
    const cur = ctx.world.jobObjects.CARRIER_HANDBILLS;
    if (cur && cur.custody === "PLAYER") {
      setRelationship(ctx.world, "RIDER_TRUST", 20);
      ctx.narrate("The rider is gone with the bell. The handbills stay in your bag.");
    }
  }
}

// ---------------------------------------------------------------------------
function* townStampNoticeOffer(ctx: Ctx): Sub<void> {
  const opened = yield* focusRead(
    ctx,
    "TOWN_STAMP_NOTICE",
    "Official Stamp notice",
    "An official notice is nailed by the door. The schedule takes effect on the first of November.",
    "BOS.MD01.ACT.TOWN_STAMP_NOTICE_OFFER.v1",
  );
  if (opened) {
    ctx.emit({ kind: "READ_PANEL", objectId: "TOWN_STAMP_NOTICE", title: "Official notice", body: TEXT.streetSources.officialNotice });
    exposure(ctx, EXPOSURES.STAMP_B4_5);
    ctx.spendTime(TIME_COST.focusRead);
    ctx.countSpacing();
  }
}

function* freshBroadsideOffer(ctx: Ctx): Sub<void> {
  const opened = yield* focusRead(
    ctx,
    "FRESH_BROADSIDE",
    "Fresh broadside",
    "The paste is still wet. This was not here when you went inside.",
    "BOS.MD01.ACT.FRESH_BROADSIDE_OFFER.v1",
  );
  if (opened) {
    ctx.emit({ kind: "READ_PANEL", objectId: "FRESH_BROADSIDE", title: "Fresh broadside", body: TEXT.streetSources.freshBroadside });
    exposure(ctx, EXPOSURES.REP_B5_5);
    ctx.spendTime(TIME_COST.focusRead);
    ctx.countSpacing();
  }
}

// ---------------------------------------------------------------------------
function* dispatchStop(ctx: Ctx, errand: Errand): Sub<ErrandOutcome> {
  switch (errand) {
    case "THOMAS_CIRCULAR":
      return yield* thomasStop(ctx);
    case "PIKE_PROOF":
      return yield* pikeStop(ctx);
    case "CUSTOMHOUSE_NOTICE":
      return yield* customHouseStop(ctx);
    case "RIDER_HANDBILLS":
      return yield* riderStop(ctx);
  }
}

function* thomasStop(ctx: Ctx): Sub<ErrandOutcome> {
  ctx.meet("Thomas");
  ctx.scene("THOMAS_COUNTINGHOUSE", TEXT.thomas.scene);
  ctx.dialogue("THOMAS", TEXT.thomas.putThere, true);
  yield* effortHold(
    ctx,
    "BOS.MD01.ACT.THOMAS_CIRCULAR_HANDOFF.v1",
    "Set the circular on Thomas's counter and hold until it lies flat.",
  );
  const c = yield* choose(ctx, "BOS.MD01.ACT.THOMAS_DELIVERY.v1", "Thomas is hauling cloth from the front of his shop.", [
    { choiceId: "HELP", label: "Help him haul the cloth in.", tags: ["costs time", "earns a favor"] },
    { choiceId: "BEG_OFF", label: "Leave the circular and go.", tags: ["saves time", "no favor earned"] },
    { choiceId: "ASK", label: "Ask why he's so rattled.", tags: [] },
  ]);
  if (c === "HELP") {
    yield* haulJob(
      ctx,
      "BOS.MD01.ACT.THOMAS_HAUL.v1",
      "Load the bolt, balance its weight, then thread it through the doorway.",
    );
    ctx.dialogue("THOMAS", TEXT.thomas.learningLine);
    exposure(ctx, EXPOSURES.REP_B5);
    setRelationship(ctx.world, "THOMAS_OBLIGATION", 40);
    ctx.unlockRoute("THOMAS_DOCK_ROUTE", "Thomas's dock shortcut");
    ctx.emit({ kind: "RELATIONSHIP_CARD", character: "Thomas", dimension: "Obligation", direction: "UP", label: "you helped haul" });
    ctx.spendTime(TIME_COST.longHelp);
  } else if (c === "ASK") {
    ctx.dialogue("THOMAS", TEXT.thomas.learningLine);
    ctx.dialogue("THOMAS", TEXT.thomas.askFollowUp);
    exposure(ctx, EXPOSURES.REP_B5);
    ctx.spendTime(TIME_COST.shortDialogue);
  } else {
    ctx.dialogue("THOMAS", TEXT.thomas.begOff);
    ctx.spendTime(TIME_COST.shortDialogue);
  }
  ctx.world.jobObjects.THOMAS_CIRCULAR = { custody: "THOMAS", condition: "INTACT" };
  ctx.countSpacing();
  return "COMPLETED";
}

function* pikeStop(ctx: Ctx): Sub<ErrandOutcome> {
  ctx.meet("Pike");
  ctx.scene("PIKE_OFFICE", TEXT.pike.scene);
  // realize contingent proof-quality effect
  const q = ctx.pressQuality ?? "USABLE";
  let pikeRespect = q === "CRISP" ? 45 : q === "USABLE" ? 35 : 20;
  ctx.dialogue("PIKE", TEXT.pike.paperLine, true);
  yield* effortHold(
    ctx,
    "BOS.MD01.ACT.PIKE_PROOF_HANDOFF.v1",
    "Place the proof in Pike's hands without creasing the fresh impression.",
  );
  ctx.dialogue("PIKE", TEXT.pike.warLine);
  exposure(ctx, EXPOSURES.POLICY_B6);
  exposure(ctx, EXPOSURES.STAMP_B6);
  ctx.spendTime(TIME_COST.shortDialogue);

  if (q === "SMUDGED") {
    const c = yield* choose(ctx, "BOS.MD01.ACT.PIKE_SMUDGE.v1", "The proof came out smudged. Pike notices.", [
      { choiceId: "REPRINT", label: "Offer to run a fresh copy.", tags: ["costs time", "earns respect"] },
      { choiceId: "OWN_IT", label: "Own the rush, let it stand.", tags: ["earns respect"] },
      { choiceId: "BRUSH_OFF", label: "Brush it off.", tags: ["loses respect"] },
    ]);
    if (c === "REPRINT") {
      ctx.dialogue("PLAYER", TEXT.pike.reprint);
      yield* leaveInterior(ctx, "BOS.MD01.CUE.REPRINT_LEAVE_PIKE.v1");
      yield* travelLeg(
        ctx,
        "MERCER_REPRINT",
        "Return to Mercer's press",
        "BOS.MD01.CUE.REPRINT_TO_MERCER.v1",
      );
      ctx.scene("MERCER_PRESS", "You bring the spoiled proof back to the press.");
      const nq = (
        yield* printJob(ctx, "BOS.MD01.ACT.PIKE_REPRINT.v1", "PIKE_REPRINT")
      ).quality;
      ctx.pressQuality = nq;
      ctx.world.jobObjects.PIKE_PROOF = { custody: "PLAYER", condition: nq };
      pikeRespect = nq === "CRISP" ? 50 : nq === "USABLE" ? 45 : 25;
      ctx.spendTime(TIME_COST.fullReprintLoop);
      yield* leaveInterior(ctx, "BOS.MD01.CUE.REPRINT_LEAVE_MERCER.v1");
      yield* travelLeg(
        ctx,
        "PIKE_RETURN",
        "Bring the fresh proof back to Pike",
        "BOS.MD01.CUE.REPRINT_TO_PIKE.v1",
      );
      ctx.scene("PIKE_OFFICE", "You return with the fresh proof.");
    } else if (c === "OWN_IT") {
      ctx.dialogue("PLAYER", TEXT.pike.ownIt);
      pikeRespect = 35;
      ctx.spendTime(TIME_COST.shortDialogue);
    } else {
      ctx.dialogue("PLAYER", TEXT.pike.brushOff);
      pikeRespect = 15;
      ctx.spendTime(TIME_COST.shortDialogue);
    }
  }
  const dir = setRelationship(ctx.world, "PIKE_RESPECT", pikeRespect);
  if (dir.changed) {
    ctx.emit({ kind: "RELATIONSHIP_CARD", character: "Pike", dimension: "Respect", direction: dir.direction, label: "how the proof landed" });
  }
  ctx.world.pendingContingentEffects = ctx.world.pendingContingentEffects.filter((e) => e.id !== "PIKE_PROOF_QUALITY");
  ctx.world.jobObjects.PIKE_PROOF = { custody: "PIKE", condition: ctx.pressQuality ?? "USABLE" };
  ctx.countSpacing();

  // Pike is the Stamp hub: if his lines completed the exposure threshold, the
  // Sync fires here, in his office, immediately arming the B6.5 sort below.
  if (!ctx.dayBoundaryReached()) yield* maybeRunSyncs(ctx, false);

  // Stamp demonstration here if already understood
  if (ctx.learner[CONCEPTS.STAMP_SCOPE].understanding === "UNDERSTOOD" && ctx.learner[CONCEPTS.STAMP_SCOPE].demonstration !== "DEMONSTRATED") {
    ctx.dialogue("PIKE", TEXT.pike.sortSetup, true);
    yield* stampSort(ctx, "BOS.MD01.ACT.PIKE_SORT.v1");
    ctx.dialogue("PIKE", TEXT.pike.sortComplete);
    markDemonstrated(ctx.learner, CONCEPTS.STAMP_SCOPE);
    ctx.spendTime(TIME_COST.effortInteraction);
  }
  ctx.countSpacing();
  return "COMPLETED";
}

function* customHouseStop(ctx: Ctx): Sub<ErrandOutcome> {
  ctx.scene("CUSTOM_HOUSE", TEXT.customHouse.scene);
  // revenue proclamation (Archive-prompted optional focus read)
  ctx.archive("There's a proclamation on the wall. Worth a look if you want it.");
  const opened = yield* focusRead(ctx, "REVENUE_PROCLAMATION", "Revenue proclamation", "Parliament's words on why the duties are laid.");
  if (opened) {
    ctx.emit({ kind: "READ_PANEL", objectId: "REVENUE_PROCLAMATION", title: "Revenue proclamation", body: TEXT.customHouse.proclamation });
    exposure(ctx, EXPOSURES.POLICY_B7_5);
    ctx.spendTime(TIME_COST.focusRead);
    ctx.countSpacing();
  }

  // The proclamation typically completes Policy: its Sync fires here in the
  // hall, so a passed Sync folds the correct-column choice into the tack below.
  if (!ctx.dayBoundaryReached()) yield* maybeRunSyncs(ctx, false);

  // post the notice (place/tack mechanic, gamified)
  const policyUnderstood = ctx.learner[CONCEPTS.POSTWAR_REVENUE].understanding === "UNDERSTOOD";
  yield* postJob(
    ctx,
    "BOS.MD01.ACT.POST_NOTICE.v1",
    "Line up the notice, then set both tacks.",
  );
  if (policyUnderstood && ctx.learner[CONCEPTS.POSTWAR_REVENUE].demonstration !== "DEMONSTRATED") {
    yield* correctedChoice(ctx, "BOS.MD01.ACT.CUSTOMHOUSE_POLICY_DEMO.v1", "Post it under the right column. Why are these duties laid?", "ARCHIVE", [
      { choiceId: "REVENUE", label: "By order of Parliament, to raise revenue from the colonies.", correct: true },
      { choiceId: "GUILD", label: "By the printers' guild.", correct: false, nudge: "That names who handles the paper, not why London wants the money." },
      { choiceId: "TOWN", label: "For the town's own use.", correct: false, nudge: "That names who handles the paper, not why London wants the money." },
    ]);
    ctx.narrate(TEXT.customHouse.policyPostComplete);
    markDemonstrated(ctx.learner, CONCEPTS.POSTWAR_REVENUE);
  } else {
    ctx.narrate(TEXT.customHouse.plainPostComplete);
  }
  ctx.world.jobObjects.CUSTOMHOUSE_NOTICE = { custody: "CUSTOMHOUSE", condition: "INTACT" };
  ctx.spendTime(TIME_COST.effortInteraction);
  ctx.countSpacing();
  return "COMPLETED";
}

function* riderStop(ctx: Ctx): Sub<ErrandOutcome> {
  // route select
  const routeOpts = [
    { choiceId: "MAIN_FAST", label: "Main street, fast.", tags: ["saves time", "risky"] },
    { choiceId: "BACK_LANES", label: "Back lanes, careful.", tags: ["costs time", "safe"] },
  ];
  if (ctx.world.routes.THOMAS_DOCK_ROUTE === "UNLOCKED") {
    routeOpts.push({ choiceId: "DOCK_ROUTE", label: "Thomas's dock shortcut.", tags: ["saves time", "safe"] });
  }
  // Archive R4 decision-frame (route choice moves time/heat/identity state).
  ctx.archive("(The main street is fast — and it is the watched one.)");
  const route = yield* choose(ctx, "BOS.MD01.ACT.RIDER_ROUTE_SELECT.v1", "The bell is close. Which way to the rider?", routeOpts);
  // Authored route costs: main street 1, back lanes 2, Thomas's dock 0.
  if (route === "MAIN_FAST") ctx.spendTime(TIME_COST.simpleHandoff);
  else if (route === "BACK_LANES") ctx.spendTime(TIME_COST.effortInteraction);
  if (ctx.world.clock.spentUnits >= ctx.world.clock.fixedEventBoundary) {
    setRelationship(ctx.world, "RIDER_TRUST", 20);
    ctx.narrate("The bell carries over the roofs before you clear the first lane. The rider will not wait.");
    ctx.countSpacing();
    return "MISSED";
  }

  // A route choice changes the playable path; it never resolves travel.
  if (route === "MAIN_FAST") {
    yield* travelLeg(
      ctx,
      "CLARKE_ROUTE",
      "Take the main street past Clarke's shop",
      "BOS.MD01.CUE.RIDER_MAIN_TO_CLARKE.v1",
    );
    // Clarke is unavoidable only on his street. Alternate routes never
    // manufacture his encounter somewhere else.
    yield* clarkeEncounter(ctx);
  } else if (route === "BACK_LANES") {
    yield* travelLeg(
      ctx,
      "RIDER_BACK_LANES",
      "Follow the back lanes toward the rider",
      "BOS.MD01.CUE.RIDER_BACK_LANES.v1",
    );
  } else {
    yield* travelLeg(
      ctx,
      "RIDER_DOCK_GATE",
      "Use Thomas's dock shortcut",
      "BOS.MD01.CUE.RIDER_DOCK_ROUTE.v1",
    );
  }

  // M2 owns B8/B9 physically. Main-fast always traverses the authored customs
  // corridor; live cones/checkpoints may suspend this exact selected plan.
  // No weighted table or generator-side stop is allowed to resolve the route.
  let recognized = ctx.field.identity.recognized;
  let confiscated =
    ctx.world.jobObjects.CARRIER_HANDBILLS?.custody === "CONFISCATED";
  const concealed =
    ctx.world.jobObjects.CARRIER_HANDBILLS?.concealment !== undefined &&
    normalizeConcealment(
      ctx.world.jobObjects.CARRIER_HANDBILLS.concealment,
    ) !== "EXPOSED";
  if (route === "MAIN_FAST") {
    yield* travelLeg(
      ctx,
      "CUSTOMS_ROUTE",
      "Cross the watched customs checkpoint",
      "BOS.MD01.CUE.RIDER_TO_CUSTOMS.v1",
    );
    // Preserve the authored Stamp/writs learning opportunity regardless of
    // whether a field interrupt occurred or which bounded branch resolved it.
    exposure(ctx, EXPOSURES.STAMP_B9);
    recognized = ctx.field.identity.recognized;
    confiscated =
      ctx.world.jobObjects.CARRIER_HANDBILLS?.custody === "CONFISCATED";
  }

  if (confiscated) {
    ctx.world.jobObjects.CARRIER_HANDBILLS = { custody: "CONFISCATED", condition: "LOST", concealment: "EXPOSED" };
    setRelationship(ctx.world, "RIDER_TRUST", 20);
    ctx.narrate("The officer takes the handbills. There is nothing to hand off now.");
    ctx.countSpacing();
    return "FAILED";
  }

  if (ctx.world.clock.spentUnits >= ctx.world.clock.fixedEventBoundary) {
    setRelationship(ctx.world, "RIDER_TRUST", 20);
    ctx.narrate("The evening bell sounds before you reach the rider's post.");
    ctx.countSpacing();
    return "MISSED";
  }

  // rider handoff
  yield* travelLeg(
    ctx,
    "RIDER_POST_ROUTE",
    "Reach the rider before the bell",
    "BOS.MD01.CUE.RIDER_FINAL_LEG.v1",
  );
  ctx.scene("RIDER_POST", TEXT.rider.scene);
  const hand = yield* choose(ctx, "BOS.MD01.ACT.RIDER_HANDOFF.v1", "The rider waits, reins in hand.", [
    { choiceId: "QUICK", label: "Hand it over quick.", tags: ["saves time", "risky"] },
    { choiceId: "WAIT_FOR_GAP", label: "Wait for a gap in the street.", tags: ["costs time", "safe"] },
  ]);
  let deliveredUnseen = true;
  if (hand === "QUICK") {
    yield* effortHold(
      ctx,
      "BOS.MD01.ACT.RIDER_QUICK_HANDOFF.v1",
      "Step in and press the bundle into the rider's hand.",
    );
    const heatKey =
      ctx.field.heat.band === "CALM"
        ? "B10_QUICK_LOW_HEAT"
        : "B10_QUICK_HIGH_HEAT";
    const r = resolveOutcome(ctx.attemptSeed, heatKey, [...OUTCOME_WEIGHTS[heatKey]]);
    deliveredUnseen = r === "DELIVERED_UNSEEN";
    ctx.narrate(TEXT.rider.quickComplete);
    ctx.spendTime(TIME_COST.quickHandoff);
  } else {
    yield* effortHold(
      ctx,
      "BOS.MD01.ACT.RIDER_GAP_HANDOFF.v1",
      "Watch the crossing traffic. Hold until the handoff gap opens.",
    );
    deliveredUnseen = true;
    const missedBell = ctx.spendTime(TIME_COST.waitForGap);
    if (missedBell) {
      setRelationship(ctx.world, "RIDER_TRUST", 20);
      ctx.narrate("The gap opens as the bell rings. The rider is already moving.");
      ctx.countSpacing();
      return "MISSED";
    }
    ctx.narrate(TEXT.rider.waitComplete);
  }
  const damaged = recognized;
  const riderTrust = damaged ? 30 : deliveredUnseen ? 50 : 40;
  const riderDir = setRelationship(ctx.world, "RIDER_TRUST", riderTrust);
  ctx.emit({ kind: "RELATIONSHIP_CARD", character: "Rider", dimension: "Trust", direction: riderDir.direction, label: damaged ? "delivered, but marked" : deliveredUnseen ? "delivered clean" : "delivered, seen" });
  if (recognized || (!deliveredUnseen && !damaged)) ctx.world.attention.recognized = recognized;
  ctx.world.jobObjects.CARRIER_HANDBILLS = {
    custody: "RIDER",
    condition: damaged ? "CREASED" : "INTACT",
    concealment: concealed ? "WRAPPED" : "EXPOSED",
  };
  ctx.meet("The rider");
  ctx.countSpacing();
  return "COMPLETED";
}

function* clarkeEncounter(ctx: Ctx): Sub<void> {
  ctx.meet("Clarke");
  ctx.scene("CLARKE_DOORWAY", TEXT.clarke.scene);
  ctx.dialogue("CLARKE", TEXT.clarke.liberty);
  ctx.dialogue("CLARKE", TEXT.clarke.challenge, true);
  // Archive R4 decision-frame: pose the historical consideration, never the
  // answer (Archive-Spec §5 — this choice moves attention/heat state).
  ctx.archive("(Clarke is a Loyalist. He reports what he sees.)");
  const c = yield* choose(ctx, "BOS.MD01.ACT.CLARKE_CHALLENGE.v1", "Clarke eyes what you're carrying.", [
    { choiceId: "CALM_CONCEAL", label: "\"Overruns for the rider.\" Tuck the bundle under the plain wrap.", tags: ["reads as harmless"] },
    { choiceId: "CURT", label: "\"None of your business.\"", tags: ["risky", "reads as a threat"] },
    { choiceId: "HEAR_OUT", label: "\"What do you make of the crowd?\"", tags: [] },
  ]);
  if (c === "CALM_CONCEAL") {
    ctx.dialogue("PLAYER", TEXT.clarke.calmCover);
    yield* effortHold(
      ctx,
      "BOS.MD01.ACT.CONCEAL_HANDBILLS.v1",
      "Fold the plain wrap over the handbills and hold to tuck the edges.",
    );
    const cur = ctx.world.jobObjects.CARRIER_HANDBILLS ?? { custody: "PLAYER" as const, condition: "INTACT" as const };
    ctx.world.jobObjects.CARRIER_HANDBILLS = { ...cur, concealment: "CONCEALED" };
    exposure(ctx, EXPOSURES.REP_B7);
    const clarkeDir = setRelationship(ctx.world, "CLARKE_POLITICAL_READ", -20, true);
    ctx.emit({ kind: "RELATIONSHIP_CARD", character: "Clarke", dimension: "Political read", direction: clarkeDir.direction, label: "read you as harmless" });
    ctx.world.attention.clarkeInformed = false;
    // The fold is a real hands-on action, not a reply.
    ctx.spendTime(TIME_COST.effortInteraction);
  } else if (c === "CURT") {
    ctx.dialogue("PLAYER", TEXT.clarke.curt);
    ctx.dialogue("CLARKE", TEXT.clarke.view);
    const clarkeDir = setRelationship(ctx.world, "CLARKE_POLITICAL_READ", 35, true);
    ctx.emit({ kind: "RELATIONSHIP_CARD", character: "Clarke", dimension: "Political read", direction: clarkeDir.direction, label: "read you as a threat" });
    ctx.world.attention.clarkeInformed = true;
    ctx.spendTime(TIME_COST.shortDialogue);
  } else {
    ctx.dialogue("PLAYER", TEXT.clarke.hearOut);
    ctx.dialogue("CLARKE", TEXT.clarke.view);
    setRelationship(ctx.world, "CLARKE_POLITICAL_READ", 10, true);
    ctx.spendTime(TIME_COST.shortDialogue);
  }
  ctx.countSpacing();
}

// ---------------------------------------------------------------------------
function* crowdApproach(ctx: Ctx): Sub<void> {
  ctx.world.controlState = "FREE_ROAM";
  playAmbient(ctx, AMBIENT_SLOTS.LATE);
  yield* freeRoam(
    ctx,
    [{ targetId: "CROWD", label: "Reach the gathering at the great elm", marker: "GOLD" }],
    false,
    "BOS.MD01.CUE.WALK_TO_LIBERTY_TREE.v1",
  );
  ctx.scene("LIBERTY_TREE_APPROACH", TEXT.crowd.scene);
  ctx.archive(TEXT.crowd.archiveRedirect);

  // High-visibility crowd board. Optional pre-boundary work only: once the
  // day's units are gone, nothing may delay the fixed event any further and
  // the Representation reroute falls to B11.5.
  if (!ctx.dayBoundaryReached()) {
    const opened = yield* focusRead(ctx, "CROWD_BOARD", "Broadside on the board", "Right in your path. A single line.");
    if (opened) {
      ctx.emit({ kind: "READ_PANEL", objectId: "CROWD_BOARD", title: "Broadside", body: TEXT.streetSources.lateCrowdBroadside });
      exposure(ctx, EXPOSURES.REP_B10_4);
      ctx.spendTime(TIME_COST.focusRead);
      ctx.countSpacing();
    }
  }

  // synthesis / catch-up syncs if time remains
  if (!ctx.dayBoundaryReached()) {
    yield* maybeRunSyncs(ctx, false);
    ctx.archive(TEXT.archiveSynthesis);
    ctx.spendTime(TIME_COST.shortDialogue);
    // observe crowd forming: advance to boundary (authored waiting activity)
    const remaining = ctx.world.clock.fixedEventBoundary - ctx.world.clock.spentUnits;
    if (remaining > 0) ctx.spendTime(remaining);
    yield* effortHold(ctx, "BOS.MD01.ACT.OBSERVE_CROWD_FORMING.v1", "Hold to watch the crowd gather at the elm.");
    ctx.world.objectives.OBSERVE_CROWD = "COMPLETED";
  }
}

function* eventOnramp(ctx: Ctx): Sub<void> {
  // Archive R4 decision-frame (attention/sympathy state moves on this choice).
  ctx.archive("(The watch remembers faces at the front of a crowd.)");
  const c = yield* choose(ctx, "BOS.MD01.ACT.EVENT_ONRAMP.v1", "The crowd thickens around the great elm.", [
    { choiceId: "CLIMB", label: "Climb for a clear vantage.", tags: ["costs a little time", "safe"] },
    { choiceId: "PUSH", label: "Push toward the front.", tags: ["risky", "draws attention"] },
    { choiceId: "CHANT", label: "Take up the chant.", tags: ["reads as sympathy"] },
  ]);
  yield* effortHold(ctx, `BOS.MD01.ACT.EVENT_${c}.v1`, "Hold to move with the crowd.");
  if (c === "PUSH") ctx.world.attention.watcherHeat += 1;
  if (c === "CHANT") ctx.world.attention.politicalSympathy = true;
  ctx.countSpacing();
}

function* fixedEvent(ctx: Ctx): Sub<void> {
  ctx.world.controlState = "FIXED_EVENT";
  ctx.world.fixedEvent = "ACTIVE";
  ctx.dialogue("CROWD", TEXT.crowd.organizer1);
  ctx.dialogue("CROWD", TEXT.crowd.organizer2);
  ctx.narrate(`BANNER\n${TEXT.crowd.banner}`);
  ctx.narrate(`FIELD TAG\n${TEXT.crowd.libertyTreeTag}`);
  ctx.narrate(TEXT.crowd.eventNarration);
  exposure(ctx, EXPOSURES.REP_B11);
  yield* waitContinue(ctx, undefined, "BOS.MD01.CUE.FIXED_EVENT_MARCH.v1");
  // The documented August 14 record continues: the Kilby Street building, the
  // Fort Hill bonfire, and Oliver's house. The runner witnesses; nothing here
  // is playable or alterable.
  ctx.narrate(TEXT.crowd.eventNarration2);
  ctx.archive(TEXT.crowd.eventAftermath);
  ctx.world.fixedEvent = "COMPLETE";
  ctx.world.objectives.RETURN_TO_PRESS = "SELECTED";
  ctx.countSpacing();
  yield* waitContinue(ctx, undefined, "BOS.MD01.CUE.FIXED_EVENT_AFTERMATH.v1");
}

// ---------------------------------------------------------------------------
function* returnToMercer(ctx: Ctx, outcomes: Record<string, ErrandOutcome>): Sub<void> {
  ctx.world.controlState = "FREE_ROAM";
  yield* freeRoam(ctx, [{ targetId: "MERCER_RETURN", label: "Back to Mercer's Press", marker: "GOLD" }], false);
  ctx.world.controlState = "INTERACTION";
  ctx.scene("MERCER_PRESS", "");

  const missed = ERRANDS.filter((id) => outcomes[id] !== "COMPLETED");
  let line: string = TEXT.return.allComplete;
  if (missed.length === 1) {
    const only = missed[0]!;
    line = only === "RIDER_HANDBILLS" ? TEXT.return.riderOnly : only === "PIKE_PROOF" ? TEXT.return.pikeOnly : only === "THOMAS_CIRCULAR" ? TEXT.return.thomasOnly : TEXT.return.customHouseOnly;
  } else if (missed.length >= 2) {
    line = TEXT.return.multiple;
  }
  ctx.dialogue("ABIGAIL", line, true);
  const trust = missed.length === 0 ? 50 : missed.length === 1 ? 25 : 15;
  const dir = setRelationship(ctx.world, "ABIGAIL_TRUST", trust);
  ctx.world.realizedHiddenEffects.push({ id: "ABIGAIL_TRUST_RETURN", relationshipId: "ABIGAIL_TRUST", newValue: trust, cause: `${missed.length} missed`, presented: true });
  ctx.emit({ kind: "RELATIONSHIP_CARD", character: "Abigail", dimension: "Trust", direction: dir.direction, label: missed.length === 0 ? "you ran it clean" : "the run came up short" });
  ctx.world.objectives.RETURN_TO_PRESS = "COMPLETED";
  ctx.countSpacing();
}

// B11.5 deficit closure: guarantee every concept reaches 3/2 + Understood.
function* deficitClosure(ctx: Ctx): Sub<void> {
  for (const concept of CONCEPT_PRIORITY) {
    yield* closeConcept(ctx, concept);
  }
}

function* closeConcept(ctx: Ctx, concept: ConceptId): Sub<void> {
  // 1. fill exposure deficit with minimum unused fallbacks
  for (const def of DEFICIT_FALLBACKS[concept]) {
    const c = ctx.learner[concept];
    if (c.distinctOccasionCount >= 3 && c.exposureTypes.length >= 2) break;
    yield* presentFallback(ctx, def);
  }
  // 2. reach Understood (bounded; cannot loop)
  let guard = 0;
  while (ctx.learner[concept].understanding !== "UNDERSTOOD" && guard < 4) {
    guard += 1;
    const c = ctx.learner[concept];
    if (c.understanding === "NOT_ASSESSED" && c.learningGate === "READY") {
      yield* runInitialSync(ctx, concept);
    } else if (c.understanding === "REEXPOSURE_REQUIRED") {
      yield* runReexposureAndRetry(ctx, concept);
    } else {
      break;
    }
  }
  unlockDemonstration(ctx.learner, concept);
}

function* presentFallback(ctx: Ctx, def: ExposureDef): Sub<void> {
  const bodyMap: Record<string, string> = {
    [EXPOSURES.POLICY_DEFICIT_SRC.exposureId]: TEXT.deficit.policySource,
    [EXPOSURES.POLICY_DEFICIT_LINE.exposureId]: TEXT.deficit.policyLine,
    [EXPOSURES.STAMP_DEFICIT_SRC.exposureId]: TEXT.deficit.stampSource,
    [EXPOSURES.STAMP_DEFICIT_LINE.exposureId]: TEXT.deficit.stampLine,
    [EXPOSURES.REP_DEFICIT_SRC.exposureId]: TEXT.deficit.repSource,
    [EXPOSURES.REP_DEFICIT_LINE.exposureId]: TEXT.deficit.repLine,
  };
  const body = bodyMap[def.exposureId] ?? "";
  if (def.type === "HANDS_ON" || def.type === "ARTICLE") {
    // Folded into the page-setting scene (design1 kill list): Abigail hands
    // the source across the stone as part of building tomorrow's page — not
    // as end-of-day bookkeeping.
    ctx.dialogue("ABIGAIL", "Before we set the page, read this once more. I print nothing we cannot stand behind.");
    ctx.emit({ kind: "READ_PANEL", objectId: def.exposureId, title: "On the composing stone", body });
    yield* waitContinue(ctx, "It holds up");
  } else {
    ctx.dialogue("ABIGAIL", body);
    yield* waitContinue(ctx);
  }
  exposure(ctx, def);
  ctx.countSpacing();
}

// B12: headline (Rep), cause line (Policy), evidence pin (Stamp).
function* headlineDemonstrations(ctx: Ctx): Sub<void> {
  ctx.dialogue("ABIGAIL", TEXT.headline.frame, true);
  yield* correctedChoice(ctx, "BOS.MD01.ACT.HEADLINE_SELECT.v1", TEXT.headline.frame, "ABIGAIL",
    HEADLINE_CHOICES.map((c) => ({ choiceId: c.choiceId, label: c.label, correct: c.correct, nudge: c.nudge })));
  ctx.selectedHeadline = "TAXED WITHOUT A VOICE";
  markDemonstrated(ctx.learner, CONCEPTS.REPRESENTATION);
  ctx.spendTime(0);
  ctx.countSpacing();

  if (ctx.learner[CONCEPTS.POSTWAR_REVENUE].demonstration !== "DEMONSTRATED") {
    ctx.dialogue("ABIGAIL", TEXT.headline.causeFrame, true);
    yield* correctedChoice(ctx, "BOS.MD01.ACT.HEADLINE_CAUSE_LINE.v1", TEXT.headline.causeFrame, "ABIGAIL",
      CAUSE_CHOICES.map((c) => ({ choiceId: c.choiceId, label: c.label, correct: c.correct, nudge: c.nudge })));
    markDemonstrated(ctx.learner, CONCEPTS.POSTWAR_REVENUE);
    ctx.countSpacing();
  }

  if (ctx.learner[CONCEPTS.STAMP_SCOPE].demonstration !== "DEMONSTRATED") {
    ctx.dialogue("ABIGAIL", TEXT.headline.evidenceFrame, true);
    yield* correctedChoice(ctx, "BOS.MD01.ACT.HEADLINE_EVIDENCE_PIN.v1", TEXT.headline.evidenceFrame, "ABIGAIL",
      EVIDENCE_CHOICES.map((c) => ({ choiceId: c.choiceId, label: c.label, correct: c.correct, nudge: c.nudge })));
    markDemonstrated(ctx.learner, CONCEPTS.STAMP_SCOPE);
    ctx.countSpacing();
  }
}

function* dayClose(ctx: Ctx): Sub<void> {
  const finalPrint = yield* printJob(
    ctx,
    "BOS.MD01.ACT.FINAL_PRESS_PULL.v1",
    "FINAL_PAGE",
  );
  // The page is the player's to carry to the board now; Abigail takes the
  // rest of the run.
  ctx.world.jobObjects.FINAL_PAGE = {
    custody: "PLAYER",
    condition: finalPrint.quality,
  };
  ctx.dialogue(
    "ABIGAIL",
    finalPrint.quality === "CRISP"
      ? "That impression will hold the street. Hang it clean."
      : finalPrint.quality === "USABLE"
        ? "Readable and true. It goes on the line."
        : "The edge is smudged, but the evidence still reads. File the craft result and hang it.",
  );
  ctx.narrate(TEXT.headline.finalPull);
  ctx.emit({ kind: "READ_PANEL", objectId: "FINAL_PAGE", title: "Tomorrow's front page", body: TEXT.headline.finalPage });
  ctx.world.objectives.SET_HEADLINE = "COMPLETED";
  ctx.dialogue("ABIGAIL", TEXT.abigailEnd, true);

  if (!dayCompletionSatisfied(ctx.learner)) {
    throw new Error("RUNTIME_DEADLOCK: day-end gate not satisfied");
  }
}

// The exterior ending beat: carry the fresh page to the town board, the
// crier shouts YOUR headline, and the printed page is posted where the town
// reads it. The day pays off on the street, in the fiction, before any
// debrief.
function* streetHeadlineBeat(ctx: Ctx): Sub<void> {
  ctx.world.objectives.POST_THE_PAGE = "SELECTED";
  yield* leaveInterior(ctx, "BOS.MD01.CUE.STREET_HEADLINE_LEAVE.v1");
  ctx.world.controlState = "FREE_ROAM";
  yield* freeRoam(
    ctx,
    [
      {
        targetId: "TOWN_NOTICE_BOARD",
        label: "Take the page to the town board",
        marker: "GOLD",
      },
    ],
    false,
    DAY1_CUES.STREET_HEADLINE_WALK,
  );
  ctx.world.controlState = "INTERACTION";
  ctx.scene("BOSTON_STREET", TEXT.streetEnding.scene);
  // The crier takes up the player's chosen headline (subtitle-attributed
  // line: the crier is subtitle-only by approved limit).
  ctx.dialogue("CRIER", `${ctx.selectedHeadline}! Tomorrow's page, hot off Mercer's press!`, true);
  yield* effortHold(
    ctx,
    DAY1_CUES.POST_HEADLINE_BOARD,
    "Hold to pin tomorrow's page to the town board.",
  );
  ctx.narrate(TEXT.streetEnding.posted);
  ctx.dialogue("CROWD", TEXT.streetEnding.passerby);
  ctx.world.objectives.POST_THE_PAGE = "COMPLETED";
  ctx.spendTime(0);
  ctx.countSpacing();
}

// The celebratory Day Record card is the LAST beat of the day: it renders
// after CP1 files, so the session's closing memory is the day's record, not
// a form. Confirming it completes the run.
function* dayRecordCard(ctx: Ctx): Sub<void> {
  ctx.world.controlState = "DAY_END";
  ctx.world.locationId = "BOSTON_STREET";
  ctx.emit({
    kind: "DAY_END_CARD",
    card: {
      headerLine: TEXT.dayRecordHeader,
      selectedHeadline: ctx.selectedHeadline,
      notes: ctx.notesEntries,
      peopleMet: ctx.peopleMet,
      routesUnlocked: ctx.routesUnlocked,
    },
  });
  yield* waitDayEnd(ctx);
}
