/**
 * S: 信号雷达 · 采集执行服务 (S/F16)
 *
 * 骨架迁移自老版 signal-collection-service.ts：
 *   - 源健康：遍历启用源 → 采集成功后写 lastStatus/lastCollected，失败写 lastError
 *   - 去重：同组织同源 (sourceKey, hash=sha256(sourceKey|title|url)) 唯一，重复跳过
 *   - 采集循环：逐源 resolve collector → 抓候选 → 去重落库 → 更新源状态
 *   - 证据包装：packageSignalToEvidence 把一条信号转为项目 Evidence（verifyStatus 恒 UNVERIFIED）
 *
 * 组织范围（2026-09-16，修 D-002）：指纹与查询一律按 `organizationId` 隔离。
 * 去重指纹本身仍只含 (sourceKey|title|url)（同一家公司内比较才是对的），
 * 隔离由唯一约束 `@@unique([organizationId, sourceKey, hash])` 与所有查询的
 * organizationId 过滤共同保证 —— 因此跨组织同标题各自成立，互不可见。
 *
 * 与老版差异：外部平台 adapter（含蝉妈妈）默认 resolveCollector 返回 null（不真连、
 * 不虚构）；测试或后续接入时注入 collector。
 */

import crypto from "crypto";
import prisma from "@/shared/db";
import { EvidenceNature, EvidenceVerifyStatus, Role } from "@prisma/client";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { SessionContext, requireProjectRole } from "../identity/session";
import {
  SIGNAL_SOURCES,
  SignalSourceDef,
  SignalCategory,
} from "./source-registry";

export interface SignalCandidate {
  title: string;
  summary?: string | null;
  url?: string | null;
  productRef?: string | null;
  channel?: string | null;
  category?: SignalCategory;
  importance?: number;
}

export interface SignalCollector {
  mode: string;
  collect(source: SignalSourceDef): Promise<SignalCandidate[]>;
}

/**
 * 默认收集器解析：恒返回 null —— 所有外部平台 adapter 当前均不真实接入，
 * 采集时跳过（源标记 skipped），绝不伪造信号数据。
 */
export function resolveCollector(source: SignalSourceDef): SignalCollector | null {
  return null;
}

/** 去重指纹：同源同 title(+url) 视为同一信号 */
export function signalHash(sourceKey: string, title: string, url?: string | null): string {
  return crypto
    .createHash("sha256")
    .update(`${sourceKey}|${title.trim()}|${url ?? ""}`)
    .digest("hex");
}

/** 首次调用/启动时把注册表同步进 SignalSource 表 */
export async function ensureSignalSources() {
  const existing = await prisma.signalSource.findMany({ select: { key: true } });
  const have = new Set(existing.map((row) => row.key));
  const missing = SIGNAL_SOURCES.filter((source) => !have.has(source.key));
  if (missing.length > 0) {
    await prisma.signalSource.createMany({
      data: missing.map((source) => ({
        key: source.key,
        name: source.name,
        category: source.category,
        description: source.description,
        priority: source.priority,
        mode: source.mode,
        enabled: true,
        lastStatus: "idle",
      })),
    });
  }
  return prisma.signalSource.findMany({ orderBy: [{ priority: "asc" }, { name: "asc" }] });
}

export type SourceCollectionResult = {
  sourceKey: string;
  sourceName: string;
  mode: string;
  status: "collected" | "skipped" | "error";
  itemsCreated: number;
  skippedDuplicates: number;
  error?: string;
};

export type CollectionSummary = {
  startedAt: string;
  sourcesAttempted: number;
  sourcesCollected: number;
  sourcesSkipped: number;
  sourcesFailed: number;
  itemsCreated: number;
  results: SourceCollectionResult[];
};

async function fetchExistingHashes(
  organizationId: string,
  sourceKey: string,
  limit = 1000
): Promise<Set<string>> {
  const rows = await prisma.signalItem.findMany({
    where: { organizationId, sourceKey },
    orderBy: { collectedAt: "desc" },
    take: limit,
    select: { hash: true },
  });
  return new Set(rows.map((row) => row.hash).filter((h): h is string => Boolean(h)));
}

async function collectOne(
  source: SignalSourceDef,
  organizationId: string,
  existingHashes: Set<string>,
  resolver: (source: SignalSourceDef) => SignalCollector | null
): Promise<SourceCollectionResult> {
  const base: SourceCollectionResult = {
    sourceKey: source.key,
    sourceName: source.name,
    mode: source.mode,
    status: "skipped",
    itemsCreated: 0,
    skippedDuplicates: 0,
  };

  const collector = resolver(source);
  if (!collector) {
    // 无自动收集器：跳过（不虚构），但更新健康状态以便前端看到"已尝试"
    await prisma.signalSource
      .update({ where: { key: source.key }, data: { lastStatus: "skipped", lastCollected: new Date() } })
      .catch(() => {});
    return base;
  }

  try {
    const candidates = await collector.collect(source);
    let itemsCreated = 0;
    let skippedDuplicates = 0;
    for (const candidate of candidates) {
      const hash = signalHash(source.key, candidate.title, candidate.url);
      if (existingHashes.has(hash)) {
        skippedDuplicates += 1;
        continue;
      }
      try {
        await prisma.signalItem.create({
          data: {
            organizationId, // 信号是公司私有内容，落库必须带归属组织（列为 NOT NULL）
            sourceKey: source.key,
            sourceName: source.name,
            category: candidate.category ?? source.category,
            title: candidate.title,
            summary: candidate.summary ?? null,
            url: candidate.url ?? null,
            nature: EvidenceNature.REAL,
            verifyStatus: EvidenceVerifyStatus.UNVERIFIED,
            productRef: candidate.productRef ?? null,
            channel: candidate.channel ?? null,
            hash,
            importance: candidate.importance ?? 1,
            collectedBy: `auto:${collector.mode}`,
          },
        });
      } catch {
        // (organizationId, sourceKey, hash) 唯一冲突 = 并发下的同组织重复：视为重复跳过
        skippedDuplicates += 1;
        continue;
      }
      existingHashes.add(hash);
      itemsCreated += 1;
    }
    await prisma.signalSource
      .update({
        where: { key: source.key },
        data: { lastStatus: "collected", lastError: null, lastCollected: new Date() },
      })
      .catch(() => {});
    return { ...base, status: "collected", itemsCreated, skippedDuplicates };
  } catch (error) {
    const lastError = error instanceof Error ? error.message.slice(0, 300) : "采集失败";
    await prisma.signalSource
      .update({
        where: { key: source.key },
        data: { lastStatus: "error", lastError, lastCollected: new Date() },
      })
      .catch(() => {});
    return { ...base, status: "error", error: lastError };
  }
}

/**
 * 执行一次全量/定向采集。sourceKeys 为空则采集全部启用源。
 * 默认无任何真实收集器（外部 adapter 未接），全部源标记 skipped；测试注入 fake collector。
 *
 * `organizationId` **必填**：信号是公司私有内容，采集落库必须指明归属组织。
 * 不提供默认值、不猜测 —— 采集器是系统级进程，没有会话可推断组织。
 */
export async function runSignalCollection(
  options: {
    organizationId: string;
    sourceKeys?: string[];
    collectorResolver?: (source: SignalSourceDef) => SignalCollector | null;
  }
): Promise<CollectionSummary> {
  await ensureSignalSources();
  const { organizationId } = options;
  if (!organizationId) {
    throw new UnprocessableEntityError("采集必须指明归属组织（organizationId），不猜测归属");
  }

  const dbKeys = new Set(
    (await prisma.signalSource.findMany({ where: { enabled: true }, select: { key: true } })).map((row) => row.key)
  );
  const targets = SIGNAL_SOURCES.filter(
    (def) =>
      dbKeys.has(def.key) &&
      (!options.sourceKeys || options.sourceKeys.length === 0 || options.sourceKeys.includes(def.key))
  );

  const resolver = options.collectorResolver ?? resolveCollector;
  const results: SourceCollectionResult[] = [];
  let sourcesCollected = 0;
  let sourcesSkipped = 0;
  let sourcesFailed = 0;
  let itemsCreated = 0;

  for (const source of targets) {
    const existing = await fetchExistingHashes(organizationId, source.key);
    const result = await collectOne(source, organizationId, existing, resolver);
    results.push(result);
    if (result.status === "collected") sourcesCollected += 1;
    else if (result.status === "skipped") sourcesSkipped += 1;
    else sourcesFailed += 1;
    itemsCreated += result.itemsCreated;
  }

  return {
    startedAt: new Date().toISOString(),
    sourcesAttempted: targets.length,
    sourcesCollected,
    sourcesSkipped,
    sourcesFailed,
    itemsCreated,
    results,
  };
}

/**
 * 信号 → 证据封装 (Evidence packaging)：把一条 SignalItem 转为某项目的 Evidence。
 * verifyStatus 恒定 UNVERIFIED（绝不自动 VERIFIED）；成功后回写信号 evidenceId 溯源。
 */
export async function packageSignalToEvidence(
  session: SessionContext,
  params: { signalId: string; projectId: string }
) {
  const { signalId, projectId } = params;
  await requireProjectRole(session, projectId, [Role.OWNER, Role.DECISION_MAKER, Role.FEEDBACK_PROVIDER]);

  const signal = await prisma.signalItem.findFirst({
    where: { id: signalId, organizationId: session.organizationId },
  });
  if (!signal) throw new NotFoundError("Signal not found");

  // 已封装过 → 返回既有证据，不重复创建
  if (signal.evidenceId) {
    const existing = await prisma.evidence.findUnique({ where: { id: signal.evidenceId } });
    if (existing) return { evidence: existing, created: false as const };
  }

  const evidence = await prisma.$transaction(async (tx) => {
    const created = await tx.evidence.create({
      data: {
        projectId,
        contentOrUri: signal.url || signal.title,
        source: signal.sourceName,
        author: session.userName,
        hash: crypto.createHash("sha256").update(signal.title.replace(/\s+/g, " ").trim()).digest("hex"),
        nature: signal.nature,
        verifyStatus: EvidenceVerifyStatus.UNVERIFIED,
        productRef: signal.productRef ?? null,
        channel: signal.channel ?? null,
      },
    });
    await tx.signalItem.update({ where: { id: signalId }, data: { evidenceId: created.id } });
    await tx.auditEvent.create({
      data: {
        actorId: session.userId,
        action: "EVIDENCE_CREATED",
        objectType: "Evidence",
        objectId: created.id,
        summary: `信号封装为证据：${signal.title.slice(0, 60)}（源 ${signal.sourceName}，未核验）`,
      },
    });
    return created;
  });

  return { evidence, created: true as const };
}

/**
 * 读取信号（支持按源/类别过滤）。
 *
 * `organizationId` **必填**：此前本函数不带组织过滤，等于「谁调用谁看到全部组织的信号」。
 * 当前无路由调用它，属**潜伏**的跨租户读泄漏；此处一并收口，避免日后有人直接接上路由。
 */
export async function listSignalItems(options: {
  organizationId: string;
  sourceKey?: string;
  category?: string;
  limit?: number;
}) {
  const where: Record<string, unknown> = { organizationId: options.organizationId };
  if (options.sourceKey) where.sourceKey = options.sourceKey;
  if (options.category) where.category = options.category;
  return prisma.signalItem.findMany({
    where,
    orderBy: { collectedAt: "desc" },
    take: Math.min(options.limit ?? 50, 200),
  });
}

/** 读取信号源（含健康状态） */
export async function listSignalSources() {
  return ensureSignalSources();
}