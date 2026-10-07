import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { createProject } from "../src/modules/projects/service";
import { assembleProductSuggestionPackage, commitProductSuggestionToGate } from "../src/modules/products/product-suggestion";
import { submitDecisionPacket, decideDecisionPacket } from "../src/modules/decisions/service";
import { reviewWork } from "../src/modules/work/service";

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const org = await prisma.organization.upsert({ where: { code: "VERSION_REVIEW_TEST" }, update: {}, create: { code: "VERSION_REVIEW_TEST", name: "Version review fixtures" } });
  const user = (email: string) => prisma.user.upsert({ where: { email }, update: {}, create: { email, name: email, organizationId: org.id } });
  const owner = await user("version-owner@hermes.test");
  const leader = await user("version-leader@hermes.test");
  const ctx = (u: typeof owner) => ({ userId: u.id, organizationId: u.organizationId, userEmail: u.email, userName: u.name });
  const project = await createProject(ctx(owner), { title: `VERSION_REVIEW_${Date.now()}`, target: "Synthetic version consistency test", mode: "NEW_PRODUCT", isDemo: true, decisionMakerId: leader.id });
  // 2026-10-04 修正：本脚本此前从未被任何 npm test:* 或 CI 引用，是静默失效的测试。
  // 把它接起来后立刻变红：证据缺口闭合失败（P1-02 → price）。查证结论是**夹具过时**，
  // 不是产品缺陷——早于迁移 20260908090000/20260909010000 时，"有证据"只需写一条自由文本
  // Evidence；现在 price 等基线字段由结构化 EvidenceClaim 判定，
  // pickResolvedClaims 只采纳 kind=FACT 且所属 evidence 已 VERIFIED 的断言
  // （见 research/evidence-claims.ts:122）。本脚本只建了自由文本、没建 claim，
  // 于是 price 永远算缺口 —— 这正是「证据驱动」应有的行为，脚本需要跟上。
  const priceEvidence = await prisma.evidence.create({ data: { projectId: project.id, contentOrUri: "Test price: 售价 80 元", source: "SYNTHETIC_TEST", hash: "test-version-source", nature: "DEMO", verifyStatus: "VERIFIED" } });
  await prisma.evidenceClaim.create({ data: { evidenceId: priceEvidence.id, fieldKey: "price", fieldName: "到手价", kind: "FACT", value: "80", currency: "CNY", spec: "10g/袋", unit: "袋", mechanism: "到手价", evidenceLevel: "B", freshness: "FRESH" } });
  const original = await assembleProductSuggestionPackage(ctx(owner), project.id, { businessOptions: { commissionRate: 20, marketingRate: 5, batchQuantity: 100, shelfLifeMonths: 12, netWeight: "TEST ORIGINAL 10g" } });
  await commitProductSuggestionToGate(ctx(owner), project.id, original, { isConfirmed: true, idempotencyKey: `${project.id}-original` });
  const revised = structuredClone(original);
  revised.specificationBrief.netWeight = "TEST REVISED 20g";
  const second = await commitProductSuggestionToGate(ctx(owner), project.id, revised, { isConfirmed: true, idempotencyKey: `${project.id}-revision` });
  const item = await prisma.workItem.findFirstOrThrow({ where: { projectId: project.id, title: "产品定义与可行性研判" } });
  await reviewWork(ctx(owner), item.id, { accepted: true, reason: "Reviewed specification-only revision; research unchanged" });
  const artifacts = await prisma.artifact.findMany({ where: { workItem: { projectId: project.id } }, orderBy: { contentVersion: "desc" } });
  const spec = artifacts.find(a => a.type === "SPECIFICATION_BRIEF");
  const report = artifacts.find(a => a.type === "MARKET_RESEARCH_REPORT");
  await submitDecisionPacket(ctx(owner), second.decisionPacket.id);

  // 该脚本用于诊断「只修订规格、研究沿用旧基线」是否正常放行；
  // 结论必须以断言表达：负责人确认后必须批准通过，否则脚本以非零码失败（不再是仅供阅读的观测输出）。
  const failures: string[] = [];

  const productNetWeight = (second.productVersion.specs as { netWeight: string }).netWeight;
  const artifactNetWeight = spec ? JSON.parse(spec.content).netWeight : null;
  const reportCount = artifacts.filter((a) => a.type === "MARKET_RESEARCH_REPORT").length;

  if (productNetWeight !== "TEST REVISED 20g") failures.push(`产品版本规格未更新: ${productNetWeight}`);
  if (artifactNetWeight !== "TEST REVISED 20g") failures.push(`规格成果内容未更新: ${artifactNetWeight}`);
  if (reportCount !== 1) failures.push(`研究未变更为 1 个版本（不应伪装重新研究）: ${reportCount}`);

  const applicability = report
    ? await prisma.artifactApplicability.findFirst({ where: { artifactId: report.id } })
    : null;
  if (!applicability) failures.push("沿用的研究报告缺少适用性确认记录");
  else if (applicability.status !== "CONFIRMED") failures.push(`适用性记录未由负责人确认: ${applicability.status}`);
  else if (applicability.sourceInputRevision !== report!.inputRevision) {
    failures.push(
      `适用性记录未保留原始输入基线: 记录 r${applicability.sourceInputRevision}, 成果 r${report!.inputRevision}`
    );
  }

  let approved = false;
  let blockedReason: string | null = null;
  try {
    const decision = await decideDecisionPacket(ctx(leader), second.decisionPacket.id, {
      decision: "APPROVE",
      reason: "Version consistency diagnostic",
    });
    approved = decision.packet?.status === "APPROVED";
  } catch (error) {
    blockedReason = (error as Error).message;
  }

  if (!approved) failures.push(`负责人确认后仍无法批准: ${blockedReason}`);

  console.log(
    JSON.stringify(
      {
        probe: "specification_only_revision_after_owner_review",
        productNetWeight,
        artifactNetWeight,
        reportVersions: reportCount,
        reportInputRevision: report?.inputRevision ?? null,
        applicability: applicability
          ? {
              baselineRevision: applicability.baselineRevision,
              sourceInputRevision: applicability.sourceInputRevision,
              status: applicability.status,
            }
          : null,
        approved,
        blockedReason,
      },
      null,
      2
    )
  );

  if (failures.length > 0) {
    throw new Error(`局部修订一致性诊断失败:\n- ${failures.join("\n- ")}`);
  }
  console.log("✔ 局部修订一致性诊断通过：只修订规格、研究沿用旧基线并经受确认后可以批准");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
