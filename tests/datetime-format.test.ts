/**
 * 时间显示口径回归锁（无 DB 依赖）
 *
 * 盯住三类曾经真实发生的缺陷：
 *   1. **hydration 失败**：不传 locale 的 `toLocaleTimeString()` 在 Node（en-US）与浏览器（zh-CN）
 *      输出不同文本，React 会重建整棵子树。/projects/[id] 曾因此报错。
 *   2. **时区静默偏移**：不传 timeZone 时用运行时本地时区，服务端 UTC + 用户 Asia/Shanghai = 差 8 小时。
 *   3. **格式不统一**：同一系统内 `2026-09-16 22:12` 与 `2026/9/17 00:25:15` 并存。
 *
 * 证据强度：不满足于「同一进程里输出一样」——那证明不了跨环境一致。
 * 本测试**另起两个子进程**，分别以 TZ=UTC 与 TZ=America/New_York 运行同一段格式化代码，
 * 断言输出逐字相同。这是 hydration 失败与线上时区偏移能成立的**充分必要条件**。
 *
 * 运行：tsx tests/datetime-format.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fmtDate, fmtTime, fmtDateTime, fmtDateTimeFull, isValidDate } from "../src/shared/datetime";

/** 2026-09-16 00:45:18Z = 北京时间 08:45:18（跨日验证：UTC 还是 16 日 00:45，北京已是 08:45 同日） */
const INSTANT = new Date("2026-09-16T00:45:18Z");

test("格式化：固定时刻在业务时区下输出逐字确定的文本", () => {
  assert.equal(fmtDate(INSTANT), "2026-09-16");
  assert.equal(fmtTime(INSTANT), "08:45:18");
  assert.equal(fmtDateTime(INSTANT), "2026-09-16 08:45");
  assert.equal(fmtDateTimeFull(INSTANT), "2026-09-16 08:45:18");
});

test("跨日与跨年：北京时间按 Asia/Shanghai 归属日期，而非 UTC", () => {
  // UTC 09-15 23:30 → 北京 09-16 07:30，日期必须落在 16 日
  assert.equal(fmtDate(new Date("2026-09-15T23:30:00Z")), "2026-09-16");
  // UTC 12-31 16:30 → 北京次年 01-01 00:30
  assert.equal(fmtDateTime(new Date("2026-12-31T16:30:00Z")), "2027-01-01 00:30");
  // 午夜必须是 00:xx，不能出现 24:xx
  assert.equal(fmtTime(new Date("2026-09-15T16:00:00Z")), "00:00:00");
});

test("接受 string / number / Date，非法值给占位符而不是 Invalid Date", () => {
  assert.equal(fmtDate("2026-09-16T00:45:18Z"), "2026-09-16");
  assert.equal(fmtDate(INSTANT.getTime()), "2026-09-16");
  assert.equal(fmtDate(null), "—");
  assert.equal(fmtDate(undefined), "—");
  assert.equal(fmtDate(""), "—");
  assert.equal(fmtDate("not-a-date"), "—");
  // 调用方可覆盖占位文案
  assert.equal(fmtDate(null, "未设置"), "未设置");
  assert.equal(isValidDate("not-a-date"), false);
  assert.equal(isValidDate(INSTANT), true);
});

test("跨环境一致性：TZ=UTC 与 TZ=America/New_York 两个子进程输出逐字相同", () => {
  const moduleUrl = pathToFileURL(path.resolve(process.cwd(), "src/shared/datetime.ts")).href;
  const snippet = `
    import { fmtDate, fmtTime, fmtDateTime, fmtDateTimeFull } from ${JSON.stringify(moduleUrl)};
    const d = new Date("2026-09-16T00:45:18Z");
    process.stdout.write([fmtDate(d), fmtTime(d), fmtDateTime(d), fmtDateTimeFull(d)].join("|"));
  `;

  const run = (tz: string) =>
    execFileSync(path.resolve(process.cwd(), "node_modules/.bin/tsx"), ["-e", snippet], {
      env: { ...process.env, TZ: tz, NODE_OPTIONS: "" },
      encoding: "utf8",
      cwd: process.cwd(),
    }).trim();

  const utcOut = run("UTC");
  const nyOut = run("America/New_York");
  const shOut = run("Asia/Shanghai");

  assert.equal(utcOut, "2026-09-16|08:45:18|2026-09-16 08:45|2026-09-16 08:45:18", `TZ=UTC 输出应固定业务时区，实际 ${utcOut}`);
  assert.equal(nyOut, utcOut, `TZ=America/New_York 应与 UTC 逐字相同，实际 ${nyOut}`);
  assert.equal(shOut, utcOut, `TZ=Asia/Shanghai 应与 UTC 逐字相同，实际 ${shOut}`);
});

test("反证：宿主的 toLocale* 天真用法确实会随 TZ/locale 漂移（这正是本模块要消灭的缺陷类）", () => {
  const moduleUrl = pathToFileURL(path.resolve(process.cwd(), "src/shared/datetime.ts")).href;
  const snippet = `
    import { fmtDateTime } from ${JSON.stringify(moduleUrl)};
    const d = new Date("2026-09-16T00:45:18Z");
    process.stdout.write([d.toLocaleString(), d.toLocaleTimeString(), fmtDateTime(d)].join("~"));
  `;
  const run = (tz: string) =>
    execFileSync(path.resolve(process.cwd(), "node_modules/.bin/tsx"), ["-e", snippet], {
      env: { ...process.env, TZ: tz, NODE_OPTIONS: "" },
      encoding: "utf8",
      cwd: process.cwd(),
    }).trim();

  const [utcNaive, , utcOurs] = run("UTC").split("~");
  const [nyNaive, , nyOurs] = run("America/New_York").split("~");

  // 天真用法：两个时区得到不同文本（线上 8 小时偏移的成因）
  assert.notEqual(utcNaive, nyNaive, "toLocaleString 在 UTC 与纽约时区应产生不同文本（证明缺陷类是真实的）");
  // 本模块：与机器时区无关
  assert.equal(utcOurs, nyOurs, "本模块输出不应随机器时区变化");
  assert.equal(utcOurs, "2026-09-16 08:45");
});

test("源码守卫：禁止未固定 timeZone 的日期 toLocale*（防 hydration 失败复发）", () => {
  const SRC = path.resolve(process.cwd(), "src");
  const skipDirs = new Set(["node_modules", ".next", ".next-verify", ".git"]);

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(SRC);

  /**
   * 剥掉注释再扫，且**等长替换为空格**以保留行号。
   * 不剥注释会误报文档示例（本模块 JSDoc 里就引用过反例）；行号错位则不好定位。
   * `//` 只在行首或前面是空白时才当注释，避免误伤 `https://` 这类字符串。
   */
  const stripComments = (t: string) =>
    t
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/(^|\s)\/\/[^\n]*/gm, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));

  const offenses: string[] = [];
  // toLocaleDateString / toLocaleTimeString 的接收者只可能是日期
  const receiverIsDate = /\.\s*toLocale(?:Date|Time)String\([^)]*\)/g;
  // toLocaleString 只有传出语言标签时才是日期（数字金额通常不传参，如 budgetAmount?.toLocaleString()）
  const withLocaleTag = /\.\s*toLocaleString\(\s*["'][a-zA-Z-]+["'][^)]*\)/g;

  for (const file of files) {
    const text = stripComments(fs.readFileSync(file, "utf8"));
    for (const re of [receiverIsDate, withLocaleTag]) {
      for (const m of text.matchAll(re)) {
        if (/timeZone\s*:/.test(m[0])) continue; // 已显式固定时区，放行
        const line = text.slice(0, m.index ?? 0).split("\n").length;
        offenses.push(`${path.relative(process.cwd(), file)}:${line} → ${m[0].slice(0, 90)}`);
      }
    }
  }

  assert.deepEqual(
    offenses,
    [],
    `以下位置使用了未固定 timeZone 的日期 toLocale*，请改用 src/shared/datetime.ts：\n${offenses.join("\n")}`,
  );
});
