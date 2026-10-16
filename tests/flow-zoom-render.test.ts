import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { FLOW_LEGIBLE_SCALE } from "../src/app/muse/execution-flow";
import type { MissionNodeView, MissionStatusView } from "../src/app/muse/mission-timeline";

// ExecutionFlow import 了 execution-flow.css；本项目是 CJS 输出，tsx 把 CSS import
// 转成 require()，node 渲染探针用 require.extensions 把 .css 短路成空模块——
// 只取组件结构，不断言样式（样式由 css 守卫与浏览器实测负责）。
createRequire(import.meta.url).extensions[".css"] = () => {};

/**
 * T11 渲染侧证据（fixture 数据 + 真实 React 组件 server render）。
 *
 * 与源码守卫（flow-zoom-guard.test.ts）互补：守卫钉住「写了什么」，
 * 本测试证明「渲染出来确实如此」——9 节点真实拓扑 + 初始视口 640×366，
 * 默认相机必须夹到宽屏 fit 下限，缩小按钮在初始态可用。
 *
 * 边界声明：这是 fixture 驱动的静态渲染（无 ResizeObserver、无交互、
 * 无真实服务与数据库），不等于 muse 真实会话的运行态证据；
 * 运行中连线高亮、明暗与手机证据属 T15 复验范围。
 */

const NODE = (key: string, dependsOn: string[] = []): MissionNodeView => ({
  key,
  kind: "SPECIALIST",
  agentCode: "agent",
  status: "SUCCEEDED",
  attempts: 1,
  taskId: "t",
  dependsOn,
});

/** 与 kern-execution-flow.test.ts 同一 9 节点拓扑（c170170 事故同形态）。 */
const NINE_NODES: MissionNodeView[] = [
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

function status(nodes: MissionNodeView[]): MissionStatusView {
  return {
    missionTaskId: "m-fixture",
    status: "ACTIVE",
    goal: "做一台便携咖啡机的可行性研究",
    playbook: "new-product",
    progress: { done: nodes.length, total: nodes.length },
    revisionRounds: 0,
    tasksCreated: nodes.length,
    nodes,
    outcome: null,
    paused: null,
    userInputs: [],
  };
}

async function renderFlow(nodes: MissionNodeView[]) {
  const React = await import("react");
  // 组件经 tsx 经典 JSX 运行时编译（React.createElement），源码不 import React；
  // node 探针补全局 React（Next.js 在客户端自动注入，node 侧需手动）。
  (globalThis as Record<string, unknown>).React ??= React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ExecutionFlow } = await import("../src/app/muse/components/execution-flow");
  return renderToStaticMarkup(React.createElement(ExecutionFlow, { status: status(nodes) }));
}

test("T11-R1 真实渲染：9 节点图默认缩放夹到宽屏 fit 下限（≥78%）", async () => {
  const html = await renderFlow(NINE_NODES);
  const shown = html.match(/m-flow-scale">(\d+)%</);
  assert.ok(shown, "渲染结果应包含缩放读数");
  const pct = Number(shown[1]);
  assert.ok(pct >= Math.round(FLOW_LEGIBLE_SCALE.wide * 100), `默认缩放 ${pct}% 低于宽屏下限 ${Math.round(FLOW_LEGIBLE_SCALE.wide * 100)}%`);
});

test("T11-R2 真实渲染：缩小按钮存在且初始态可用（scale > .38）", async () => {
  const html = await renderFlow(NINE_NODES);
  assert.ok(html.includes('aria-label="缩小工作流"'), "缩小按钮应渲染");
  const disabled = html.match(/aria-label="缩小工作流"[^>]*disabled|<button[^>]*disabled[^>]*aria-label="缩小工作流"/);
  assert.ok(!disabled, "初始态 scale ≥ .78，缩小按钮不应被禁用");
  assert.ok(html.includes('aria-label="放大工作流"'), "放大按钮应渲染");
});

test("T11-R3 真实渲染：默认视图 9 个节点全部展示（无隐藏项）", async () => {
  const html = await renderFlow(NINE_NODES);
  const rendered = html.match(/class="m-flow-node"/g) ?? [];
  assert.equal(rendered.length, 9, `9 节点应全部渲染，实际 ${rendered.length}`);
  assert.ok(!html.includes("还有"), "已全部展示时不应出现「还有 N 项」隐藏提示");
});
