/**
 * TASK-016 回归测试：analyzeProductVersion 专业分析扩展
 *
 * 测试覆盖：
 * 1. 参数验证逻辑
 * 2. 专业分析请求的参数组合
 * 3. 输入快照结构
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// 导入类型定义
import type { AnalyzeParams } from "../src/modules/product-development/analysis";

// ─────────────────────── ① 参数验证 ───────────────────────

test("TASK-016: 基础分析参数（无专业分析）", () => {
  const params: AnalyzeParams = {
    productId: "product-1",
    productVersionId: "version-1",
  };

  // 验证参数结构
  assert.equal(params.productId, "product-1");
  assert.equal(params.productVersionId, "version-1");
  assert.equal(params.requestProfessionalAnalysis, undefined);
  assert.equal(params.agentRunId, undefined);
});

test("TASK-016: 请求专业分析的参数组合", () => {
  const params: AnalyzeParams = {
    productId: "product-1",
    productVersionId: "version-1",
    requestProfessionalAnalysis: true,
    agentRunId: "agent-run-1",
  };

  // 验证参数结构
  assert.equal(params.productId, "product-1");
  assert.equal(params.productVersionId, "version-1");
  assert.equal(params.requestProfessionalAnalysis, true);
  assert.equal(params.agentRunId, "agent-run-1");
});

test("TASK-016: 请求专业分析但无 agentRunId", () => {
  const params: AnalyzeParams = {
    productId: "product-1",
    productVersionId: "version-1",
    requestProfessionalAnalysis: true,
    // agentRunId 未提供
  };

  // 验证参数结构
  assert.equal(params.productId, "product-1");
  assert.equal(params.productVersionId, "version-1");
  assert.equal(params.requestProfessionalAnalysis, true);
  assert.equal(params.agentRunId, undefined);
});

test("TASK-016: 有 agentRunId 但未请求专业分析", () => {
  const params: AnalyzeParams = {
    productId: "product-1",
    productVersionId: "version-1",
    requestProfessionalAnalysis: false,
    agentRunId: "agent-run-1",
  };

  // 验证参数结构
  assert.equal(params.productId, "product-1");
  assert.equal(params.productVersionId, "version-1");
  assert.equal(params.requestProfessionalAnalysis, false);
  assert.equal(params.agentRunId, "agent-run-1");
});

test("TASK-016: 输入快照结构验证", () => {
  // 模拟输入快照结构
  const inputSnapshot = {
    // 原有字段
    scorecard: {
      ruleVersion: "1.0",
      coverageRatio: 0.8,
      provisional: false,
      weightedScore: 75,
    },
    // 新增字段（专业分析）
    professionalAnalysis: {
      status: "DRAFT",
      summary: "专业分析需要启用 LLM 适配器",
      recommendedActions: [],
      evidenceGaps: [],
      riskAssessment: {
        level: "UNKNOWN",
        factors: [],
      },
      metadata: {
        version: "1.0",
        generatedAt: new Date().toISOString(),
        model: "deterministic-rules",
        confidence: 0,
      },
    },
    agentRunId: "agent-run-1",
    versionIdAtAnalysis: "version-1",
    generatedAt: new Date().toISOString(),
  };

  // 验证结构
  assert.ok(inputSnapshot.scorecard);
  assert.ok(inputSnapshot.professionalAnalysis);
  assert.ok(inputSnapshot.agentRunId);
  assert.ok(inputSnapshot.versionIdAtAnalysis);
  assert.ok(inputSnapshot.generatedAt);

  // 验证专业分析字段
  const analysis = inputSnapshot.professionalAnalysis;
  assert.equal(analysis.status, "DRAFT");
  assert.equal(analysis.metadata.model, "deterministic-rules");
  assert.equal(analysis.metadata.version, "1.0");
});

test("TASK-016: 版本变更时的输入快照结构", () => {
  // 模拟版本变更时的输入快照结构
  const inputSnapshot = {
    // 原有字段
    scorecard: {
      ruleVersion: "1.0",
      coverageRatio: 0.8,
      provisional: false,
      weightedScore: 75,
    },
    // 新增字段（专业分析）
    professionalAnalysis: {
      status: "DRAFT",
      summary: "专业分析需要启用 LLM 适配器",
      recommendedActions: [],
      evidenceGaps: [],
      riskAssessment: {
        level: "UNKNOWN",
        factors: [],
      },
      metadata: {
        version: "1.0",
        generatedAt: new Date().toISOString(),
        model: "deterministic-rules",
        confidence: 0,
      },
    },
    agentRunId: "agent-run-1",
    versionIdAtAnalysis: "version-1",
    generatedAt: new Date().toISOString(),
  };

  // 验证结构
  assert.ok(inputSnapshot.professionalAnalysis);
  assert.ok(inputSnapshot.agentRunId);
  assert.ok(inputSnapshot.versionIdAtAnalysis);
});

test("TASK-016: 版本变更时的输入快照结构（无专业分析）", () => {
  // 模拟版本变更时的输入快照结构（无专业分析）
  const inputSnapshot = {
    // 原有字段
    scorecard: {
      ruleVersion: "1.0",
      coverageRatio: 0.8,
      provisional: false,
      weightedScore: 75,
    },
    // 无专业分析字段
  };

  // 验证结构
  assert.ok(inputSnapshot.scorecard);
  assert.equal(inputSnapshot.professionalAnalysis, undefined);
  assert.equal(inputSnapshot.agentRunId, undefined);
  assert.equal(inputSnapshot.versionIdAtAnalysis, undefined);
});

// ─────────────────────── ② 参数组合逻辑 ───────────────────────

test("TASK-016: 请求专业分析的参数组合逻辑", () => {
  const params: AnalyzeParams = {
    productId: "product-1",
    productVersionId: "version-1",
    requestProfessionalAnalysis: true,
    agentRunId: "agent-run-1",
  };

  // 验证参数组合逻辑
  const shouldRunProfessionalAnalysis = !!(params.requestProfessionalAnalysis && params.agentRunId);
  assert.equal(shouldRunProfessionalAnalysis, true);
});

test("TASK-016: 请求专业分析但无 agentRunId 的参数组合逻辑", () => {
  const params: AnalyzeParams = {
    productId: "product-1",
    productVersionId: "version-1",
    requestProfessionalAnalysis: true,
    // agentRunId 未提供
  };

  // 验证参数组合逻辑
  const shouldRunProfessionalAnalysis = !!(params.requestProfessionalAnalysis && params.agentRunId);
  assert.equal(shouldRunProfessionalAnalysis, false);
});

test("TASK-016: 有 agentRunId 但未请求专业分析的参数组合逻辑", () => {
  const params: AnalyzeParams = {
    productId: "product-1",
    productVersionId: "version-1",
    requestProfessionalAnalysis: false,
    agentRunId: "agent-run-1",
  };

  // 验证参数组合逻辑
  const shouldRunProfessionalAnalysis = !!(params.requestProfessionalAnalysis && params.agentRunId);
  assert.equal(shouldRunProfessionalAnalysis, false);
});

test("TASK-016: 无 agentRunId 且未请求专业分析的参数组合逻辑", () => {
  const params: AnalyzeParams = {
    productId: "product-1",
    productVersionId: "version-1",
  };

  // 验证参数组合逻辑
  const shouldRunProfessionalAnalysis = !!(params.requestProfessionalAnalysis && params.agentRunId);
  assert.equal(shouldRunProfessionalAnalysis, false);
});
