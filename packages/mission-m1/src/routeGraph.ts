// Route connectivity and time cost.
//
// Link durations come from the verifier, which derives them from the shipped
// physics (flight time for a ballistic link, authored duration for an
// affordance, distance over speed for a run), so "how long does this route
// take" is not a separate guess living beside the geometry.

import type { LinkVerdict } from "./traversal.js";
import type { MissionLevel, RouteLink, SectionId } from "./types.js";

export interface GraphEdge {
  link: RouteLink;
  seconds: number;
  metres: number;
  ok: boolean;
}

export interface RouteGraph {
  edges: Map<string, GraphEdge[]>;
  byId: Map<string, GraphEdge>;
  sectionOf: Map<string, SectionId>;
}

export function routeGraph(
  level: MissionLevel,
  verdicts: readonly LinkVerdict[],
): RouteGraph {
  const verdictById = new Map(verdicts.map((v) => [v.id, v]));
  const edges = new Map<string, GraphEdge[]>();
  const byId = new Map<string, GraphEdge>();
  for (const link of level.links) {
    const verdict = verdictById.get(link.id);
    const edge: GraphEdge = {
      link,
      seconds: verdict?.durationS ?? 0,
      metres: verdict?.distanceM ?? 0,
      ok: verdict?.ok ?? false,
    };
    const list = edges.get(link.from);
    if (list) list.push(edge);
    else edges.set(link.from, [edge]);
    byId.set(link.id, edge);
  }
  return {
    edges,
    byId,
    sectionOf: new Map(level.nodes.map((n) => [n.id, n.section])),
  };
}

export interface PathResult {
  nodes: string[];
  links: string[];
  seconds: number;
  metres: number;
}

/**
 * Cheapest path in seconds, restricted to the given lines. `allow` is a
 * whitelist: passing ["SAFE"] answers "can a player who never takes a risk
 * still finish", which is the question that actually matters.
 */
export function cheapestPath(
  graph: RouteGraph,
  from: string,
  to: string,
  allow: ReadonlyArray<RouteLink["line"]>,
  options: { requireVerified?: boolean } = {},
): PathResult | null {
  const requireVerified = options.requireVerified ?? true;
  const allowed = new Set(allow);
  const best = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, { node: string; edge: GraphEdge }>();
  const queue: Array<{ node: string; cost: number }> = [
    { node: from, cost: 0 },
  ];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    if (current.cost > (best.get(current.node) ?? Infinity)) continue;
    if (current.node === to) break;
    for (const edge of graph.edges.get(current.node) ?? []) {
      if (!allowed.has(edge.link.line)) continue;
      if (requireVerified && !edge.ok) continue;
      const cost = current.cost + edge.seconds;
      if (cost >= (best.get(edge.link.to) ?? Infinity)) continue;
      best.set(edge.link.to, cost);
      previous.set(edge.link.to, { node: current.node, edge });
      queue.push({ node: edge.link.to, cost });
    }
  }

  if (!best.has(to)) return null;
  const nodes: string[] = [to];
  const links: string[] = [];
  let metres = 0;
  let cursor = to;
  while (cursor !== from) {
    const step = previous.get(cursor);
    if (!step) return null;
    links.unshift(step.edge.link.id);
    metres += step.edge.metres;
    cursor = step.node;
    nodes.unshift(cursor);
  }
  return { nodes, links, seconds: best.get(to)!, metres };
}

export interface LineBudget {
  line: RouteLink["line"] | "SAFE+FAST" | "ALL";
  reachable: boolean;
  seconds: number;
  metres: number;
  hops: number;
}

export function lineBudget(
  level: MissionLevel,
  graph: RouteGraph,
): LineBudget[] {
  const sets: Array<{
    label: LineBudget["line"];
    allow: RouteLink["line"][];
  }> = [
    { label: "SAFE", allow: ["SAFE"] },
    { label: "SAFE+FAST", allow: ["SAFE", "FAST"] },
    { label: "ALL", allow: ["SAFE", "FAST", "EXPERT"] },
  ];
  return sets.map(({ label, allow }) => {
    const toPost = cheapestPath(graph, level.startNode, level.postNode, allow);
    const toArena = cheapestPath(graph, level.postNode, level.arenaNode, allow);
    const path =
      toPost && toArena
        ? {
            nodes: [...toPost.nodes, ...toArena.nodes.slice(1)],
            links: [...toPost.links, ...toArena.links],
            seconds: toPost.seconds + toArena.seconds,
            metres: toPost.metres + toArena.metres,
          }
        : null;
    return {
      line: label,
      reachable: path !== null,
      seconds: path?.seconds ?? 0,
      metres: path?.metres ?? 0,
      hops: path?.links.length ?? 0,
    };
  });
}
