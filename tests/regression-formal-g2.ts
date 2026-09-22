import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import type { SessionContext } from "../src/modules/identity/session";
import {
  confirmProductionDelivery,
  confirmProductionStart,
  prepareProduction,
  requestFormalG2Approval,
} from "../src/modules/production/service";
import { decideDecisionPacket } from "../src/modules/decisions/service";
import { computeInputFingerprint } from "../src/modules/work/structured-artifacts";
import { ARTIFACT_SCHEMA_VERSION } from "../src/modules/work/artifact-schema";
import {
  DecisionOutcome,
  ProjectMode,
  ProjectStage,
  Role,
  WorkExecutorType,
  WorkItemStatus,
} from "@prisma/client";

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
  console.log(`  ✔ ${message}`);
}

async function expectFailure(fn: () => Promise<unknown>, contains: string) {
  let error: any = null;
  try {
    await fn();
  } catch (e: any) {
    error = e;
  }
  check(!!error, `预期失败：${contains}`);
  check(String(error?.message ?? "").includes(contains), `错误原因包含「${contains}」`);
}

function contentEnvelope(
  business: Record<string, unknown>,
  ctx: { organizationId: string; projectId: string; productVersionId: string; recordedBy: string }
) {
  return JSON.stringify({
    ...business,
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    productId: null,
    productVersionId: ctx.productVersionId,
    sourceRefs: [],
    inputFingerprint: computeInputFingerprint(business),
    dataNature: "REAL",
    assumptions: [],
    missingInputs: [],
    recordedBy: ctx.recordedBy,
    confirmedBy: null,
    confirmedAt: null,
  });
}

async function addArtifact(params: {
  workItemId: string;
  organizationId: string;
  projectId: string;
  productVersionId: string;
  recordedBy: string;
  inputRevision: number;
  type: string;
  title: string;
  business: Record<string, unknown>;
  contentVersion?: number;
}) {
  return prisma.artifact.create({
    data: {
      workItemId: params.workItemId,
      organizationId: params.organizationId,
      productVersionId: params.productVersionId,
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      type: params.type,
      title: params.title,
      content: contentEnvelope(params.business, params),
      contentVersion: params.contentVersion ?? 1,
      inputRevision: params.inputRevision,
      reviewStatus: "ACCEPTED",
      producerType: "MANUAL",
    },
  });
}

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = `g2-${Date.now()}`;

  const org = await prisma.organization.create({
    data: { code: tag, name: "Formal G2 回归机构" },
  });
  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `${tag}-owner@hermes.test`,
      name: "G2 项目负责人",
    },
  });
  const dm = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `${tag}-dm@hermes.test`,
      name: "G2 指定决策人",
    },
  });

  const ownerSession: SessionContext = {
    userId: owner.id,
    organizationId: org.id,
    userEmail: owner.email,
    userName: owner.name,
  };
  const dmSession: SessionContext = {
    userId: dm.id,
    organizationId: org.id,
    userEmail: dm.email,
    userName: dm.name,
  };

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      name: "Formal G2 新品",
      identityCode: `${tag}-product`,
      targetAudience: "测试人群",
      marketPath: "DOMESTIC",
      devMode: "SELF_DEVELOPED",
      ownerId: owner.id,
      lifecycleStage: "SAMPLING",
    },
  });
  const version = await prisma.productVersion.create({
    data: {
      productId: product.id,
      versionTag: "v1",
      specs: { formSpec: "3g*10条/盒" },
      targetCost: 8,
      isConfirmed: true,
    },
  });
  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      productId: product.id,
      productVersionId: version.id,
      mode: ProjectMode.NEW_PRODUCT,
      stage: ProjectStage.SAMPLING,
      title: "Formal G2 新品项目",
      target: "验证生产投入授权",
      ownerId: owner.id,
      decisionMakerId: dm.id,
      members: {
        create: [
          { userId: owner.id, role: Role.OWNER },
          { userId: dm.id, role: Role.DECISION_MAKER },
        ],
      },
    },
  });

  const sampleWork = await prisma.workItem.create({
    data: {
      projectId: project.id,
      title: "样品验收",
      target: "确认当前版本样品",
      deliverableReq: "SAMPLE_ROUND",
      executorType: WorkExecutorType.HUMAN,
      status: WorkItemStatus.ACCEPTED,
      inputRevision: project.revision,
    },
  });
  const sample = await addArtifact({
    workItemId: sampleWork.id,
    organizationId: org.id,
    projectId: project.id,
    productVersionId: version.id,
    recordedBy: owner.id,
    inputRevision: project.revision,
    type: "SAMPLE_ROUND",
    title: "第一轮样品",
    business: {
      round: 1,
      factoryRef: "测试工厂",
      sampleDate: "2026-09-20",
      verdict: "PASS",
      issues: [],
      nextAction: "进入生产准备",
    },
  });

  // 1. 样品 PASS 只能进入 PRODUCTION_PREP，不能直接视为生产获批。
  const prepared = await prepareProduction(ownerSession, project.id);
  check(prepared.stage === ProjectStage.PRODUCTION_PREP, "新品样品 PASS 后显式进入 PRODUCTION_PREP");
  const afterPrepare = await prisma.project.findUnique({ where: { id: project.id } });
  check(afterPrepare?.stage === ProjectStage.PRODUCTION_PREP, "数据库项目阶段为 PRODUCTION_PREP");
  check(
    (await prisma.decisionPacket.count({ where: { projectId: project.id, gate: "PRODUCTION_GATE" } })) === 0,
    "进入生产准备不伪造 G2 批准"
  );

  const prepRevision = afterPrepare!.revision;
  const quoteWork = await prisma.workItem.findFirst({
    where: { projectId: project.id, title: "[G2] 供应商正式报价" },
  });
  const professionalWork = await prisma.workItem.findFirst({
    where: { projectId: project.id, title: "[G2] 专业与合规确认" },
  });
  const packagingWork = await prisma.workItem.findFirst({
    where: { projectId: project.id, title: "[G2] 包装生产确认" },
  });
  const planWork = await prisma.workItem.findFirst({
    where: { projectId: project.id, title: "[G2] 生产投入计划" },
  });
  check(!!quoteWork && !!professionalWork && !!packagingWork && !!planWork, "生产准备自动建立四类 G2 准备工作项");

  const quote1 = await addArtifact({
    workItemId: quoteWork!.id,
    organizationId: org.id,
    projectId: project.id,
    productVersionId: version.id,
    recordedBy: owner.id,
    inputRevision: prepRevision,
    type: "SUPPLIER_QUOTE",
    title: "供应商报价 v1",
    business: {
      supplierRef: "工厂A",
      specification: "3g*10条/盒",
      quantity: 1000,
      moq: 500,
      unitPrice: 10,
      currency: "CNY",
      taxBasis: "含税",
      leadTime: "30天",
      validUntil: "2030-12-31",
      paymentTerms: "30/70",
    },
  });
  await addArtifact({
    workItemId: professionalWork!.id,
    organizationId: org.id,
    projectId: project.id,
    productVersionId: version.id,
    recordedBy: owner.id,
    inputRevision: prepRevision,
    type: "PROFESSIONAL_CONFIRMATION",
    title: "专业确认",
    business: {
      domain: "生产合规",
      appliesToIdentity: "普通食品",
      appliesToRegion: "中国大陆",
      appliesToChannel: "电商",
      materialRefs: [],
      scopeItems: ["标签", "生产条件"],
      validUntil: "2030-12-31",
      confirmedByPerson: "合规负责人",
      recordedByPerson: "项目负责人",
    },
  });
  const packaging = await addArtifact({
    workItemId: packagingWork!.id,
    organizationId: org.id,
    projectId: project.id,
    productVersionId: version.id,
    recordedBy: owner.id,
    inputRevision: prepRevision,
    type: "PACKAGING_BRIEF",
    title: "包装确认",
    business: {
      packagingVersion: "P1",
      format: "盒",
      material: "纸盒+铝膜条包",
      specification: "10条/盒",
      complianceNotes: ["标签已核对"],
    },
  });
  const plan1 = await addArtifact({
    workItemId: planWork!.id,
    organizationId: org.id,
    projectId: project.id,
    productVersionId: version.id,
    recordedBy: owner.id,
    inputRevision: prepRevision,
    type: "PRODUCTION_PLAN",
    title: "生产计划 v1",
    business: {
      quantity: 1000,
      unit: "盒",
      budget: 10000,
      currency: "CNY",
      quoteRefs: [quote1.id],
      sampleRefs: [sample.id],
      packagingRefs: [packaging.id],
      leadTime: "30天",
      productionConditions: ["报价有效", "包装确认未变化"],
      stopConditions: ["规格或金额越界"],
    },
  });

  // 2. 负责人提交；负责人不能自批；批准不推进到 PRODUCTION。
  const submitted1 = await requestFormalG2Approval(ownerSession, project.id);
  check(submitted1.status === "IN_REVIEW", "正式 G2 提交后进入 IN_REVIEW");
  const packet1 = await prisma.decisionPacket.findUnique({ where: { id: submitted1.packetId } });
  check(packet1?.gate === "PRODUCTION_GATE", "G2 使用统一 DecisionPacket(PRODUCTION_GATE)");
  check(
    Array.isArray(packet1?.artifactVersions) && (packet1!.artifactVersions as any[]).every((x) => x.id && x.contentHash),
    "G2 冻结精确成果 id + 内容指纹"
  );

  await expectFailure(
    () =>
      decideDecisionPacket(ownerSession, submitted1.packetId, {
        decision: DecisionOutcome.APPROVE,
        reason: "负责人尝试自批",
      }),
    "Only the designated project decision maker"
  );
  check(
    (await prisma.decision.count({ where: { packetId: submitted1.packetId } })) === 0,
    "负责人自批失败且零 Decision"
  );

  // 3. 待审批时关键报价变化：旧包自动撤回，不能捡回旧快照。
  const quote2 = await addArtifact({
    workItemId: quoteWork!.id,
    organizationId: org.id,
    projectId: project.id,
    productVersionId: version.id,
    recordedBy: owner.id,
    inputRevision: prepRevision,
    type: "SUPPLIER_QUOTE",
    title: "供应商报价 v2",
    contentVersion: 2,
    business: {
      supplierRef: "工厂A",
      specification: "3g*10条/盒",
      quantity: 1000,
      moq: 500,
      unitPrice: 9.5,
      currency: "CNY",
      taxBasis: "含税",
      leadTime: "30天",
      validUntil: "2030-12-31",
      paymentTerms: "30/70",
    },
  });
  await addArtifact({
    workItemId: planWork!.id,
    organizationId: org.id,
    projectId: project.id,
    productVersionId: version.id,
    recordedBy: owner.id,
    inputRevision: prepRevision,
    type: "PRODUCTION_PLAN",
    title: "生产计划 v2",
    contentVersion: 2,
    business: {
      quantity: 1000,
      unit: "盒",
      budget: 9500,
      currency: "CNY",
      quoteRefs: [quote2.id],
      sampleRefs: [sample.id],
      packagingRefs: [packaging.id],
      leadTime: "30天",
      productionConditions: ["报价有效", "包装确认未变化"],
      stopConditions: ["规格或金额越界"],
    },
  });

  const submitted2 = await requestFormalG2Approval(ownerSession, project.id);
  check(submitted2.packetId !== submitted1.packetId, "关键输入变化后创建新的 G2 包");
  check(
    (await prisma.decisionPacket.findUnique({ where: { id: submitted1.packetId } }))?.status === "WITHDRAWN",
    "旧 IN_REVIEW G2 快照自动撤回"
  );

  await decideDecisionPacket(dmSession, submitted2.packetId, {
    decision: DecisionOutcome.APPROVE,
    reason: "当前生产计划、报价、样品与包装已满足生产投入条件",
  });
  check(
    (await prisma.project.findUnique({ where: { id: project.id } }))?.stage === ProjectStage.PRODUCTION_PREP,
    "G2 批准仍停留在 PRODUCTION_PREP，不把批准伪装成已生产"
  );

  // 4. 批准后生产计划越界变化：实际开工必须重新审批。
  await addArtifact({
    workItemId: planWork!.id,
    organizationId: org.id,
    projectId: project.id,
    productVersionId: version.id,
    recordedBy: owner.id,
    inputRevision: prepRevision,
    type: "PRODUCTION_PLAN",
    title: "生产计划 v3",
    contentVersion: 3,
    business: {
      quantity: 1500,
      unit: "盒",
      budget: 14000,
      currency: "CNY",
      quoteRefs: [quote2.id],
      sampleRefs: [sample.id],
      packagingRefs: [packaging.id],
      leadTime: "35天",
      productionConditions: ["报价有效", "包装确认未变化"],
      stopConditions: ["规格或金额越界"],
    },
  });
  await expectFailure(
    () => confirmProductionStart(ownerSession, project.id, "工厂准备开工"),
    "必须重新提交 G2"
  );

  const submitted3 = await requestFormalG2Approval(ownerSession, project.id);
  await decideDecisionPacket(dmSession, submitted3.packetId, {
    decision: DecisionOutcome.APPROVE,
    reason: "调整后的数量、预算与交期重新获得生产投入授权",
  });
  const started = await confirmProductionStart(ownerSession, project.id, "工厂已确认排产并完成首批投料");
  check(started.stage === ProjectStage.PRODUCTION, "真实开工后才进入 PRODUCTION");

  // 5. 真实交付需要当前版本、已验收、REAL 的生产记录，且不能突破 G2 授权数量/单位。
  const tracking = await prisma.workItem.findUnique({ where: { id: started.trackingWorkItemId } });
  check(!!tracking, "开工后建立生产执行/交付记录任务");

  const overrunRecord = await addArtifact({
    workItemId: started.trackingWorkItemId,
    organizationId: org.id,
    projectId: project.id,
    productVersionId: version.id,
    recordedBy: owner.id,
    inputRevision: started.revision,
    type: "PRODUCTION_RECORD",
    title: "越界生产记录",
    business: {
      authorizationRef: submitted3.packetId,
      batchNo: "BATCH-OVERRUN",
      quantity: 1600,
      unit: "盒",
      factoryRef: "工厂A",
      producedAt: "2026-09-22",
      conditions: ["超出已批准生产数量"],
      exceptions: ["实际数量超过 G2 授权"],
      deliveryConfirmation: "不得据此确认交付",
    },
  });
  await expectFailure(
    () => confirmProductionDelivery(ownerSession, project.id, "尝试确认越界交付"),
    "超过 G2 授权数量"
  );
  await prisma.artifact.update({
    where: { id: overrunRecord.id },
    data: { reviewStatus: "REJECTED" },
  });

  const productionRecord = await addArtifact({
    workItemId: started.trackingWorkItemId,
    organizationId: org.id,
    projectId: project.id,
    productVersionId: version.id,
    recordedBy: owner.id,
    inputRevision: started.revision,
    type: "PRODUCTION_RECORD",
    title: "首批生产交付记录",
    contentVersion: 2,
    business: {
      authorizationRef: submitted3.packetId,
      batchNo: "BATCH-001",
      quantity: 1500,
      unit: "盒",
      factoryRef: "工厂A",
      producedAt: "2026-09-22",
      conditions: ["按 G2 授权计划执行"],
      exceptions: [],
      deliveryConfirmation: "首批1500盒已入仓并取得签收记录",
    },
  });
  const delivered = await confirmProductionDelivery(ownerSession, project.id, "首批货物已完成入仓签收");
  check(delivered.stage === ProjectStage.DELIVERED, "真实生产记录验收后项目进入 DELIVERED");
  check(delivered.productionRecordId === productionRecord.id, "交付回执绑定真实 PRODUCTION_RECORD");

  // 6. 固定产品路径：不要求伪造 G1 / SAMPLE_ROUND。
  const fixedProject = await prisma.project.create({
    data: {
      organizationId: org.id,
      productId: product.id,
      productVersionId: version.id,
      mode: ProjectMode.FIXED_PRODUCT,
      stage: ProjectStage.PRODUCTION_PREP,
      title: "Formal G2 固定产品项目",
      target: "验证固定产品无需伪造 G1",
      ownerId: owner.id,
      decisionMakerId: dm.id,
      members: {
        create: [
          { userId: owner.id, role: Role.OWNER },
          { userId: dm.id, role: Role.DECISION_MAKER },
        ],
      },
    },
  });
  const fixedWork = await prisma.workItem.create({
    data: {
      projectId: fixedProject.id,
      title: "固定产品 G2 材料",
      target: "整理现有产品生产投入材料",
      deliverableReq: "G2 structured artifacts",
      executorType: WorkExecutorType.HUMAN,
      status: WorkItemStatus.ACCEPTED,
      inputRevision: fixedProject.revision,
    },
  });
  const fixedCtx = {
    workItemId: fixedWork.id,
    organizationId: org.id,
    projectId: fixedProject.id,
    productVersionId: version.id,
    recordedBy: owner.id,
    inputRevision: fixedProject.revision,
  };
  const fixedQuote = await addArtifact({
    ...fixedCtx,
    type: "SUPPLIER_QUOTE",
    title: "固定产品报价",
    business: {
      supplierRef: "既有工厂",
      specification: "3g*10条/盒",
      quantity: 500,
      moq: 200,
      unitPrice: 10,
      currency: "CNY",
      taxBasis: "含税",
      leadTime: "20天",
      validUntil: "2030-12-31",
      paymentTerms: "30/70",
    },
  });
  await addArtifact({
    ...fixedCtx,
    type: "PROFESSIONAL_CONFIRMATION",
    title: "固定产品适用确认",
    business: {
      domain: "生产合规",
      appliesToIdentity: "既有已确认产品",
      appliesToRegion: "中国大陆",
      appliesToChannel: "电商",
      materialRefs: [],
      scopeItems: ["当前版本适用性"],
      validUntil: "2030-12-31",
      confirmedByPerson: "合规负责人",
      recordedByPerson: "项目负责人",
    },
  });
  const fixedPackaging = await addArtifact({
    ...fixedCtx,
    type: "PACKAGING_BRIEF",
    title: "固定产品包装",
    business: {
      packagingVersion: "P1",
      format: "盒",
      material: "纸盒",
      specification: "10条/盒",
      complianceNotes: ["既有包装确认"],
    },
  });
  await addArtifact({
    ...fixedCtx,
    type: "PRODUCTION_PLAN",
    title: "固定产品生产计划",
    business: {
      quantity: 500,
      unit: "盒",
      budget: 5000,
      currency: "CNY",
      quoteRefs: [fixedQuote.id],
      sampleRefs: [],
      packagingRefs: [fixedPackaging.id],
      leadTime: "20天",
      productionConditions: ["当前版本与确认资料适用"],
      stopConditions: ["规格或预算变化"],
    },
  });

  const fixedG2 = await requestFormalG2Approval(ownerSession, fixedProject.id);
  check(fixedG2.status === "IN_REVIEW", "固定产品无需伪造 G1/SAMPLE_ROUND 也可提交正式 G2");

  const invalidationAudit = await prisma.auditEvent.count({
    where: { action: "FORMAL_G2_INVALIDATED", objectType: "DecisionPacket" },
  });
  check(invalidationAudit >= 1, "G2 关键输入漂移留下 FORMAL_G2_INVALIDATED 审计");

  console.log("\n✅ Formal G2 governance regression passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
