import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import type { SessionContext } from "../src/modules/identity/session";
import { createDevelopmentProduct } from "../src/modules/products/service";
import {
  runResearchRunTasks,
  startResearchRun,
} from "../src/modules/research/research-run";
import { ResearchTaskType } from "@prisma/client";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
  console.log(`  ✔ ${message}`);
}

async function main() {
  await assertTestDatabaseSafety(prisma);

  const tag = `research-snapshot-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { code: tag, name: "研究快照回归机构" },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `${tag}@hermes.test`,
      name: "研究负责人",
    },
  });
  const session: SessionContext = {
    userId: user.id,
    organizationId: org.id,
    userEmail: user.email,
    userName: user.name,
  };

  const created = await createDevelopmentProduct(session, {
    name: "AKG 钙半年套餐·快照回归",
    coreIdea: "做一个35岁以上人群的半年精准营养套餐",
    targetAudience: "35岁以上人群",
    coreSellingPoints: "AKG + 甲基化年龄检测，挑战减龄1-3年",
    targetChannels: "私域、会销",
    priceExpectation: "1999元半年套餐",
    targetCost: 800,
    formSpec: "每日3g，半年量",
  });

  const started = await startResearchRun(session, {
    projectId: created.project.id,
    question: "评估该产品是否值得推进，重点核查目标人群、价格与减龄宣称风险",
  });

  const storedRun = await prisma.researchRun.findUnique({ where: { id: started.run.id } });
  assert(!!storedRun?.scopeSnapshotJson, "ResearchRun 启动时写入 scopeSnapshotJson");
  const scopeRaw = storedRun!.scopeSnapshotJson!;
  const scope =
    typeof scopeRaw === "string"
      ? JSON.parse(scopeRaw)
      : scopeRaw;
  assert(scope.requirementContext?.version === "requirement-context/v2", "冻结需求上下文版本为 v2");
  assert(scope.requirementContext?.requirementText.includes("1999元半年套餐"), "冻结快照包含原始 1999 元套餐");
  assert(scope.requirementContext?.requirementText.includes("35岁以上"), "冻结快照包含原始目标年龄");

  // 启动后故意修改 live 数据。若执行阶段仍读 live 字段，报告会漂到 99 元/18 岁/快手。
  await prisma.product.update({
    where: { id: created.product.id },
    data: {
      priceExpectation: "99元",
      targetAudience: "18岁以上人群",
      targetChannels: "快手直播",
    },
  });
  await prisma.project.update({
    where: { id: created.project.id },
    data: {
      constraints: "售价99元，18岁以上，快手直播",
      revision: { increment: 1 },
    },
  });

  await runResearchRunTasks(started.run.id);

  const marketTask = await prisma.researchRunTask.findFirst({
    where: {
      runId: started.run.id,
      taskType: ResearchTaskType.BRANCH_MARKET,
    },
    orderBy: { createdAt: "asc" },
  });

  assert(marketTask?.status === "SUCCEEDED", "市场研究分支成功执行");
  assert(!!marketTask?.resultJson, "市场研究分支产出结构化结果");

  const resultRaw = marketTask!.resultJson!;
  const report =
    typeof resultRaw === "string"
      ? JSON.parse(resultRaw)
      : resultRaw;
  assert(report.candidateRoutes?.[0]?.targetPrice === 1999, "研究结果仍使用启动时冻结的 1999 元，而不是 live 99 元");

  const audience = report.opportunityAnalysis?.elements?.find(
    (item: { key: string }) => item.key === "targetUserAndNeed"
  );
  assert(
    audience?.inference?.some((text: string) => text.includes("35岁以上")),
    "研究结果仍使用冻结的 35 岁以上目标人群"
  );

  const channel = report.opportunityAnalysis?.elements?.find(
    (item: { key: string }) => item.key === "channelFit"
  );
  assert(
    channel?.inference?.some((text: string) => text.includes("私域/社群电商渠道")),
    "研究结果仍使用冻结的私域/会销渠道"
  );
  assert(
    !channel?.inference?.some((text: string) => text.includes("公域短视频/直播电商")),
    "启动后的快手直播修改没有污染当前 ResearchRun"
  );

  console.log("\n✅ ResearchRun frozen requirement snapshot regression passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
