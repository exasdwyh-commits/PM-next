import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  FLOW_GOAL,
  FLOW_LEGIBLE_SCALE,
  FLOW_NODE,
  flowDefaultCamera,
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

test("FLOW-A：列内按依赖重心稳定重排、不回退，行序与依赖对齐", () => {
  const layout = layoutExecutionFlow(NEW_PRODUCT_SHUFFLED);
  assert.equal(layout.unresolved.length, 0);

  // 诚实的承诺边界：列内排序只影响同 rank 的行位；跨级线（rank0→rank2）的几何
  // 交点不在其影响域内。因此断言三件事，而不是「交叉归零」那种听不见的承诺：
  // 1) 重排后行序 = 依赖重心排序后的既有顺序（GTm/红队/验证围绕 opportunity）；
  // 2) 交叉量不回退（不比重排前更差）；
  // 3) 单一依赖的子节点与其唯一依赖的行位对齐（视觉不再「隔空拉扯」）。
  const rank2Rows = layout.positions
    .filter((p) => p.rank === 2)
    .sort((a, b) => a.y - b.y)
    .map((p) => p.key);
  assert.deepEqual(rank2Rows, ["gtm", "red-team", "validation"]);

  const improved = crossingCount(layout);
  const raw = crossingCount(layoutRawInputOrder(NEW_PRODUCT_SHUFFLED));
  assert.ok(improved <= raw, `交叉量不得回退：重排后 ${improved} > 重排前 ${raw}`);

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

/**
 * FLOW-F/G：默认相机的可读线与对准（2026-10-14 W1）。
 * 事故：c170170 把 fit 下限从 .86/.72 拆到 .05，9 节点图默认被压到 0.33、标题 4.3px，
 * 没有任何断言拦住它；origin/main 的 .72 也只有 9.4px 且整图溢出视口需拖拽。
 * 这里把「默认视图标题有效字号 ≥10px」焊成不变量：字号从 execution-flow.css 实读，
 * 相机走组件同一函数 flowDefaultCamera（组件初始 size 640×366 是确定性常量，SSR 同样成立）。
 */
const FLOW_CSS = fs.readFileSync(path.resolve(process.cwd(), "src/app/muse/components/execution-flow.css"), "utf8");
const TITLE_PX = Number(/\.m-flow-node-copy strong\s*\{[^}]*font-size:\s*([\d.]+)px/.exec(FLOW_CSS)?.[1]);
const WIRE_PX = Number(/\.m-flow-wire\s*\{[^}]*stroke-width:\s*([\d.]+)/.exec(FLOW_CSS)?.[1]);
/** 组件侧的 shownWidth：已展示节点最右缘 + padding（含 FLOW_GOAL.offset 平移），与 execution-flow.tsx 同口径。 */
function shownWidthOf(layout: ReturnType<typeof layoutExecutionFlow>, revealed: Set<string>) {
  return Math.max(FLOW_GOAL.width + FLOW_NODE.padding * 2, ...layout.positions.filter((p) => revealed.has(p.key)).map((p) => p.x + FLOW_GOAL.offset + FLOW_NODE.width + FLOW_NODE.padding));
}

test("FLOW-F：默认视图标题有效字号 ≥10px、连线 ≥1px（9 节点全展示，初始尺寸与实测视口各一次）", () => {
  assert.ok(TITLE_PX >= 13, `execution-flow.css 标题字号应可读出（得到 ${TITLE_PX}）`);
  assert.ok(WIRE_PX >= 1, `execution-flow.css 连线描边应可读出（得到 ${WIRE_PX}）`);
  const layout = layoutExecutionFlow(NEW_PRODUCT_SHUFFLED);
  const all = new Set(NEW_PRODUCT_SHUFFLED.map((n) => n.key));
  const shownWidth = shownWidthOf(layout, all);
  assert.equal(shownWidth, 1758, "9 节点 NEW_PRODUCT 计划全展示宽度（需求单 §2.2 基线）");
  assert.equal(layout.height, 570);
  for (const size of [{ width: 640, height: 366 }, { width: 603, height: 480 }, { width: 1280, height: 480 }, { width: 390, height: 390 }]) {
    const camera = flowDefaultCamera({ size, layoutHeight: layout.height, shownWidth, anchor: null });
    const title = TITLE_PX * camera.scale;
    assert.ok(title >= 10, `视口 ${size.width}×${size.height}：标题有效字号 ${title.toFixed(2)}px < 10px（scale ${camera.scale.toFixed(3)}）`);
    assert.ok(WIRE_PX * camera.scale >= 1, `视口 ${size.width}×${size.height}：连线有效宽 ${(WIRE_PX * camera.scale).toFixed(2)}px < 1px`);
    assert.ok(camera.scale <= 1, "默认不放大超过 1:1");
    // 至少完整可见 1 列节点 + 相邻列连线走向：一列（节点宽 + 列距）必须装进视口
    assert.ok(FLOW_NODE.column * camera.scale <= size.width, `视口 ${size.width}：一列节点及其连线应装得下`);
  }
  // 603×480（需求单 §2.2 实测视口）：高度适配 (480-24)/570 = 0.8，高于可读下限
  const measured = flowDefaultCamera({ size: { width: 603, height: 480 }, layoutHeight: layout.height, shownWidth, anchor: null });
  assert.ok(Math.abs(measured.scale - 0.8) < 1e-9, `603×480 默认缩放应为 0.8，得到 ${measured.scale}`);
  // 初始 640×366：高度适配 0.6 低于下限，夹到 .78
  const initial = flowDefaultCamera({ size: { width: 640, height: 366 }, layoutHeight: layout.height, shownWidth, anchor: null });
  assert.equal(initial.scale, FLOW_LEGIBLE_SCALE.wide);
  assert.ok(FLOW_LEGIBLE_SCALE.wide * 13 >= 10 && FLOW_LEGIBLE_SCALE.narrow >= FLOW_LEGIBLE_SCALE.wide, "可读下限本身必须守住 10px，且窄屏不低于宽屏");
});

test("FLOW-G：默认相机对准锚点列并夹在已展示范围内；装得下时居中", () => {
  const layout = layoutExecutionFlow(NEW_PRODUCT_SHUFFLED);
  const size = { width: 603, height: 480 };
  const all = new Set(NEW_PRODUCT_SHUFFLED.map((n) => n.key));
  const shownWidth = shownWidthOf(layout, all);
  const at = (key: string) => { const p = layout.positions.find((item) => item.key === key)!; return { x: p.x + FLOW_GOAL.offset, y: p.y }; };
  // 运行到第 3 列（gtm 活动）：节点中心应落在视口内，且相邻列（opportunity / qa）有一部分可见
  const mid = flowDefaultCamera({ size, layoutHeight: layout.height, shownWidth, anchor: at("gtm") });
  const centerX = (key: string) => mid.x + (at(key).x + FLOW_NODE.width / 2) * mid.scale;
  assert.ok(Math.abs(centerX("gtm") - size.width / 2) < 1e-6, "锚点列应居中于视口");
  assert.ok(centerX("opportunity") > 0 && centerX("qa") < size.width, "相邻列的连线走向应可见");
  // 已结束：锚点 = 最后一步（synthesis，最右列）——夹到右边界，不露出画布外的空白
  const end = flowDefaultCamera({ size, layoutHeight: layout.height, shownWidth, anchor: at("synthesis") });
  assert.ok(Math.abs(end.x - (size.width - shownWidth * end.scale)) < 1e-6, "最右列锚点应夹到右边界");
  assert.ok(end.x + (at("synthesis").x + FLOW_NODE.width) * end.scale <= size.width + 1e-6, "最后一步应完整可见");
  // 拟定中：锚点 = 第一步（最左列）——居中第一列，工作目标卡仍完整可见（不露出画布左侧空白）
  const start = flowDefaultCamera({ size, layoutHeight: layout.height, shownWidth, anchor: at("market") });
  assert.ok(start.x <= 0, "不露出画布左侧空白");
  assert.ok(start.x + FLOW_NODE.padding * start.scale >= 0, "工作目标卡左缘应在视口内");
  assert.ok(Math.abs(start.x + (at("market").x + FLOW_NODE.width / 2) * start.scale - size.width / 2) < 1e-6, "第一列居中");
  // 运行中只展示到第 2 列：shownWidth 收窄，锚点在右缘则夹到已展示范围，不是整个世界
  const partial = new Set(["market", "compliance", "economics", "opportunity"]);
  const partialWidth = shownWidthOf(layout, partial);
  assert.ok(partialWidth < shownWidth);
  const running = flowDefaultCamera({ size, layoutHeight: layout.height, shownWidth: partialWidth, anchor: at("opportunity") });
  assert.ok(Math.abs(running.x - Math.min(0, size.width - partialWidth * running.scale)) < 1e-6 || running.x <= 0, "运行中夹在已展示范围内");
  // 高度装得下（570×0.8=456 ≤ 480）→ 垂直居中；单链 3 节点 → 水平也居中
  assert.ok(Math.abs(mid.y - (size.height - layout.height * mid.scale) / 2) < 1e-6);
  const chain = layoutExecutionFlow([NODE("x"), NODE("y", ["x"]), NODE("z", ["y"])]);
  const chainWidth = shownWidthOf(chain, new Set(["x", "y", "z"]));
  const small = flowDefaultCamera({ size: { width: 1400, height: 480 }, layoutHeight: chain.height, shownWidth: chainWidth, anchor: { x: FLOW_GOAL.offset + FLOW_NODE.padding, y: FLOW_NODE.padding } });
  assert.equal(small.scale, 1);
  assert.ok(Math.abs(small.x - (1400 - chainWidth) / 2) < 1e-6, "装得下时忽略锚点、整体居中");
});
