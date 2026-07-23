import {
  ACT1_OPEN_RESPONSE_CONTENT,
  ACT1_OPEN_RESPONSE_RECORD_HASHES,
} from "./generated/act1OpenResponseContent.generated.js";

export type HistoricalClaimType =
  | "DOCUMENTED"
  | "REPRESENTATIVE"
  | "INFERENCE";

export interface HistoricalProvenanceClaim {
  claimId: string;
  claimType: HistoricalClaimType;
  text: string;
  citationHint: string;
  evidenceIds: readonly string[];
}

export interface HistoricalProvenanceEvidence {
  evidenceId: string;
  text: string;
}

export interface HistoricalProvenanceRecord {
  sourceId: string;
  version: string;
  hash: `sha256:${string}`;
  label: string;
  claimTypes: readonly HistoricalClaimType[];
  reviewedText: string;
  reviewedTranscription: string;
  recallLabel: string;
  tracking: "TRACKED";
  approval: "HISTORICAL_REVIEW_PENDING";
  backingRefs: readonly string[];
  claims: readonly HistoricalProvenanceClaim[];
  evidence: readonly HistoricalProvenanceEvidence[];
  warnings: readonly string[];
}

const packets = ACT1_OPEN_RESPONSE_CONTENT.sources.packets;

export const HISTORICAL_SOURCE_REGISTRY: Readonly<
  Record<string, HistoricalProvenanceRecord>
> = Object.fromEntries(
  packets.map((packet) => {
    const warnings = packet.claims
      .filter(
        (claim) =>
          claim.claimType === "REPRESENTATIVE" ||
          claim.claimType === "INFERENCE",
      )
      .map((claim) => claim.citationHint);
    return [
      packet.packetId,
      {
        sourceId: packet.packetId,
        version: ACT1_OPEN_RESPONSE_CONTENT.sources.registryVersion,
        hash:
          ACT1_OPEN_RESPONSE_RECORD_HASHES.sources[
            packet.packetId as keyof typeof ACT1_OPEN_RESPONSE_RECORD_HASHES.sources
          ],
        label: packet.title,
        claimTypes: [
          ...new Set(
            packet.claims.map(
              (claim) => claim.claimType as HistoricalClaimType,
            ),
          ),
        ],
        reviewedText: packet.reviewedParaphrase,
        reviewedTranscription: packet.reviewedTranscription,
        recallLabel: packet.title,
        tracking: "TRACKED",
        approval: "HISTORICAL_REVIEW_PENDING",
        backingRefs: packet.backingRefs,
        claims: packet.claims,
        evidence: packet.evidence,
        warnings,
      },
    ];
  }),
);

const aliases = new Map<string, string[]>();
for (const packet of packets) {
  for (const backingRef of packet.backingRefs) {
    const values = aliases.get(backingRef) ?? [];
    if (!values.includes(packet.packetId)) values.push(packet.packetId);
    aliases.set(backingRef, values);
  }
}
for (const [legacySourceId, packetIds] of Object.entries({
  "KN-customhouse": ["BOS.ACT01.SRC.REVENUE_PROCLAMATION.v1"],
  "THR-sarah": ["BOS.ACT01.SRC.SARAH_MARKET.v1"],
  "NPC-rider": ["BOS.ACT01.SRC.RIDER_NETWORK.v1"],
} satisfies Record<string, string[]>)) {
  const values = aliases.get(legacySourceId) ?? [];
  for (const packetId of packetIds) {
    if (!values.includes(packetId)) values.push(packetId);
  }
  aliases.set(legacySourceId, values);
}

export const FIELD_SOURCE_ALIASES: Readonly<Record<string, string>> =
  Object.fromEntries(
    [...aliases].map(([sourceId, packetIds]) => [sourceId, packetIds[0]!]),
  );

export function canonicalSourceId(sourceId: string): string {
  return FIELD_SOURCE_ALIASES[sourceId] ?? sourceId;
}

export function canonicalSourceIds(sourceId: string): readonly string[] {
  if (HISTORICAL_SOURCE_REGISTRY[sourceId]) return [sourceId];
  return (
    aliases.get(sourceId) ??
    aliases.get(sourceId.replace(/^INTERIOR:/, "")) ??
    []
  );
}

