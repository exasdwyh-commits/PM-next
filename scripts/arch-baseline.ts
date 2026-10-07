/**
 * 重写 KX-70 两份守卫基线（只在「还掉一条违规」或「有意升 persona 版本」之后运行）：
 *   tests/fixtures/architecture-baseline.json   分层越界 import + app 直连 db
 *   tests/fixtures/prompt-prefix-baseline.json  提示词静态前缀哈希 + persona 版本
 *
 * 用法：npm run arch:baseline
 */
import fs from "node:fs";
import path from "node:path";
import { BASELINE_PATH, type Baseline, readBaseline, relPath, scan, writeBaseline } from "../tests/helpers/architecture-layers";
import { currentPrefixBaseline } from "../tests/helpers/prompt-prefix";

const result = scan();
let before: Baseline | null = null;
try {
  before = readBaseline();
} catch {
  before = null;
}
writeBaseline(result);
const prefixPath = path.join(process.cwd(), "tests", "fixtures", "prompt-prefix-baseline.json");
fs.writeFileSync(prefixPath, `${JSON.stringify(currentPrefixBaseline(), null, 2)}\n`, "utf8");

const delta = (a: number, b: number) => (a === b ? "不变" : a > b ? `新增 ${a - b}（请解释）` : `减少 ${b - a}`);
console.log(`${relPath(BASELINE_PATH)}：越界 ${result.violations.length} 条${before ? `，${delta(result.violations.length, before.layerViolations.length)}` : ""}；app 直连 db ${result.appDbFiles.length} 个${before ? `，${delta(result.appDbFiles.length, before.appDbFiles.length)}` : ""}`);
console.log(`${relPath(prefixPath)}：已重写`);
