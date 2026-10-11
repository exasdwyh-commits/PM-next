import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildReportUrl, getReportBaseUrl } from "../src/shared/report-links";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("getReportBaseUrl 优先使用 KERN_PUBLIC_BASE_URL，并去掉末尾斜杠", () => {
  withEnv({ KERN_PUBLIC_BASE_URL: "https://kern.example.com///" }, () => {
    assert.equal(getReportBaseUrl(), "https://kern.example.com");
  });
});

test("getReportBaseUrl 未配置时回退到本地 PORT", () => {
  withEnv({ KERN_PUBLIC_BASE_URL: undefined, PORT: "3100" }, () => {
    assert.equal(getReportBaseUrl(), "http://localhost:3100");
  });
  withEnv({ KERN_PUBLIC_BASE_URL: undefined, PORT: "8080" }, () => {
    assert.equal(getReportBaseUrl(), "http://localhost:8080");
  });
});

test("getReportBaseUrl 生产环境未配置时直接抛错，不拼 localhost 坏链接", () => {
  withEnv({ KERN_PUBLIC_BASE_URL: undefined, PORT: "3100", NODE_ENV: "production" }, () => {
    assert.throws(() => getReportBaseUrl(), /KERN_PUBLIC_BASE_URL 未配置/);
  });
});

test("buildReportUrl 拼出 /reports/<id> 绝对链接并编码 id", () => {
  withEnv({ KERN_PUBLIC_BASE_URL: "http://localhost:3100" }, () => {
    assert.equal(
      buildReportUrl("abc-123"),
      "http://localhost:3100/reports/abc-123"
    );
    assert.equal(
      buildReportUrl("a/b?c"),
      "http://localhost:3100/reports/a%2Fb%3Fc"
    );
  });
});

// ---------------------------------------------------------------- 源码守卫
//
// 这一组锁住的是「2026-10-11 修掉的坑 A」，见 src/shared/report-links.ts 顶部说明：
// 该文件曾被 worker 等裸 Node/tsx 进程 import，一旦重新引入 `server-only`，
// `npm run worker` / 构建期脚本会在**启动阶段**就崩，且报错信息与报告功能毫无关系，
// 极难定位。运行时自检 + 静态守卫两层一起表达「只能在服务端用」这条约束。

const SRC = path.resolve(process.cwd(), "src");
const SKIP = new Set(["node_modules", ".next", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** 剥注释并等长替换为空格（保留行号） */
const stripComments = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/[^\n]*/gm, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));

const rel = (f: string) => path.relative(process.cwd(), f);

test("守卫 1：report-links.ts 必须保持零依赖（尤其不得重新引入 server-only）", () => {
  const file = path.join(SRC, "shared/report-links.ts");
  const text = stripComments(fs.readFileSync(file, "utf8"));
  const imports = [...text.matchAll(/^\s*import\s.+$/gm)].map((m) => m[0].trim());
  assert.deepEqual(
    imports,
    [],
    "report-links.ts 会被 worker / 构建期脚本（裸 Node，非 RSC）加载，任何 import 都是风险：\n" +
      "server-only 会让这些进程启动即崩（This module cannot be imported from a Client Component module）；\n" +
      "prisma/密钥类模块则会让纯函数变成有副作用的服务端依赖。\n" +
      `当前导入：\n${imports.join("\n")}`,
  );
});

test("守卫 2：没有任何 \"use client\" 模块 import report-links", () => {
  const files = walk(SRC).filter((f) => /\.tsx?$/.test(f));
  const clientFiles: string[] = [];
  const offenders: string[] = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    if (!/(^|\n)\s*["']use client["']/.test(text.slice(0, 2000))) continue;
    clientFiles.push(rel(f));
    const body = stripComments(text);
    if (/from\s+["'][^"']*report-links["']/.test(body)) offenders.push(rel(f));
  }
  // 取样下限：走到这一步说明 walk 正常、客户端组件确实扫到了
  assert.ok(
    clientFiles.length >= 20,
    `"use client" 模块取样过少（${clientFiles.length}），守卫可能已失效`,
  );
  assert.deepEqual(
    offenders,
    [],
    "report-links 读的是 KERN_PUBLIC_BASE_URL（服务端变量），客户端组件引入后只会拼出 localhost 坏链接：\n" +
      offenders.join("\n"),
  );
});

test("守卫 3：浏览器环境调用直接抛错，不把坏链接静默发给用户", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  assert.equal(g.window, undefined, "本用例假定运行在 Node 环境，前提不成立");
  g.window = {};
  try {
    assert.throws(() => getReportBaseUrl(), /只能在服务端使用/);
    assert.throws(() => buildReportUrl("abc-123"), /只能在服务端使用/);
  } finally {
    delete g.window;
  }
});
