/**
 * 市场机会 · 手工录入（蓝图 §3、§10）
 *
 * 蓝图说明：现阶段手工录入来源或触发单次检索已足够支撑产品分析，
 * 自动监测在主线稳定后再补。所有外部平台 adapter 均未真实接入（resolveCollector 恒为 null），
 * 因此**不会**出现自动抓取的信号，也不会伪造数据。
 *
 * 组织归属（蓝图 §7）：信号是公司私有内容，写入时强制要求 organizationId；
 * 公共来源配置（SignalSource.organizationId = null）只登记来源，不携带内容。
 */

import prisma from "@/shared/db";
import { UnprocessableEntityError } from "@/shared/errors";
import { EvidenceNature, EvidenceVerifyStatus } from "@prisma/client";
import { SessionContext } from "../identity/session";
import { signalHash } from "./signal-collection";

const MANUAL_SOURCE_KEY = "manual-entry";

export interface CreateManualSignalParams {
  title: string;
  summary?: string;
  url?: string;
  category?: string;
  productRef?: string;
  channel?: string;
  importance?: number;
  valueTier?: "high" | "normal" | "low";
  valueReason?: string;
}

async function ensureManualSource() {
  const existing = await prisma.signalSource.findUnique({ where: { key: MANUAL_SOURCE_KEY } });
  if (existing) return existing;
  return prisma.signalSource.create({
    data: {
      key: MANUAL_SOURCE_KEY,
      name: "手工录入",
      category: "manual",
      description: "由团队成员手工录入的来源明确的市场观察；不含自动抓取",
      priority: "P1",
      mode: "manual",
      organizationId: null, // 公共来源配置：所有组织共用，但不携带任何内容
      enabled: true,
      lastStatus: "idle",
    },
  });
}

export async function createManualSignal(session: SessionContext, params: CreateManualSignalParams) {
  const title = params.title?.trim();
  if (!title) throw new UnprocessableEntityError("信号标题不能为空");

  await ensureManualSource();
  const hash = signalHash(MANUAL_SOURCE_KEY, title, params.url ?? null);
  const organizationId = session.organizationId;

  // 去重范围 = **本组织**（2026-09-16，修 D-002）。
  //
  // 此前用 `findUnique({ sourceKey, hash })` + 全局唯一约束，导致组织 B 录入与组织 A
  // 同标题的信号时会命中 A 的行，并返回 422「该信号已属于其他组织」——
  // 这等于告诉 B「另一家公司已经录入过这个信号」，直接违反本系统
  // 「跨组织不泄露对象存在性」的原则。
  //
  // 现在：指纹按组织隔离（@@unique([organizationId, sourceKey, hash])），
  // 查询也带上组织。跨组织同标题会**各自成功创建**，互不可见。
  const existing = await prisma.signalItem.findFirst({
    where: { organizationId, sourceKey: MANUAL_SOURCE_KEY, hash },
  });
  if (existing) return existing;

  try {
    return await prisma.signalItem.create({
      data: {
        organizationId, // 强制组织归属（列为 NOT NULL，缺失即写入失败，不做猜测）
        sourceKey: MANUAL_SOURCE_KEY,
        sourceName: "手工录入",
        category: params.category?.trim() || "manual",
        title,
        summary: params.summary?.trim() || null,
        relevance: null,
        url: params.url?.trim() || null,
        // 手工录入的观察默认按真实资料登记，但核验状态保持 UNVERIFIED（不自动置为已核实）
        nature: EvidenceNature.REAL,
        verifyStatus: EvidenceVerifyStatus.UNVERIFIED,
        productRef: params.productRef?.trim() || null,
        channel: params.channel?.trim() || null,
        hash,
        importance: params.importance ?? 1,
        valueTier: params.valueTier ?? null,
        valueReason: params.valueReason?.trim() || null,
        collectedBy: "manual",
      },
    });
  } catch (error) {
    // 并发下的同组织重复：唯一键冲突 → 回读既有行，仍然返回成功语义（幂等）
    if (isUniqueViolation(error)) {
      const raced = await prisma.signalItem.findFirst({
        where: { organizationId, sourceKey: MANUAL_SOURCE_KEY, hash },
      });
      if (raced) return raced;
    }
    throw error;
  }
}

/** Prisma 唯一键冲突（P2002）。不引入 Prisma 命名空间以保持本文件依赖最小。 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export async function listOrganizationSignals(session: SessionContext) {
  return prisma.signalItem.findMany({
    where: { organizationId: session.organizationId },
    orderBy: [{ valueTier: "desc" }, { collectedAt: "desc" }],
    take: 200,
  });
}

export async function listAvailableSources() {
  return prisma.signalSource.findMany({
    orderBy: [{ priority: "asc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });
}
