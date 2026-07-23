import {
  CP1_CHECKPOINT_ID,
  CP1_REQUIRED_MACROS,
  isCp1ScopedItem,
  isProductionApprovedStatus,
  type AssessmentItem,
  type AssessmentQuestionBank,
  type DebriefFormSelection,
  type MicroConceptId,
} from "@pa/contracts";
import { draw } from "../seed.js";
import { assertSelectableBank } from "./validateQuestionBank.js";

export interface SelectDebriefOptions {
  attemptSeed: Uint8Array;
  bank: AssessmentQuestionBank;
  engagedMicroIds: readonly MicroConceptId[];
  allowDraft: boolean;
  maxEnrichment?: number;
}

function eligible(
  item: AssessmentItem,
  allowDraft: boolean,
): boolean {
  return allowDraft || isProductionApprovedStatus(item.approvalStatus);
}

// CP1 (Boston Day 1, 1765) may select ONLY era-appropriate items. This holds
// regardless of allowDraft: post-1765 items banked toward future checkpoints
// are never selected here, even when their concept id happens to alias a CP1
// macro (their actScope excludes CP1). See isCp1ScopedItem.
function selectableForCp1(
  item: AssessmentItem,
  allowDraft: boolean,
): boolean {
  return eligible(item, allowDraft) && isCp1ScopedItem(item);
}

function rank(
  attemptSeed: Uint8Array,
  bankVersion: string,
  item: AssessmentItem,
): number {
  return draw(
    attemptSeed,
    `${CP1_CHECKPOINT_ID}|${bankVersion}|${item.tier}|${item.conceptId}|${item.itemId}`,
  );
}

function stableFormId(
  bankVersion: string,
  itemIds: readonly string[],
  seedDraw: number,
): string {
  let hash = 0x811c9dc5;
  const value = `${bankVersion}|${seedDraw.toFixed(12)}|${itemIds.join("|")}`;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `BOS.ACT01.CP1.FORM.${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function selectDebrief(options: SelectDebriefOptions): {
  selection: DebriefFormSelection;
  items: AssessmentItem[];
} {
  assertSelectableBank(options.bank, !options.allowDraft);
  const macros = CP1_REQUIRED_MACROS.map((conceptId) => {
    const candidates = options.bank.items
      .filter(
        (item) =>
          item.tier === "MACRO" &&
          item.conceptId === conceptId &&
          selectableForCp1(item, options.allowDraft),
      )
      .sort(
        (a, b) =>
          rank(options.attemptSeed, options.bank.bankVersion, a) -
            rank(options.attemptSeed, options.bank.bankVersion, b) ||
          a.itemId.localeCompare(b.itemId),
      );
    const selected = candidates[0];
    if (!selected) {
      throw new Error(`ASSESSMENT_BANK_INVALID: no selectable macro for ${conceptId}`);
    }
    return selected;
  });
  const engaged = new Set<string>(options.engagedMicroIds);
  const micros = options.bank.items
    .filter(
      (item) =>
        item.tier === "MICRO" &&
        engaged.has(item.conceptId) &&
        selectableForCp1(item, options.allowDraft),
    )
    .sort(
      (a, b) =>
        rank(options.attemptSeed, options.bank.bankVersion, a) -
          rank(options.attemptSeed, options.bank.bankVersion, b) ||
        a.itemId.localeCompare(b.itemId),
    )
    .slice(0, Math.max(0, Math.min(2, options.maxEnrichment ?? 2)));
  const items = [...macros, ...micros];
  const itemIds = items.map((item) => item.itemId);
  const seedDraw = draw(
    options.attemptSeed,
    `${CP1_CHECKPOINT_ID}|${options.bank.bankVersion}|FORM`,
  );
  const macroItemIds = macros.map((item) => item.itemId);
  const microItemIds = micros.map((item) => item.itemId);
  const coreFormId = stableFormId(
    options.bank.bankVersion,
    macroItemIds,
    seedDraw,
  );
  const selection: DebriefFormSelection = {
    checkpointId: CP1_CHECKPOINT_ID,
    coreFormId,
    enrichmentSupplementId:
      microItemIds.length > 0
        ? stableFormId(
            `${options.bank.bankVersion}|ENRICHMENT`,
            microItemIds,
            seedDraw,
          )
        : null,
    // Backward-compatible event field. It now names the required core only.
    formId: coreFormId,
    bankId: options.bank.bankId,
    bankVersion: options.bank.bankVersion,
    itemIds,
    macroItemIds,
    microItemIds,
  };
  return { selection, items };
}

export function resolveSelectedItems(
  bank: AssessmentQuestionBank,
  selection: DebriefFormSelection,
  allowDraft: boolean,
): AssessmentItem[] {
  if (
    selection.bankId !== bank.bankId ||
    selection.bankVersion !== bank.bankVersion
  ) {
    throw new Error("DEBRIEF_EVENT_INVALID: selected bank identity does not match");
  }
  const byId = new Map(bank.items.map((item) => [item.itemId, item]));
  const items = selection.itemIds.map((itemId) => {
    const item = byId.get(itemId);
    if (!item || !selectableForCp1(item, allowDraft)) {
      throw new Error(`DEBRIEF_EVENT_INVALID: unavailable item ${itemId}`);
    }
    return item;
  });
  const macros = items.filter((item) => item.tier === "MACRO");
  if (
    macros.length !== CP1_REQUIRED_MACROS.length ||
    CP1_REQUIRED_MACROS.some(
      (conceptId) => !macros.some((item) => item.conceptId === conceptId),
    )
  ) {
    throw new Error("DEBRIEF_EVENT_INVALID: form omits a required CP1 macro");
  }
  return items;
}
