import { CONCEPTS, CONCEPT_PRIORITY, TIME_COST, type ConceptId } from "@pa/contracts";
import type { Ctx, Flow, Sub } from "../../engine/ctx.js";
import { choose, freeRoam, focusRead, waitContinue, waitAck } from "../../engine/dsl.js";
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
import { pressPull, effortHold, placeTack, stampSort, correctedChoice } from "./mechanics.js";

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

  while (pending.size > 0 && ctx.world.clock.spentUnits < ctx.world.clock.fixedEventBoundary) {
    ctx.world.controlState = "FREE_ROAM";
    const targets = [...pending].map((id) => ({
      targetId: id,
      label: ERRAND_LABEL[id],
      marker: (pending.size === 1 ? "GOLD" : "BLUE") as "GOLD" | "BLUE",
    }));
    const ev = yield* freeRoam(ctx, targets, false);
    if (ev.type === "FREE_ROAM_IDLE") {
      ctx.archive("Still four stops on the board. Pick one and move.");
      continue;
    }
    if (ev.type !== "FREE_ROAM_GOTO" || !pending.has(ev.targetId as Errand)) continue;
    const sel = ev.targetId as Errand;

    if (firstSelection) {
      firstSelection = false;
      yield* townStampNoticeOffer(ctx);
    }

    ctx.world.controlState = "INTERACTION";
    const outcome = yield* dispatchStop(ctx, sel);
    outcomes[sel] = outcome;
    pending.delete(sel);
    ctx.world.objectives[sel] = outcome === "COMPLETED" ? "COMPLETED" : outcome;

    if (!firstCompleted && outcome === "COMPLETED") {
      firstCompleted = true;
      ctx.world.firstErrandCompletionRecorded = true;
      yield* freshBroadsideOffer(ctx);
    }
    const resolved = ERRANDS.length - pending.size;
    if (resolved === 2) playAmbient(ctx, AMBIENT_SLOTS.MID);

    yield* maybeRunSyncs(ctx, false);
  }

  // ---- Dusk / shops-closed if errands remain ----
  if (pending.size > 0) {
    yield* waitAck(ctx, TEXT.shopsClosed);
    for (const id of pending) {
      outcomes[id] = "MISSED";
      ctx.world.objectives[id] = "MISSED";
    }
    pending.clear();
  }

  // ---- Crowd funnel (time-of-day driven) ----
  yield* crowdApproach(ctx);
  yield* eventOnramp(ctx);
  yield* fixedEvent(ctx);

  // ---- Return, deficit closure, demonstrations, close ----
  yield* returnToMercer(ctx, outcomes);
  yield* deficitClosure(ctx);
  yield* headlineDemonstrations(ctx);
  yield* dayClose(ctx);
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
  yield* waitContinue(ctx, "Synchronize");
  ctx.emitClock();

  // traverse (free, 0 units)
  ctx.world.controlState = "FREE_ROAM";
  ctx.scene("BOSTON_STREET", TEXT.arrival);
  const ev = yield* freeRoam(ctx, [{ targetId: "MERCER_PRESS", label: "Mercer's Press", marker: "GOLD" }], false);
  void ev;
  playAmbient(ctx, AMBIENT_SLOTS.EARLY);

  // enter
  ctx.world.controlState = "INTERACTION";
  ctx.scene("MERCER_PRESS", TEXT.shopInside);
  const enter = yield* choose(ctx, "BOS.MD01.ACT.ENTER_MERCER.v1", "You reach the shop door.", [
    { choiceId: "KNOCK", label: "Knock first.", tags: [] },
    { choiceId: "WALK_IN", label: "Walk straight in.", tags: [] },
    { choiceId: "LOOK_FIRST", label: "Look through the window first.", tags: [] },
  ]);
  ctx.meet("Abigail Mercer");
  ctx.dialogue("ABIGAIL", TEXT.enterLines[enter as keyof typeof TEXT.enterLines], true);
  ctx.spendTime(TIME_COST.shortDialogue);
  ctx.countSpacing();

  // catch sheet (effort)
  yield* effortHold(ctx, "BOS.MD01.ACT.CATCH_SHEET.v1", "Catch the sheet Abigail tosses. Hold to steady it.");
  ctx.spendTime(TIME_COST.shortDialogue);
  ctx.countSpacing();

  // press pike proof (graded)
  const quality = yield* pressPull(ctx, "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1");
  ctx.pressQuality = quality;
  ctx.world.jobObjects.PIKE_PROOF = { custody: "PLAYER", condition: quality };
  const abRespect = quality === "CRISP" ? 45 : quality === "USABLE" ? 35 : 25;
  const dir = setRelationship(ctx.world, "ABIGAIL_RESPECT", abRespect);
  ctx.emit({ kind: "RELATIONSHIP_CARD", character: "Abigail", dimension: "Respect", direction: dir.direction, label: `proof came out ${quality.toLowerCase()}` });
  ctx.world.pendingContingentEffects.push({ id: "PIKE_PROOF_QUALITY", relationshipId: "PIKE_RESPECT", cause: `proof ${quality}`, resolveOn: "MEET_PIKE" });
  ctx.spendTime(TIME_COST.gradedPressPull);
  ctx.countSpacing();

  // compare stamp proofs (focus read, tracked HANDS_ON)
  ctx.narrate("Two proofs sit side by side on the stone.");
  const opened = yield* focusRead(ctx, "STAMP_PROOF_COMPARE", "Compare the two proofs", "The new proof carries a blank space the old one lacks.");
  if (opened) {
    ctx.emit({ kind: "READ_PANEL", objectId: "STAMP_PROOF_COMPARE", title: "The two proofs", body: TEXT.stampCompareBody });
    ctx.narrate(`FIELD TAG\n${TEXT.stampFieldTag}`);
    exposure(ctx, EXPOSURES.STAMP_B3);
    ctx.spendTime(TIME_COST.focusRead);
  }
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

  // exit shop (free roam)
  ctx.world.controlState = "FREE_ROAM";
  const exit = yield* freeRoam(ctx, [{ targetId: "STREET", label: "Step out into the street", marker: "GOLD" }], false);
  void exit;
}

// ---------------------------------------------------------------------------
function* townStampNoticeOffer(ctx: Ctx): Sub<void> {
  const c = yield* choose(ctx, "BOS.MD01.ACT.TOWN_STAMP_NOTICE_OFFER.v1", "An official notice is nailed by the door.", [
    { choiceId: "READ", label: "Stop and read the notice.", tags: [] },
    { choiceId: "SKIP", label: "Leave it and get moving.", tags: [] },
  ]);
  if (c === "READ") {
    ctx.emit({ kind: "READ_PANEL", objectId: "TOWN_STAMP_NOTICE", title: "Official notice", body: TEXT.streetSources.officialNotice });
    exposure(ctx, EXPOSURES.STAMP_B4_5);
    ctx.spendTime(TIME_COST.focusRead);
    ctx.countSpacing();
  }
}

function* freshBroadsideOffer(ctx: Ctx): Sub<void> {
  const c = yield* choose(ctx, "BOS.MD01.ACT.FRESH_BROADSIDE_OFFER.v1", "A broadside has just been pasted up. It wasn't there when you went in.", [
    { choiceId: "READ", label: "Read the fresh broadside.", tags: [] },
    { choiceId: "SKIP", label: "Move on.", tags: [] },
  ]);
  if (c === "READ") {
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
  const c = yield* choose(ctx, "BOS.MD01.ACT.THOMAS_DELIVERY.v1", "Thomas is hauling cloth from the front of his shop.", [
    { choiceId: "HELP", label: "Help him haul the cloth in.", tags: ["costs time", "earns a favor"] },
    { choiceId: "BEG_OFF", label: "Leave the circular and go.", tags: ["saves time", "no favor earned"] },
    { choiceId: "ASK", label: "Ask why he's so rattled.", tags: [] },
  ]);
  if (c === "HELP") {
    yield* effortHold(ctx, "BOS.MD01.ACT.THOMAS_HAUL.v1", "Haul the heavy cloth bolts. Hold to carry.");
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
      ctx.dialogue("NARRATOR", TEXT.pike.reprint);
      ctx.narrate("You loop back to the press and run it again.");
      const nq = yield* pressPull(ctx, "BOS.MD01.ACT.PIKE_REPRINT.v1");
      ctx.pressQuality = nq;
      ctx.world.jobObjects.PIKE_PROOF = { custody: "PLAYER", condition: nq };
      pikeRespect = nq === "CRISP" ? 50 : nq === "USABLE" ? 45 : 25;
      ctx.spendTime(TIME_COST.fullReprintLoop);
    } else if (c === "OWN_IT") {
      ctx.dialogue("NARRATOR", TEXT.pike.ownIt);
      pikeRespect = 35;
    } else {
      ctx.dialogue("NARRATOR", TEXT.pike.brushOff);
      pikeRespect = 15;
    }
  }
  const dir = setRelationship(ctx.world, "PIKE_RESPECT", pikeRespect);
  ctx.emit({ kind: "RELATIONSHIP_CARD", character: "Pike", dimension: "Respect", direction: dir.direction, label: "how the proof landed" });
  ctx.world.pendingContingentEffects = ctx.world.pendingContingentEffects.filter((e) => e.id !== "PIKE_PROOF_QUALITY");
  ctx.world.jobObjects.PIKE_PROOF = { custody: "PIKE", condition: ctx.pressQuality ?? "USABLE" };

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

  // post the notice (place/tack mechanic, gamified)
  const policyUnderstood = ctx.learner[CONCEPTS.POSTWAR_REVENUE].understanding === "UNDERSTOOD";
  yield* placeTack(ctx, "BOS.MD01.ACT.POST_NOTICE.v1", "Line the notice up on the board and press to tack it.");
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
  const route = yield* choose(ctx, "BOS.MD01.ACT.RIDER_ROUTE_SELECT.v1", "The bell is close. Which way to the rider?", routeOpts);
  ctx.spendTime(route === "BACK_LANES" ? TIME_COST.effortInteraction : TIME_COST.simpleHandoff);

  // Clarke encounter (adjacent -> challenge)
  yield* clarkeEncounter(ctx);

  // Customs stop possible on main fast
  let recognized = false;
  let confiscated = false;
  const concealed = ctx.world.jobObjects.CARRIER_HANDBILLS?.concealment === "CONCEALED";
  if (route === "MAIN_FAST") {
    const clear = resolveOutcome(ctx.attemptSeed, "B8_MAIN_FAST", [...OUTCOME_WEIGHTS.B8_MAIN_FAST]);
    if (clear === "STOP_TRIGGERED") {
      ctx.scene("CUSTOMS_POST", "");
      ctx.dialogue("OFFICER", TEXT.customs.officer1, true);
      ctx.dialogue("OFFICER", TEXT.customs.officer2);
      exposure(ctx, EXPOSURES.STAMP_B9);
      const c = yield* choose(ctx, "BOS.MD01.ACT.CUSTOMS_STOP.v1", "The officer blocks your way.", [
        { choiceId: "COMPLY", label: "Comply and open the bag.", tags: ["risky"] },
        { choiceId: "TALK", label: "Talk your way through.", tags: ["risky"] },
        { choiceId: "SLIP", label: "Slip away into the crowd.", tags: ["risky", "draws attention"] },
      ]);
      const informed = ctx.world.attention.clarkeInformed;
      if (c === "COMPLY") {
        if (!concealed) confiscated = true;
        else recognized = resolveOutcome(ctx.attemptSeed, "B9_COMPLY_CONCEALED", [...OUTCOME_WEIGHTS.B9_COMPLY_CONCEALED]) === "RECOGNIZED";
      } else if (c === "TALK") {
        const w = informed ? OUTCOME_WEIGHTS.B9_TALK_INFORMED : OUTCOME_WEIGHTS.B9_TALK_NORMAL;
        const r = resolveOutcome(ctx.attemptSeed, informed ? "B9_TALK_INFORMED" : "B9_TALK_NORMAL", [...w]);
        if (r === "SEARCH") {
          if (!concealed) confiscated = true;
          else recognized = true;
        }
      } else {
        const r = resolveOutcome(ctx.attemptSeed, "B9_SLIP", [...OUTCOME_WEIGHTS.B9_SLIP]);
        ctx.world.attention.watcherHeat += 1;
        if (r === "CAUGHT") {
          if (!concealed) confiscated = true;
          else recognized = true;
        }
      }
      ctx.spendTime(TIME_COST.shortDialogue);
      ctx.countSpacing();
    }
  }

  if (confiscated) {
    ctx.world.jobObjects.CARRIER_HANDBILLS = { custody: "CONFISCATED", condition: "LOST", concealment: "EXPOSED" };
    setRelationship(ctx.world, "RIDER_TRUST", 20);
    ctx.narrate("The officer takes the handbills. There is nothing to hand off now.");
    ctx.countSpacing();
    return "FAILED";
  }

  // rider handoff
  ctx.scene("RIDER_POST", TEXT.rider.scene);
  const hand = yield* choose(ctx, "BOS.MD01.ACT.RIDER_HANDOFF.v1", "The rider waits, reins in hand.", [
    { choiceId: "QUICK", label: "Hand it over quick.", tags: ["saves time", "risky"] },
    { choiceId: "WAIT_FOR_GAP", label: "Wait for a gap in the street.", tags: ["costs time", "safe"] },
  ]);
  let deliveredUnseen = true;
  if (hand === "QUICK") {
    const heatKey = ctx.world.attention.watcherHeat > 0 ? "B10_QUICK_HIGH_HEAT" : "B10_QUICK_LOW_HEAT";
    const r = resolveOutcome(ctx.attemptSeed, heatKey, [...OUTCOME_WEIGHTS[heatKey]]);
    deliveredUnseen = r === "DELIVERED_UNSEEN";
    ctx.narrate(TEXT.rider.quickComplete);
    ctx.spendTime(TIME_COST.quickHandoff);
  } else {
    deliveredUnseen = true;
    ctx.narrate(TEXT.rider.waitComplete);
    ctx.spendTime(TIME_COST.waitForGap);
  }
  const damaged = recognized;
  const riderTrust = damaged ? 30 : deliveredUnseen ? 50 : 40;
  setRelationship(ctx.world, "RIDER_TRUST", riderTrust);
  ctx.emit({ kind: "RELATIONSHIP_CARD", character: "Rider", dimension: "Trust", direction: "UP", label: damaged ? "delivered, but marked" : deliveredUnseen ? "delivered clean" : "delivered, seen" });
  if (recognized) ctx.world.attention.recognized = true;
  ctx.world.jobObjects.CARRIER_HANDBILLS = { custody: "RIDER", condition: damaged ? "CREASED" : "INTACT", concealment: concealed ? "CONCEALED" : "EXPOSED" };
  ctx.meet("The rider");
  ctx.countSpacing();
  return "COMPLETED";
}

function* clarkeEncounter(ctx: Ctx): Sub<void> {
  ctx.meet("Clarke");
  ctx.scene("CLARKE_DOORWAY", TEXT.clarke.scene);
  ctx.dialogue("CLARKE", TEXT.clarke.liberty);
  ctx.dialogue("CLARKE", TEXT.clarke.challenge, true);
  const c = yield* choose(ctx, "BOS.MD01.ACT.CLARKE_CHALLENGE.v1", "Clarke eyes what you're carrying.", [
    { choiceId: "CALM_CONCEAL", label: "\"Overruns for the rider.\" Tuck the bundle under the plain wrap.", tags: ["reads as harmless"] },
    { choiceId: "CURT", label: "\"None of your business.\"", tags: ["risky", "reads as a threat"] },
    { choiceId: "HEAR_OUT", label: "\"What do you make of the crowd?\"", tags: [] },
  ]);
  if (c === "CALM_CONCEAL") {
    ctx.dialogue("NARRATOR", `Player: "${TEXT.clarke.calmCover}"`);
    const cur = ctx.world.jobObjects.CARRIER_HANDBILLS ?? { custody: "PLAYER" as const, condition: "INTACT" as const };
    ctx.world.jobObjects.CARRIER_HANDBILLS = { ...cur, concealment: "CONCEALED" };
    exposure(ctx, EXPOSURES.REP_B7);
    setRelationship(ctx.world, "CLARKE_POLITICAL_READ", -20, true);
    ctx.world.attention.clarkeInformed = false;
  } else if (c === "CURT") {
    ctx.dialogue("NARRATOR", `Player: "${TEXT.clarke.curt}"`);
    ctx.dialogue("CLARKE", TEXT.clarke.view);
    setRelationship(ctx.world, "CLARKE_POLITICAL_READ", 35, true);
    ctx.world.attention.clarkeInformed = true;
  } else {
    ctx.dialogue("NARRATOR", `Player: "${TEXT.clarke.hearOut}"`);
    ctx.dialogue("CLARKE", TEXT.clarke.view);
    setRelationship(ctx.world, "CLARKE_POLITICAL_READ", 10, true);
  }
  ctx.spendTime(TIME_COST.shortDialogue);
  ctx.countSpacing();
}

// ---------------------------------------------------------------------------
function* crowdApproach(ctx: Ctx): Sub<void> {
  ctx.world.controlState = "FREE_ROAM";
  playAmbient(ctx, AMBIENT_SLOTS.LATE);
  ctx.scene("LIBERTY_TREE_APPROACH", TEXT.crowd.scene);
  ctx.archive(TEXT.crowd.archiveRedirect);

  // high-visibility crowd board (optional read; reroute for Representation)
  const opened = yield* focusRead(ctx, "CROWD_BOARD", "Broadside on the board", "Right in your path. A single line.");
  if (opened) {
    ctx.emit({ kind: "READ_PANEL", objectId: "CROWD_BOARD", title: "Broadside", body: TEXT.streetSources.lateCrowdBroadside });
    exposure(ctx, EXPOSURES.REP_B10_4);
    ctx.spendTime(TIME_COST.focusRead);
    ctx.countSpacing();
  }

  // synthesis / catch-up syncs if time remains
  if (ctx.world.clock.spentUnits < ctx.world.clock.fixedEventBoundary) {
    yield* maybeRunSyncs(ctx, false);
    ctx.archive(TEXT.archiveSynthesis);
    // observe crowd forming: advance to boundary (authored waiting activity)
    const remaining = ctx.world.clock.fixedEventBoundary - ctx.world.clock.spentUnits;
    if (remaining > 0) ctx.spendTime(remaining);
    ctx.world.objectives.OBSERVE_CROWD = "COMPLETED";
    yield* effortHold(ctx, "BOS.MD01.ACT.OBSERVE_CROWD_FORMING.v1", "Hold to watch the crowd gather at the elm.");
  }
}

function* eventOnramp(ctx: Ctx): Sub<void> {
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
  ctx.world.fixedEvent = "COMPLETE";
  ctx.world.objectives.RETURN_TO_PRESS = "SELECTED";
  ctx.countSpacing();
  yield* waitContinue(ctx);
}

// ---------------------------------------------------------------------------
function* returnToMercer(ctx: Ctx, outcomes: Record<string, ErrandOutcome>): Sub<void> {
  ctx.world.controlState = "FREE_ROAM";
  yield* freeRoam(ctx, [{ targetId: "MERCER_PRESS", label: "Back to Mercer's Press", marker: "GOLD" }], false);
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
    ctx.archive("Pull the source and read it before we file.");
    ctx.emit({ kind: "READ_PANEL", objectId: def.exposureId, title: "Source", body });
    yield* waitContinue(ctx, "I've read it");
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
  yield* effortHold(ctx, "BOS.MD01.ACT.FINAL_PRESS_PULL.v1", "Lock the type, ink it, and pull the final sheet.");
  ctx.narrate(TEXT.headline.finalPull);
  ctx.emit({ kind: "READ_PANEL", objectId: "FINAL_PAGE", title: "Tomorrow's front page", body: TEXT.headline.finalPage });
  ctx.world.objectives.SET_HEADLINE = "COMPLETED";
  ctx.dialogue("ABIGAIL", TEXT.abigailEnd, true);

  if (!dayCompletionSatisfied(ctx.learner)) {
    throw new Error("RUNTIME_DEADLOCK: day-end gate not satisfied");
  }

  ctx.world.controlState = "DAY_END";
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
  yield* waitContinue(ctx, "Finish the day");
}
