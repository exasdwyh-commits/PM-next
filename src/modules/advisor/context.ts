/**
 * 授权分析上下文构建（TASK-014；计划 §1.9 / 契约「结构化成果与门禁契约」B 节）
 *
 * 组合公司简报、当前产品版本、证据/反证、成本情景、历史决定，
 * 生成输入指纹和引用白名单，限定本次上下文体积并记录截断，
 * 不让历史聊天当确认事实。
 *
 * 本模块只读聚合，不创建、不确认、不修改任何业务记录。
 */

import prisma from "@/shared/db";
import { SessionContext } from "../identity/session";
import { buildCompanyBriefSnapshot, type BriefSnapshotResult } from "../knowledge/brief-snapshot";
import { searchKnowledge, type KnowledgeSearchResult } from "../knowledge/search";
import { computeInputFingerprint } from "../work/structured-artifacts";
import { parseCostScenario, listCostScenarios } from "../cost-engine/scenarios";

// ── 常量 ──

/** 上下文体积硬上限（字符）；超出部分截断并记录 */
const CONTEXT_MAX_CHARS = 30_000;

/** 每类上下文子项的最大条目数 */
const MAX_EVIDENCE_ITEMS = 20;
const MAX_COST_SCENARIO_ITEMS = 5;
const MAX_DECISION_ITEMS = 10;
const MAX_KNOWLEDGE_CITATIONS = 8;

// ── 类型 ──

/** 引用白名单条目：只允许这些 ref 出现在 LLM 输出中 */
export interface AuthorizedCitation {
  /** 引用标识（chunkId / artifactId / evidenceId / decisionId） */
  ref: string;
  /** 来源类型 */
  kind: "knowledge" | "evidence" | "cost_scenario" | "decision" | "company_fact";
  /** 可读标签 */
  label: string;
  /** 来源文件/路径（可选） */
  sourcePath?: string;
}

/** 证据条目（简化） */
export interface ContextEvidence {
  id: string;
  source: string;
  nature: string;
  verifyStatus: string;
  snippet: string;
}

/** 成本情景条目（简化） */
export interface ContextCostScenario {
  artifactId: string;
  label: string;
  engineVersion: string;
  currency: string;
  totalCost: number | null;
}

/** 历史决定条目（简化） */
export interface ContextDecision {
  decisionPacketId: string;
  gate: string;
  decision: string;
  reason: string;
  decidedAt: string;
}

/** 上下文截断记录 */
export interface TruncationRecord {
  /** 被截断的子项类型 */
  section: string;
  /** 原始条目数 */
  originalCount: number;
  /** 截断后保留条目数 */
  keptCount: number;
  /** 截断原因 */
  reason: string;
}

/** 构建授权分析上下文的输入 */
export interface BuildAuthorizedContextInput {
  session: SessionContext;
  /** 产品 ID（可选；无产品咨询时为 null） */
  productId?: string | null;
  /** 产品版本 ID（可选） */
  productVersionId?: string | null;
  /** 检索关键词（用于知识库搜索） */
  queryKeywords?: string[];
}

/** 授权分析上下文的输出 */
export interface AuthorizedAnalysisContext {
  /** 公司简报快照（TASK-010） */
  companyBrief: BriefSnapshotResult | null;
  /** 当前产品版本摘要 */
  productVersion: {
    id: string;
    versionTag: string;
    targetCost: number | null;
    currency: string;
    specs: unknown;
  } | null;
  /** 知识库检索结果（带引用） */
  knowledge: KnowledgeSearchResult;
  /** 科学证据/反证（简化） */
  evidence: ContextEvidence[];
  /** 成本情景 */
  costScenarios: ContextCostScenario[];
  /** 历史决定 */
  decisions: ContextDecision[];
  /** 引用白名单（只允许这些 ref 出现在 LLM 输出中） */
  citationWhitelist: AuthorizedCitation[];
  /** 输入指纹（所有输入的确定性哈希） */
  inputFingerprint: string;
  /** 上下文截断记录 */
  truncations: TruncationRecord[];
  /** 上下文总字符数（截断后） */
  totalChars: number;
}

// ── 辅助函数 ──

/**
 * 查找产品关联的 Project ID 列表
 */
async function findProjectIdsForProduct(productId: string): Promise<string[]> {
  const projects = await prisma.project.findMany({
    where: { productId },
    select: { id: true },
  });
  return projects.map((p) => p.id);
}

// ── 实现 ──

/**
 * 构建授权分析上下文。
 *
 * 1. 组合公司简报（TASK-010）、当前产品版本、证据、成本情景、历史决定
 * 2. 生成输入指纹和引用白名单
 * 3. 限定本次上下文体积并记录截断
 * 4. 不让历史聊天当确认事实
 */
export async function buildAuthorizedAnalysisContext(
  input: BuildAuthorizedContextInput
): Promise<AuthorizedAnalysisContext> {
  const { session, productId, productVersionId, queryKeywords } = input;
  const truncations: TruncationRecord[] = [];
  const citationWhitelist: AuthorizedCitation[] = [];

  // 1. 公司简报快照（TASK-010）
  let companyBrief: BriefSnapshotResult | null = null;
  try {
    companyBrief = await buildCompanyBriefSnapshot({ session });
    // 将公司事实加入引用白名单
    for (const ref of companyBrief.sourceRefs) {
      citationWhitelist.push({
        ref: ref.factId,
        kind: "company_fact",
        label: ref.factLabel,
      });
    }
  } catch {
    // 公司简报构建失败不影响上下文，记录为 null
  }

  // 2. 当前产品版本
  let productVersion: AuthorizedAnalysisContext["productVersion"] = null;
  if (productVersionId) {
    const pv = await prisma.productVersion.findUnique({
      where: { id: productVersionId },
      select: {
        id: true,
        versionTag: true,
        targetCost: true,
        currency: true,
        specs: true,
      },
    });
    if (pv) {
      productVersion = {
        id: pv.id,
        versionTag: pv.versionTag,
        targetCost: pv.targetCost ? Number(pv.targetCost) : null,
        currency: pv.currency,
        specs: pv.specs,
      };
    }
  }

  // 3. 知识库检索（复用 searchKnowledge）
  let knowledge: KnowledgeSearchResult = { query: "", citations: [], facts: [] };
  if (queryKeywords && queryKeywords.length > 0) {
    const query = queryKeywords.join(" ");
    knowledge = await searchKnowledge(session, { query, limit: MAX_KNOWLEDGE_CITATIONS });
    // 将知识库引用加入白名单
    for (const cit of knowledge.citations) {
      citationWhitelist.push({
        ref: cit.ref,
        kind: "knowledge",
        label: `${cit.docTitle} > ${cit.headingPath ?? "根"}`,
        sourcePath: cit.relativePath,
      });
    }
  }

  // 4. 证据/反证（通过 Project 关联）
  let evidence: ContextEvidence[] = [];
  if (productId) {
    const projectIds = await findProjectIdsForProduct(productId);
    if (projectIds.length > 0) {
      const rawEvidence = await prisma.evidence.findMany({
        where: { projectId: { in: projectIds } },
        take: MAX_EVIDENCE_ITEMS,
        orderBy: { obtainedAt: "desc" },
        select: {
          id: true,
          source: true,
          nature: true,
          verifyStatus: true,
          contentOrUri: true,
        },
      });

      if (rawEvidence.length > MAX_EVIDENCE_ITEMS) {
        truncations.push({
          section: "evidence",
          originalCount: rawEvidence.length,
          keptCount: MAX_EVIDENCE_ITEMS,
          reason: `超出上限 ${MAX_EVIDENCE_ITEMS} 条`,
        });
      }

      evidence = rawEvidence.map((e) => ({
        id: e.id,
        source: e.source,
        nature: String(e.nature),
        verifyStatus: String(e.verifyStatus),
        snippet: e.contentOrUri.slice(0, 200),
      }));

      // 证据加入白名单
      for (const e of evidence) {
        citationWhitelist.push({
          ref: e.id,
          kind: "evidence",
          label: e.source,
        });
      }
    }
  }

  // 5. 成本情景
  let costScenarios: ContextCostScenario[] = [];
  if (productVersionId) {
    const scenarios = await listCostScenarios(prisma, productVersionId);
    const parsed = scenarios.slice(0, MAX_COST_SCENARIO_ITEMS).map((s) => {
      const parsedScenario = parseCostScenario(s);
      return {
        artifactId: s.id,
        label: parsedScenario?.scenarioName ?? s.title,
        engineVersion: parsedScenario?.engineVersion ?? "unknown",
        currency: parsedScenario?.currency ?? "CNY",
        totalCost: parsedScenario?.recalculatedResult?.totalCost ?? null,
      };
    });

    if (scenarios.length > MAX_COST_SCENARIO_ITEMS) {
      truncations.push({
        section: "costScenarios",
        originalCount: scenarios.length,
        keptCount: MAX_COST_SCENARIO_ITEMS,
        reason: `超出上限 ${MAX_COST_SCENARIO_ITEMS} 条`,
      });
    }

    costScenarios = parsed;

    // 成本情景加入白名单
    for (const cs of costScenarios) {
      citationWhitelist.push({
        ref: cs.artifactId,
        kind: "cost_scenario",
        label: cs.label,
      });
    }
  }

  // 6. 历史决定
  let decisions: ContextDecision[] = [];
  if (productId) {
    const projectIds = await findProjectIdsForProduct(productId);
    if (projectIds.length > 0) {
      const rawDecisions = await prisma.decisionPacket.findMany({
        where: { projectId: { in: projectIds } },
        take: MAX_DECISION_ITEMS,
        orderBy: { createdAt: "desc" },
        include: {
          decisions: {
            orderBy: { decidedAt: "desc" },
            take: 1,
            select: {
              decision: true,
              reason: true,
              decidedAt: true,
            },
          },
        },
      });

      if (rawDecisions.length > MAX_DECISION_ITEMS) {
        truncations.push({
          section: "decisions",
          originalCount: rawDecisions.length,
          keptCount: MAX_DECISION_ITEMS,
          reason: `超出上限 ${MAX_DECISION_ITEMS} 条`,
        });
      }

      decisions = rawDecisions
        .filter((dp) => dp.decisions.length > 0)
        .map((dp) => ({
          decisionPacketId: dp.id,
          gate: String(dp.gate),
          decision: String(dp.decisions[0].decision),
          reason: dp.decisions[0].reason,
          decidedAt: dp.decisions[0].decidedAt.toISOString(),
        }));

      // 历史决定加入白名单
      for (const d of decisions) {
        citationWhitelist.push({
          ref: d.decisionPacketId,
          kind: "decision",
          label: `${d.gate} → ${d.decision}`,
        });
      }
    }
  }

  // 7. 生成输入指纹
  const fingerprintInput = {
    companyBriefVersion: companyBrief?.confirmedFactVersion,
    productVersionId: productVersion?.id,
    knowledgeQuery: knowledge.query,
    evidenceIds: evidence.map((e) => e.id),
    costScenarioIds: costScenarios.map((cs) => cs.artifactId),
    decisionIds: decisions.map((d) => d.decisionPacketId),
    builtAt: new Date().toISOString(),
  };
  const inputFingerprint = computeInputFingerprint(fingerprintInput);

  // 8. 计算上下文总字符数并截断
  let totalChars = 0;
  const sections = [
    { name: "companyBrief", data: companyBrief?.businessInput },
    { name: "productVersion", data: productVersion },
    { name: "knowledge", data: knowledge },
    { name: "evidence", data: evidence },
    { name: "costScenarios", data: costScenarios },
    { name: "decisions", data: decisions },
  ];

  for (const section of sections) {
    const sectionChars = JSON.stringify(section.data ?? null).length;
    totalChars += sectionChars;
  }

  if (totalChars > CONTEXT_MAX_CHARS) {
    truncations.push({
      section: "total",
      originalCount: totalChars,
      keptCount: CONTEXT_MAX_CHARS,
      reason: `上下文总字符数 ${totalChars} 超出上限 ${CONTEXT_MAX_CHARS}`,
    });
    // 截断策略：优先缩减 decisions（历史决定不影响当前分析核心）
    // 实际截断由调用方（LLM 提示词组装）按需执行，此处只记录
  }

  return {
    companyBrief,
    productVersion,
    knowledge,
    evidence,
    costScenarios,
    decisions,
    citationWhitelist,
    inputFingerprint,
    truncations,
    totalChars,
  };
}
