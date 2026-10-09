/**
 * Knowledge → Evidence 绑定：把 Knowledge Router 的综合产物挂到**现有的** Evidence 模型上。
 *
 * 原则：**不新造一套引用体系**。KnowledgeResultItem 说的是「哪份材料说了什么」，
 * Evidence 说的是「这条依据是什么、可信到什么程度」，两者本来就该合流。
 *
 * 字段映射（全部复用既有列，不动 Schema）：
 *   Evidence.contentOrUri      ← 首个来源 uri（或检索式）
 *   Evidence.source            ← 「Knowledge Router」+ 命中的 scope 列表
 *   Evidence.hash              ← query + top refs + 冲突裁决的 sha256（同一批知识幂等，不重复建）
 *   Evidence.sourceType        ← "KNOWLEDGE"
 *   Evidence.trustTier         ← top 条目的权威档
 *   Evidence.untrustedInput    ← true（知识检索结果属外部/派生输入，是注入面）
 *   Evidence.verifyStatus      ← UNVERIFIED（**绝不**因为权威分高就置 VERIFIED）
 *   EvidenceClaim              ← 冲突里的每一种说法（conflictGroup / selectionReason /
 *                                 evidenceLevel / freshness 直接对上）
 *   EvidenceSourceCapture      ← 每条 top 来源，injectionFlags 存 scope / 权威分 / 置信度
 *
 * 只有会话绑定了项目且调用方有写权限时才真的写；否则返回 `bound: false` 并说明原因，
 * 知识照常进 prompt——绑定失败不该挡住对话。
 */
import crypto from "node:crypto";
import prisma from "@/shared/db";
import { Role, EvidenceNature, EvidenceVerifyStatus, EvidenceClaimKind } from "@prisma/client";
import type { SessionContext } from "../identity/session";
import { requireProjectRole } from "../identity/session";
import type {
  KnowledgeEvidenceBinding,
  KnowledgeRouteResult,
  SynthesizedKnowledge,
} from "@/modules/kern-contracts";
import { freshnessLabel } from "./authority";

export interface BindKnowledgeParams {
  projectId: string;
  route: KnowledgeRouteResult;
  syn: SynthesizedKnowledge;
}

export type BindKnowledgeResult =
  | ({ bound: true } & KnowledgeEvidenceBinding)
  | { bound: false; reason: string };

function trustTierOf(syn: SynthesizedKnowledge): string {
  return syn.top[0]?.authorityTier ?? "unknown";
}

/** 这批知识的幂等键：query + 有序 refs + 冲突裁决 → sha256。内容没变就不重复建证据。 */
export function knowledgeHash(route: KnowledgeRouteResult, syn: SynthesizedKnowledge): string {
  const payload = [
    route.query,
    ...syn.top.map((i) => i.ref),
    ...syn.conflicts.map((c) => `${c.group}:${c.winnerRef ?? "tie"}`),
  ].join("\n");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function bindKnowledgeToEvidence(
  session: SessionContext,
  params: BindKnowledgeParams
): Promise<BindKnowledgeResult> {
  const { projectId, route, syn } = params;

  if (!syn.top.length && !syn.conflicts.length) {
    return { bound: false, reason: "没有可绑定的知识条目（top 与 conflicts 都为空）" };
  }

  try {
    await requireProjectRole(session, projectId, [
      Role.OWNER,
      Role.DECISION_MAKER,
      Role.FEEDBACK_PROVIDER,
    ]);
  } catch (error) {
    return {
      bound: false,
      reason: `无该项目的证据写入权限：${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
    };
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!project) return { bound: false, reason: "项目不存在或不属于当前组织" };

  const hash = knowledgeHash(route, syn);
  const existing = await prisma.evidence.findFirst({
    where: { projectId, hash },
    select: { id: true },
  });
  if (existing) {
    return {
      bound: true,
      evidenceId: existing.id,
      refs: syn.top.map((i) => i.ref),
      conflictCount: syn.conflicts.length,
      created: false,
    };
  }

  const scopes = [...new Set(syn.top.map((i) => i.scope))].sort();
  const evidence = await prisma.$transaction(async (tx) => {
    const created = await tx.evidence.create({
      data: {
        projectId,
        contentOrUri: syn.top[0]?.uri ?? route.query,
        source: `Knowledge Router（${scopes.join("、") || "无域"}）`,
        author: session.userName,
        hash,
        nature: EvidenceNature.REAL,
        verifyStatus: EvidenceVerifyStatus.UNVERIFIED,
        sourceType: "KNOWLEDGE",
        trustTier: trustTierOf(syn),
        dataClass: "INTERNAL",
        untrustedInput: true,
        injectionStatus: syn.conflicts.length ? "HAS_CONFLICT" : "CLEAN",
      },
    });

    // 冲突 → EvidenceClaim（每种说法一条，落败方也留痕，选择理由写清楚）
    for (const conflict of syn.conflicts) {
      for (const [idx, s] of conflict.statements.entries()) {
        const won = conflict.winnerRef ? s.ref === conflict.winnerRef : idx === 0;
        await tx.evidenceClaim.create({
          data: {
            evidenceId: created.id,
            fieldKey: `knowledge.claim.${conflict.group}`.slice(0, 190),
            fieldName: "Knowledge 检索冲突说法",
            kind: EvidenceClaimKind.FACT,
            value: s.statement.slice(0, 500),
            conflictGroup: conflict.group.slice(0, 190),
            selectionReason: won
              ? conflict.winnerRef
                ? `采用：权威更高（${conflict.reason}）`
                : "权威打平，两种说法并列保留，待人工裁决"
              : `未采用：${conflict.reason}`,
            evidenceLevel: s.authority >= 0.7 ? "HIGH" : s.authority >= 0.4 ? "MEDIUM" : "LOW",
            freshness: freshnessLabel(s.capturedAt),
          },
        });
      }
    }

    // 每条 top 来源 → EvidenceSourceCapture（injectionFlags 存结构化元数据）
    for (const item of syn.top) {
      await tx.evidenceSourceCapture.create({
        data: {
          evidenceId: created.id,
          sourceUri: item.uri ?? `knowledge:${item.ref}`,
          sourceType: "KNOWLEDGE",
          trustTier: item.authorityTier,
          sourceOrganization: null,
          contentHash: crypto.createHash("sha256").update(item.ref).digest("hex"),
          rawContentPreview: item.snippet.slice(0, 500),
          injectionStatus: "PENDING",
          injectionFlags: {
            scope: item.scope,
            ref: item.ref,
            authority: item.authority,
            authorityTier: item.authorityTier,
            verified: item.verified,
            capturedAt: item.capturedAt,
            score: item.score,
            confidence: syn.confidence,
          },
          organizationId: session.organizationId,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorId: session.userId,
        action: "EVIDENCE_CREATED",
        objectType: "Evidence",
        objectId: created.id,
        summary: `Knowledge Router 结果入证：「${route.query.slice(0, 60)}」${syn.top.length} 条来源、${syn.conflicts.length} 处冲突、置信度 ${syn.confidence}（未核验）`,
      },
    });
    return created;
  });

  return {
    bound: true,
    evidenceId: evidence.id,
    refs: syn.top.map((i) => i.ref),
    conflictCount: syn.conflicts.length,
    created: true,
  };
}
