/**
 * 结构化成果契约回归锁（TASK-009a；验证映射 = 计划 TEST-006）
 *
 * TEST-006 要求：**坏 JSON、未知版本、关系错绑、组织不符、字段列与内容版本不一致均失败；
 * 自由文本历史可读但不伪装结构成果；AI 内容不能自带 ACCEPTED**。
 *
 * 本测试为**纯逻辑**（无 DB 依赖）：直接调 helper；写路径用内存 fake `tx` 替换
 * `Prisma.TransactionClient`，并断言校验失败时**零写入**。
 * 运行：`node_modules/.bin/tsx scripts/run-test.ts tests/regression-structured-artifacts.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { UnprocessableEntityError } from "../src/shared/errors";
import {
  canonicalize,
  computeInputFingerprint,
  pickBusinessInput,
  readStructuredArtifact,
  validateStructuredArtifact,
  writeStructuredArtifact,
} from "../src/modules/work/structured-artifacts";
import { ARTIFACT_SCHEMA_VERSION, isStructuredArtifactType } from "../src/modules/work/artifact-schema";

const ENVELOPE = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: ARTIFACT_SCHEMA_VERSION,
  organizationId: "org-1",
  projectId: "proj-1",
  sourceRefs: [{ id: "ref-1", hash: "abc", retrievedAt: "2026-09-20" }],
  inputFingerprint: "a".repeat(64),
  dataNature: "REAL",
  assumptions: [],
  missingInputs: [],
  recordedBy: "user-1",
  confirmedBy: null,
  confirmedAt: null,
  ...over,
});

/** 一个合法的最小 COST_SCENARIO（项目级）业务输入。 */
const COST_BUSINESS = {
  engineVersion: "v1",
  scenarioName: "基础情景",
  currency: "CNY",
  unit: "盒",
  expenseBase: "出厂口径",
  result: 12.5,
};

const PRODUCTION_BUSINESS = {
  quantity: 100,
  unit: "盒",
  budget: 5000,
  currency: "CNY",
  quoteRefs: [],
  sampleRefs: [],
  packagingRefs: [],
  leadTime: null,
  productionConditions: [],
  stopConditions: [],
};

const ANALYSIS_BUSINESS = {
  conclusion: "PROCEED_TO_VALIDATE",
  summary: "摘要",
  companyFit: [],
  claims: [],
  alternatives: [],
  economicScenarioRef: null,
  risks: [],
  unknowns: [],
  recommendedActions: [],
  limitations: [],
};

function errorsOf(result: ReturnType<typeof validateStructuredArtifact>): string[] {
  return Object.keys(result.fieldErrors);
}

// ─────────────────────────── ① 拒绝路径（不猜、不放行） ───────────────────────────

test("① 非对象内容 → 拒绝（坏 JSON / 数组 / null 都不是结构化成果）", () => {
  for (const bad of [null, [], "text", 42] as unknown[]) {
    const result = validateStructuredArtifact({ type: "COST_SCENARIO", value: bad as Record<string, unknown> });
    assert.equal(result.ok, false);
    assert.deepEqual(errorsOf(result), ["content"]);
  }
});

test("① 未登记类型 → 拒绝（新增类型必须先登记，不允许通用成果接口绕过）", () => {
  assert.equal(isStructuredArtifactType("COST_SCENARIO"), true);
  assert.equal(isStructuredArtifactType("MADE_UP_TYPE"), false);
  const result = validateStructuredArtifact({ type: "MADE_UP_TYPE", value: ENVELOPE({ ...COST_BUSINESS }) });
  assert.equal(result.ok, false);
  assert.deepEqual(errorsOf(result), ["type"]);
});

test("① 未知 schemaVersion → 拒绝（不尽力猜）", () => {
  const result = validateStructuredArtifact({
    type: "COST_SCENARIO",
    value: ENVELOPE({ schemaVersion: "9.9", ...COST_BUSINESS }),
  });
  assert.equal(result.ok, false);
  assert.ok(errorsOf(result).includes("schemaVersion"));
  assert.match(result.fieldErrors.schemaVersion[0], /未知版本 9\.9/);
});

test("① 信封缺字段 / 空字符串掩盖缺失 → 字段级错误", () => {
  const result = validateStructuredArtifact({
    type: "COST_SCENARIO",
    value: {
      ...COST_BUSINESS,
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      organizationId: "   ",
      assumptions: [""],
      missingInputs: [null],
      recordedBy: "",
    },
  });
  assert.equal(result.ok, false);
  const fields = errorsOf(result);
  for (const f of [
    "organizationId",
    "assumptions[0]",
    "missingInputs[0]",
    "recordedBy",
    "sourceRefs",
    "dataNature",
    "inputFingerprint",
  ]) {
    assert.ok(fields.includes(f), `应报 ${f}（实际：${fields.join("、")}）`);
  }
});

test("① confirmedBy 不得凭空填人名：必须与 confirmedAt 成对，未确认即 null", () => {
  const pair = validateStructuredArtifact({
    type: "COST_SCENARIO",
    value: ENVELOPE({ ...COST_BUSINESS, confirmedBy: "某专家", confirmedAt: null }),
  });
  assert.equal(pair.ok, false);
  assert.ok(errorsOf(pair).includes("confirmedBy"));

  const emptyName = validateStructuredArtifact({
    type: "COST_SCENARIO",
    value: ENVELOPE({ ...COST_BUSINESS, confirmedBy: "", confirmedAt: "2026-09-20" }),
  });
  assert.equal(emptyName.ok, false);
  assert.ok(errorsOf(emptyName).includes("confirmedBy"));
});

test("① 项目级成果必须关联项目；公司级简报是唯一例外", () => {
  const missingProject = validateStructuredArtifact({
    type: "COST_SCENARIO",
    value: ENVELOPE({ projectId: null, ...COST_BUSINESS }),
  });
  assert.equal(missingProject.ok, false);
  assert.ok(errorsOf(missingProject).includes("projectId"));

  const orgBrief = validateStructuredArtifact({
    type: "COMPANY_BRAND_BRIEF",
    value: ENVELOPE({
      projectId: null,
      productId: null,
      productVersionId: null,
      goals: ["年度目标"],
      audience: ["中老年私域"],
      channels: ["私域"],
      resources: ["现有产线"],
      forbiddenItems: ["医疗声称"],
      confirmedFactRefs: ["fact-1"],
      confirmedFactVersion: "1",
    }),
  });
  assert.equal(orgBrief.ok, true, JSON.stringify(orgBrief.fieldErrors));
});

test("① 业务字段：负数量 / 非法币种 / 非法枚举 → 拒绝", () => {
  const negative = validateStructuredArtifact({
    type: "PRODUCTION_PLAN",
    value: ENVELOPE({ ...PRODUCTION_BUSINESS, quantity: -1 }),
  });
  assert.equal(negative.ok, false);
  assert.match(negative.fieldErrors.quantity[0], /不得为负/);

  const badCurrency = validateStructuredArtifact({
    type: "COST_SCENARIO",
    value: ENVELOPE({ ...COST_BUSINESS, currency: "rmb" }),
  });
  assert.equal(badCurrency.ok, false);
  assert.match(badCurrency.fieldErrors.currency[0], /三位大写 ISO 币种/);

  const badEnum = validateStructuredArtifact({
    type: "PROFESSIONAL_ANALYSIS",
    value: ENVELOPE({ ...ANALYSIS_BUSINESS, conclusion: "SHIP_IT" }),
  });
  assert.equal(badEnum.ok, false);
  assert.match(badEnum.fieldErrors.conclusion[0], /PROCEED_TO_VALIDATE/);

  const okCase = validateStructuredArtifact({ type: "PROFESSIONAL_ANALYSIS", value: ENVELOPE({ ...ANALYSIS_BUSINESS }) });
  assert.equal(okCase.ok, true, JSON.stringify(okCase.fieldErrors));
});

// ─────────────────────────── ② 指纹稳定性（规范化 JSON） ───────────────────────────

test("② 指纹：键序与引用顺序无关；业务输入不同则不同；信封保留键不参与", () => {
  const a = computeInputFingerprint({ b: 1, a: [{ id: "z" }, { id: "a" }] });
  const b = computeInputFingerprint({ a: [{ id: "a" }, { id: "z" }], b: 1 });
  assert.equal(a, b, "键序与引用顺序不应改变指纹");
  assert.notEqual(a, computeInputFingerprint({ b: 2, a: [{ id: "a" }, { id: "z" }] }));
  assert.match(a, /^[0-9a-f]{64}$/);

  const withEnvelopeNoise = pickBusinessInput({ ...COST_BUSINESS, organizationId: "attacker-org", inputFingerprint: "x" });
  assert.equal(
    computeInputFingerprint(withEnvelopeNoise),
    computeInputFingerprint(COST_BUSINESS),
    "信封保留键必须被剔除，不能影响指纹"
  );
  assert.deepEqual(canonicalize({ b: 1, a: 2 }), { a: 2, b: 1 });
});

// ─────────────────────────── ③ 读取：历史自由文本 vs 结构化 ───────────────────────────

test("③ schemaVersion 列为 null → 历史自由文本只读，不伪装结构成果", () => {
  const plain = readStructuredArtifact({
    type: "MARKET_RESEARCH_REPORT",
    content: "这是一段自由文本历史成果",
    schemaVersion: null,
  });
  assert.equal(plain.kind, "legacy-free-text");

  const jsonButUnversioned = readStructuredArtifact({
    type: "SPECIFICATION_BRIEF",
    content: JSON.stringify({ netWeight: "10g" }),
    schemaVersion: null,
  });
  assert.equal(jsonButUnversioned.kind, "legacy-free-text", "列未版本化时不得按结构化成果解释");
});

test("③ 未知版本 / 列与内容版本不一致 / 坏 JSON → 422", () => {
  assert.throws(
    () => readStructuredArtifact({ type: "COST_SCENARIO", content: "{}", schemaVersion: "9.9" }),
    (e: unknown) => e instanceof UnprocessableEntityError && /未知成果 schema 版本/.test((e as Error).message)
  );
  assert.throws(
    () =>
      readStructuredArtifact({
        type: "COST_SCENARIO",
        content: JSON.stringify({ schemaVersion: "2.0" }),
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
      }),
    (e: unknown) => e instanceof UnprocessableEntityError && /不一致/.test((e as Error).message)
  );
  assert.throws(
    () => readStructuredArtifact({ type: "COST_SCENARIO", content: "{not json", schemaVersion: ARTIFACT_SCHEMA_VERSION }),
    (e: unknown) => {
      if (!(e instanceof UnprocessableEntityError)) return false;
      // 字段级错误随响应下发（422），消息与字段都点明原因
      const fieldErrors = (e as UnprocessableEntityError & { fieldErrors?: Record<string, string[]> }).fieldErrors;
      return /不是合法 JSON/.test(e.message) && /坏 JSON/.test(String(fieldErrors?.content ?? ""));
    }
  );
});

test("③ 合法结构化成果 → 读取并规范化", () => {
  const written = {
    ...ENVELOPE({ ...COST_BUSINESS }),
  };
  const read = readStructuredArtifact({
    type: "COST_SCENARIO",
    content: JSON.stringify(written),
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
  });
  assert.equal(read.kind, "structured");
  if (read.kind === "structured") assert.equal(read.value.result, 12.5);
});

// ─────────────────────────── ④ 写入：同事务、追加保存、零写入 ───────────────────────────

function fakeTx(existingContentVersions: number[] = []) {
  const created: Array<Record<string, unknown>> = [];
  const tx = {
    artifact: {
      findFirst: async () =>
        existingContentVersions.length > 0
          ? { contentVersion: Math.max(...existingContentVersions) }
          : null,
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: `artifact-${created.length}`, ...args.data };
      },
    },
  };
  return { tx: tx as unknown as Parameters<typeof writeStructuredArtifact>[0], created };
}

function writeParams(over: Record<string, unknown> = {}) {
  return {
    type: "COST_SCENARIO" as const,
    title: "成本情景 · 基础",
    workItemId: "wi-1",
    submissionId: "sub-1",
    inputRevision: 3,
    businessInput: { ...COST_BUSINESS },
    envelope: {
      organizationId: "org-1",
      projectId: "proj-1",
      productId: "prod-1",
      productVersionId: "pv-1",
      sourceRefs: [],
      dataNature: "REAL" as const,
      assumptions: ["未含运费"],
      missingInputs: ["工厂报价"],
      recordedBy: "user-1",
      confirmedBy: null,
      confirmedAt: null,
    },
    ...over,
  };
}

test("④ 写入：信封由服务端组装 + 追加保存（contentVersion 递增）+ 列与内容版本一致", async () => {
  const { tx, created } = fakeTx([1, 2]);
  const row = await writeStructuredArtifact(tx, writeParams());
  assert.equal(created.length, 1);
  assert.equal(row.contentVersion, 3, "同 workItem+type 上应追加为第 3 版，而不是覆盖旧版本");
  assert.equal(row.schemaVersion, ARTIFACT_SCHEMA_VERSION);
  const parsed = JSON.parse(String(row.content));
  assert.equal(parsed.schemaVersion, ARTIFACT_SCHEMA_VERSION, "内容顶层版本必须与列一致");
  assert.match(parsed.inputFingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(parsed.missingInputs, ["工厂报价"], "未定输入必须显式保留，不得省略");
  assert.equal(parsed.confirmedBy, null, "未确认不得填人名");
});

test("④ 业务输入里的 organizationId 不得覆盖服务端信封（不信任请求体）", async () => {
  const { tx, created } = fakeTx();
  await writeStructuredArtifact(
    tx,
    writeParams({ businessInput: { ...COST_BUSINESS, organizationId: "attacker-org", projectId: "other-proj" } })
  );
  const parsed = JSON.parse(String(created[0].content));
  assert.equal(parsed.organizationId, "org-1");
  assert.equal(parsed.projectId, "proj-1");
  assert.equal(created[0].organizationId, "org-1");
});

test("④ 校验失败 → 抛 422 且零写入（不得留下半成品成果）", async () => {
  const { tx, created } = fakeTx();
  await assert.rejects(
    () =>
      writeStructuredArtifact(
        tx,
        writeParams({ businessInput: { ...COST_BUSINESS, result: Number.NaN }, envelope: { ...writeParams().envelope, dataNature: "SYNTHETIC" as unknown as "REAL" } })
      ),
    (e: unknown) => e instanceof UnprocessableEntityError
  );
  assert.equal(created.length, 0, "校验失败必须零写入");
});

test("④ 服务端推导的 dataNature 不可被请求体覆盖（合成成果不得借声明进入真实门禁）", async () => {
  const { tx, created } = fakeTx();
  const params = writeParams({
    businessInput: { ...COST_BUSINESS, dataNature: "REAL" },
    envelope: { ...writeParams().envelope, dataNature: "DEMO" as const },
  });
  await writeStructuredArtifact(tx, params);
  const parsed = JSON.parse(String(created[0].content));
  assert.equal(parsed.dataNature, "DEMO", "信封的 dataNature 必须盖过业务输入里的声明");
});
