import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * 角色视图提示框四档配方守卫（T12 / B-3）。
 *
 * 声明（response-role.css 文件内注释，W3 提交 92d5f38 同款）：
 *   提示框（info / ok / warn / block）四档同一配方：10px 圆角、1px 同色系细边、
 *   3px 左色条、同色系浅底；档位只换 --info/--ok/--warn/--block 这一组色。
 *
 * 事故：.rb-failed（block 档失败态）实现写了 12px，与声明不一致——用户看到
 * 失败态圆角和其余三档提示框不一样。本守卫钉住家族一致性，并防再次漂移。
 *
 * 不在守卫范围（故意）：.rb-dec-lead（决策卡，16/12/8/4 节奏，非提示框家族）、
 * .rb-ask（提问卡 14px）、.rb-response 外卡 18px——它们本就不是四档配方成员。
 */

const CSS = path.join(process.cwd(), "src/app/muse/response/response-role.css");

/** 四档提示框家族成员（与文件中 border-left 家族规则同一组选择器）。 */
const FAMILY = [".rb-call", ".rb-call-lead", ".rb-sales-callout", ".rb-failed"] as const;
const RECIPE_RADIUS = 10;

function radiusOf(css: string, selector: string): number | null {
  const rule = css.match(new RegExp(`(?:^|\\n)\\${selector}\\s*\\{([^}]*)\\}`));
  if (!rule) return null;
  const radius = rule[1].match(/border-radius:\s*(\d+)px/);
  return radius ? Number(radius[1]) : null;
}

/** 返回全部违规描述（空数组 = 守约）。 */
export function calloutRadiusViolations(css: string): string[] {
  const problems: string[] = [];
  for (const member of FAMILY) {
    const radius = radiusOf(css, member);
    if (radius === null) {
      problems.push(`${member} 规则缺失或未声明 border-radius（四档配方要求 ${RECIPE_RADIUS}px）`);
    } else if (radius !== RECIPE_RADIUS) {
      problems.push(`${member} 圆角 ${radius}px ≠ 四档配方 ${RECIPE_RADIUS}px`);
    }
  }
  return problems;
}

test("T12-1 四档提示框圆角一致（.rb-call / .rb-call-lead / .rb-sales-callout / .rb-failed 均 10px）", () => {
  const problems = calloutRadiusViolations(fs.readFileSync(CSS, "utf8"));
  assert.deepEqual(problems, [], `提示框四档配方违规：\n${problems.join("\n")}`);
});

test("T12-2 变异自检：.rb-failed 回到 12px 必须报违规", () => {
  const css = fs.readFileSync(CSS, "utf8");
  const mutated = css.replace(
    /(\.rb-failed\s*\{[^}]*?)border-radius:\s*10px/,
    "$1border-radius: 12px",
  );
  assert.notEqual(mutated, css, "变异注入应命中 .rb-failed 的圆角行");
  const problems = calloutRadiusViolations(mutated);
  assert.ok(problems.some(p => p.includes(".rb-failed")), "12px 回退必须被捕获");
});

test("T12-3 变异自检：其余三档任一处漂移必须报违规", () => {
  const css = fs.readFileSync(CSS, "utf8");
  const mutated = css.replace(
    /(\.rb-call-lead\s*\{[^}]*?)border-radius:\s*10px/,
    "$1border-radius: 12px",
  );
  assert.notEqual(mutated, css, "变异注入应命中 .rb-call-lead 的圆角行");
  const problems = calloutRadiusViolations(mutated);
  assert.ok(problems.some(p => p.includes(".rb-call-lead")), "任档位漂移必须被捕获");
});
