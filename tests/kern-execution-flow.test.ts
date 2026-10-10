import assert from "node:assert/strict";
import test from "node:test";

import {
  FLOW_NODE,
  layoutExecutionFlow,
  type FlowPosition,
} from "../src/app/muse/execution-flow";
import type { MissionNodeView } from "../src/app/muse/mission-timeline";

const NODE = (key: string, dependsOn: string[] = []): MissionNodeView => ({
  key,
  kind: "SPECIALIST",
  agentCode: "agent",
  status: "SUCCEEDED",
  attempts: 1,
  taskId: "t",
  dependsOn,
});

type Pt = { x: number; y: number };

/**
 * 新产品研发 mission 的真实形态（plan.ts buildNewProductMissionPlan）。为构造
 * 最明显的交叉，列内输入序刻意打乱（列 2 与列 3 逆序喂入）——这正是用户看到的
 * 「连线交织」的成因。
 */
const NEW_PRODUCT_SHUFFLED: MissionNodeView[] = [
  NODE("market"),
  NODE("compliance"),
  NODE("economics"),
  NODE("red-team", ["opportunity", "compliance", "economics"]),
  NODE("gtm", ["opportunity"]),
  NODE("validation", ["opportunity", "compliance", "economics"]),
  NODE("opportunity", ["market"]),
  NODE("synthesis", ["qa"]),
  NODE("qa", ["validation", "gtm", "red-team"]),
];

function rowOfNode(layout: ReturnType<typeof layoutExecutionFlow>, key: string): number {
  const position = layout.positions.find((p) => p.key === key)!;
  // row 间距 180：把 y 反推成行号
  return Math.round((position.y - FLOW_NODE.padding) / FLOW_NODE.row);
}

/** 计算线段交叉数：只统计共享端点之外的几何相交。 */
function crossingCount(layout: Pick<ReturnType<typeof layoutExecutionFlow>, "positions" | "edges">): number {
  const byKey = new Map(layout.positions.map((p) => [p.key, p]));
  const segs = layout.edges.map((e) => ({
    from: byKey.get(e.from)!,
    to: byKey.get(e.to)!,
    a: String(e.from) < String(e.to) ? `${e.from}|${e.to}` : `${e.to}|${e.from}`,
  }));
  const center = (p: FlowPosition): Pt => ({ x: p.x + FLOW_NODE.width / 2, y: p.y + FLOW_NODE.height / 2 });
  const orient = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  let crossings = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s1 = segs[i];
      const s2 = segs[j];
      // 共享端点的兄弟边不算“交织”
      if ([s1.from.key, s1.to.key].includes(s2.from.key) || [s1.from.key, s1.to.key].includes(s2.to.key)) continue;
      const a1 = center(s1.from);
      const b1 = center(s1.to);
      const a2 = center(s2.from);
      const b2 = center(s2.to);
      // x 区间不相交不可能交叉
      if (Math.max(Math.min(a1.x, b1.x), Math.min(a2.x, b2.x)) > Math.min(Math.max(a1.x, b1.x), Math.max(a2.x, b2.x))) continue;
      const d1 = orient(a2, b2, a1);
      const d2 = orient(a2, b2, b1);
      const d3 = orient(a1, b1, a2);
      const d4 = orient(a1, b1, b2);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) crossings += 1;
    }
  }
  return crossings;
}

/** 重排前的原始布局（同 topology，列内保持计划输入序）——改善幅度对照用。 */
function layoutRawInputOrder(nodes: MissionNodeView[]) {
  const keys = new Set(nodes.map((n) => n.key));
  const ranks = new Map<string, number>();
  const remaining = new Set(keys);
  for (let pass = 0; pass < nodes.length && remaining.size; pass++) {
    let moved = false;
    for (const node of nodes) {
      if (!remaining.has(node.key)) continue;
      const deps = (node.dependsOn ?? []).filter((k) => keys.has(k));
      if (deps.some((k) => !ranks.has(k))) continue;
      ranks.set(node.key, deps.length ? Math.max(...deps.map((k) => ranks.get(k)!)) + 1 : 0);
      remaining.delete(node.key);
      moved = true;
    }
    if (!moved) break;
  }
  const fallback = ranks.size ? Math.max(...ranks.values()) + 1 : 0;
  for (const key of remaining) ranks.set(key, fallback);
  const columns = new Map<number, MissionNodeView[]>();
  for (const node of nodes) {
    const rank = ranks.get(node.key)!;
    columns.set(rank, [...(columns.get(rank) ?? []), node]);
  }
  const rows = Math.max(1, ...[...columns.values()].map((c) => c.length));
  const { width, column, row, padding } = FLOW_NODE;
  const positions = nodes.map((node) => {
    const rank = ranks.get(node.key)!;
    const peers = columns.get(rank)!;
    return { key: node.key, rank, x: padding + rank * column, y: padding + ((rows - peers.length) * row) / 2 + peers.indexOf(node) * row };
  });
  const edges = nodes.flatMap((node) => [...new Set(node.dependsOn ?? [])].filter((k) => keys.has(k)).map((from) => ({ from, to: node.key })));
  return { positions, edges };
}

test("FLOW-A：乱序喂入新产品形态，交叉线比重排前可量化地减少", () => {
  const layout = layoutExecutionFlow(NEW_PRODUCT_SHUFFLED);
  assert.equal(layout.unresolved.length, 0);

  // 多档跨级线（rank0→rank2）的几何交点不在列内排序的影响域内，因此以
  // 「相对重排前严格减少 + 有文档化上界」作为诚实的验收，而不虚假宣称 0。
  const improved = crossingCount(layout);
  const raw = crossingCount(layoutRawInputOrder(NEW_PRODUCT_SHUFFLED));
  assert.ok(improved < raw, `交叉线应严格减少：重排后 ${improved} < 重排前 ${raw}`);
  assert.ok(improved <= 2, `该形态下改善后的上界为 2（跨级线几何交点）：实际 ${improved}`);

  // 排序确实被应用过：gtm 的行位与其唯一依赖 opportunity 对齐（barycenter 行为）
  const oppRow = rowOfNode(layout, "opportunity");
  assert.ok(Math.abs(rowOfNode(layout, "gtm") - oppRow) <= 1, "gtm 的行位应贴近其唯一依赖");
});

test("FLOW-B：rank/输入顺序确定性，石榴换序后不漂移", () => {
  const a = layoutExecutionFlow(NEW_PRODUCT_SHUFFLED);
  const b = layoutExecutionFlow(NEW_PRODUCT_SHUFFLED);
  assert.deepEqual(b.positions, a.positions, "layout 必须确定性（同输入同输出）");

  // rank 不与行序混淆：触发两次并以 rank 复核（x 完全由 rank 决定）
  for (const p of a.positions.filter((p) => p.key === "synthesis")) {
    assert.equal(p.x, FLOW_NODE.padding + 4 * FLOW_NODE.column, "synthesis 列位必须与其 rank 一致");
    assert.equal(p.rank, 4);
  }

  // cross-rank 的乱序输入不改变 rank 的判定（只改列内行序）
  const reversed = layoutExecutionFlow([...NEW_PRODUCT_SHUFFLED].reverse());
  for (const key of ["synthesis", "qa", "opportunity"]) {
    const p1 = a.positions.find((p) => p.key === key)!;
    const p2 = reversed.positions.find((p) => p.key === key)!;
    assert.equal(p2.rank, p1.rank, `${key} 的 rank 必须稳定，不许因输入顺序漂移`);
  }
});

test("FLOW-C：根列 0 保持计划输入序（无依赖节点的视觉即计划序）", () => {
  const layout = layoutExecutionFlow(NEW_PRODUCT_SHUFFLED);
  const roots = layout.positions.filter((p) => p.rank === 0).sort((a, b) => a.y - b.y).map((p) => p.key);
  assert.deepEqual(roots, ["market", "compliance", "economics"], "rank 0 列的行序 = 计划输入序");
});

test("FLOW-D：无法解析/环状依赖兜到独立列，点不丢、不假装能按序执行", () => {
  const nodes = [
    NODE("a", ["b"]),
    NODE("b", ["a"]),
    NODE("c", ["ghost"]), // 引用不存在的上游
    NODE("d"),
  ];
  const layout = layoutExecutionFlow(nodes);
  assert.deepEqual([...layout.unresolved].sort(), ["a", "b"]);
  assert.equal(layout.positions.length, 4, "所有点都要渲染（兜底列），不许丢节点");
  assert.ok(layout.positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  // a/b 在兜底列且为 rank 最大列；c/d 正常
  const aPos = layout.positions.find((p) => p.key === "a")!;
  const dPos = layout.positions.find((p) => p.key === "d")!;
  assert.ok(aPos.rank > dPos.rank, "环依赖节点必须落在最大 rank 之后");
});

test("FLOW-E：单链、空集与孤点边界", () => {
  assert.deepEqual(layoutExecutionFlow([]).positions, []);
  const chain = layoutExecutionFlow([NODE("x"), NODE("y", ["x"]), NODE("z", ["y"])]);
  assert.equal(crossingCount(chain), 0);
  assert.equal(chain.width, FLOW_NODE.padding * 2 + FLOW_NODE.width + 2 * FLOW_NODE.column);
});
