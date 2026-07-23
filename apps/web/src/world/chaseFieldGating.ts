// Pure gating predicates for how field interrupts interact with the contextual
// interaction surface and the casual explore portals. Extracted from World3D so
// the chase-specific invariants are unit-testable and cannot silently regress.
//
// Invariants (World-Design-Bible §5 traversal + §chase):
//  - Contextual F interactions (traversal climb/vault/duck) MUST stay live
//    during a CHASE: the TraversalDirector is active during a chase and the
//    chase stamina action-debit path is reachable only through the F surface,
//    so parkour escapes work. Every other interrupt (dialogue, reactive
//    exchange, open response, confrontation) suppresses contextual interactions.
//  - Casual presentation explore portals MUST NOT fire during an active chase:
//    a refuge door resolves the pursuit (and choreographs the safe entry), so a
//    proximity portal must not whisk the player into an interior before the
//    refuge hold lands.
import type { FieldInterruptKind } from "@pa/contracts";

export function contextualInteractionsAllowedDuringInterrupt(
  interruptKind: FieldInterruptKind | null | undefined,
): boolean {
  return !interruptKind || interruptKind === "CHASE";
}

export function explorePortalsAllowedDuringChase(hasActiveChase: boolean): boolean {
  return !hasActiveChase;
}
