/**
 * 局部修订回归套件 (C01 局部修订一致性)
 *
 * 背景：只修订规格时，未变化的市场研究报告被复用，但其 inputRevision 仍是旧基线，
 * 审批要求「每条成果的原始 inputRevision 必须等于决策包基线」，导致正常局部修订无法批准
 * （修复前报错：Referenced deliverable 'MARKET_RESEARCH_REPORT' v1 input baseline mismatch）。
 *
 * 修复口径：变化成果生成新版本；未变成果沿用原内容（不伪装成重新研究），
 * 但必须留下「负责人确认其适用于当前基线」的适用性记录；原始 inputRevision 保持历史事实。
 *
 * 三类场景各自独立验证五条断言：
 *   1 待检查阻断      修订成果在负责人检查前不得批准
 *   2 检查后通过      负责人确认后批准并推进至 SAMPLING
 *   3 旧决策不误批    引用被取代旧成果的决策包一律阻断
 *   4 历史不可覆盖    旧批次、旧成果、原始 inputRevision 完整保留
 *   5 重复提交不重建  相同内容重复提交不产生新批次/新成果/新适用性记录
 *
 * 场景：SPEC_ONLY（仅改规格）/ RESEARCH_ONLY（仅改研究）/ BOTH（两者同改）
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
const SPEC = "SPECIFICATION_BRIEF";
const REPORT = "MARKET_RESEARCH_REPORT";

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

interface Env {
  orgId: string;
  owner: { id: string; organizationId: string; email: string; name: string };
  leader: { id: string; organizationId: string; email: string; name: string };
  ctx: (u: { id: string; organizationId: string; email: string; name: string }) => {
    userId: string;
    organizationId: string;
    userEmail: string;
    userName: string;
  };
}

async function workItemIdOf(projectId: string) {
  const item = await prisma.workItem.findFirst({ where: { projectId, title: WORK_ITEM_TITLE } });
  if (!item) throw new Error("未找到产品定义工作项");
  return item.id;
}

async function latestArtifact(projectId: string, type: string) {
  const artifact = await prisma.artifact.findFirst({
    where: { workItemId: await workItemIdOf(projectId), type },
    orderBy: { contentVersion: "desc" },
  });
  if (!artifact) throw new Error(`未找到成果 ${type}`);
  return artifact;
}

async function runScenario(
  env: Env,
  cfg: {
    tag: string;
    label: string;
    revise: (pkg: any) => void;
  }
) {
  const { ctx, owner, leader } = env;
  console.log(`\n\n################ 场景 ${cfg.tag}: ${cfg.label} ################`);

  const project = await createProject(ctx(owner), {
    title: `PARTIAL_REVISION_${cfg.tag}_${Date.now()}`,
    target: `局部修订回归（${cfg.label}，合成数据）`,
    mode: "NEW_PRODUCT",
    isDemo: true,
    decisionMakerId: leader.id,
  });

  await prisma.evidence.create({
    data: {
      projectId: project.id,
      contentOrUri: "回归用已核实材料：同类竞品售价 80 元",
      source: "REGRESSION_FIXTURE",
      hash: `partial-fixture-${cfg.tag}-${Date.now()}`,
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

  // ---------------- 第一轮：原始建议包 ----------------
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

  const workItemId = await workItemIdOf(project.id);
  const round1Spec = await latestArtifact(project.id, SPEC);
  const round1Report = await latestArtifact(project.id, REPORT);
  const round1Revision = (await prisma.project.findUnique({ where: { id: project.id } }))!.revision;
  const round1SubmissionCount = await prisma.workSubmission.count({ where: { workItemId } });

  assert(round1SubmissionCount === 1, `${cfg.tag} 基线: 首轮生成提交批次 #1`);

  // ---------------- 第二轮：局部修订 ----------------
  const revised = structuredClone(original);
  cfg.revise(revised);

  const second = await commitProductSuggestionToGate(ctx(owner), project.id, revised, {
    isConfirmed: true,
    idempotencyKey: `${project.id}-r2`,
  });

  const specAfter = await latestArtifact(project.id, SPEC);
  const reportAfter = await latestArtifact(project.id, REPORT);
  const baselineRevision = (await prisma.project.findUnique({ where: { id: project.id } }))!.revision;

  const specReused = specAfter.id === round1Spec.id;
  const reportReused = reportAfter.id === round1Report.id;

  assert(
    !(specReused && reportReused),
    `${cfg.tag} 基线: 修订至少使一项成果产生新版本（规格${specReused ? "沿用" : "新增"}，研究${reportReused ? "沿用" : "新增"}）`
  );

  // ---- 沿用成果必须留下适用性待确认记录（原始 inputRevision 不被覆盖） ----
  const reusedChecks: Array<{ type: string; artifact: typeof specAfter; label: string }> = [];
  if (specReused) reusedChecks.push({ type: SPEC, artifact: specAfter, label: "产品规格简报" });
  if (reportReused) reusedChecks.push({ type: REPORT, artifact: reportAfter, label: "市场研究报告" });

  for (const item of reusedChecks) {
    assert(
      item.artifact.inputRevision === round1Revision,
      `${cfg.tag} 沿用: ${item.label} v${item.artifact.contentVersion} 原始输入基线 r${item.artifact.inputRevision} 未被覆盖`
    );
  }

  const carriedForward = await prisma.artifactApplicability.findMany({
    where: { workItemId },
    orderBy: { createdAt: "asc" },
  });

  const mismatchedReused = reusedChecks.filter((i) => i.artifact.inputRevision !== baselineRevision);
  if (mismatchedReused.length > 0) {
    for (const item of mismatchedReused) {
      const record = carriedForward.find(
        (r) => r.artifactId === item.artifact.id && r.baselineRevision === baselineRevision
      );
      assert(
        !!record,
        `${cfg.tag} 沿用: ${item.label} 已生成适用于当前基线 r${baselineRevision} 的适用性记录`
      );
      assert(
        record!.sourceInputRevision === item.artifact.inputRevision && record!.status === "PENDING",
        `${cfg.tag} 沿用: 适用性记录保留原始基线 r${record!.sourceInputRevision} 且在负责人确认前为 PENDING`
      );
    }
  }
  if (reusedChecks.length > 0 && mismatchedReused.length === 0) {
    assert(
      carriedForward.length === 0,
      `${cfg.tag} 沿用: 基线未变化时无需生成适用性记录（不为无意义流程造记录）`
    );
  }

  // ---------------- 1/5 待检查阻断 ----------------
  console.log(`\n▶ 1/5 ${cfg.tag} 修订成果在负责人检查前必须阻断批准...`);
  if (!specReused) {
    assert(
      specAfter.reviewStatus === "PENDING",
      `${cfg.tag} 1/5: 修订规格成果 v${specAfter.contentVersion} 在负责人确认前为 PENDING`
    );
  }
  if (!reportReused) {
    assert(
      reportAfter.reviewStatus === "PENDING",
      `${cfg.tag} 1/5: 修订研究成果 v${reportAfter.contentVersion} 在负责人确认前为 PENDING`
    );
  }

  await submitDecisionPacket(ctx(owner), second.decisionPacket.id);
  await expectBlockedMatching(
    () =>
      decideDecisionPacket(ctx(leader), second.decisionPacket.id, {
        decision: "APPROVE",
        reason: "尝试在负责人检查前批准",
      }),
    `${cfg.tag} 1/5 待检查阻断`,
    /has not been reviewed and accepted|no owner-confirmed applicability/
  );

  // ---------------- 2/5 检查后通过 ----------------
  console.log(`\n▶ 2/5 ${cfg.tag} 负责人确认后必须能批准并推进至 SAMPLING...`);
  await reviewWork(ctx(owner), workItemId, {
    accepted: true,
    reason: `已逐项核对第 2 批成果（规格 v${specAfter.contentVersion} / 研究 v${reportAfter.contentVersion}，输入基线 r${baselineRevision}），确认采纳`,
  });

  for (const item of mismatchedReused) {
    const record = await prisma.artifactApplicability.findFirst({
      where: { artifactId: item.artifact.id, baselineRevision, submission: { status: "ACCEPTED" } },
    });
    assert(
      record?.status === "CONFIRMED" && record.confirmedById === owner.id && !!record.confirmedAt,
      `${cfg.tag} 2/5: ${item.label} 的适用性记录已由负责人确认（状态 ${record?.status}，确认人 ${record?.confirmedById === owner.id ? "负责人" : "缺失"}）`
    );
  }

  const approval = await decideDecisionPacket(ctx(leader), second.decisionPacket.id, {
    decision: "APPROVE",
    reason: "局部修订成果已由负责人确认，准予打样",
  });
  assert(approval.packet?.status === "APPROVED", `${cfg.tag} 2/5: 负责人确认后决策包批准通过`);
  assert(approval.project.stage === "SAMPLING", `${cfg.tag} 2/5: 项目阶段推进至 SAMPLING`);

  // ---------------- 3/5 旧决策不误批 ----------------
  console.log(`\n▶ 3/5 ${cfg.tag} 引用被取代旧成果的决策包必须阻断...`);
  const stalePacket = await createDecisionPacketDraft(ctx(owner), {
    projectId: project.id,
    productVersionId: second.productVersion.id,
    artifactVersions: [buildArtifactRef(round1Spec), buildArtifactRef(round1Report)],
    evidenceVersions: second.decisionPacket.evidenceVersions as Array<{ id: string; hash: string }>,
    budgetAmount: 1000,
    budgetCurrency: "CNY",
    budgetScope: "旧决策阻断验证",
    validationPlan: "旧决策阻断验证",
    requiredChecks: { inputBaselineRevision: round1Revision },
  });
  await submitDecisionPacket(ctx(owner), stalePacket.id);
  await expectBlockedMatching(
    () =>
      decideDecisionPacket(ctx(leader), stalePacket.id, {
        decision: "APPROVE",
        reason: "尝试用旧成果批准",
      }),
    `${cfg.tag} 3/5 旧决策阻断`,
    /superseded by v2/
  );

  // ---------------- 4/5 历史不可覆盖 ----------------
  console.log(`\n▶ 4/5 ${cfg.tag} 历史批次与历史成果必须完整保留...`);
  const preservedSpec = await prisma.artifact.findUnique({ where: { id: round1Spec.id } });
  const preservedReport = await prisma.artifact.findUnique({ where: { id: round1Report.id } });
  assert(
    !!preservedSpec && preservedSpec.inputRevision === round1Revision,
    `${cfg.tag} 4/5: 历史规格成果 v${round1Spec.contentVersion} 保留原始输入基线 r${round1Revision}`
  );
  assert(
    JSON.parse(preservedSpec!.content).netWeight === "TEST ORIGINAL 10g",
    `${cfg.tag} 4/5: 历史规格成果内容仍为 TEST ORIGINAL 10g`
  );
  assert(
    !!preservedReport && preservedReport.inputRevision === round1Revision,
    `${cfg.tag} 4/5: 历史研究成果 v${round1Report.contentVersion} 保留原始输入基线 r${round1Revision}`
  );

  const submissions = await prisma.workSubmission.findMany({
    where: { workItemId },
    orderBy: { attempt: "asc" },
  });
  assert(
    submissions.length === 2 && submissions[0].status === "ACCEPTED" && !!submissions[0].reviewedById,
    `${cfg.tag} 4/5: 历史批次 #1 的检查记录完整保留`
  );
  assert(
    !!submissions[0].reviewReason && !submissions[0].reviewReason.includes("自动形式验收"),
    `${cfg.tag} 4/5: 检查记录说明确认的具体版本，而非“自动形式验收”`
  );
  assert(
    first.productVersion.id !== second.productVersion.id || specReused || reportReused,
    `${cfg.tag} 4/5: 首轮产品版本记录未被就地改写`
  );

  // ---------------- 5/5 重复提交不重建 ----------------
  console.log(`\n▶ 5/5 ${cfg.tag} 相同内容重复提交不产生新记录...`);
  const before = {
    submissions: await prisma.workSubmission.count({ where: { workItemId } }),
    artifacts: await prisma.artifact.count({ where: { workItemId } }),
    applicability: await prisma.artifactApplicability.count({ where: { workItemId } }),
  };

  await commitProductSuggestionToGate(ctx(owner), project.id, revised, {
    isConfirmed: true,
    idempotencyKey: `${project.id}-r2-replay`,
  });

  const after = {
    submissions: await prisma.workSubmission.count({ where: { workItemId } }),
    artifacts: await prisma.artifact.count({ where: { workItemId } }),
    applicability: await prisma.artifactApplicability.count({ where: { workItemId } }),
  };

  assert(
    before.submissions === after.submissions && before.artifacts === after.artifacts,
    `${cfg.tag} 5/5: 重复提交未产生新的批次与成果记录（${before.submissions}→${after.submissions} / ${before.artifacts}→${after.artifacts}）`
  );
  assert(
    before.applicability === after.applicability,
    `${cfg.tag} 5/5: 重复提交未产生重复的适用性确认记录（${before.applicability}→${after.applicability}）`
  );
  const specAfterReplay = await latestArtifact(project.id, SPEC);
  assert(
    specAfterReplay.reviewStatus === "ACCEPTED",
    `${cfg.tag} 5/5: 无业务修改未把已验收成果重置为待检查（不引发无意义重审）`
  );
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);

  console.log("================================================================================");
  console.log("🧪 局部修订回归套件（仅改规格 / 仅改研究 / 两者同改）");
  console.log("================================================================================");

  const org = await prisma.organization.upsert({
    where: { code: "PARTIAL_REVISION_ORG" },
    update: {},
    create: { code: "PARTIAL_REVISION_ORG", name: "局部修订回归机构" },
  });
  const upsertUser = (email: string, name: string) =>
    prisma.user.upsert({
      where: { email },
      update: { organizationId: org.id },
      create: { email, name, organizationId: org.id },
    });
  const owner = await upsertUser("partial-owner@hermes.test", "局部修订回归负责人");
  const leader = await upsertUser("partial-leader@hermes.test", "局部修订回归决策人");

  const env: Env = {
    orgId: org.id,
    owner,
    leader,
    ctx: (u) => ({
      userId: u.id,
      organizationId: u.organizationId,
      userEmail: u.email,
      userName: u.name,
    }),
  };

  // 场景一：只修订规格，研究报告沿用
  await runScenario(env, {
    tag: "SPEC_ONLY",
    label: "仅修订产品规格（研究报告沿用）",
    revise: (pkg) => {
      pkg.specificationBrief.netWeight = "TEST REVISED 20g";
    },
  });

  // 场景二：只修订研究结论，规格沿用
  await runScenario(env, {
    tag: "RESEARCH_ONLY",
    label: "仅修订市场研究结论（规格沿用）",
    revise: (pkg) => {
      pkg.researchReport.selectionRationale = "REVISED TEST RATIONALE ONLY";
    },
  });

  // 场景三：规格与研究同时修订
  await runScenario(env, {
    tag: "BOTH",
    label: "规格与研究结论同时修订",
    revise: (pkg) => {
      pkg.specificationBrief.netWeight = "TEST REVISED 20g";
      pkg.researchReport.selectionRationale = "REVISED TEST RATIONALE BOTH";
    },
  });

  console.log("\n================================================================================");
  console.log("🏆 局部修订回归全绿：三类场景 × 五项断言全部通过！");
  console.log("================================================================================\n");
}

main()
  .catch((error) => {
    console.error("\n❌ 局部修订回归失败:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
