import {
  CP1_REQUIRED_MACROS,
  MICRO_CONCEPT_IDS,
  isCp1ScopedItem,
  isProductionApprovedStatus,
  type AssessmentQuestionBank,
} from "@pa/contracts";

export interface BankValidationOptions {
  production: boolean;
}

export interface BankValidationResult {
  valid: boolean;
  errors: string[];
  missingContent: string[];
}

const microIds = new Set<string>(Object.values(MICRO_CONCEPT_IDS));
const macroIds = new Set<string>(CP1_REQUIRED_MACROS);

export function validateQuestionBank(
  bank: AssessmentQuestionBank,
  options: BankValidationOptions,
): BankValidationResult {
  const errors: string[] = [];
  const missingContent: string[] = [];
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
    // CP1 concept-membership is enforced only for CP1-scoped items. Post-1765
    // items banked for future checkpoints carry lineage concept ids and are
    // excluded here (and from CP1 selection) by their actScope.
    const cp1Scoped = isCp1ScopedItem(item);
    if (cp1Scoped && item.tier === "MACRO" && !macroIds.has(item.conceptId)) {
      errors.push(`${item.itemId} has invalid MACRO concept ${item.conceptId}`);
    }
    if (cp1Scoped && item.tier === "MICRO" && !microIds.has(item.conceptId)) {
      errors.push(`${item.itemId} has invalid MICRO concept ${item.conceptId}`);
    }
    if (!cp1Scoped && !String(item.conceptId).trim()) {
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
    // Approved macro TEKS tags are required only for CP1-scoped macros (the
    // ones that can actually be selected at CP1).
    if (
      options.production &&
      cp1Scoped &&
      item.tier === "MACRO" &&
      (item.teksTags?.length ?? 0) === 0
    ) {
      errors.push(`${item.itemId} is missing approved macro TEKS tags`);
    }
  }
  for (const conceptId of CP1_REQUIRED_MACROS) {
    const candidates = bank.items.filter(
      (item) =>
        item.tier === "MACRO" &&
        item.conceptId === conceptId &&
        isCp1ScopedItem(item),
    );
    if (candidates.length === 0) {
      missingContent.push(`Required approved macro variant: ${conceptId}`);
      // A production bank that cannot supply a required CP1 macro is not
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
      isCp1ScopedItem(item) &&
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
  production: boolean,
): void {
  const result = validateQuestionBank(bank, { production });
  if (!result.valid) {
    throw new Error(`ASSESSMENT_BANK_INVALID: ${result.errors.join("; ")}`);
  }
}
