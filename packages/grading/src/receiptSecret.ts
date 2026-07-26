// Where the receipt key comes from.
//
// The receipt (./verdict.ts) needs a secret the client does not have. Two ways to
// supply one, in order:
//
//   1. GRADING_RECEIPT_SECRET, if the deployment sets one. Preferred, because a
//      key with one job can be rotated on its own schedule.
//   2. Derived from SESSION_SECRET with HKDF and a distinct info label. This is
//      key separation rather than key reuse: the derived value cannot be used to
//      forge a session and a session secret cannot be used to forge a receipt,
//      and it means verdicts are unforgeable today on a deployment that has not
//      added a new secret yet. Every environment in this repo already has
//      SESSION_SECRET, including the ECS task definition.
//
// There is no third option. A missing secret throws rather than falling back to a
// constant, because a predictable receipt key is worse than no receipts at all: it
// would look like the verdict was being verified while a client could mint its own.

import { hkdfSync } from "node:crypto";

const INFO = "project-archive:duel-verdict-receipt:v1";

let cached: string | null = null;

export class ReceiptSecretMissingError extends Error {
  constructor() {
    super(
      "GRADING_RECEIPT_SECRET or SESSION_SECRET is required to sign duel verdicts",
    );
    this.name = "ReceiptSecretMissingError";
  }
}

export function verdictReceiptSecret(): string {
  if (cached !== null) return cached;
  const dedicated = process.env.GRADING_RECEIPT_SECRET?.trim();
  if (dedicated) {
    cached = dedicated;
    return cached;
  }
  const session = process.env.SESSION_SECRET?.trim();
  if (!session) throw new ReceiptSecretMissingError();
  // Salt is empty and the info label carries the domain separation, which is the
  // standard construction when there is no per-use nonce to bind.
  cached = Buffer.from(
    hkdfSync("sha256", Buffer.from(session, "utf8"), Buffer.alloc(0), INFO, 32),
  ).toString("base64url");
  return cached;
}

/** Tests set env vars between cases; nothing in the server calls this. */
export function resetVerdictReceiptSecretCache(): void {
  cached = null;
}
