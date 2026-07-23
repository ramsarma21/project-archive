import {
  isCheckpointScopedItem,
  isProductionApprovedStatus,
  type AssessmentQuestionBank,
} from "@pa/contracts";
import type { CheckpointSpec } from "../engine/chapter.js";

export interface BankValidationOptions {
  production: boolean;
}

export interface BankValidationResult {
  valid: boolean;
  errors: string[];
  missingContent: string[];
}

export function validateQuestionBank(
  bank: AssessmentQuestionBank,
  checkpoint: CheckpointSpec,
  options: BankValidationOptions,
): BankValidationResult {
  const errors: string[] = [];
  const missingContent: string[] = [];
  const microIds = new Set<string>(checkpoint.microConceptIds);
  const macroIds = new Set<string>(checkpoint.requiredMacroConceptIds);
  if (!bank.bankId.trim()) errors.push("bankId is required");
  if (!bank.bankVersion.trim()) errors.push("bankVersion is required");
  if (options.production && !isProductionApprovedStatus(bank.approvalStatus)) {
    errors.push(
      `bank ${bank.bankId}@${bank.bankVersion} is not approved for production`,
    );
  }
  const itemIds = new Set<string>();
  for (const item of bank.items) {
    if (!item.itemId.trim() || !item.itemVersion.trim()) {
      errors.push("every item requires stable itemId and itemVersion");
    }
    if (itemIds.has(item.itemId)) errors.push(`duplicate itemId ${item.itemId}`);
    itemIds.add(item.itemId);
    // Checkpoint concept-membership is enforced only for items scoped to THIS
    // checkpoint. Items banked for future checkpoints carry lineage concept
    // ids and are excluded here (and from selection) by their actScope.
    const scoped = isCheckpointScopedItem(item, checkpoint.checkpointId);
    if (scoped && item.tier === "MACRO" && !macroIds.has(item.conceptId)) {
      errors.push(`${item.itemId} has invalid MACRO concept ${item.conceptId}`);
    }
    if (scoped && item.tier === "MICRO" && !microIds.has(item.conceptId)) {
      errors.push(`${item.itemId} has invalid MICRO concept ${item.conceptId}`);
    }
    if (!scoped && !String(item.conceptId).trim()) {
      errors.push(`${item.itemId} must carry a non-empty lineage concept id`);
    }
    if (!item.stem.trim()) errors.push(`${item.itemId} has an empty stem`);
    if (item.options.length < 2 || item.options.length > 4) {
      errors.push(`${item.itemId} must expose 2..4 options`);
    }
    const optionIds = new Set(item.options.map((option) => option.optionId));
    if (optionIds.size !== item.options.length) {
      errors.push(`${item.itemId} has duplicate option IDs`);
    }
    if (!optionIds.has(item.correctOptionId)) {
      errors.push(`${item.itemId} must identify exactly one valid correct option`);
    }
    if (options.production && !isProductionApprovedStatus(item.approvalStatus)) {
      errors.push(`${item.itemId} is not approved for production`);
    }
    if (item.teksTags === undefined) {
      errors.push(`${item.itemId} must include TEKS metadata (an explicit array)`);
    }
    // Approved macro TEKS tags are required only for checkpoint-scoped macros
    // (the ones that can actually be selected here).
    if (
      options.production &&
      scoped &&
      item.tier === "MACRO" &&
      (item.teksTags?.length ?? 0) === 0
    ) {
      errors.push(`${item.itemId} is missing approved macro TEKS tags`);
    }
  }
  for (const conceptId of checkpoint.requiredMacroConceptIds) {
    const candidates = bank.items.filter(
      (item) =>
        item.tier === "MACRO" &&
        item.conceptId === conceptId &&
        isCheckpointScopedItem(item, checkpoint.checkpointId),
    );
    if (candidates.length === 0) {
      missingContent.push(`Required approved macro variant: ${conceptId}`);
      // A production bank that cannot supply a required macro is not
      // selectable; surface it as a hard error so the gate stays blocked.
      if (options.production) {
        errors.push(`no production-eligible macro variant for ${conceptId}`);
      }
    } else if (
      options.production &&
      !candidates.some((item) => isProductionApprovedStatus(item.approvalStatus))
    ) {
      missingContent.push(`SME approval for macro variant: ${conceptId}`);
      errors.push(`macro variant ${conceptId} has no production-approved item`);
    }
  }
  const eligibleMicros = bank.items.filter(
    (item) =>
      item.tier === "MICRO" &&
      isCheckpointScopedItem(item, checkpoint.checkpointId) &&
      (!options.production || isProductionApprovedStatus(item.approvalStatus)),
  );
  if (eligibleMicros.length === 0) {
    missingContent.push("Approved optional micro-item pool (engaged-only)");
  }
  if (options.production && bank.items.length === 0) {
    missingContent.push("Final CP1 Archive dialogue and transition copy");
    missingContent.push("Final SME-authored TEKS tags and approval provenance");
  }
  return { valid: errors.length === 0, errors, missingContent };
}

export function assertSelectableBank(
  bank: AssessmentQuestionBank,
  checkpoint: CheckpointSpec,
  production: boolean,
): void {
  const result = validateQuestionBank(bank, checkpoint, { production });
  if (!result.valid) {
    throw new Error(`ASSESSMENT_BANK_INVALID: ${result.errors.join("; ")}`);
  }
}
