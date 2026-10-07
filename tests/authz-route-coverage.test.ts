/**
 * 权限矩阵 · 路由覆盖守卫（2026-10-04）
 * ================================================
 * 目的：让 `tests/authz-matrix.ts` 里声明的那条硬规则**真正被执行**——
 *
 *   「新增路由未登记即判失败」：扫描 src/app/api/**\/route.ts 的实际导出方法，
 *   与 AUTHZ_MATRIX 逐项比对；有路由/方法没登记，或表里有已不存在的路由，一律失败。
 *
 * 为什么需要这个文件
 * ------------------
 * `tests/authz-matrix.ts` 有 129 条按方法登记的权限预期（覆盖 93 条路由），
 * 文档开头就写明上面那条硬规则——但它**没有任何运行器**：没有 main、没有
 * process.argv、不被任何 npm test:* 脚本或 CI workflow 引用。
 * 换句话说，一份看起来在守权限边界的表，实际从未被执行过。
 * 本文件是纯静态分析（不连数据库、不发 HTTP），因此可以挂进已接线的
 * `test:source-guards`，成本与那些纯函数单测同级。
 *
 * 本守卫**不重复** HTTP 层的鉴权断言
 * ----------------------------------
 * 「哪个身份拿到什么状态码」由 tests/acceptance-authz-matrix.test.ts 通过真实
 * HTTP 负责（它用 BASELINE_ROUTES 基线计数法）。本守卫只回答一个不同的问题：
 * **表有没有跟上代码**。两者互补：前者守行为，后者守覆盖面。
 *
 * 已知边界（如实记录）
 * --------------------
 * 1. 只校验「路径 + 方法」的登记完整性，不校验 `expect` 里的状态码是否正确
 *    ——那需要真实载荷发 HTTP，超出静态分析范围。
 * 2. `src/app/api/health` 这类公开端点也在表内（期望 anon: [200]），
 *    本守卫不区分「应当公开」与「应当鉴权」，那是表作者的责任。
 * 3. 动态段统一归一化为 `{seg}`，因此 `/api/x/{id}` 与 `/api/x/{other}`
 *    视为同一路径；若将来出现同形不同名且鉴权语义不同的动态段，需要在此登记例外。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AUTHZ_MATRIX } from "./authz-matrix";

const SRC = path.resolve(process.cwd(), "src");
const API = path.join(SRC, "app", "api");
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** `/api/projects/[id]/route.ts` → `/api/projects/{id}` */
function routePathOf(file: string): string {
  const rel = path.relative(API, file).replace(/\\/g, "/");
  const trimmed = rel.replace(/\/?route\.ts$/, "").replace(/\[([^\]]+)\]/g, "{$1}");
  // API 目录本身是相对起点，所以要补回 /api 前缀（否则得到 /auth/session 而不是 /api/auth/session）
  return "/api/" + trimmed.replace(/^\/+/, "");
}

function exportedMethods(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const found = new Set<string>();
  for (const m of HTTP_METHODS) {
    // 只认「导出函数」这一种形式；`export const GET = ...` 同样算。
    const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let)\\s+${m}\\b`);
    if (re.test(text)) found.add(m);
  }
  return [...found];
}

interface Actual { path: string; method: string }

function collectActual(): Actual[] {
  if (!fs.existsSync(API)) return [];
  const out: Actual[] = [];
  for (const file of walk(API)) {
    if (path.basename(file) !== "route.ts") continue;
    const p = routePathOf(file);
    for (const method of exportedMethods(file)) out.push({ path: p, method });
  }
  return out;
}

const actual = collectActual();
const declared = AUTHZ_MATRIX.map((r) => ({ path: r.path, method: r.method }));
const key = (r: Actual) => `${r.method} ${r.path}`;

test("AC1：每条实际路由的每个导出方法都已在权限矩阵登记", () => {
  const declaredKeys = new Set(declared.map(key));
  const missing = actual.filter((r) => !declaredKeys.has(key(r))).map(key).sort();
  assert.deepEqual(
    missing,
    [],
    `新增路由未登记即判失败。以下 method 未出现在 tests/authz-matrix.ts：\n  ${missing.join("\n  ") || "无"}\n` +
      `实际路由方法数 ${actual.length} / 已登记 ${declared.length}。`,
  );
});

test("AC2：矩阵里没有已不存在的路由（防止改名后残留幽灵条目）", () => {
  const actualKeys = new Set(actual.map(key));
  const ghosts = declared.filter((r) => !actualKeys.has(key(r))).map(key).sort();
  assert.deepEqual(
    ghosts,
    [],
    `矩阵里这些 method 在代码中已找不到对应导出（路由可能已改名或删除）：\n  ${ghosts.join("\n  ") || "无"}`,
  );
});

test("AC3：矩阵自身无重复登记", () => {
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const r of declared) {
    const k = key(r);
    if (seen.has(k)) dup.push(k);
    seen.add(k);
  }
  assert.deepEqual([...new Set(dup)].sort(), [], `矩阵存在重复登记：${[...new Set(dup)].join(", ")}`);
});

/**
 * AC4：未登录身份（anon）不得得到 2xx，除非该端点被显式论证为公开。
 *
 * 2026-10-04 修正：初版拿 `UNAUTHORIZED = [anon, foreign, outsider]` 三类一起查，
 * 结果 39 条全部误报。查证后确认是**判定写错、表本身没错**：
 * foreign / outsider 是**自己组织的合法成员**，在自己组织的数据上拿 2xx 是正确行为；
 * 跨租户隔离不是靠状态码证明的，而是靠 `crossTenant: true` 配合响应体内不含
 * 他组织夹具标记（见 authz-matrix.ts 头注与 CROSS_TENANT_MARKER）。
 * 真正「未授权」的身份只有 anon。
 *
 * 公开端点白名单只收两条，且都必须带论证（下方 PUBLIC_ANON_2XX 的注释即论证）：
 * 新增任何一条都要在这里写清为什么它不构成越权面。
 */
const PUBLIC_ANON_2XX = new Set(["DELETE /api/auth/session", "GET /api/health"]);
test("AC4：未登录身份（anon）不得得到 2xx，公开端点须在论证白名单内", () => {
  const violations = AUTHZ_MATRIX.filter((r) => {
    const codes = (r.expect as Record<string, number[] | string>).anon;
    if (!Array.isArray(codes) || !codes.some((c) => c < 300)) return false;
    return !PUBLIC_ANON_2XX.has(key(r));
  }).map((r) => `${key(r)} expect.anon=${JSON.stringify((r.expect as any).anon)}`);
  assert.deepEqual(
    violations,
    [],
    `未登录身份被期望拿到 2xx，但该端点不在公开白名单内：\n  ${violations.join("\n  ")}`,
  );
  // 反向：白名单里的端点必须确实声明了 anon 2xx，避免白名单腐化
  const stale = [...PUBLIC_ANON_2XX].filter((k) => {
    const row = AUTHZ_MATRIX.find((r) => key(r) === k);
    const codes = row && ((row.expect as Record<string, number[] | string>).anon);
    return !Array.isArray(codes) || !codes.some((c) => c < 300);
  });
  assert.deepEqual(stale, [], `公开白名单里的端点已不再期望 anon 2xx（白名单腐化）：${stale.join(", ")}`);
});

test("AC5：每条登记都覆盖 anon/foreign/outsider/viewer 四类身份（owner 走 ownerGate）", () => {
  // owner 是**项目级**角色，表里用独立的 ownerGate 字段表达其预期，
  // 不出现在 expect 内——130/130 条都有 ownerGate，这里一并断言，避免该字段被悄悄删掉。
  const REQUIRED = ["anon", "foreign", "outsider", "viewer"] as const;
  const gaps: string[] = [];
  const missingOwnerGate: string[] = [];
  for (const r of AUTHZ_MATRIX) {
    const expect = r.expect as Record<string, unknown>;
    const missingIds = REQUIRED.filter((id) => !(id in expect));
    if (missingIds.length) gaps.push(`${key(r)} 缺 ${missingIds.join("/")}`);
    if (r.ownerGate === undefined) missingOwnerGate.push(key(r));
  }
  assert.deepEqual(gaps, [], `以下登记未覆盖全部四类身份：\n  ${gaps.join("\n  ")}`);
  assert.deepEqual(
    missingOwnerGate,
    [],
    `以下登记缺 ownerGate（owner 身份的预期无处表达）：\n  ${missingOwnerGate.join("\n  ")}`,
  );
});