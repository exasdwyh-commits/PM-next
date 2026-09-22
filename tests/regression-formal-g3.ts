import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import type { SessionContext } from "../src/modules/identity/session";
import {
  confirmLaunchExecution,
  prepareLaunch,
  requestFormalG3Approval,
  updateLaunchBasics,
  upsertMilestone,
} from "../src/modules/launch/service";
import { decideDecisionPacket } from "../src/modules/decisions/service";
import { DecisionOutcome, LaunchMilestoneStatus } from "@prisma/client";
import { ARTIFACT_SCHEMA_VERSION } from "../src/modules/work/artifact-schema";
import { computeInputFingerprint } from "../src/modules/work/structured-artifacts";

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

async function main() {
  await assertTestDatabaseSafety(prisma);

  const tag = `g3-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { code: tag, name: "Formal G3 回归机构" },
  });
  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `${tag}-owner@hermes.test`,
      name: "G3 项目负责人",
    },
  });
  const dm = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `${tag}-dm@hermes.test`,
      name: "G3 指定决策人",
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
      name: "Formal G3 合成产品",
      identityCode: `${tag}-product`,
      targetAudience: "合成人群",
      marketPath: "DOMESTIC",
      devMode: "SELF_DEVELOPED",
      ownerId: owner.id,
      lifecycleStage: "LAUNCH_PREP",
    },
  });
  const version = await prisma.productVersion.create({
    data: {
      productId: product.id,
      versionTag: "v1",
      specs: { coreIdea: "G3 回归产品" },
      isConfirmed: true,
    },
  });
  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      productId: product.id,
      productVersionId: version.id,
      mode: "NEW_PRODUCT",
      stage: "DELIVERED",
      title: "Formal G3 回归项目",
      target: "验证正式上市授权治理",
      ownerId: owner.id,
      decisionMakerId: dm.id,
      members: {
        create: [
          { userId: owner.id, role: "OWNER" },
          { userId: dm.id, role: "DECISION_MAKER" },
        ],
      },
    },
  });

  const prepared = await prepareLaunch(ownerSession, {
    productId: product.id,
    projectId: project.id,
    ownerId: owner.id,
    targetDate: "2026-12-01",
    title: "Formal G3 上市计划",
    milestones: [
      {
        title: "合规资料确认",
        kind: "COMPLIANCE",
        status: LaunchMilestoneStatus.DONE,
      },
      {
        title: "首批供货确认",
        kind: "SUPPLY",
        status: LaunchMilestoneStatus.DONE,
      },
    ],
  });
  const planId = prepared.planId;

  // G3 必须建立在正式 G2 + 当前版本真实生产交付之上，不能仅凭上市里程碑绕过生产门。
  await expectFailure(
    () => requestFormalG3Approval(ownerSession, planId),
    "正式 G2"
  );

  const g2Packet = await prisma.decisionPacket.create({
    data: {
      projectId: project.id,
      gate: "PRODUCTION_GATE",
      productVersionId: version.id,
      artifactVersions: [],
      evidenceVersions: [],
      budgetAmount: 10000,
      budgetCurrency: "CNY",
      budgetScope: "1000 盒正式生产",
      validationPlan: "正式生产投入已批准",
      requiredChecks: {
        productionAuthorization: {
          quantity: 1000,
          unit: "盒",
          budget: 10000,
          currency: "CNY",
        },
      },
      scopeHash: `g2-${tag}`,
      status: "APPROVED",
    },
  });
  await prisma.decision.create({
    data: {
      packetId: g2Packet.id,
      actorId: dm.id,
      decision: "APPROVE",
      reason: "G3 回归夹具：正式 G2 已批准",
    },
  });
  const productionWork = await prisma.workItem.create({
    data: {
      projectId: project.id,
      title: "G3 回归生产记录",
      target: "证明真实生产交付",
      deliverableReq: "PRODUCTION_RECORD",
      status: "ACCEPTED",
      executorType: "HUMAN",
      inputRevision: project.revision,
    },
  });
  const productionBusiness = {
    authorizationRef: g2Packet.id,
    batchNo: "G3-BATCH-001",
    quantity: 1000,
    unit: "盒",
    factoryRef: "G3 测试工厂",
    producedAt: "2026-09-22",
    conditions: ["按 G2 授权生产"],
    exceptions: [],
    deliveryConfirmation: "首批货物已完成真实入仓交付",
  };
  await prisma.artifact.create({
    data: {
      workItemId: productionWork.id,
      organizationId: org.id,
      productVersionId: version.id,
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      type: "PRODUCTION_RECORD",
      title: "G3 上市前生产交付依据",
      contentVersion: 1,
      inputRevision: project.revision,
      reviewStatus: "ACCEPTED",
      producerType: "MANUAL",
      content: JSON.stringify({
        ...productionBusiness,
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        organizationId: org.id,
        projectId: project.id,
        productId: product.id,
        productVersionId: version.id,
        sourceRefs: [],
        inputFingerprint: computeInputFingerprint(productionBusiness),
        dataNature: "REAL",
        assumptions: [],
        missingInputs: [],
        recordedBy: owner.id,
        confirmedBy: null,
        confirmedAt: null,
      }),
    },
  });

  // 1. 负责人只能提交，提交本身不能产生正式授权。
  const submitted1 = await requestFormalG3Approval(ownerSession, planId);
  check(submitted1.status === "IN_REVIEW", "负责人提交后 G3 进入 IN_REVIEW");
  const packet1 = await prisma.decisionPacket.findUnique({ where: { id: submitted1.packetId } });
  check(packet1?.gate === "LAUNCH_GATE", "G3 使用统一 DecisionPacket.LAUNCH_GATE");
  check(!!packet1?.launchPlanHash, "G3 冻结上市计划内容指纹");

  const beforeDecision = await prisma.launchPlan.findUnique({ where: { id: planId } });
  check(!beforeDecision?.formalG3PacketId, "仅提交不会写正式 G3 授权");

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
    "负责人自批被拒后没有写 Decision"
  );

  // 2. 送审期间修改计划：旧包必须退出评审队列，不能继续批准。
  await updateLaunchBasics(ownerSession, planId, {
    notes: "送审后补充渠道执行说明，必须触发旧 G3 快照失效",
  });
  const stalePacket = await prisma.decisionPacket.findUnique({ where: { id: submitted1.packetId } });
  check(stalePacket?.status === "WITHDRAWN", "上市计划变化后旧 IN_REVIEW G3 自动撤回");

  await expectFailure(
    () =>
      decideDecisionPacket(dmSession, submitted1.packetId, {
        decision: DecisionOutcome.APPROVE,
        reason: "尝试批准已失效快照",
      }),
    "packet must be IN_REVIEW"
  );

  // 3. 基于新计划重新送审，由独立决策人批准；ProjectStage 不被 G3 错误推进。
  const submitted2 = await requestFormalG3Approval(ownerSession, planId);
  check(submitted2.packetId !== submitted1.packetId, "计划变化后生成新的 G3 决策包");
  check(submitted2.status === "IN_REVIEW", "新 G3 决策包重新进入 IN_REVIEW");

  await decideDecisionPacket(dmSession, submitted2.packetId, {
    decision: DecisionOutcome.APPROVE,
    reason: "全部上市依赖闭环，批准正式 G3",
  });

  const approvedPlan = await prisma.launchPlan.findUnique({ where: { id: planId } });
  check(approvedPlan?.formalG3PacketId === submitted2.packetId, "批准后 LaunchPlan 指向当前正式 G3 决策包");
  check(!!approvedPlan?.formalG3ApprovedAt, "批准后记录正式 G3 时间");
  check(
    (await prisma.project.findUnique({ where: { id: project.id } }))?.stage === "DELIVERED",
    "G3 只授权上市，不错误改写 ProjectStage"
  );
  check(
    (await prisma.decision.count({ where: { packetId: submitted2.packetId } })) === 1,
    "G3 批准写入一条 append-only Decision"
  );

  // 4. 正式批准后再修改计划：当前有效指针清空，但历史批准永久保留。
  await updateLaunchBasics(ownerSession, planId, {
    notes: "正式 G3 后修改渠道排期，当前授权应失效",
  });
  const invalidatedPlan = await prisma.launchPlan.findUnique({ where: { id: planId } });
  check(!invalidatedPlan?.formalG3PacketId, "G3 后实质修改会清空当前有效授权指针");
  check(!invalidatedPlan?.formalG3ApprovedAt, "G3 后实质修改会清空当前有效授权时间");
  check(
    (await prisma.decisionPacket.findUnique({ where: { id: submitted2.packetId } }))?.status === "APPROVED",
    "历史 G3 决策包仍保持 APPROVED，不篡改审计历史"
  );
  check(
    (await prisma.decision.count({ where: { packetId: submitted2.packetId } })) === 1,
    "历史 Decision 仍然保留"
  );

  await expectFailure(
    () =>
      confirmLaunchExecution(ownerSession, planId, {
        note: "没有当前 G3 时尝试上市",
      }),
    "尚未取得当前有效的正式 G3"
  );

  // 5. 再次审批后，如果生产交付依据又变化，实际上市必须让旧 G3 失效并重新审批。
  const submitted3 = await requestFormalG3Approval(ownerSession, planId);
  await decideDecisionPacket(dmSession, submitted3.packetId, {
    decision: DecisionOutcome.APPROVE,
    reason: "更新后的上市计划再次通过正式 G3",
  });

  const revisedProductionBusiness = {
    ...productionBusiness,
    batchNo: "G3-BATCH-002",
    quantity: 900,
    deliveryConfirmation: "交付记录补充为最终入仓 900 盒",
  };
  await prisma.artifact.create({
    data: {
      workItemId: productionWork.id,
      organizationId: org.id,
      productVersionId: version.id,
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      type: "PRODUCTION_RECORD",
      title: "G3 上市前生产交付依据 v2",
      contentVersion: 2,
      inputRevision: project.revision,
      reviewStatus: "ACCEPTED",
      producerType: "MANUAL",
      content: JSON.stringify({
        ...revisedProductionBusiness,
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        organizationId: org.id,
        projectId: project.id,
        productId: product.id,
        productVersionId: version.id,
        sourceRefs: [],
        inputFingerprint: computeInputFingerprint(revisedProductionBusiness),
        dataNature: "REAL",
        assumptions: [],
        missingInputs: [],
        recordedBy: owner.id,
        confirmedBy: null,
        confirmedAt: null,
      }),
    },
  });

  await expectFailure(
    () =>
      confirmLaunchExecution(ownerSession, planId, {
        note: "生产依据变化后尝试沿用旧 G3 上市",
      }),
    "当前正式 G3 已因项目/生产交付基线变化而失效"
  );
  const afterProductionDrift = await prisma.launchPlan.findUnique({ where: { id: planId } });
  check(!afterProductionDrift?.formalG3PacketId, "生产交付依据变化后当前 G3 指针被清空");
  check(
    (await prisma.decisionPacket.findUnique({ where: { id: submitted3.packetId } }))?.status === "APPROVED",
    "生产依据变化只失效当前授权，不篡改历史 G3 APPROVED 记录"
  );

  const submitted4 = await requestFormalG3Approval(ownerSession, planId);
  await decideDecisionPacket(dmSession, submitted4.packetId, {
    decision: DecisionOutcome.APPROVE,
    reason: "按更新后的真实生产交付依据重新批准正式 G3",
  });

  const launched = await confirmLaunchExecution(ownerSession, planId, {
    note: "渠道正式上线并完成首批出货",
  });
  check(launched.lifecycleStage === "LAUNCHED", "当前有效正式 G3 后可确认实际上市");
  check(launched.authorization.formalG3 === true, "实际上市回执明确携带 FORMAL_G3 授权");
  check(
    (await prisma.product.findUnique({ where: { id: product.id } }))?.lifecycleStage === "LAUNCHED",
    "产品生命周期真实进入 LAUNCHED"
  );

  await expectFailure(
    () => updateLaunchBasics(ownerSession, planId, { notes: "上市后篡改历史" }),
    "历史上市计划不可再修改"
  );

  // 6. 仅有旧 approvedAt 不能绕过正式 G3。
  const legacyPlan = await prisma.launchPlan.create({
    data: {
      organizationId: org.id,
      productId: product.id,
      projectId: project.id,
      title: "旧机制批准夹具",
      targetDate: new Date("2026-12-15T00:00:00Z"),
      ownerId: owner.id,
      status: "ACTIVE",
      approvedAt: new Date(),
      createdById: owner.id,
    },
  });
  await prisma.launchMilestone.create({
    data: {
      planId: legacyPlan.id,
      organizationId: org.id,
      title: "旧机制里程碑",
      kind: "OTHER",
      status: "DONE",
      completedAt: new Date(),
    },
  });
  await expectFailure(
    () =>
      confirmLaunchExecution(ownerSession, legacyPlan.id, {
        note: "只有旧 approvedAt 也不应允许上市",
      }),
    "旧机制批准不能替代正式 G3"
  );

  const invalidationAudits = await prisma.auditEvent.count({
    where: {
      objectId: product.id,
      action: "FORMAL_G3_INVALIDATED",
    },
  });
  check(invalidationAudits >= 3, "待审批、计划变更与生产依据漂移都留下 G3 失效审计事件");

  console.log("\n✅ Formal G3 governance regression passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
