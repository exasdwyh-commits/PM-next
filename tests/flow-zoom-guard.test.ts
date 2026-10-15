import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * 流程图缩放可读性契约守卫（T11 / B-2）。
 *
 * 事故背景：c170170（V3 海报链）把三处下限一起降到 .05——9 节点图默认被压到
 * 0.33、标题 4.3px，没有任何断言拦住它。本守卫把「可读性契约」钉在源码上，
 * 各下限独立断言、不统一成一个数：
 *
 *   1. 自动 fit 宽/窄屏分档下限（src/app/muse/execution-flow.ts 的 FLOW_LEGIBLE_SCALE）：
 *      宽屏 ≥ .78、窄屏 ≥ .86、窄屏不低于宽屏；且宽屏下限 × 标题字号 ≥ 10px 可读线。
 *      fit 管「默认视图一打开就可读」，与手动缩小语义不同。
 *   2. 手动 zoom() 的绝对下限（execution-flow.tsx 的 Math.max(floor, camera.scale * factor)）≥ .38。
 *   3. 缩小按钮停用阈值（disabled={camera.scale <= threshold}）≥ .38。
 *      .38 是「用户主动缩小」的绝对下限，不适用 10px 可读线，但绝不允许回到 .05。
 *   4. 「定位当前步骤」focus 下限 ≥ 宽屏 fit 下限（当前实现 .86）。
 *
 * 变异自检：注入旧值 .05 必须报违规；把三处统一成 .38 必须报 fit 违规。
 * 没有变异自检的守卫等于没有守卫——只绿不红的断言拦不住下一次事故。
 *
 * 环境变量 KERN_FLOW_SRC_TSX / KERN_FLOW_SRC_LIB 可指向副本（供变异复跑），
 * 不设置时读产品源码。
 */

const ROOT = process.cwd();
const TSX_PATH = process.env.KERN_FLOW_SRC_TSX ?? path.join(ROOT, "src/app/muse/components/execution-flow.tsx");
const LIB_PATH = process.env.KERN_FLOW_SRC_LIB ?? path.join(ROOT, "src/app/muse/execution-flow.ts");

/** 契约下限。zoom/button 的 .38 与 fit 的 .78/.86 是两套语义，故意不是同一个数。 */
export const FLOW_FLOORS = {
  zoom: 0.38,
  button: 0.38,
  fitWide: 0.78,
  fitNarrow: 0.86,
  focus: 0.78,
  titlePx: 13,
  readablePx: 10,
} as const;

const read = (file: string) => fs.readFileSync(file, "utf8");

/** 从两份源码中提取三处下限并逐项核对，返回全部违规描述（空数组 = 守约）。 */
export function flowGuardViolations(input: { tsx: string; lib: string }): string[] {
  const problems: string[] = [];
  const floors = FLOW_FLOORS;

  // 1. fit 宽/窄屏分档下限
  const scale = input.lib.match(/FLOW_LEGIBLE_SCALE\s*=\s*\{\s*wide:\s*([0-9.]+)\s*,\s*narrow:\s*([0-9.]+)\s*,\s*narrowBelow:\s*(\d+)\s*\}/);
  if (!scale) {
    problems.push("execution-flow.ts：FLOW_LEGIBLE_SCALE 声明缺失或形状被改（wide/narrow/narrowBelow 三字段）");
  } else {
    const wide = Number(scale[1]);
    const narrow = Number(scale[2]);
    if (wide < floors.fitWide) problems.push(`fit 宽屏下限 ${wide} < ${floors.fitWide}：默认视图标题 ${(wide * floors.titlePx).toFixed(1)}px 跌破可读线`);
    if (narrow < floors.fitNarrow) problems.push(`fit 窄屏下限 ${narrow} < ${floors.fitNarrow}`);
    if (narrow < wide) problems.push(`fit 窄屏下限 ${narrow} 低于宽屏下限 ${wide}：窄屏更挤，不能比宽屏还小`);
    if (wide * floors.titlePx < floors.readablePx) problems.push(`fit 宽屏下限 × 标题 ${floors.titlePx}px = ${(wide * floors.titlePx).toFixed(2)}px < ${floors.readablePx}px 可读线`);
    if (!/size\.width < FLOW_LEGIBLE_SCALE\.narrowBelow \? FLOW_LEGIBLE_SCALE\.narrow : FLOW_LEGIBLE_SCALE\.wide/.test(input.lib)) {
      problems.push("execution-flow.ts：fit 未按 narrowBelow 做宽/窄屏分档（分支表达式缺失或被改写）");
    }
  }

  // 2. 手动 zoom() 绝对下限
  const zoom = input.tsx.match(/Math\.max\(([0-9.]+),\s*camera\.scale \* factor\)/);
  if (!zoom) {
    problems.push("execution-flow.tsx：zoom() 的 Math.max(floor, camera.scale * factor) 下限缺失或表达式被改写");
  } else if (Number(zoom[1]) < floors.zoom) {
    problems.push(`手动 zoom 下限 ${zoom[1]} < ${floors.zoom}：允许缩到标题不可读（c170170 事故值 .05 同类）`);
  }

  // 3. 缩小按钮停用阈值
  const button = input.tsx.match(/disabled=\{camera\.scale <= ([0-9.]+)\}/);
  if (!button) {
    problems.push("execution-flow.tsx：缩小按钮 disabled={camera.scale <= threshold} 缺失或表达式被改写");
  } else if (Number(button[1]) < floors.button) {
    problems.push(`缩小按钮阈值 ${button[1]} < ${floors.button}：按钮不失效，用户可一路缩到 .05`);
  }

  // 4. focus（定位当前步骤）下限不低于宽屏 fit 下限
  const focusClamps = [...input.tsx.matchAll(/Math\.max\(([0-9.]+),\s*camera\.scale\)/g)].map(m => Number(m[1]));
  if (!focusClamps.length) {
    problems.push("execution-flow.tsx：focusCurrent 的 Math.max(floor, camera.scale) 下限缺失");
  } else {
    for (const floor of focusClamps) {
      if (floor < floors.focus) problems.push(`focus 下限 ${floor} < ${floors.focus}（宽屏 fit 下限）：定位当前步骤会把视图压到默认可读线以下`);
    }
  }

  return problems;
}

test("T11-1 产品源码三处下限守约（fit 宽/窄屏、手动 zoom、缩小按钮、focus）", () => {
  const problems = flowGuardViolations({ tsx: read(TSX_PATH), lib: read(LIB_PATH) });
  assert.deepEqual(problems, [], `流程图缩放契约违规：\n${problems.join("\n")}`);
});

test("T11-2 契约数值本身自洽：.38 与 .78/.86 是两套语义，且窄屏不低于宽屏", () => {
  assert.ok(FLOW_FLOORS.zoom < FLOW_FLOORS.fitWide, "手动缩小下限必须低于默认 fit 下限，否则用户无法缩小看全景");
  assert.ok(FLOW_FLOORS.fitNarrow >= FLOW_FLOORS.fitWide, "窄屏 fit 下限不得低于宽屏");
  assert.ok(FLOW_FLOORS.fitWide * FLOW_FLOORS.titlePx >= FLOW_FLOORS.readablePx, "宽屏 fit 下限必须满足 10px 可读线");
});

test("T11-3 变异自检：注入旧值 .05 必须报违规（红）", () => {
  const mutatedTsx = read(TSX_PATH)
    .replace(/Math\.max\(\.38,/g, "Math.max(.05,")
    .replace(/<= \.38/g, "<= .05");
  const mutatedLib = read(LIB_PATH)
    .replace(/wide: \.78/g, "wide: .05")
    .replace(/narrow: \.86/g, "narrow: .05");
  const problems = flowGuardViolations({ tsx: mutatedTsx, lib: mutatedLib });
  assert.ok(problems.length >= 3, `注入 .05 后应至少报 3 处违规，实际 ${problems.length} 处：${JSON.stringify(problems)}`);
  assert.ok(problems.some(p => p.includes("zoom")), "应捕获手动 zoom 下限被降到 .05");
  assert.ok(problems.some(p => p.includes("按钮")), "应捕获缩小按钮阈值被降到 .05");
  assert.ok(problems.some(p => p.includes("fit")), "应捕获 fit 下限被降到 .05");
});

test("T11-4 变异自检：把三处统一成 .38 必须报 fit 违规（防止抹平语义）", () => {
  const mutatedLib = read(LIB_PATH)
    .replace(/wide: \.78/g, "wide: .38")
    .replace(/narrow: \.86/g, "narrow: .38");
  const problems = flowGuardViolations({ tsx: read(TSX_PATH), lib: mutatedLib });
  assert.ok(problems.some(p => p.includes("fit 宽屏下限")), "统一成 .38 后 fit 宽屏下限必须报违规");
  assert.ok(problems.some(p => p.includes("窄屏")), "统一成 .38 后窄屏下限必须报违规");
});

test("T11-5 变异自检：抹掉宽/窄屏分档分支必须报违规", () => {
  const mutatedLib = read(LIB_PATH)
    .replace(/size\.width < FLOW_LEGIBLE_SCALE\.narrowBelow \? FLOW_LEGIBLE_SCALE\.narrow : FLOW_LEGIBLE_SCALE\.wide/g, "FLOW_LEGIBLE_SCALE.wide");
  const problems = flowGuardViolations({ tsx: read(TSX_PATH), lib: mutatedLib });
  assert.ok(problems.some(p => p.includes("分档")), "分档分支被抹掉必须报违规");
});
