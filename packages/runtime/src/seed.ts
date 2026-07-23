import { RUN_SEED_MESSAGE_PREFIX } from "@pa/contracts";
import { hmacSha256, hexToBytes, bytesToHex, utf8 } from "./crypto/sha256.js";

// attempt_seed = leftmost_16_bytes( HMAC-SHA-256(root, "PA.RUN.SEED.v1|<chapter>|<attempt>") )
export function deriveAttemptSeed(
  variationRootSeedHex: string,
  chapterId: string,
  attemptStartSequence: number,
): Uint8Array {
  const msg = `${RUN_SEED_MESSAGE_PREFIX}|${chapterId}|${attemptStartSequence}`;
  const full = hmacSha256(hexToBytes(variationRootSeedHex), utf8(msg));
  return full.slice(0, 16);
}

// Deterministic uniform draw in [0, 1) from a label, seeded by attempt seed.
// Distinct labels used in a fixed order during replay yield reproducible values.
export function draw(attemptSeed: Uint8Array, label: string): number {
  const digest = hmacSha256(attemptSeed, utf8(label));
  // take first 6 bytes as an integer, normalize
  let v = 0;
  for (let i = 0; i < 6; i++) v = v * 256 + digest[i]!;
  const max = Math.pow(256, 6);
  return v / max;
}

export function deriveFieldSeedHex(attemptSeed: Uint8Array): string {
  return bytesToHex(hmacSha256(attemptSeed, utf8("PA.FIELD.SEED.v1")).slice(0, 16));
}

export { bytesToHex };
