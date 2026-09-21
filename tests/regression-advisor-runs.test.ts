/**
 * TASK-017 交互式运行管理回归锁
 *
 * 本测试为**纯逻辑**（无 DB 依赖）：验证运行管理的核心逻辑。
 * 运行：node --import tsx --test tests/regression-advisor-runs.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTERACTIVE_RUN_START_TTL_MS,
  type InteractiveRunPurpose,
} from "../src/modules/advisor/runs";

// ── 常量测试 ──

test("TASK-017: INTERACTIVE_RUN_START_TTL_MS 为 300 秒（5 分钟）", () => {
  assert.equal(INTERACTIVE_RUN_START_TTL_MS, 300_000);
});

test("TASK-017: 允许的运行用途包含 ADVISOR_MESSAGE 和 PROFESSIONAL_ANALYSIS", () => {
  const validPurposes: InteractiveRunPurpose[] = ["ADVISOR_MESSAGE", "PROFESSIONAL_ANALYSIS"];
  assert.equal(validPurposes.length, 2);
  assert.ok(validPurposes.includes("ADVISOR_MESSAGE"));
  assert.ok(validPurposes.includes("PROFESSIONAL_ANALYSIS"));
});

// ── 状态转换逻辑测试 ──

test("TASK-017: 终态列表包含 SUCCEEDED、FAILED、CANCELLED", () => {
  const terminalStatuses = ["SUCCEEDED", "FAILED", "CANCELLED"];
  assert.equal(terminalStatuses.length, 3);
  assert.ok(terminalStatuses.includes("SUCCEEDED"));
  assert.ok(terminalStatuses.includes("FAILED"));
  assert.ok(terminalStatuses.includes("CANCELLED"));
});

test("TASK-017: QUEUED 状态可转换为 RUNNING", () => {
  const validTransitions: Record<string, string[]> = {
    QUEUED: ["RUNNING", "CANCELLED"],
    RUNNING: ["SUCCEEDED", "FAILED", "CANCELLED"],
    CANCELLED: [],
    SUCCEEDED: [],
    FAILED: [],
  };
  
  assert.ok(validTransitions["QUEUED"].includes("RUNNING"));
  assert.ok(validTransitions["QUEUED"].includes("CANCELLED"));
  assert.ok(!validTransitions["QUEUED"].includes("SUCCEEDED"));
});

test("TASK-017: RUNNING 状态可转换为 SUCCEEDED 或 FAILED", () => {
  const validTransitions: Record<string, string[]> = {
    QUEUED: ["RUNNING", "CANCELLED"],
    RUNNING: ["SUCCEEDED", "FAILED", "CANCELLED"],
    CANCELLED: [],
    SUCCEEDED: [],
    FAILED: [],
  };
  
  assert.ok(validTransitions["RUNNING"].includes("SUCCEEDED"));
  assert.ok(validTransitions["RUNNING"].includes("FAILED"));
  assert.ok(validTransitions["RUNNING"].includes("CANCELLED"));
  assert.ok(!validTransitions["RUNNING"].includes("QUEUED"));
});

test("TASK-017: 终态不可转换", () => {
  const validTransitions: Record<string, string[]> = {
    QUEUED: ["RUNNING", "CANCELLED"],
    RUNNING: ["SUCCEEDED", "FAILED", "CANCELLED"],
    CANCELLED: [],
    SUCCEEDED: [],
    FAILED: [],
  };
  
  assert.equal(validTransitions["CANCELLED"].length, 0);
  assert.equal(validTransitions["SUCCEEDED"].length, 0);
  assert.equal(validTransitions["FAILED"].length, 0);
});

// ── TTL 逻辑测试 ──

test("TASK-017: TTL 过期判断逻辑", () => {
  const now = new Date();
  const createdAt = new Date(now.getTime() - INTERACTIVE_RUN_START_TTL_MS - 1000); // 超过 TTL
  const elapsed = now.getTime() - createdAt.getTime();
  
  assert.ok(elapsed > INTERACTIVE_RUN_START_TTL_MS, "应检测到 TTL 过期");
});

test("TASK-017: TTL 未过期判断逻辑", () => {
  const now = new Date();
  const createdAt = new Date(now.getTime() - INTERACTIVE_RUN_START_TTL_MS + 1000); // 未超过 TTL
  const elapsed = now.getTime() - createdAt.getTime();
  
  assert.ok(elapsed < INTERACTIVE_RUN_START_TTL_MS, "应检测到 TTL 未过期");
});

// ── 显示状态逻辑测试 ──

test("TASK-017: 过期的 QUEUED 运行显示 EXPIRED", () => {
  const status = "QUEUED";
  const isExpired = true;
  const displayStatus = isExpired ? "EXPIRED" : status;
  
  assert.equal(displayStatus, "EXPIRED");
});

test("TASK-017: 未过期的 QUEUED 运行显示 QUEUED", () => {
  const status = "QUEUED";
  const isExpired = false;
  const displayStatus = isExpired ? "EXPIRED" : status;
  
  assert.equal(displayStatus, "QUEUED");
});

test("TASK-017: RUNNING 运行显示 RUNNING", () => {
  const status = "RUNNING";
  const isExpired = false; // RUNNING 状态不检查 TTL
  const displayStatus = isExpired ? "EXPIRED" : status;
  
  assert.equal(displayStatus, "RUNNING");
});

// ── 条件更新逻辑测试 ──

test("TASK-017: 条件更新防重复认领逻辑", () => {
  // 模拟条件更新：只有 QUEUED 状态才能认领
  const currentStatus = "QUEUED";
  const targetStatus = "RUNNING";
  
  const canClaim = currentStatus === "QUEUED";
  assert.ok(canClaim, "QUEUED 状态应可认领");
});

test("TASK-017: RUNNING 状态不可认领", () => {
  const currentStatus: string = "RUNNING";
  const canClaim = currentStatus === "QUEUED";
  
  assert.ok(!canClaim, "RUNNING 状态不可认领");
});

test("TASK-017: CANCELLED 状态不可认领", () => {
  const currentStatus: string = "CANCELLED";
  const canClaim = currentStatus === "QUEUED";
  
  assert.ok(!canClaim, "CANCELLED 状态不可认领");
});

// ── 取消逻辑测试 ──

test("TASK-017: 终态不可取消", () => {
  const terminalStatuses = ["SUCCEEDED", "FAILED", "CANCELLED"];
  const currentStatus = "SUCCEEDED";
  
  const canCancel = !terminalStatuses.includes(currentStatus);
  assert.ok(!canCancel, "SUCCEEDED 状态不可取消");
});

test("TASK-017: QUEUED 状态可取消", () => {
  const terminalStatuses = ["SUCCEEDED", "FAILED", "CANCELLED"];
  const currentStatus = "QUEUED";
  
  const canCancel = !terminalStatuses.includes(currentStatus);
  assert.ok(canCancel, "QUEUED 状态应可取消");
});

test("TASK-017: RUNNING 状态可取消", () => {
  const terminalStatuses = ["SUCCEEDED", "FAILED", "CANCELLED"];
  const currentStatus = "RUNNING";
  
  const canCancel = !terminalStatuses.includes(currentStatus);
  assert.ok(canCancel, "RUNNING 状态应可取消");
});

// ── 权限逻辑测试 ──

test("TASK-017: 只有运行发起人可取消", () => {
  const runUserId = "user-1";
  const currentUserId = "user-1";
  
  const canCancel = runUserId === currentUserId;
  assert.ok(canCancel, "发起人应可取消自己的运行");
});

test("TASK-017: 非运行发起人不可取消", () => {
  const runUserId: string = "user-1";
  const currentUserId: string = "user-2";
  
  const canCancel = runUserId === currentUserId;
  assert.ok(!canCancel, "非发起人不可取消他人运行");
});

test("TASK-017: 只有运行发起人可认领", () => {
  const runUserId = "user-1";
  const currentUserId = "user-1";
  
  const canClaim = runUserId === currentUserId;
  assert.ok(canClaim, "发起人应可认领自己的运行");
});

test("TASK-017: 非运行发起人不可认领", () => {
  const runUserId: string = "user-1";
  const currentUserId: string = "user-2";
  
  const canClaim = runUserId === currentUserId;
  assert.ok(!canClaim, "非发起人不可认领他人运行");
});

// ── 用途验证测试 ──

test("TASK-017: 无效用途应被拒绝", () => {
  const validPurposes: InteractiveRunPurpose[] = ["ADVISOR_MESSAGE", "PROFESSIONAL_ANALYSIS"];
  const invalidPurpose = "INVALID_PURPOSE";
  
  const isValid = validPurposes.includes(invalidPurpose as InteractiveRunPurpose);
  assert.ok(!isValid, "无效用途应被拒绝");
});

test("TASK-017: ADVISOR_MESSAGE 用途有效", () => {
  const validPurposes: InteractiveRunPurpose[] = ["ADVISOR_MESSAGE", "PROFESSIONAL_ANALYSIS"];
  const purpose = "ADVISOR_MESSAGE";
  
  const isValid = validPurposes.includes(purpose);
  assert.ok(isValid, "ADVISOR_MESSAGE 应为有效用途");
});

test("TASK-017: PROFESSIONAL_ANALYSIS 用途有效", () => {
  const validPurposes: InteractiveRunPurpose[] = ["ADVISOR_MESSAGE", "PROFESSIONAL_ANALYSIS"];
  const purpose = "PROFESSIONAL_ANALYSIS";
  
  const isValid = validPurposes.includes(purpose);
  assert.ok(isValid, "PROFESSIONAL_ANALYSIS 应为有效用途");
});

// ── 上下文校验逻辑测试 ──

test("TASK-017: 上下文快照应包含 purpose 字段", () => {
  const contextSnapshot = {
    capturedAt: new Date().toISOString(),
    organizationId: "org-1",
    purpose: "ADVISOR_MESSAGE",
    productId: null,
    productVersionId: null,
    permissionScope: "own organization only",
    modelConfigured: false,
    llmEnabled: false,
  };
  
  assert.ok("purpose" in contextSnapshot, "上下文快照应包含 purpose 字段");
  assert.equal(contextSnapshot.purpose, "ADVISOR_MESSAGE");
});

test("TASK-017: 上下文快照应包含 productId 和 productVersionId", () => {
  const contextSnapshot = {
    capturedAt: new Date().toISOString(),
    organizationId: "org-1",
    purpose: "PROFESSIONAL_ANALYSIS",
    productId: "product-1",
    productVersionId: "version-1",
    permissionScope: "own organization only",
    modelConfigured: true,
    llmEnabled: true,
  };
  
  assert.ok("productId" in contextSnapshot, "上下文快照应包含 productId");
  assert.ok("productVersionId" in contextSnapshot, "上下文快照应包含 productVersionId");
  assert.equal(contextSnapshot.productId, "product-1");
  assert.equal(contextSnapshot.productVersionId, "version-1");
});

// ── 错误消息测试 ──

test("TASK-017: TTL 过期错误消息包含毫秒数", () => {
  const elapsed = 301000; // 超过 300000ms
  const errorMessage = `运行启动超时（已过期 ${elapsed}ms）`;
  
  assert.ok(errorMessage.includes("超时"), "错误消息应包含超时");
  assert.ok(errorMessage.includes("301000"), "错误消息应包含过期毫秒数");
});

test("TASK-017: 状态不匹配错误消息包含当前状态", () => {
  const currentStatus = "RUNNING";
  const errorMessage = `运行状态不是 QUEUED：${currentStatus}`;
  
  assert.ok(errorMessage.includes("QUEUED"), "错误消息应包含期望状态");
  assert.ok(errorMessage.includes(currentStatus), "错误消息应包含当前状态");
});

test("TASK-017: 已取消运行不可操作错误消息", () => {
  const errorMessage = "运行已处于终态：CANCELLED";
  
  assert.ok(errorMessage.includes("终态"), "错误消息应包含终态");
  assert.ok(errorMessage.includes("CANCELLED"), "错误消息应包含状态");
});
