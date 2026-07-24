import type {
  ChoiceEffectPreview,
  ReactiveCompletionEffects,
} from "@pa/contracts";

export function stakeTags(effects: ChoiceEffectPreview | undefined): string[] {
  if (!effects) return [];
  const tags: string[] = [];
  if (effects.time) tags.push(`TIME −${effects.time}`);
  if (effects.heat) {
    tags.push(`HEAT ${effects.heat === "UP" ? "▲" : effects.heat === "DOWN" ? "▼" : "?"}`);
  }
  if (effects.standing) {
    tags.push(`STANDING ${effects.standing === "UP" ? "▲" : "▼"}`);
  }
  if (effects.trust) {
    tags.push(
      `TRUST ${effects.trust.person} ${
        effects.trust.direction === "UP" ? "▲" : "▼"
      }`,
    );
  }
  if (effects.goods) {
    tags.push(
      `GOODS ${effects.goods === "GAIN" ? "+" : effects.goods === "LOSE" ? "−" : "?"}`,
    );
  }
  if (effects.route) {
    tags.push(`ROUTE ${effects.route === "OPEN" ? "+" : effects.route === "CLOSE" ? "−" : "?"}`);
  }
  return tags;
}

export function consequenceReceipt(effects: ChoiceEffectPreview): string {
  const clauses: string[] = [];
  if (effects.heat === "UP") clauses.push("the watch noticed");
  if (effects.heat === "DOWN") clauses.push("you stayed unseen");
  if (effects.heat === "RISK") clauses.push("the watch might notice");
  if (effects.time) clauses.push("the bell cost you");
  if (effects.trust) {
    clauses.push(
      effects.trust.direction === "UP"
        ? `${effects.trust.person} will remember`
        : `${effects.trust.person} took the measure of it`,
    );
  }
  if (effects.standing) {
    clauses.push(
      effects.standing === "UP"
        ? "your name carries farther"
        : "your name lost ground",
    );
  }
  if (effects.goods === "GAIN") clauses.push("the goods are in hand");
  if (effects.goods === "LOSE") clauses.push("the goods are gone");
  if (effects.goods === "RISK") clauses.push("the goods stayed at risk");
  if (effects.route === "OPEN") clauses.push("a way opened");
  if (effects.route === "CLOSE") clauses.push("that way closed");
  if (effects.route === "RISK") clauses.push("the route stayed uncertain");
  return clauses.length > 0
    ? `${effects.receiptLead}: ${clauses.join(", but ")}`
    : effects.receiptLead;
}

export function reactiveEffectPreview(
  effects: Omit<
    ReactiveCompletionEffects,
    "interactionId" | "sourceId" | "outcomeId"
  >,
  receiptLead: string,
): ChoiceEffectPreview | undefined {
  const relationship = effects.relationships?.find((entry) => entry.delta !== 0);
  const thread = effects.threads?.find((entry) => entry.trustDelta);
  const custody = effects.custody?.at(-1);
  const route = effects.routes?.at(-1);
  const hasEffects =
    Boolean(effects.clockUnits) ||
    Boolean(effects.heat) ||
    Boolean(effects.standing) ||
    Boolean(relationship) ||
    Boolean(thread) ||
    Boolean(custody) ||
    Boolean(route);
  if (!hasEffects) return undefined;
  return {
    receiptLead,
    time: effects.clockUnits,
    heat: effects.heat ? "UP" : undefined,
    standing: effects.standing
      ? effects.standing.delta > 0
        ? "UP"
        : "DOWN"
      : undefined,
    trust: relationship
      ? {
          person: relationship.relationshipId.split("_")[0] ?? "They",
          direction: relationship.delta > 0 ? "UP" : "DOWN",
        }
      : thread?.trustDelta
        ? {
            person: thread.threadId.includes("NED")
              ? "Ned"
              : thread.threadId.includes("SARAH")
                ? "Sarah"
                : "They",
            direction: thread.trustDelta > 0 ? "UP" : "DOWN",
          }
        : undefined,
    goods: custody
      ? custody.custody === "PLAYER"
        ? "GAIN"
        : custody.custody === "CONFISCATED"
          ? "LOSE"
          : undefined
      : undefined,
    route: route ? "OPEN" : undefined,
  };
}
