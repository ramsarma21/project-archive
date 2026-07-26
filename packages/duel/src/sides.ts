// Sides are A and B, never "player" and "boss".
//
// This is the load-bearing naming decision for PvP reuse: the machine has no
// concept of which side is human. A is the local player in both modes; B is a
// boss in PvE and a remote player in PvP, and the difference is one field on the
// config (machine.ts, `OpponentSource`) rather than a second implementation.

export type DuelSide = "A" | "B";

export const DUEL_SIDES: readonly DuelSide[] = ["A", "B"];

export function otherSide(side: DuelSide): DuelSide {
  return side === "A" ? "B" : "A";
}

export type BySide<T> = { readonly A: T; readonly B: T };

export function bySide<T>(a: T, b: T): BySide<T> {
  return { A: a, B: b };
}

export function pickSide<T>(pair: BySide<T>, side: DuelSide): T {
  return side === "A" ? pair.A : pair.B;
}

export function withSide<T>(pair: BySide<T>, side: DuelSide, value: T): BySide<T> {
  return side === "A" ? { A: value, B: pair.B } : { A: pair.A, B: value };
}
