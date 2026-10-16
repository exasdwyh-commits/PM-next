import assert from "node:assert/strict";
import test from "node:test";
import { userFacingFailureReason } from "../src/shared/errors";

/**
 * 失败原因过滤判据（`userFacingFailureReason`）
 *
 * 为什么锁住它：同步路径（conversation-engine）与后台路径（message-worker）
 * 共用同一个判据。此前只有同步路径接了它，后台路径把 `error.message` 原样写进
 * 对话正文 —— Prisma / 网关的英文堆栈会直出给用户。判据一旦被改宽或改窄，
 * 两条路径会同时受影响，所以在这里固定行为。
 *
 * 约定：中文业务提示照常透出；英文技术原文返回 null，由调用方换成自己的可读说明。
 * 诊断原文一律留在结构化字段（ToolCall.errorReason / AgentRun.errorReason），不因过滤而丢失。
 */

test("英文技术堆栈不展示给用户（返回 null）", () => {
  assert.equal(userFacingFailureReason("connect ECONNREFUSED 127.0.0.1:5432"), null);
  assert.equal(
    userFacingFailureReason('PrismaClientInitializationError: permission denied for database "hermes_dev"'),
    null,
  );
  assert.equal(userFacingFailureReason("fetch failed"), null);
  assert.equal(userFacingFailureReason(""), null);
});

test("中文业务提示照常透出", () => {
  assert.equal(userFacingFailureReason("额度已用完，请稍后再试"), "额度已用完，请稍后再试");
  assert.equal(userFacingFailureReason("后台执行进程中断；这次请求不会自动重复执行"), "后台执行进程中断；这次请求不会自动重复执行");
});

test("已知边界：英文堆栈里嵌中文时整段仍会透出（文档化，不是意外）", () => {
  // 判据是「含任意汉字即透出」。这条锁住的是**当前已知行为**，
  // 若将来收紧为白名单式匹配，请连同两处调用方一起评估后更新本断言。
  const mixed = 'Error: invalid input for product "奥洛曦"';
  assert.equal(userFacingFailureReason(mixed), mixed);
});
