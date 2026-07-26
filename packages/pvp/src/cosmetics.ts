// The cosmetic loadout, and why it cannot become pay-to-win by accident.
//
// "Cosmetic only" is easy to write in a design document and easy to lose in code,
// because the loss is never deliberate. Somebody adds a weapon to the loadout, a
// weapon plainly has a calibre, and six months later a flintlock does 22 damage and
// a Kentucky rifle does 26. Nobody decided that; it just followed from the noun.
//
// Three defences, in increasing order of strength:
//
//   1. The type carries NO numbers. `CosmeticLoadout` is two ids, and
//      `ForbiddenCosmeticKeys` is a compile-time assertion that no gameplay-shaped
//      key has appeared on it.
//   2. The wire parser rejects unknown keys rather than ignoring them, so a client
//      cannot smuggle `{ skinId, weaponId, damageBonus }` past it.
//   3. THE SIMULATION NEVER RECEIVES IT. This is the one that actually holds: the
//      authority builds its fighter parameters from @pa/duel's `playerParams()` and
//      the resolved ability loadout, and the cosmetics live in a separate
//      presentation record that the reducer is never handed. A cosmetic cannot
//      affect a fight it is not an input to, and `cosmetics.test.ts` proves it by
//      running two matches with opposite loadouts and asserting byte-identical
//      simulation.
//
// Defence 3 is why this file has no "apply cosmetics" function to audit. There is
// nothing to apply.

export interface CosmeticLoadout {
  /** A skin from any chapter the profile has completed. Presentation only. */
  readonly skinId: string;
  /** A historically accurate weapon from any era. Presentation only. */
  readonly weaponId: string;
}

export const COSMETIC_LOADOUT_KEYS = ["skinId", "weaponId"] as const;

export const DEFAULT_COSMETIC_LOADOUT: CosmeticLoadout = {
  skinId: "SKIN.BOSTON.RUNNER",
  weaponId: "WEAPON.FLINTLOCK.PISTOL",
};

/**
 * Compile-time guard. If anybody adds a gameplay-shaped field to CosmeticLoadout,
 * this type stops being `never` and `assertCosmeticsCarryNoStats` stops compiling.
 */
export type ForbiddenCosmeticKeys = Extract<
  keyof CosmeticLoadout,
  | "damage"
  | "damageBonus"
  | "health"
  | "healthBonus"
  | "speed"
  | "moveSpeedScale"
  | "fireIntervalTicks"
  | "ammo"
  | "bullets"
  | "reach"
  | "accuracy"
>;

export function assertCosmeticsCarryNoStats(): void {
  const forbidden: ForbiddenCosmeticKeys[] = [];
  if (forbidden.length > 0) {
    throw new Error("a cosmetic loadout may never carry a gameplay value");
  }
}

export type CosmeticRejection =
  | "NOT_AN_OBJECT"
  | "UNKNOWN_FIELD"
  | "MISSING_FIELD"
  | "BAD_FIELD_TYPE"
  | "UNKNOWN_SKIN"
  | "UNKNOWN_WEAPON";

export type CosmeticParseResult =
  | { readonly ok: true; readonly loadout: CosmeticLoadout }
  | { readonly ok: false; readonly reason: CosmeticRejection; readonly detail: string };

export interface CosmeticCatalogue {
  /** Skins this profile has earned. Ownership is decided upstream, not here. */
  readonly skinIds: readonly string[];
  readonly weaponIds: readonly string[];
}

/**
 * Parse a client-supplied loadout against what the profile owns. Unknown keys are
 * refused rather than dropped, so an attempt to attach a stat is visible in logs
 * instead of silently succeeding at nothing.
 */
export function parseCosmeticLoadout(
  input: unknown,
  catalogue: CosmeticCatalogue,
): CosmeticParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "NOT_AN_OBJECT", detail: typeof input };
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set<string>(COSMETIC_LOADOUT_KEYS);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return { ok: false, reason: "UNKNOWN_FIELD", detail: key };
    }
  }
  for (const key of COSMETIC_LOADOUT_KEYS) {
    if (!(key in record)) return { ok: false, reason: "MISSING_FIELD", detail: key };
    if (typeof record[key] !== "string") {
      return { ok: false, reason: "BAD_FIELD_TYPE", detail: key };
    }
  }
  const skinId = record.skinId as string;
  const weaponId = record.weaponId as string;
  if (!catalogue.skinIds.includes(skinId)) {
    return { ok: false, reason: "UNKNOWN_SKIN", detail: skinId };
  }
  if (!catalogue.weaponIds.includes(weaponId)) {
    return { ok: false, reason: "UNKNOWN_WEAPON", detail: weaponId };
  }
  return { ok: true, loadout: { skinId, weaponId } };
}
