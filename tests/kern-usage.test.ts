/** KX-37 用量：部署上限读取与自然月窗口（纯函数）。产品内无套餐 / 价格。 */
import assert from "node:assert/strict";
import test from "node:test";
import { calendarMonth, deploymentLimits } from "../src/modules/usage";

test("缺省不限；只有部署显式设置才有上限；非法值视为不限", () => {
  assert.deepEqual(deploymentLimits({}), { missionsPerMonth: null, modelCallsPerMonth: null, memoryItems: null });
  assert.deepEqual(
    deploymentLimits({ KERN_LIMIT_MISSIONS_PER_MONTH: "200", KERN_LIMIT_MODEL_CALLS_PER_MONTH: " 5000 ", KERN_LIMIT_MEMORY_ITEMS: "abc" }),
    { missionsPerMonth: 200, modelCallsPerMonth: 5000, memoryItems: null }
  );
  assert.equal(deploymentLimits({ KERN_LIMIT_MISSIONS_PER_MONTH: "-1" }).missionsPerMonth, null);
  assert.equal(deploymentLimits({ KERN_LIMIT_MISSIONS_PER_MONTH: "" }).missionsPerMonth, null);
});

test("自然月按上海时区切分", () => {
  const p = calendarMonth(new Date("2026-09-28T08:00:00Z"));
  assert.equal(p.start.toISOString(), "2026-08-31T16:00:00.000Z");
  assert.equal(p.end.toISOString(), "2026-09-30T16:00:00.000Z");
  // 上海已是 10 月 1 日 00:30，UTC 仍是 9 月 30 日
  assert.equal(calendarMonth(new Date("2026-09-30T16:30:00Z")).start.toISOString(), "2026-09-30T16:00:00.000Z");
  // 跨年
  assert.equal(calendarMonth(new Date("2026-12-31T17:00:00Z")).end.toISOString(), "2027-01-31T16:00:00.000Z");
});
