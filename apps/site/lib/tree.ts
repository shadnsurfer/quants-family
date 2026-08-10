/**
 * Family-tree layout: generations as rows, rich cards as nodes, dashed edges parent→child.
 * Pure math — the client canvas just applies pan/zoom transforms to what this computes.
 *
 * Lineage model: there is no mother and no pool. The tree roots at the gen-0 progenitor
 * (agent zero) and every row below it is a generation of self-funded, self-designed children.
 */
import type { World, WorldQuant } from "./world";
import { breedProgress, hpOf, pnlPct } from "./world";

export const CARD_W = 292;
export const CARD_H = 248;
const ROW_GAP = 120;
const COL_GAP = 48;
const PAD = 60;

export interface TreeNode {
  q: WorldQuant;
  x: number;
  y: number;
  rank: number;
  hp: number;
  pnl: number;
  breed: number;
  sport: boolean;
  ageH: number;
  children: number;
}

export interface ProtoNode {
  x: number;
  y: number;
  gen: number;
}

export interface TreeEdge {
  x1: number; y1: number; x2: number; y2: number;
  dead: boolean;
  proto?: boolean;
}

export interface TreeLayout {
  nodes: TreeNode[];
  proto: ProtoNode | null;
  edges: TreeEdge[];
  worldW: number;
  worldH: number;
}

export function buildTreeLayout(world: World): TreeLayout {
  const quants = world.quants;
  const byGen = new Map<number, WorldQuant[]>();
  for (const q of quants) {
    const row = byGen.get(q.generation) ?? [];
    row.push(q);
    byGen.set(q.generation, row);
  }
  const gens = [...byGen.keys()].sort((a, b) => a - b);
  const maxRowLen = Math.max(1, ...[...byGen.values()].map((r) => r.length));
  const anyAlive = quants.some((q) => q.status === "alive");
  const protoRow = anyAlive ? 1 : 0;

  const worldW = Math.max(1080, PAD * 2 + maxRowLen * CARD_W + (maxRowLen - 1) * COL_GAP);
  const rowCount = gens.length + protoRow;
  const worldH = PAD * 2 + rowCount * CARD_H + (rowCount - 1) * ROW_GAP;

  const ranked = [...quants].sort((a, b) => (b.fitness ?? -1) - (a.fitness ?? -1));
  const rankOf = new Map(ranked.map((q, i) => [q.id, i + 1]));
  const sports = new Set(
    world.events
      .filter((e) => e.kind === "birth" && /SPORT/i.test(e.detail))
      .map((e) => e.quantId),
  );
  const childCount = new Map<string, number>();
  for (const q of quants) {
    for (const p of q.parents) childCount.set(p, (childCount.get(p) ?? 0) + 1);
  }
  const endMs = world.simEndMs ?? 0;

  const nodes: TreeNode[] = [];
  gens.forEach((g, gi) => {
    const row = byGen.get(g)!;
    const rowW = row.length * CARD_W + (row.length - 1) * COL_GAP;
    const x0 = (worldW - rowW) / 2;
    row.forEach((q, i) => {
      nodes.push({
        q,
        x: x0 + i * (CARD_W + COL_GAP),
        y: PAD + gi * (CARD_H + ROW_GAP),
        rank: rankOf.get(q.id) ?? 0,
        hp: hpOf(q),
        pnl: pnlPct(q),
        breed: breedProgress(q, endMs).pct,
        sport: sports.has(q.id),
        ageH: Math.max(0, Math.round(((q.diedAtMs ?? endMs) - q.bornAtMs) / 3_600_000)),
        children: childCount.get(q.id) ?? 0,
      });
    });
  });

  const posOf = new Map(nodes.map((n) => [n.q.id, n]));
  const edges: TreeEdge[] = [];
  for (const n of nodes) {
    // the progenitor has no parents and no incoming edge — it IS the root
    for (const p of n.q.parents) {
      const from = posOf.get(p);
      if (!from) continue;
      edges.push({
        x1: from.x + CARD_W / 2, y1: from.y + CARD_H,
        x2: n.x + CARD_W / 2, y2: n.y,
        dead: from.q.status === "dead" || n.q.status === "dead",
      });
    }
  }

  // the unhatched next generation: a dashed prototype card fed by the fittest living quant —
  // asexual lineage: one parent, its own design, clone + mutation
  let proto: ProtoNode | null = null;
  if (anyAlive) {
    const nextGen = Math.max(...gens) + 1;
    proto = {
      x: (worldW - CARD_W) / 2,
      y: PAD + gens.length * (CARD_H + ROW_GAP),
      gen: nextGen,
    };
    const parents = ranked.filter((q) => q.status === "alive").slice(0, 1);
    for (const p of parents) {
      const from = posOf.get(p.id);
      if (!from) continue;
      edges.push({
        x1: from.x + CARD_W / 2, y1: from.y + CARD_H,
        x2: proto.x + CARD_W / 2, y2: proto.y,
        dead: false,
        proto: true,
      });
    }
  }

  return { nodes, proto, edges, worldW, worldH };
}
