/**
 * 修订版本一致性回归套件 (C01 版本一致性 / F16-F17)
 *
 * 复现路径：先提交规格 10g 的建议包并生成正式成果，随后将规格修订为 20g、修改研究结论，
 * 再以不同幂等键提交。修复前：产品规格库已更新为 20g，但规格报告仍是 10g、市场报告不含修订内容，
 * 决策包依旧引用旧成果并可以 APPROVED。
 *
 * 本套件以「会失败的断言」锁定修复结果：
 *   A1 修订规格必须落库为新版本成果
 *   A2 修订研究结论必须落库为新版本成果
 *   A3 修订成果在负责人确认前为待检查状态，且提交指针指向新批次
 *   A4 历史成果与历史批次完整保留，检查记录不得为“自动形式验收”
 *   D1 旧成果/旧产品版本决策包阻断批准
 *   D2 新成果未经负责人检查阻断批准
 *   D3 负责人确认新版本后可批准并推进至 SAMPLING
 *   D4 重复相同请求不产生新记录（非业务修改不引发无意义重审）
 *
 * 仅使用独立测试库（断言库名以 _test 结尾），自建测试组织与身份，追加测试记录，不写入开发库。
 */

import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { createProject } from "../src/modules/projects/service";
import {
  assembleProductSuggestionPackage,
  commitProductSuggestionToGate,
} from "../src/modules/products/product-suggestion";
import {
  createDecisionPacketDraft,
  submitDecisionPacket,
  decideDecisionPacket,
} from "../src/modules/decisions/service";
import { buildArtifactRef } from "../src/modules/decisions/artifact-ref";
import { reviewWork } from "../src/modules/work/service";

const WORK_ITEM_TITLE = "产品定义与可行性研判";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
  console.log(`  ✔ ${message}`);
}

async function expectBlockedMatching(action: () => Promise<unknown>, label: string, matcher: RegExp) {
  try {
    const result = await action();
    throw new Error(`${label} 失败: 该操作未被阻断，实际返回 ${JSON.stringify(result)}`);
  } catch (err: any) {
    if (err.message?.startsWith(`${label} 失败`)) throw err;
    const code = err.statusCode;
    if (code !== 409 && code !== 422) {
      throw new Error(`${label} 失败: 期望 409/422 阻断，实际抛出 ${err.message}`);
    }
    if (!matcher.test(err.message)) {
      throw new Error(`${label} 失败: 阻断原因不符合预期 (${matcher})，实际: ${err.message}`);
    }
    console.log(`  ✔ ${label}: 已阻断 (${code}) - ${err.message}`);
  }
}

async function expectBlocked(action: () => Promise<unknown>, label: string) {
  try {
    const result = await action();
    throw new Error(`${label} 失败: 该操作未被阻断，实际返回 ${JSON.stringify(result)}`);
  } catch (err: any) {
    if (err.message?.startsWith(`${label} 失败`)) throw err;
    const code = err.statusCode;
    if (code !== 409 && code !== 422) {
      throw new Error(`${label} 失败: 期望 409/422 阻断，实际抛出 ${err.message}`);
    }
    console.log(`  ✔ ${label}: 已阻断 (${code}) - ${err.message}`);
  }
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);

  console.log("================================================================================");
  console.log("🧪 修订版本一致性回归套件 (C01 版本一致性)");
  console.log("================================================================================\n");

  const org = await prisma.organization.upsert({
    where: { code: "REVISION_REGRESSION_ORG" },
    update: {},
    create: { code: "REVISION_REGRESSION_ORG", name: "修订一致性回归机构" },
  });
  const upsertUser = (email: string, name: string) =>
    prisma.user.upsert({
      where: { email },
      update: { organizationId: org.id },
      create: { email, name, organizationId: org.id },
    });
  const owner = await upsertUser("revision-owner@hermes.test", "修订回归负责人");
  const leader = await upsertUser("revision-leader@hermes.test", "修订回归决策人");
  const ctx = (u: typeof owner) => ({
    userId: u.id,
    organizationId: u.organizationId,
    userEmail: u.email,
    userName: u.name,
  });

  const project = await createProject(ctx(owner), {
    title: `REVISION_REGRESSION_${Date.now()}`,
    target: "修订一致性回归验证（合成数据）",
    mode: "NEW_PRODUCT",
    isDemo: true,
    decisionMakerId: leader.id,
  });

  await prisma.evidence.create({
    data: {
      projectId: project.id,
      contentOrUri: "回归用已核实材料：同类竞品售价 80 元",
      source: "REGRESSION_FIXTURE",
      hash: `regression-fixture-${Date.now()}`,
      nature: "DEMO",
      verifyStatus: "VERIFIED",
      claims: {
        create: [
          {
            fieldKey: "price",
            fieldName: "竞品价格",
            kind: "FACT",
            value: "80",
            currency: "CNY",
          },
        ],
      },
    },
  });

  const workItemId = async () => {
    const item = await prisma.workItem.findFirst({ where: { projectId: project.id, title: WORK_ITEM_TITLE } });
    if (!item) throw new Error("未找到产品定义工作项");
    return item.id;
  };

  // --------------------------------------------------------------------------
  // 第一轮：原始规格 10g
  // --------------------------------------------------------------------------
  const original = await assembleProductSuggestionPackage(ctx(owner), project.id, {
    businessOptions: {
      commissionRate: 20,
      marketingRate: 5,
      batchQuantity: 100,
      shelfLifeMonths: 12,
      netWeight: "TEST ORIGINAL 10g",
    },
  });

  const first = await commitProductSuggestionToGate(ctx(owner), project.id, original, {
    isConfirmed: true,
    idempotencyKey: `${project.id}-r1`,
  });

  const firstSubmission = await prisma.workSubmission.findFirst({
    where: { workItemId: await workItemId(), attempt: 1 },
  });
  assert(!!firstSubmission, "A0: 首轮提交批次 #1 已生成");

  // --------------------------------------------------------------------------
  // 第二轮：修订规格为 20g 并修改研究结论
  // --------------------------------------------------------------------------
  const revised = structuredClone(original);
  revised.specificationBrief.netWeight = "TEST REVISED 20g";
  revised.researchReport.selectionRationale = "REVISED TEST RATIONALE";

  const second = await commitProductSuggestionToGate(ctx(owner), project.id, revised, {
    isConfirmed: true,
    idempotencyKey: `${project.id}-r2`,
  });

  const artifacts = await prisma.artifact.findMany({
    where: { workItemId: await workItemId() },
    orderBy: { contentVersion: "asc" },
  });
  const specVersions = artifacts.filter((a) => a.type === "SPECIFICATION_BRIEF");
  const reportVersions = artifacts.filter((a) => a.type === "MARKET_RESEARCH_REPORT");
  const latestSpec = specVersions[specVersions.length - 1];
  const latestReport = reportVersions[reportVersions.length - 1];

  console.log("\n▶ A1/A2 修订内容必须落库为新版本成果...");
  assert(
    (second.productVersion.specs as { netWeight: string }).netWeight === "TEST REVISED 20g",
    "A1: 产品版本规格已更新为 TEST REVISED 20g"
  );
  assert(
    JSON.parse(latestSpec.content).netWeight === "TEST REVISED 20g",
    "A1: 最新规格成果内容为 TEST REVISED 20g（不再停留在旧版 10g）"
  );
  assert(
    latestReport.content.includes("REVISED TEST RATIONALE"),
    "A2: 最新市场研究成果包含修订后的选择理由"
  );

  console.log("\n▶ A5 市场研究报告必须显式标注为待验证草案...");
  const reportPayload = JSON.parse(latestReport.content);
  assert(!!reportPayload.verification, "A5: 研究成果携带验证状态区块");
  assert(
    reportPayload.verification.status === "DRAFT_UNVERIFIED" ||
      reportPayload.verification.status === "PARTIALLY_EVIDENCED",
    `A5: 研究报告状态为待验证草案（${reportPayload.verification.status}）`
  );
  assert(
    reportPayload.verification.inferredSections.length > 0,
    "A5: 明确列出由规则模板推断、尚未取得证据的结论"
  );
  // 修订版的选择理由是本用例自行覆盖的人工文本，故正文标注检查针对系统生成的原始报告
  const systemReportPayload = JSON.parse(reportVersions[0].content);
  assert(
    systemReportPayload.marketInsights.overview.includes("待验证草案") &&
      systemReportPayload.selectionRationale.includes("待验证"),
    "A5: 系统生成的报告正文（趋势概述与选型理由）明确标注待验证，不再以肯定语气陈述模板结论"
  );
  assert(
    (second.productVersion.unknowns as unknown as string[]).some((item) => item.includes("待验证草案")),
    "A5: 产品版本 unknowns 中记录研究报告为待验证草案"
  );

  console.log("\n▶ A3 修订成果在负责人确认前保持待检查，且提交指针指向新批次...");
  assert(latestSpec.contentVersion === 2 && latestReport.contentVersion === 2, "A3: 修订产生成果 v2（历史 v1 保留）");
  assert(
    latestSpec.reviewStatus === "PENDING" && latestReport.reviewStatus === "PENDING",
    "A3: 修订成果在负责人确认前为 PENDING，不得自动形式验收"
  );
  const revisions = await prisma.workSubmission.findMany({
    where: { workItemId: await workItemId() },
    orderBy: { attempt: "asc" },
  });
  assert(revisions.length === 2 && revisions[1].status === "PENDING", "A3: 修订生成新提交批次 #2 且状态为待检查");
  const currentWorkItem = await prisma.workItem.findUnique({ where: { id: await workItemId() } });
  assert(
    currentWorkItem?.currentSubmissionId === revisions[1].id,
    "A3: 当前提交指针已更新至修订批次 #2"
  );

  console.log("\n▶ A4 历史成果与历史批次完整保留，检查记录说明确认的具体版本...");
  assert(
    specVersions.length === 2 && JSON.parse(specVersions[0].content).netWeight === "TEST ORIGINAL 10g",
    "A4: 历史规格成果 v1 保留原始 TEST ORIGINAL 10g"
  );
  assert(
    reportVersions.length === 2 && !reportVersions[0].content.includes("REVISED TEST RATIONALE"),
    "A4: 历史研究成果 v1 保留原始结论"
  );
  assert(
    revisions[0].status === "ACCEPTED" && !!revisions[0].reviewedById && !!revisions[0].reviewedAt,
    "A4: 历史批次 #1 的检查记录完整保留"
  );
  assert(
    !!revisions[0].reviewReason && !revisions[0].reviewReason.includes("自动形式验收"),
    `A4: 检查记录说明负责人确认的具体版本，而非“自动形式验收”（实际: ${revisions[0].reviewReason}）`
  );

  console.log("\n▶ D1 引用旧产品版本与旧成果的决策包必须阻断批准...");
  await submitDecisionPacket(ctx(owner), first.decisionPacket.id);
  await expectBlocked(
    () => decideDecisionPacket(ctx(leader), first.decisionPacket.id, { decision: "APPROVE", reason: "尝试用旧成果批准" }),
    "D1 旧成果引用阻断"
  );

  // D1b 与产品版本检查相互独立：即使绑定当前产品版本，引用被取代的旧成果仍必须阻断
  const stalePacket = await createDecisionPacketDraft(ctx(owner), {
    projectId: project.id,
    productVersionId: second.productVersion.id,
    artifactVersions: [buildArtifactRef(specVersions[0]), buildArtifactRef(reportVersions[0])],
    evidenceVersions: second.decisionPacket.evidenceVersions as Array<{ id: string; hash: string }>,
    budgetAmount: 1000,
    budgetCurrency: "CNY",
    budgetScope: "旧成果阻断验证",
    validationPlan: "旧成果阻断验证",
    requiredChecks: { inputBaselineRevision: specVersions[0].inputRevision },
  });
  await submitDecisionPacket(ctx(owner), stalePacket.id);
  await expectBlockedMatching(
    () => decideDecisionPacket(ctx(leader), stalePacket.id, { decision: "APPROVE", reason: "尝试用被取代的旧成果批准" }),
    "D1b 旧成果被取代阻断",
    /superseded by v2/
  );

  console.log("\n▶ D2 新成果未经负责人检查时必须阻断批准...");
  await submitDecisionPacket(ctx(owner), second.decisionPacket.id);
  await expectBlocked(
    () => decideDecisionPacket(ctx(leader), second.decisionPacket.id, { decision: "APPROVE", reason: "尝试批准未检查成果" }),
    "D2 新成果待检查阻断"
  );

  console.log("\n▶ D3 负责人确认新版本后可批准并推进至 SAMPLING...");
  await reviewWork(ctx(owner), await workItemId(), {
    accepted: true,
    reason: "已逐项核对修订版规格 TEST REVISED 20g 与市场研究报告 v2（输入基线 r2），确认采纳",
  });
  const approval = await decideDecisionPacket(ctx(leader), second.decisionPacket.id, {
    decision: "APPROVE",
    reason: "修订成果已由负责人确认，产品版本与成果版本一致，准予打样",
  });
  assert(approval.packet?.status === "APPROVED", "D3: 负责人确认后决策包批准通过");
  assert(approval.project.stage === "SAMPLING", "D3: 项目阶段推进至 SAMPLING");

  console.log("\n▶ D4 重复相同请求不产生新记录、不引发无意义重审...");
  const beforeSubmissions = await prisma.workSubmission.count({ where: { workItemId: await workItemId() } });
  const beforeArtifacts = await prisma.artifact.count({ where: { workItemId: await workItemId() } });

  // D4-1 同一幂等键重放：直接复用原响应记录
  const replaySameKey = await commitProductSuggestionToGate(ctx(owner), project.id, revised, {
    isConfirmed: true,
    idempotencyKey: `${project.id}-r2`,
  });
  assert(
    replaySameKey.decisionPacket.id === second.decisionPacket.id,
    "D4: 同一幂等键重放复用原决策包记录"
  );

  // D4-2 新幂等键但内容未变：不产生新批次、新成果，原成果验收状态不被重置
  const replay = await commitProductSuggestionToGate(ctx(owner), project.id, revised, {
    isConfirmed: true,
    idempotencyKey: `${project.id}-r2-replay`,
  });
  const afterSubmissions = await prisma.workSubmission.count({ where: { workItemId: await workItemId() } });
  const afterArtifacts = await prisma.artifact.count({ where: { workItemId: await workItemId() } });
  assert(
    beforeSubmissions === afterSubmissions && beforeArtifacts === afterArtifacts,
    "D4: 相同内容重复提交未产生新的批次与成果记录"
  );
  assert(replay.productVersion.id === second.productVersion.id, "D4: 相同内容复用原产品版本记录");
  assert(
    JSON.stringify(replay.decisionPacket.artifactVersions) === JSON.stringify(second.decisionPacket.artifactVersions),
    "D4: 相同内容复用同一批已验收成果引用"
  );
  const specAfterReplay = await prisma.artifact.findFirst({
    where: { workItemId: await workItemId(), type: "SPECIFICATION_BRIEF" },
    orderBy: { contentVersion: "desc" },
  });
  assert(
    specAfterReplay?.reviewStatus === "ACCEPTED",
    "D4: 无业务修改未把已验收成果重置为待检查（不引发无意义重审）"
  );

  console.log("\n================================================================================");
  console.log("🏆 修订版本一致性回归全绿：A1-A4 与 D1-D4 八项断言全部通过！");
  console.log("================================================================================\n");
}

main()
  .catch((error) => {
    console.error("\n❌ 修订版本一致性回归失败:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
