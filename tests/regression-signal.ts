/**
 * S: 信号采集骨架回归
 *
 * 覆盖：
 * 1. ensureSignalSources 把注册表同步进 SignalSource（含蝉妈妈 mode=manual）；
 * 2. runSignalCollection 注入 fake collector：采集落库、同源同 hash 去重、源健康状态更新；
 *    无 collector 的真实源（如蝉妈妈）标记 skipped，绝不虚构；
 * 3. packageSignalToEvidence：信号 → 项目 Evidence，verifyStatus 恒 UNVERIFIED，回写 evidenceId。
 * 4. **组织隔离（2026-09-16 新增，修 D-002）**：
 *    - 每个组织各自持有同标题信号，互不冲突；
 *    - A 组织封装信号时不能拿到 B 组织的信号（跨租户读断言）。
 *
 * 组织归属变化：`runSignalCollection` 自 2026-09-16 起要求显式 `organizationId`
 * （信号列为 NOT NULL，采集器是系统级进程、没有会话可推断组织）。
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { SessionContext } from "../src/modules/identity/session";
import { createProject } from "../src/modules/projects/service";
import { ProjectMode, EvidenceVerifyStatus } from "@prisma/client";
import {
  ensureSignalSources,
  runSignalCollection,
  signalHash,
  resolveCollector,
  packageSignalToEvidence,
  SIGNAL_SOURCES,
  SignalSourceDef,
  SignalCandidate,
  SignalCollector,
} from "../src/modules/signal";

/** 为指定源注入的 fake collector（不真连外部平台，仅验证骨架逻辑） */
function fakeCollectorFor(sourceKey: string, candidates: SignalCandidate[]): (source: SignalSourceDef) => SignalCollector | null {
  return (source) => (source.key === sourceKey ? { mode: "fake", collect: async () => candidates } : null);
}

async function main() {
  await assertTestDatabaseSafety(prisma);

  // 夹具组织/用户先建：采集必须先有归属组织（signalItem.organizationId 为 NOT NULL）
  const codeA = `SIGA_${randomUUID().slice(0, 8)}`;
  const codeB = `SIGB_${randomUUID().slice(0, 8)}`;
  const orgA = await prisma.organization.create({ data: { name: "信号回归机构 A", code: codeA } });
  const orgB = await prisma.organization.create({ data: { name: "信号回归机构 B", code: codeB } });
  const mkUser = (email: string, organizationId: string) =>
    prisma.user.create({ data: { organizationId, name: "信号测试", email } });
  const ownerA = await mkUser(`siga_${randomUUID().slice(0, 8)}@hermes.test`, orgA.id);
  const ownerB = await mkUser(`sigb_${randomUUID().slice(0, 8)}@hermes.test`, orgB.id);
  const session: SessionContext = {
    userId: ownerA.id,
    organizationId: orgA.id,
    userName: ownerA.name,
    userEmail: ownerA.email,
  };

  // 幂等：清理本测试用到的源，保证去重断言从干净状态开始（容忍上次失败遗留）
  await prisma.signalItem.deleteMany({ where: { sourceKey: "douyin_trend", organizationId: { in: [orgA.id, orgB.id] } } });

  // ============ 1. 源同步 ============
  await ensureSignalSources();
  const sources = await prisma.signalSource.findMany();
  for (const def of SIGNAL_SOURCES) {
    const row = sources.find((s) => s.key === def.key);
    assert.ok(row, `信号源已同步: ${def.key}`);
    assert.equal(row.mode, def.mode, `${def.key} mode 与注册表一致`);
  }
  const chamaix = sources.find((s) => s.key === "chamaix")!;
  assert.equal(chamaix.mode, "manual", "蝉妈妈仅人工核验项，未强制自动采集");
  console.log("✓ ensureSignalSources 同步注册表，蝉妈妈标记 manual");

  // ============ 2. 采集循环：落库 + 去重 + 源健康 ============
  const candidates: SignalCandidate[] = [
    { title: "某竞品 抖音月销 5 万+ 到手价 59.9", url: "https://example.com/a", channel: "抖音", productRef: "某竞品" },
    { title: "某爆款配方趋势", url: "https://example.com/b", category: "trend" },
    { title: "某竞品 抖音月销 5 万+ 到手价 59.9", url: "https://example.com/a" }, // 与第 1 条同源同 title+url → 重复
  ];

  const fake = fakeCollectorFor("douyin_trend", candidates);
  const first = await runSignalCollection({
    organizationId: orgA.id,
    sourceKeys: ["douyin_trend"],
    collectorResolver: fake,
  });
  const collected = first.results.find((r) => r.sourceKey === "douyin_trend");
  assert.equal(collected?.status, "collected", "注入 collector 的源应采集成功");
  assert.equal(first.itemsCreated, 2, "3 条候选中 1 条重复，实际创建 2 条");
  assert.equal(collected?.skippedDuplicates, 1, "同源同 hash 的重复候选被去重");

  const skip = await runSignalCollection({
    organizationId: orgA.id,
    sourceKeys: ["chamaix"],
    collectorResolver: resolveCollector,
  });
  const skipped = skip.results.find((r) => r.sourceKey === "chamaix");
  assert.equal(skipped?.status, "skipped", "无 collector 的真实源跳过，不虚构数据");

  const after = await prisma.signalSource.findUnique({ where: { key: "douyin_trend" } });
  assert.equal(after?.lastStatus, "collected", "源健康状态更新为 collected");
  const created = await prisma.signalItem.findMany({
    where: { sourceKey: "douyin_trend", organizationId: orgA.id },
  });
  assert.equal(created.length, 2, "落库 2 条信号");
  const dupTarget = created.find((c) => c.title === "某竞品 抖音月销 5 万+ 到手价 59.9")!;
  assert.equal(dupTarget.verifyStatus, EvidenceVerifyStatus.UNVERIFIED, "采集信号默认未核验");
  assert.equal(
    dupTarget.hash,
    signalHash("douyin_trend", "某竞品 抖音月销 5 万+ 到手价 59.9", "https://example.com/a"),
    "hash 可复算"
  );
  assert.equal(dupTarget.organizationId, orgA.id, "采集信号带归属组织");
  console.log("✓ 采集循环：注入 fake collector 落库、同源同 hash 去重、源健康更新、默认 UNVERIFIED");

  // ============ 2b. 组织隔离：同标题在两个组织各自成立（D-002 回归） ============
  const orgBSame = await runSignalCollection({
    organizationId: orgB.id,
    sourceKeys: ["douyin_trend"],
    collectorResolver: fake,
  });
  assert.equal(orgBSame.itemsCreated, 2, "组织 B 用同样的候选也能全部创建（不受组织 A 影响）");
  const createdB = await prisma.signalItem.findMany({
    where: { sourceKey: "douyin_trend", organizationId: orgB.id },
  });
  assert.equal(createdB.length, 2, "组织 B 有自己的 2 条信号");
  assert.equal(
    createdB[0].hash,
    created[0].hash,
    "两组织的同标题信号 hash 相同（指纹只描述内容），隔离由唯一约束的组织维度保证"
  );
  assert.notEqual(createdB[0].id, created[0].id, "两组织持有的是不同记录，互不覆盖");
  console.log("✓ 组织隔离：同标题信号在 A/B 两组织各自成立，指纹相同但记录独立");

  // ============ 3. 信号 → 证据封装 ============
  const project = await createProject(session, {
    title: "信号回归",
    target: "验证证据封装",
    mode: ProjectMode.NEW_PRODUCT,
  });
  await prisma.project.update({ where: { id: project.id }, data: { isDemo: true } });

  const target = created[0];
  const packaged = await packageSignalToEvidence(session, { signalId: target.id, projectId: project.id });
  assert.equal(packaged.created, true, "首次封装创建证据");
  const evidence = packaged.evidence as any;
  assert.equal(evidence.verifyStatus, EvidenceVerifyStatus.UNVERIFIED, "信号转证据恒 UNVERIFIED，不自动核验");
  assert.equal(evidence.source, "抖音热榜", "证据 source 为信号源名");
  const updated = await prisma.signalItem.findUniqueOrThrow({ where: { id: target.id } });
  assert.equal(updated.evidenceId, evidence.id, "信号回写 evidenceId 溯源");

  // 重复封装返回既有证据
  const again = await packageSignalToEvidence(session, { signalId: target.id, projectId: project.id });
  assert.equal(again.created, false, "重复封装不新建证据");
  console.log("✓ 信号 → 证据封装：验证状态恒 UNVERIFIED、回写 evidenceId、去重封装");

  // ============ 3b. 跨组织信号不可封装（跨租户读断言） ============
  await assert.rejects(
    () => packageSignalToEvidence(session, { signalId: createdB[0].id, projectId: project.id }),
    /Signal not found/,
    "A 组织不能把 B 组织的信号封装进自己的项目（返回 404，不泄露存在性）"
  );
  console.log("✓ 跨组织信号不可被封装（404，不泄露存在性）");

  console.log("\n✅ S: 信号采集骨架回归全部通过");
  return {
    orgIds: [orgA.id, orgB.id],
    userIds: [ownerA.id, ownerB.id],
    projectId: project.id,
    evidenceId: evidence.id,
    signalIds: [...created.map((c) => c.id), ...createdB.map((c) => c.id)],
  };
}

main()
  .then(async (ctx) => {
    if (!ctx) return;
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ctx.userIds } } });
    await prisma.dataGap.deleteMany({ where: { projectId: ctx.projectId } });
    await prisma.evidence.deleteMany({ where: { projectId: ctx.projectId } });
    await prisma.projectMember.deleteMany({ where: { projectId: ctx.projectId } });
    await prisma.signalItem.deleteMany({ where: { organizationId: { in: ctx.orgIds } } });
    await prisma.project.deleteMany({ where: { id: ctx.projectId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: { in: ctx.orgIds } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: ctx.orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: ctx.orgIds } } });
    // 信号源（SignalSource）是跨组织配置，由 ensureSignalSources 维护，此处不删。
    // 信号行（SignalItem）已随上面的组织范围删除清空。
  })
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
