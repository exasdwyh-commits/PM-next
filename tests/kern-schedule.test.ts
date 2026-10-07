/** KX-34 定时：cron 解析 / 时区下一次触发 / 简报内容（纯函数）。 */
import assert from "node:assert/strict";
import test from "node:test";
import { describeCron, isValidTimezone, nextCronRun, parseCron } from "../src/modules/schedule/cron";
import { composeDailyDigest } from "../src/modules/schedule/digest";

test("parseCron 基本语法与错误", () => {
  const c = parseCron("*/15 9-18 * * 1-5");
  assert.deepEqual([...c.minute], [0, 15, 30, 45]);
  assert.equal(c.hour.size, 10);
  assert.ok(parseCron("0 9 * * 7").dow.has(0), "7 也是周日");
  assert.throws(() => parseCron("0 9 * *"), /5 段/);
  assert.throws(() => parseCron("60 9 * * *"), /超出范围/);
  assert.throws(() => parseCron("a 9 * * *"), /无法识别/);
});

test("nextCronRun 按上海时区计算", () => {
  // 2026-09-28 00:30Z = 上海 08:30 → 下一个 09:00 上海 = 01:00Z
  assert.equal(nextCronRun("0 9 * * *", new Date("2026-09-28T00:30:00Z"), "Asia/Shanghai")?.toISOString(), "2026-09-28T01:00:00.000Z");
  // 正好 09:00 时，严格晚于 → 次日
  assert.equal(nextCronRun("0 9 * * *", new Date("2026-09-28T01:00:00Z"), "Asia/Shanghai")?.toISOString(), "2026-09-29T01:00:00.000Z");
  // 2026-10-02 是周五 → 工作日 9 点的下一次是周一 10-05
  assert.equal(nextCronRun("0 9 * * 1-5", new Date("2026-10-02T02:00:00Z"), "Asia/Shanghai")?.toISOString(), "2026-10-05T01:00:00.000Z");
  // 东京时区
  assert.equal(nextCronRun("30 7 * * *", new Date("2026-09-28T00:00:00Z"), "Asia/Tokyo")?.toISOString(), "2026-09-28T22:30:00.000Z");
  // 日与周都受限时取「或」
  const r = nextCronRun("0 0 1 * 1", new Date("2026-09-28T12:00:00Z"), "UTC");
  assert.equal(r?.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(nextCronRun("0 0 30 2 *", new Date("2026-01-01T00:00:00Z"), "UTC"), null, "2 月 30 日永不触发");
});

test("nextCronRun 跨夏令时（纽约）仍落在当地 9 点", () => {
  const a = nextCronRun("0 9 * * *", new Date("2026-11-01T00:00:00Z"), "America/New_York")!;
  const b = nextCronRun("0 9 * * *", a, "America/New_York")!;
  assert.equal(a.toISOString(), "2026-11-01T14:00:00.000Z");
  assert.equal(b.toISOString(), "2026-11-02T14:00:00.000Z");
});

test("describeCron / isValidTimezone", () => {
  assert.equal(describeCron("0 9 * * *"), "每天 09:00");
  assert.equal(describeCron("30 8 * * 1-5"), "工作日 08:30");
  assert.equal(describeCron("0 10 * * 1"), "每周一 10:00");
  assert.equal(describeCron("0 9 1 * *"), "每月 1 日 09:00");
  assert.ok(isValidTimezone("Asia/Shanghai"));
  assert.ok(!isValidTimezone("Mars/Base"));
});

test("composeDailyDigest：没有值得打扰的内容就返回 null", () => {
  const empty = { needsYou: [], inProgress: [{ title: "A", why: "进行中" }], finishedSince: [], expiringCredentials: [], brokenConnectors: [] };
  assert.equal(composeDailyDigest(empty), null, "只有进行中不打扰");
  const now = new Date("2026-09-28T00:00:00Z");
  const text = composeDailyDigest(
    { ...empty, finishedSince: [{ goal: "新产品调研", status: "COMPLETED" }], expiringCredentials: [{ label: "店铺", target: "shop.example.com", expiresAt: "2026-09-28T05:00:00Z" }] },
    now
  )!;
  assert.match(text, /上次简报以来结束的工作（1，其中完成 1）/);
  assert.match(text, /新产品调研：已完成/);
  assert.match(text, /5 小时后过期/);
  assert.match(text, /正在推进/);
});
