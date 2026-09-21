/**
 * 产品版本分析（蓝图 §4.4）
 *
 * 本模块是**确定性规则合成**，不调用任何 LLM：
 * 1. AnalysisRun 固定产品版本 / 证据版本指纹 / 评分规则版本；
 * 2. 六维度逐项给出 score / basis / assumptions / gaps / recommendation / evidenceRefs；
 * 3. 未知项保持 null，缺口写清原因；
 * 4. 历史 run 不被最新结果覆盖（新 run 通过 supersedesRunId 指向被替代者）。
 *
 * 未接真实模型时 runMode = MANUAL（规则合成），不伪称 AI 分析。
 */

import crypto from "crypto";
import prisma from "@/shared/db";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { createAuditEventInTx } from "@/shared/audit";
import { Prisma, AnalysisDimensionKey, AnalysisRunKind, RunMode } from "@prisma/client";
import { SessionContext } from "../identity/session";
import { buildEvidenceInsight } from "../research/evidence-claims";
import { PRODUCT_WRITE_ROLES, requireProductRole } from "../identity/product-access";
import {
  DIMENSION_LABELS,
  DIMENSION_ORDER,
  SCORE_RULE_VERSION,
  computeScorecard,
  coverageScore,
  grossMarginScore,
  parseAmount,
} from "./scoring";

export interface AnalyzeParams {
  productId?: string;
  productVersionId?: string;
  kind?: AnalysisRunKind;
  supersedesRunId?: string;
  /** TASK-016 新增：受权 agentRunId，用于专业分析 */
  agentRunId?: string;
  /** TASK-016 新增：是否请求专业分析 */
  requestProfessionalAnalysis?: boolean;
}

interface DimensionDraft {
  dimension: AnalysisDimensionKey;
  score: number | null;
  basis: string | null;
  assumptions: string | null;
  gaps: string | null;
  recommendation: string | null;
  evidenceRefs: Prisma.InputJsonValue | null;
}

function fingerprintEvidences(rows: { id: string; hash: string }[]): string {
  const payload = rows
    .map((r) => `${r.id}:${r.hash}`)
    .sort()
    .join("|");
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * 从版本 specs Json 里安全取非空字符串。
 * 用于「版本级取值优先于产品级取值」——多轮优化时各版本必须能算出不同结果。
 */
function specOfString(specs: unknown, field: string): string | null {
  if (!specs || typeof specs !== "object") return null;
  const v = (specs as Record<string, unknown>)[field];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

export async function analyzeProductVersion(session: SessionContext, params: AnalyzeParams) {
  let productId: string | undefined = params.productId;
  if (!productId && params.productVersionId) {
    const pv = await prisma.productVersion.findUnique({
      where: { id: params.productVersionId },
      select: { productId: true },
    });
    productId = pv?.productId ?? undefined;
  }

  if (!productId) {
    throw new UnprocessableEntityError("缺少产品ID或无法根据版本找到所属产品");
  }
  const resolvedProductId: string = productId;

  // B4：产品级授权。此前这里只比较 organizationId，等于「同组织的任意用户都可以
  // 对本组织任意产品运行分析」。现要求调用者是该产品**关联项目**的
  // OWNER / DECISION_MAKER。产品不存在 / 属于其它组织由 requireProductRole
  // 统一返回 404，不泄露对象是否存在。
  await requireProductRole(session, resolvedProductId, PRODUCT_WRITE_ROLES);

  const product = await prisma.product.findUnique({
    where: { id: resolvedProductId },
    include: {
      versions: { orderBy: { createdAt: "desc" } },
      launchPlans: { include: { milestones: true }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!product) {
    throw new NotFoundError("Product not found");
  }

  const version = params.productVersionId
    ? product.versions.find((v) => v.id === params.productVersionId)
    : product.versions[0];

  if (!version) {
    throw new UnprocessableEntityError("该产品还没有任何版本，无法分析");
  }

  // B5：supersedesRunId 来自请求体，必须校验归属（同组织 + 同产品）。
  // 否则可把其它组织 / 其它产品的分析轮次标记为「被本轮替代」，污染版本轨迹。
  if (params.supersedesRunId) {
    const previous = await prisma.analysisRun.findUnique({
      where: { id: params.supersedesRunId },
      select: { id: true, organizationId: true, productId: true },
    });
    if (
      !previous ||
      previous.organizationId !== session.organizationId ||
      previous.productId !== product.id
    ) {
      throw new UnprocessableEntityError("引用的历史分析轮次不存在或不属于该产品");
    }
  }

  // 产品关联的全部项目证据（含断言）
  const projects = await prisma.project.findMany({
    where: { productId: product.id, organizationId: session.organizationId },
    select: {
      id: true,
      title: true,
      evidences: {
        select: {
          id: true,
          hash: true,
          source: true,
          verifyStatus: true,
          nature: true,
          claims: true,
        },
      },
    },
  });

  const allEvidences = projects.flatMap((p) => p.evidences);
  const verifiedReal = allEvidences.filter(
    (e) => e.verifyStatus === "VERIFIED" && e.nature === "REAL"
  );

  const insight = buildEvidenceInsight(
    allEvidences.map((e) => ({
      source: e.source,
      verifyStatus: e.verifyStatus,
      claims: e.claims.map((c) => ({ ...c, evidenceId: c.evidenceId, fieldName: c.fieldName })),
    }))
  );
  const coveredFields = new Set(insight.resolved.map((r) => r.fieldKey));
  const refsFor = (fields: string[]): Prisma.InputJsonValue => {
    const picked = insight.resolved.filter((r) => fields.includes(r.fieldKey));
    return picked.map((p) => ({
      evidenceId: p.evidenceId,
      fieldKey: p.fieldKey,
      fieldName: p.fieldName,
      value: p.value,
      source: p.source,
    })) as unknown as Prisma.InputJsonValue;
  };

  const confirmedFacts = await prisma.companyFact.findMany({
    where: { organizationId: session.organizationId, status: "CONFIRMED" },
    select: { id: true, key: true, label: true },
  });

  const launchPlan = product.launchPlans[0] ?? null;

  const drafts: DimensionDraft[] = [];
  /** 价格取值来源留痕：版本级 / 产品级 / 未取到（避免事后无法解释两轮分析为何不同） */
  let priceSource: "version_specs" | "product" | "none" = "none";

  // ---- 1. 需求价值：必需证据 {salesVolume, targetAudience} ----
  {
    const required = ["salesVolume", "targetAudience"];
    const r = coverageScore(required, coveredFields);
    drafts.push({
      dimension: "DEMAND_VALUE",
      score: r.score,
      basis:
        r.covered.length > 0
          ? `已核实真实证据覆盖 ${r.covered.length}/${required.length} 项（${r.covered.join("、")}）`
          : null,
      assumptions: "覆盖度只说明资料齐备程度，不等于需求规模已被验证",
      gaps:
        r.missing.length > 0
          ? `缺少已核实的 ${r.missing.join("、")} 证据，需求侧结论仍待补证`
          : null,
      recommendation:
        r.missing.length > 0
          ? `优先补齐 ${r.missing.join("、")} 的真实来源证据后再做取舍`
          : "需求证据已具备，可进入差异化与经济性比选",
      evidenceRefs: refsFor(required),
    });
  }

  // ---- 2. 差异化：必需证据 {dosageForm, netWeight} ----
  {
    const required = ["dosageForm", "netWeight"];
    const r = coverageScore(required, coveredFields);
    drafts.push({
      dimension: "DIFFERENTIATION",
      score: r.score,
      basis:
        r.covered.length > 0
          ? `已核实真实证据覆盖 ${r.covered.length}/${required.length} 项（${r.covered.join("、")}）`
          : null,
      assumptions: "剂型与规格是差异化比选的基础维度，尚不代表差异化成立",
      gaps:
        r.missing.length > 0
          ? `缺少已核实的 ${r.missing.join("、")} 证据，无法完成路线比选`
          : null,
      recommendation: r.missing.length > 0 ? `补齐 ${r.missing.join("、")} 证据` : "可开展差异化定位比选",
      evidenceRefs: refsFor(required),
    });
  }

  // ---- 3. 单位经济性：由代码算毛利 ----
  {
    // 价格预期优先取「本版本 specs」里的取值：多轮优化时 v2 可能改了价格，
    // 若仍读 Product 级字段，v1/v2 会算出同一个数，历史结论就无法区分（蓝图 §4.4）。
    // 版本 specs 缺失时回退到 Product 级录入值；两者都没有则保持未知。
    const versionPrice = specOfString(version.specs, "priceExpectation");
    const price = parseAmount(versionPrice ?? product.priceExpectation);
    priceSource = versionPrice ? "version_specs" : product.priceExpectation ? "product" : "none";
    const cost = version.targetCost !== null ? Number(version.targetCost) : null;
    const missing: string[] = [];
    if (price === null) missing.push("价格预期");
    if (cost === null) missing.push("目标成本");

    let score: number | null = null;
    let basis: string | null = null;
    let recommendation: string | null = null;

    if (price !== null && cost !== null) {
      const g = grossMarginScore(price, cost);
      if (g) {
        score = g.score;
        basis = `代码计算：价格 ${price} − 目标成本 ${cost} → 毛利率 ${(g.grossMargin * 100).toFixed(1)}%（${g.band}）`;
        recommendation =
          score >= 70 ? "单位经济性可接受，继续推进" : "单位经济性偏弱，建议先压缩成本或调整定价假设";
      }
    }

    const priceEvidenceMissing = ["price", "netWeight"].filter((f) => !coveredFields.has(f));
    drafts.push({
      dimension: "UNIT_ECONOMICS",
      score,
      basis,
      assumptions:
        price !== null && cost !== null
          ? "价格预期与目标成本均为录入假设，尚未由已核实证据支撑"
          : null,
      gaps:
        missing.length > 0
          ? `缺少${missing.join("、")}，无法计算毛利`
          : priceEvidenceMissing.length > 0
            ? `计算结果依赖录入值；仍缺少已核实的 ${priceEvidenceMissing.join("、")} 证据`
            : null,
      recommendation,
      evidenceRefs: refsFor(["price", "netWeight"]),
    });
  }

  // ---- 4. 公司适配：已确认公司事实 ----
  {
    const n = confirmedFacts.length;
    const score = n === 0 ? null : Math.min(90, 40 + 10 * Math.min(n, 5));
    drafts.push({
      dimension: "COMPANY_FIT",
      score,
      basis: n > 0 ? `公司知识库中已有 ${n} 条已确认事实可供比对` : null,
      assumptions: "已确认事实数量只反映上下文齐备度，不等于该产品与公司方向匹配",
      gaps: n === 0 ? "公司知识库尚无「已确认」事实，无法判断与公司方向、渠道、供应能力的匹配度" : null,
      recommendation: n === 0 ? "先在公司知识中确认业务方向、渠道与供应能力等基础事实" : "用已确认事实逐条比对产品定位",
      evidenceRefs: confirmedFacts.slice(0, 10) as unknown as Prisma.InputJsonValue,
    });
  }

  // ---- 5. 交付可行性：本版无该数据源，保持未知 ----
  drafts.push({
    dimension: "DELIVERY_FEASIBILITY",
    score: null,
    basis: null,
    assumptions: null,
    gaps: "本版尚未接入工厂可制造性反馈与报价有效期数据源，交付可行性无法评定（不补造分数）",
    recommendation: "补充工厂可制造性反馈与供应商报价后再评估",
    evidenceRefs: null,
  });

  // ---- 6. 上市准备度：由 LaunchPlan 完整性计算 ----
  {
    if (!launchPlan) {
      drafts.push({
        dimension: "LAUNCH_READINESS",
        score: null,
        basis: null,
        assumptions: null,
        gaps: "尚未建立上市计划（缺负责人 / 目标日期 / 里程碑），准备度无法评定",
        recommendation: "先建立上市计划并指定负责人与目标日期",
        evidenceRefs: null,
      });
    } else {
      const checks = [
        { ok: !!launchPlan.ownerId, label: "负责人" },
        { ok: !!launchPlan.targetDate, label: "目标日期" },
        { ok: launchPlan.milestones.length > 0, label: "里程碑" },
        { ok: !launchPlan.milestones.some((m) => m.status === "BLOCKED"), label: "无阻塞项" },
      ];
      const passed = checks.filter((c) => c.ok);
      const score = Math.round((passed.length / checks.length) * 100);
      drafts.push({
        dimension: "LAUNCH_READINESS",
        score,
        basis: `上市计划完整性 ${passed.length}/${checks.length}（已具备：${passed.map((c) => c.label).join("、") || "无"}）`,
        assumptions: "准备度由计划字段完备性计算，不代表已被批准上市",
        gaps:
          passed.length < checks.length
            ? `未完成：${checks.filter((c) => !c.ok).map((c) => c.label).join("、")}`
            : null,
        recommendation: passed.length < checks.length ? "补齐上市计划缺失项" : "可提交上市放行评审",
        evidenceRefs: null,
      });
    }
  }

  const ordered = DIMENSION_ORDER.map((k) => drafts.find((d) => d.dimension === k)!);
  const scorecard = computeScorecard(ordered.map((d) => ({ dimension: d.dimension, score: d.score })));

  const inputSnapshot = {
    capturedAt: new Date().toISOString(),
    productId: product.id,
    productVersionId: version.id,
    versionTag: version.versionTag,
    projectIds: projects.map((p) => p.id),
    evidenceCount: allEvidences.length,
    verifiedRealEvidenceCount: verifiedReal.length,
    resolvedFieldKeys: [...coveredFields],
    confirmedCompanyFactCount: confirmedFacts.length,
    hasLaunchPlan: !!launchPlan,
    /** 价格取值来源：版本级优先。用于解释两轮分析结论为何不同 */
    priceSource,
    ruleVersion: scorecard.ruleVersion,
    dimensionLabels: DIMENSION_LABELS,
  };

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.analysisRun.create({
      data: {
        organizationId: session.organizationId,
        productId: product.id,
        productVersionId: version.id,
        kind: params.kind ?? "BASELINE",
        status: "SUCCEEDED",
        inputSnapshot,
        evidenceFingerprint: fingerprintEvidences(verifiedReal.map((e) => ({ id: e.id, hash: e.hash }))),
        ruleVersion: scorecard.ruleVersion,
        runMode: RunMode.MANUAL, // 规则合成，非模型调用
        supersedesRunId: params.supersedesRunId,
        createdById: session.userId,
        finishedAt: new Date(),
      },
    });

    for (const d of ordered) {
      await tx.analysisDimension.create({
        data: {
          runId: created.id,
          dimension: d.dimension,
          score: d.score,
          basis: d.basis,
          assumptions: d.assumptions,
          gaps: d.gaps,
          recommendation: d.recommendation,
          evidenceRefs: d.evidenceRefs ?? Prisma.JsonNull,
        },
      });
    }

    await tx.scorecard.create({
      data: {
        runId: created.id,
        productId: product.id,
        productVersionId: version.id,
        weights: scorecard.weights,
        ruleVersion: scorecard.ruleVersion,
        coverageRatio: scorecard.coverageRatio,
        provisional: scorecard.provisional,
        weightedScore: scorecard.weightedScore,
      },
    });

    // 阶段推进（蓝图 §4.5）：完成首次分析即从「想法入库」进入「分析优化」。
    // 只做这一条前向推进，不自动跨越打样/上市等需要人工拍板的阶段；
    // 后续阶段由对应业务命令（打样投入、上市放行）驱动，不在这里猜。
    if (product.lifecycleStage === "IDEA") {
      await tx.product.update({
        where: { id: product.id },
        data: { lifecycleStage: "ANALYSIS" },
      });
      await createAuditEventInTx(tx, {
        actorId: session.userId,
        action: "PRODUCT_STAGE_ADVANCED",
        objectType: "Product",
        objectId: product.id,
        summary: `完成首轮分析（${version.versionTag}），生命周期由「想法入库」推进为「分析优化」`,
        details: { from: "IDEA", to: "ANALYSIS", analysisRunId: created.id, ruleVersion: scorecard.ruleVersion },
      });
    }

    return created;
  });

  // TASK-016：如果请求了专业分析，生成并保存
  if (params.requestProfessionalAnalysis && params.agentRunId) {
    const agentRun = await prisma.agentRun.findUnique({
      where: { id: params.agentRunId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        userId: true,
        startedAt: true,
        cancelRequestedAt: true,
        usageJson: true,
      },
    });

    if (!agentRun || agentRun.organizationId !== session.organizationId) {
      throw new UnprocessableEntityError("agentRunId 无效或不属于该组织");
    }
    if (agentRun.userId !== session.userId) {
      throw new UnprocessableEntityError("agentRun 不属于当前用户");
    }
    if (agentRun.status !== "RUNNING") {
      throw new UnprocessableEntityError("agentRun 状态不是 RUNNING，无法认领");
    }
    if (agentRun.cancelRequestedAt) {
      await prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: "CANCELLED",
          finishedAt: new Date(),
          errorReason: "专业分析开始前已收到取消请求",
        },
      });
      throw new UnprocessableEntityError("agentRun 已请求取消");
    }

    const currentVersion = await prisma.productVersion.findUnique({
      where: { id: version.id },
      select: { id: true },
    });
    if (!currentVersion) {
      throw new UnprocessableEntityError("版本不存在");
    }

    const startedAt = agentRun.startedAt ?? new Date();
    try {
      const { generateProfessionalAnalysisDraft } = await import(
        "../product-development/professional-analysis"
      );
      const { buildAuthorizedAnalysisContext } = await import("../advisor/context");

      // 无论 LLM 是否启用都走同一个生成入口：
      // 未启用/输出无效时 generateProfessionalAnalysisDraft 会返回 canonical V1 默认分析，
      // 不再写入另一套 placeholder schema。
      const context = await buildAuthorizedAnalysisContext({
        session,
        productId: product.id,
        productVersionId: version.id,
      });
      const analysisDraft = await generateProfessionalAnalysisDraft({
        session,
        context,
        productId: product.id,
        productVersionId: version.id,
        signal: AbortSignal.timeout(120000),
      });

      const finishedAt = new Date();
      const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
      const generatedAt = finishedAt.toISOString();
      const existingUsage =
        agentRun.usageJson &&
        typeof agentRun.usageJson === "object" &&
        !Array.isArray(agentRun.usageJson)
          ? (agentRun.usageJson as Record<string, unknown>)
          : {};

      await prisma.$transaction(async (tx) => {
        await tx.analysisRun.update({
          where: { id: run.id },
          data: {
            inputSnapshot: {
              ...((run.inputSnapshot as Record<string, unknown>) || {}),
              // 主数据字段永远只保存纯 ProfessionalAnalysisV1。
              professionalAnalysis: analysisDraft.analysis as unknown as Prisma.InputJsonValue,
              // 生成过程元数据与业务分析正文分离。
              professionalAnalysisMeta: {
                isLLMGenerated: analysisDraft.isLLMGenerated,
                promptVersion: analysisDraft.promptVersion,
                failureReason: analysisDraft.failureReason ?? null,
                generatedAt,
              },
              agentRunId: agentRun.id,
              versionIdAtAnalysis: version.id,
              generatedAt,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        await tx.agentRun.update({
          where: { id: agentRun.id },
          data: {
            status: "SUCCEEDED",
            finishedAt,
            durationMs,
            errorReason: null,
            usageJson: {
              ...existingUsage,
              analysisRunId: run.id,
              versionId: version.id,
              professionalAnalysis: {
                isLLMGenerated: analysisDraft.isLLMGenerated,
                promptVersion: analysisDraft.promptVersion,
                fallbackReason: analysisDraft.failureReason ?? null,
              },
            } as Prisma.InputJsonValue,
          },
        });
      });
    } catch (error) {
      const finishedAt = new Date();
      const latest = await prisma.agentRun.findUnique({
        where: { id: agentRun.id },
        select: { cancelRequestedAt: true },
      });
      const cancelled =
        !!latest?.cancelRequestedAt ||
        (error instanceof Error && error.name === "AbortError");

      await prisma.agentRun.updateMany({
        where: {
          id: agentRun.id,
          organizationId: session.organizationId,
          status: "RUNNING",
        },
        data: {
          status: cancelled ? "CANCELLED" : "FAILED",
          finishedAt,
          durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
          errorReason:
            error instanceof Error
              ? error.message.slice(0, 1000)
              : String(error).slice(0, 1000),
        },
      });

      throw error;
    }
  }

  return run.id;
}
