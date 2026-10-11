/**
 * 凭证脱敏守卫（仓库为公开仓库）：
 * `scripts/` 与 `src/` 的执行代码里不得写死任何真实凭证
 * （口令 / API Key / Secret / Token）。这类值一旦进入版本库即等于公开。
 *
 * 判定口径：键名像凭证，且右侧是长度 ≥6 的**字符串字面量**。
 * 显式豁免「一眼是占位/假值」的写法（test / example / placeholder / <...> 等），
 * 以免误伤测试夹具；但绝不豁免「看起来能登录/能调用」的真实值。
 *
 * 历史教训：`scripts/verify-login-ui.mjs` 曾写死 `password = "hermes1234"`，
 * `scripts/reset-seed-passwords.mjs` 曾以 `?? "Hermes#2026"` 兜底 ——
 * 两者都被推到公开仓库，只能靠轮换收场。本守卫防止复发。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SCAN_DIRS = ["scripts", "src"];
const EXT = /\.(ts|tsx|js|mjs|cjs)$/;

// 键名像凭证 + 右侧为字符串字面量（长度 ≥ 6）
const PATTERN =
  /\b(password|passwd|pwd|secret|api[_-]?key|apiKey|apikey|access[_-]?token|accessToken|auth[_-]?token|authToken|bearer|token)\b\s*[:=]\s*(["'])([^"'\n]{6,})\2/gi;

// 一眼是占位/假值 —— 命中即放行
const ALLOW =
  /(test|example|placeholder|your[_-]?|changeme|dummy|sample|fixture|sk-test|sk-unit|xxx|<|\$\{|process\.env|wrong[_-]?password|redacted|\*\*\*|\.test"|@hermes\.test)/i;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === "fixtures") continue;
      walk(p, out);
    } else if (EXT.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

test("scripts/ 与 src/ 不写死真实凭证（公开仓库脱敏红线）", () => {
  const hits: string[] = [];
  for (const d of SCAN_DIRS) {
    for (const f of walk(path.join(process.cwd(), d))) {
      const rel = path.relative(process.cwd(), f).split(path.sep).join("/");
      const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        PATTERN.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = PATTERN.exec(line)) !== null) {
          const value = m[3];
          if (ALLOW.test(value) || ALLOW.test(m[0])) continue;
          hits.push(`${rel}:${i + 1} 键=${m[1]} 值=[已脱敏，长度 ${value.length}]`);
        }
      });
    }
  }
  assert.deepEqual(
    hits,
    [],
    `发现疑似写死的真实凭证 ${hits.length} 处（公开仓库不得出现）：\n${hits.join("\n")}\n` +
      `如确为占位值，请改用 process.env 读取或在注释中显式标注示例。`
  );
});
