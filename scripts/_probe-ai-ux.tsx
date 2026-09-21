/**
 * 一次性探针（下划线前缀，不提交）：验证 Thinking 的「状态透明」扩展。
 *  - 无 steps：输出必须与旧版逐字节一致（单行 inline-flex，role=status）。
 *  - 有 steps：步骤区必须在 live region **之外**（避免读屏反复播报整张表）。
 *  - 两次渲染逐字节一致（确定性），且不含任何百分比。
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Empty, Thinking } from "../src/components/ui";
import { ScoreBar } from "../src/components/viz";

(globalThis as any).React = React;

let bad = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "  ✔" : "  ❌"} ${msg}`);
  if (!cond) bad += 1;
};

const plain = renderToStaticMarkup(React.createElement(Thinking, { label: "QA 探针" }));
ok(plain.includes('role="status"') && plain.includes('aria-live="polite"'), "无 steps：保留 role=status + aria-live=polite");
// 渲染后的属性顺序由 React 决定，故按「同一标签内同时具备 class 与 aria-hidden」判定（与运行时 DOM 查询同口径）
const dotsTag = /<span[^>]*hermes-thinking-dots[^>]*>/.exec(plain)?.[0] ?? "";
ok(dotsTag.includes('aria-hidden="true"'), `无 steps：圆点容器 aria-hidden=true（实际 ${dotsTag}）`);
ok(!plain.includes("hermes-thinking-block"), "无 steps：不渲染步骤区（形态与旧版一致）");
ok(plain === renderToStaticMarkup(React.createElement(Thinking, { label: "QA 探针" })), "无 steps：两次渲染逐字节一致");

const withSteps = renderToStaticMarkup(
  React.createElement(Thinking, {
    label: "正在按确定性规则重跑分析…",
    hint: "本次执行的步骤（不调用模型）",
    steps: ["读取当前版本的方案字段", "校验证据的核实状态与真实 / 演示属性", "对六个维度打分并计算覆盖率"],
  }),
);
ok(withSteps.includes("hermes-thinking-block"), "有 steps：渲染 .hermes-thinking-block");
ok(withSteps.includes("hermes-thinking-steps-label") && withSteps.includes("本次执行的步骤"), "有 steps：渲染步骤区抬头");
ok((withSteps.match(/<li>/g) || []).length === 3, "有 steps：3 条步骤渲染为 3 个 <li>");
ok(!withSteps.includes("%"), "有 steps：不出现任何百分比（步骤 ≠ 进度）");
ok(!/已完成|done/.test(withSteps), "有 steps：不标注任何「已完成」状态");

// live region 边界：步骤区必须落在 role="status" 容器之外
const statusEnd = withSteps.indexOf("</div>", withSteps.indexOf('role="status"'));
const stepsAt = withSteps.indexOf("hermes-thinking-steps-label");
ok(statusEnd > -1 && stepsAt > statusEnd, "步骤区在 live region 之外（不被 aria-live 反复播报）");
ok(withSteps === renderToStaticMarkup(
  React.createElement(Thinking, {
    label: "正在按确定性规则重跑分析…",
    hint: "本次执行的步骤（不调用模型）",
    steps: ["读取当前版本的方案字段", "校验证据的核实状态与真实 / 演示属性", "对六个维度打分并计算覆盖率"],
  }),
), "有 steps：两次渲染逐字节一致");

// —— 移植自老版 cockpit-truth 的两件：Empty 三件套 / ScoreBar ——
const emptyLegacy = renderToStaticMarkup(React.createElement(Empty, null, "还没有分析结果。"));
ok(
  emptyLegacy === '<div class="hermes-empty">还没有分析结果。</div>',
  `Empty 只传 children 时形态与旧版逐字节一致（实际 ${emptyLegacy}）`,
);
const emptyFull = renderToStaticMarkup(
  React.createElement(Empty, { title: "还没有分析结果", action: React.createElement("button", null, "运行首次分析") }, "运行一次分析后，这里会列出六个维度。"),
);
ok(emptyFull.includes("hermes-empty-title") && emptyFull.includes("还没有分析结果"), "Empty 支持 title（说清为什么空）");
ok(emptyFull.includes("hermes-empty-action") && emptyFull.includes("运行首次分析"), "Empty 支持 action（给出下一步）");
ok(emptyFull.indexOf("hermes-empty-title") < emptyFull.indexOf("运行一次分析后") && emptyFull.indexOf("运行一次分析后") < emptyFull.indexOf("hermes-empty-action"), "三段顺序：标题 → 说明 → 动作");

const bar = renderToStaticMarkup(React.createElement(ScoreBar, { label: "单位经济性", value: 80, note: "权重 20%" }));
ok(bar.includes("viz-scorebar-track") && /width:80%/.test(bar), "ScoreBar 有值 → 画条到 80%");
ok(bar.includes(">80<") && !bar.includes("未知"), "ScoreBar 有值 → 显示真实分值，不写「未知」");
ok(bar.includes("权重 20%"), "ScoreBar 支持权重注脚");
ok(!/data-empty/.test(bar), "ScoreBar 有值 → 不带 data-empty");
const barNull = renderToStaticMarkup(React.createElement(ScoreBar, { label: "公司适配", value: null }));
ok(barNull.includes('data-empty="true"'), "ScoreBar 无值 → data-empty=true");
ok(barNull.includes("未知") && !barNull.includes(">0<"), "ScoreBar 无值 → 写「未知」，绝不显示 0 分");
ok(!/<i style/.test(barNull), "ScoreBar 无值 → 不渲染填充条（虚线空轨，不是 0% 条）");
ok(!barNull.includes("%"), "ScoreBar 无值 → 不出现任何百分比");
const barNaN = renderToStaticMarkup(React.createElement(ScoreBar, { label: "交付可行性", value: Number.NaN }));
ok(barNaN.includes("未知") && /data-empty="true"/.test(barNaN), "ScoreBar 收到 NaN → 同样按「未知」处理，不当成数值");
ok(renderToStaticMarkup(React.createElement(ScoreBar, { label: "x", value: 42 })) === renderToStaticMarkup(React.createElement(ScoreBar, { label: "x", value: 42 })), "ScoreBar 两次渲染逐字节一致");

console.log(bad === 0 ? "\n🏆 探针全部通过" : `\n❌ 探针失败 ${bad} 项`);
process.exitCode = bad === 0 ? 0 : 1;
