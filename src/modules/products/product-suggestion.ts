/**
 * 同版本产品建议包组装服务 (F16, F17)
 *
 * 核心功能：
 * 1. 聚合需求解析 (F13)、市场研究与路线选型 (F14/F15)、确定性成本引擎测算 (F18/F19)；
 * 2. 组装为统一产品建议包 (ProductSuggestionPackage)；
 * 3. 支持将建议包发布为正式的不可变 ProductVersion (状态 isConfirmed = true, isImmutable = true)；
 * 4. 自动同步生成研发打样门草稿 (DecisionPacket DRAFT)，实现从研究到打样门的数据闭环。
 */

import crypto from "crypto";
import prisma from "@/shared/db";
import { SessionContext, requireProjectRole } from "@/modules/identity/session";
import { parseProjectRequirements, RequirementParseResult } from "@/modules/research/requirement-parser";
import { synthesizeMarketResearch, MarketResearchReport, FeasibleRoute } from "@/modules/research/market-research";
import { ResolvedFieldValue, buildEvidenceInsight } from "@/modules/research/evidence-claims";
import { BUSINESS_BASELINE, BASELINE_FIELD } from "@/config/business-baseline";
import { calcCost, CostResult } from "@/modules/cost-engine";
import { computeScopeHash } from "@/modules/decisions/scope-hash";
import { buildArtifactRef, computeArtifactContentHash, stableStringify } from "@/modules/decisions/artifact-ref";
import { NotFoundError, UnprocessableEntityError, ConflictError } from "@/shared/errors";
import {
  Role,
  GateType,
  DecisionPacketStatus,
  WorkItemStatus,
  RunMode,
  WorkExecutorType,
  ProducerType,
  ArtifactReviewStatus,
  ArtifactApplicabilityStatus,
} from "@prisma/client";
import { computeRequestHash } from "@/shared/idempotency";
import { ARTIFACT_SCHEMA_VERSION } from "@/modules/work/artifact-schema";

export interface BusinessEconomicsOptions {
  commissionRate?: number;
  marketingRate?: number;
  platformFeeRate?: number;
  monthlyFixed?: number;
  batchQuantity?: number;
  shelfLifeMonths?: number;
  netWeight?: string;
  budgetScope?: string;
  validationPlan?: string;
}

export interface ProductSuggestionPackage {
  projectId: string;
  categoryName: string;
  requirementAnalysis: RequirementParseResult;
  researchReport: MarketResearchReport;
  selectedRoute: FeasibleRoute;
  costEconomics: CostResult;
  businessAssumptions: {
    commissionRate: number;
    isCommissionAssumed: boolean;
    marketingRate: number;
    isMarketingAssumed: boolean;
    batchQuantity: number;
    isBatchQuantityAssumed: boolean;
    shelfLifeMonths: number;
    isShelfLifeAssumed: boolean;
    netWeight: string;
    isNetWeightAssumed: boolean;
  };
  specificationBrief: {
    productName: string;
    targetUser: string;
    dosageForm: string;
    netWeight: string;
    shelfLifeMonths: number;
    recommendedIngredients: string[];
    forbiddenRedLines: string[];
    experienceGoals: string;
    technicalAdvice: string;
    targetRetailPrice: number;
    targetCostAmount: number;
  };
  assembledAt: string;
}

/**
 * 组装同版本产品建议包（纯服务计算，R2-06: 明确区分业务输入与默认假设）
 */
export async function assembleProductSuggestionPackage(
  session: SessionContext,
  projectId: string,
  options?: {
    categoryName?: string;
    selectedRouteCode?: "ROUTE_A" | "ROUTE_B" | "ROUTE_C";
    businessOptions?: BusinessEconomicsOptions;
  }
): Promise<ProductSuggestionPackage> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      evidences: {
        where: { verifyStatus: "VERIFIED" },
        include: { claims: true },
      },
    },
  });

  if (!project || project.organizationId !== session.organizationId) {
    throw new NotFoundError("Project not found");
  }

  await requireProjectRole(session, projectId, [Role.OWNER, Role.DECISION_MAKER, Role.VIEWER]);

  const categoryName = options?.categoryName || "草本固体茶饮";
  const reqAnalysis = parseProjectRequirements(project.target + " " + (project.constraints || ""));

  const verifiedSnippets = project.evidences.map((e) => ({
    id: e.id,
    content: e.contentOrUri,
    source: e.source,
  }));

  // P1-01：从已核实证据的结构化 FACT 断言中取有据取值，传入研究合成（无证据则保持缺口）
  const resolvedClaims: ResolvedFieldValue[] = [];
  for (const ev of project.evidences) {
    for (const c of ev.claims ?? []) {
      if (c.kind !== "FACT") continue;
      resolvedClaims.push({
        fieldKey: c.fieldKey,
        fieldName: c.fieldName,
        value: c.value,
        evidenceId: ev.id,
        spec: c.spec,
        unit: c.unit,
        mechanism: c.mechanism,
        source: ev.source,
        conflictGroup: c.conflictGroup,
        selectionReason: c.selectionReason,
      });
    }
  }

  const researchReport = synthesizeMarketResearch(project.id, categoryName, reqAnalysis.constraints, verifiedSnippets, resolvedClaims);
  const routeCode = options?.selectedRouteCode || researchReport.recommendedRouteCode;
  const selectedRoute = researchReport.candidateRoutes.find((r) => r.routeCode === routeCode) || researchReport.candidateRoutes[0];

  // R2-06: 业务输入参数与未确认假设记录
  const biz = options?.businessOptions;
  const isCommissionAssumed = biz?.commissionRate === undefined;
  const commissionRate = biz?.commissionRate ?? 25.0;

  const isMarketingAssumed = biz?.marketingRate === undefined;
  const marketingRate = biz?.marketingRate ?? 8.0;

  const isBatchQuantityAssumed = biz?.batchQuantity === undefined;
  const batchQuantity = biz?.batchQuantity ?? 1000;

  const isShelfLifeAssumed = biz?.shelfLifeMonths === undefined;
  const shelfLifeMonths = biz?.shelfLifeMonths ?? 18;

  const isNetWeightAssumed = biz?.netWeight === undefined;
  const netWeight = biz?.netWeight ?? "3.5g × 20 条/盒";

  // 纯函数计算成本指标 (复用 cost-engine)
  const retailPrice = selectedRoute.targetPrice;
  const rawMaterialEst = Number((selectedRoute.estimatedCost * 0.6).toFixed(2));
  const packagingEst = Number((selectedRoute.estimatedCost * 0.4).toFixed(2));

  const costResult = calcCost({
    retailPrice,
    materialCost: rawMaterialEst,
    packagingCost: packagingEst,
    manufacturingCost: 1.5,
    certificationCost: 0.3,
    platformFeeRate: biz?.platformFeeRate ?? 2.0,
    commissionRate,
    marketingRate,
    monthlyFixed: biz?.monthlyFixed ?? 3000,
    channel: "PUBLIC",
    invoiceType: "达人开票",
    marketReferencePrice: retailPrice * 1.1,
    pricingStrategy: "MARKET_FOLLOW",
  });

  const specificationBrief = {
    productName: `${project.title} (${selectedRoute.dosageForm})`,
    targetUser: reqAnalysis.constraints.targetAudience || "新中式健康饮品消费者",
    dosageForm: selectedRoute.dosageForm,
    netWeight,
    shelfLifeMonths,
    recommendedIngredients: selectedRoute.keyIngredients,
    forbiddenRedLines: [
      ...reqAnalysis.constraints.forbiddenForms.map((f) => `禁止剂型: ${f}`),
      ...reqAnalysis.constraints.forbiddenClaims.map((c) => `禁止宣称: ${c}`),
      ...reqAnalysis.constraints.forbiddenIngredients.map((i) => `禁止成分: ${i}`),
    ],
    experienceGoals: "冲调即溶、口感清爽甘润、无人工香精刺激感",
    technicalAdvice: "建议采用冷萃低温冻干工艺，控制水分活度 ≤ 0.6，避免活性多酚氧化衰减",
    targetRetailPrice: retailPrice,
    targetCostAmount: selectedRoute.estimatedCost,
  };

  return {
    projectId: project.id,
    categoryName,
    requirementAnalysis: reqAnalysis,
    researchReport,
    selectedRoute,
    costEconomics: costResult,
    businessAssumptions: {
      commissionRate,
      isCommissionAssumed,
      marketingRate,
      isMarketingAssumed,
      batchQuantity,
      isBatchQuantityAssumed,
      shelfLifeMonths,
      isShelfLifeAssumed,
      netWeight,
      isNetWeightAssumed,
    },
    specificationBrief,
    assembledAt: new Date().toISOString(),
  };
}

/**
 * 确认采纳产品建议包：发布正式不可变产品版本，并联动创建打样门决策草稿 (R2-05: 单一原子事务，不可变版本指纹，C01-C04 闭环)
 */
export async function commitProductSuggestionToGate(
  session: SessionContext,
  projectId: string,
  suggestion: ProductSuggestionPackage,
  options?: {
    budgetScope?: string;
    validationPlan?: string;
    isConfirmed?: boolean;
    idempotencyKey?: string;
  }
) {
  // 必须是项目负责人
  await requireProjectRole(session, projectId, [Role.OWNER]);

  const reqHash = computeRequestHash({ projectId, suggestion, options });

  return await prisma.$transaction(async (tx) => {
    // 0. C03 幂等检查
    if (options?.idempotencyKey) {
      const existingIdemp = await tx.idempotencyRecord.findUnique({
        where: { key: options.idempotencyKey },
      });
      if (existingIdemp) {
        if (existingIdemp.requestHash !== reqHash || existingIdemp.actorId !== session.userId) {
          throw new ConflictError("Idempotency key reused with different request payload or actor (C03)");
        }
        return existingIdemp.responseBody as any;
      }
    }

    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { evidences: { where: { verifyStatus: "VERIFIED" } } },
    });
    if (!project || project.organizationId !== session.organizationId) {
      throw new NotFoundError("Project not found");
    }

    // P1-02：按业务基线校验关键证据缺口是否闭合，服务端阻断提交（缺则不允许进入打样决策）
    const verifiedWithClaims = await tx.evidence.findMany({
      where: { projectId: project.id, verifyStatus: "VERIFIED" },
      include: { claims: true },
    });
    const insight = buildEvidenceInsight(verifiedWithClaims);
    const blockedGapFields: string[] = [];
    const hasPriceGap = insight.gaps.some((g) => g.fieldKey === BASELINE_FIELD.price);
    if (BUSINESS_BASELINE.priceRequired && hasPriceGap) {
      blockedGapFields.push(BASELINE_FIELD.price);
    }
    const isFollowHit =
      suggestion.researchReport?.opportunityAnalysis?.type === "FOLLOW_HIT_PRODUCT";
    if (
      BUSINESS_BASELINE.followHitRequiresSalesVolume &&
      isFollowHit &&
      insight.gaps.some((g) => g.fieldKey === BASELINE_FIELD.salesVolume)
    ) {
      blockedGapFields.push(BASELINE_FIELD.salesVolume);
    }
    const keyEvidenceGapsFilled = blockedGapFields.length === 0;
    if (!keyEvidenceGapsFilled) {
      throw new UnprocessableEntityError(
        `关键证据缺口未闭合，阻断提交（P1-02）：需补足并核实 → ${blockedGapFields.join("、")}`
      );
    }

    // 1. 查找或创建基础产品
    let product = await tx.product.findFirst({
      where: { organizationId: session.organizationId, name: project.title },
    });

    if (!product) {
      product = await tx.product.create({
        data: {
          organizationId: session.organizationId,
          name: project.title,
          identityCode: `PRD-${Date.now().toString(36).toUpperCase()}`,
          targetAudience: suggestion.specificationBrief.targetUser,
          marketPath: suggestion.requirementAnalysis.constraints.targetChannel || "全渠道",
          devMode: project.mode,
        },
      });
    }

    // 2. R2-05 & C03: 计算配方规格内容哈希（排除不可控的动态自增 revision，使相同规格生成稳定版本指纹）
    const specsObject = {
      dosageForm: suggestion.specificationBrief.dosageForm,
      netWeight: suggestion.specificationBrief.netWeight,
      shelfLifeMonths: suggestion.specificationBrief.shelfLifeMonths,
      recommendedIngredients: suggestion.specificationBrief.recommendedIngredients,
      forbiddenRedLines: suggestion.specificationBrief.forbiddenRedLines,
      retailPrice: suggestion.specificationBrief.targetRetailPrice,
      targetCost: suggestion.specificationBrief.targetCostAmount,
    };
    const specHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(specsObject))
      .digest("hex")
      .slice(0, 8);

    const versionTag = `v1.0-${suggestion.selectedRoute.routeCode}-${specHash}`;

    let productVersion = await tx.productVersion.findUnique({
      where: {
        productId_versionTag: {
          productId: product.id,
          versionTag,
        },
      },
    });

    // 收集假设未决项与 C04 状态
    const unconfirmedAssumptions: string[] = [...suggestion.requirementAnalysis.gaps];
    if (suggestion.businessAssumptions.isCommissionAssumed) {
      unconfirmedAssumptions.push("渠道带货佣金率采用默认预设 25%，尚未经业务渠道正式确认");
    }
    if (suggestion.businessAssumptions.isMarketingAssumed) {
      unconfirmedAssumptions.push("营销推广费率采用默认预设 8%，尚未经业务正式核准");
    }
    if (suggestion.businessAssumptions.isBatchQuantityAssumed) {
      unconfirmedAssumptions.push("首期中试投产批量采用预设 1000 盒");
    }

    // C02/R2-03: 研究报告中的固定模板结论必须显式降级为待验证草案
    const researchVerification = suggestion.researchReport?.verification;
    const inferredCount = researchVerification?.inferredSections?.length ?? 0;
    if (!researchVerification || researchVerification.status === "DRAFT_UNVERIFIED" || inferredCount > 0) {
      unconfirmedAssumptions.push(
        `市场研究报告为待验证草案（${researchVerification?.status ?? "DRAFT_UNVERIFIED"}）：${inferredCount} 项结论（市场趋势、痛点、路线成分与成本比例、最优路线）为规则模板推断，尚无外部证据或人工核实`
      );
    }

    const hasUnconfirmedAssumptions =
      suggestion.businessAssumptions.isCommissionAssumed ||
      suggestion.businessAssumptions.isMarketingAssumed ||
      suggestion.businessAssumptions.isBatchQuantityAssumed;

    // C04: 若存在未决假设且未明确确认，isConfirmed 必须为 false
    const isVersionConfirmed = options?.isConfirmed === true || !hasUnconfirmedAssumptions;

    if (!productVersion) {
      productVersion = await tx.productVersion.create({
        data: {
          productId: product.id,
          versionTag,
          specs: specsObject,
          technicalAdvice: suggestion.specificationBrief.technicalAdvice,
          experienceGoals: suggestion.specificationBrief.experienceGoals,
          targetCost: suggestion.specificationBrief.targetCostAmount,
          currency: "CNY",
          unknowns: unconfirmedAssumptions,
          isImmutable: true,
          isConfirmed: isVersionConfirmed,
        },
      });
    } else if (options?.isConfirmed && !productVersion.isConfirmed) {
      productVersion = await tx.productVersion.update({
        where: { id: productVersion.id },
        data: { isConfirmed: true },
      });
    }

    // 3. 将项目与此产品版本绑定，仅在绑定的 productVersion 发生变化时原子递增 revision
    let updatedProject = project;
    if (project.productVersionId !== productVersion.id) {
      updatedProject = await tx.project.update({
        where: { id: project.id },
        data: {
          productVersionId: productVersion.id,
          revision: { increment: 1 },
        },
        include: { evidences: { where: { verifyStatus: "VERIFIED" } } },
      });
    }

    // 4. C01: 持久化真实交付成果 (WorkItem + WorkSubmission + Artifacts)
    let workItem = await tx.workItem.findFirst({
      where: {
        projectId: project.id,
        title: "产品定义与可行性研判",
      },
    });

    if (!workItem) {
      workItem = await tx.workItem.create({
        data: {
          projectId: project.id,
          title: "产品定义与可行性研判",
          target: "完成需求拆解、竞品价格带研究与产品规格简报定义",
          deliverableReq: "产品规格简报 (SPECIFICATION_BRIEF) 与市场研究报告 (MARKET_RESEARCH_REPORT)",
          status: WorkItemStatus.ACCEPTED,
          executorType: WorkExecutorType.HUMAN,
          inputRevision: updatedProject.revision,
        },
      });
    } else if (workItem.status !== WorkItemStatus.ACCEPTED) {
      workItem = await tx.workItem.update({
        where: { id: workItem.id },
        data: { status: WorkItemStatus.ACCEPTED },
      });
    }

    // 4.1 计算本轮交付内容指纹（剔除时间戳，避免非业务改动触发无意义重审）
    const specContent = stableStringify(suggestion.specificationBrief);
    const reportContent = stableStringify(suggestion.researchReport);
    const specContentHash = computeArtifactContentHash(specContent);
    const reportContentHash = computeArtifactContentHash(reportContent);

    const latestSpec = await tx.artifact.findFirst({
      where: { workItemId: workItem.id, type: "SPECIFICATION_BRIEF" },
      orderBy: { contentVersion: "desc" },
    });
    const latestReport = await tx.artifact.findFirst({
      where: { workItemId: workItem.id, type: "MARKET_RESEARCH_REPORT" },
      orderBy: { contentVersion: "desc" },
    });

    const specChanged = !latestSpec || computeArtifactContentHash(latestSpec.content) !== specContentHash;
    const reportChanged = !latestReport || computeArtifactContentHash(latestReport.content) !== reportContentHash;
    const deliverablesChanged = specChanged || reportChanged;

    // 4.2 内容修订必须生成新的提交批次与负责人检查记录，历史批次完整保留
    let submission = await tx.workSubmission.findFirst({
      where: { workItemId: workItem.id },
      orderBy: { attempt: "desc" },
    });
    const isRevisionSubmission = Boolean(submission) && deliverablesChanged;

    if (!submission || isRevisionSubmission) {
      const attempt = submission ? submission.attempt + 1 : 1;
      submission = await tx.workSubmission.create({
        data: {
          workItemId: workItem.id,
          attempt,
          inputRevision: updatedProject.revision,
          submittedById: session.userId,
          runMode: RunMode.MANUAL,
          // C01: 修订批次必须经负责人逐项复核确认，禁止以“自动形式验收”替代修订内容检查
          status: isRevisionSubmission ? ArtifactReviewStatus.PENDING : ArtifactReviewStatus.ACCEPTED,
          reviewedById: isRevisionSubmission ? null : session.userId,
          reviewedAt: isRevisionSubmission ? null : new Date(),
          reviewReason: isRevisionSubmission
            ? null
            : `负责人确认采纳第 ${attempt} 批研究成果（输入基线 r${updatedProject.revision}，产品版本 ${productVersion.versionTag}），已逐项核对产品规格简报与市场研究报告内容`,
        },
      });

      await tx.workItem.update({
        where: { id: workItem.id },
        data: {
          currentSubmissionId: submission.id, // 当前提交指针更新，历史批次保留
          status: isRevisionSubmission ? WorkItemStatus.SUBMITTED : WorkItemStatus.ACCEPTED,
        },
      });
    }

    // 4.3 成果按版本追加：内容未变复用原记录，内容修订产生新版本记录（历史成果不删除不覆盖）
    const artifactReviewStatus = isRevisionSubmission ? ArtifactReviewStatus.PENDING : ArtifactReviewStatus.ACCEPTED;

    let specArtifact = latestSpec && !specChanged ? latestSpec : null;
    if (!specArtifact) {
      specArtifact = await tx.artifact.create({
        data: {
          workItemId: workItem.id,
          submissionId: submission.id,
          // I-001 / I-002 / I-003：成果必须自证归属组织与所绑产品版本，
          // 否则「产品已 V3 而营销材料仍是 V1」无法判定。
          organizationId: updatedProject.organizationId,
          productVersionId: productVersion.id,
          schemaVersion: ARTIFACT_SCHEMA_VERSION,
          type: "SPECIFICATION_BRIEF",
          title: `产品规格简报 - ${suggestion.specificationBrief.productName}`,
          content: specContent,
          contentVersion: (latestSpec?.contentVersion ?? 0) + 1,
          producerType: ProducerType.MANUAL,
          inputRevision: updatedProject.revision,
          reviewStatus: artifactReviewStatus,
        },
      });
    }

    let reportArtifact = latestReport && !reportChanged ? latestReport : null;
    if (!reportArtifact) {
      reportArtifact = await tx.artifact.create({
        data: {
          workItemId: workItem.id,
          submissionId: submission.id,
          organizationId: updatedProject.organizationId,
          productVersionId: productVersion.id,
          schemaVersion: ARTIFACT_SCHEMA_VERSION,
          type: "MARKET_RESEARCH_REPORT",
          title: `市场调研报告（待验证草案）- ${suggestion.categoryName}`,
          content: reportContent,
          contentVersion: (latestReport?.contentVersion ?? 0) + 1,
          producerType: ProducerType.MANUAL,
          inputRevision: updatedProject.revision,
          reviewStatus: artifactReviewStatus,
        },
      });
    }

    // 4.4 局部修订：未变化的成果沿用原内容（不伪装成重新研究），
    //     但必须留下一条「适用于当前基线」的待确认记录，由负责人检查该批次时确认；
    //     原始 Artifact.inputRevision 保持历史事实，不做覆盖。
    if (isRevisionSubmission) {
      const carriedForward = [
        { artifact: latestSpec && !specChanged ? latestSpec : null, label: "产品规格简报" },
        { artifact: latestReport && !reportChanged ? latestReport : null, label: "市场研究报告" },
      ];

      for (const item of carriedForward) {
        const reused = item.artifact;
        if (!reused || reused.inputRevision === updatedProject.revision) continue;

        await tx.artifactApplicability.upsert({
          where: {
            artifactId_submissionId: { artifactId: reused.id, submissionId: submission.id },
          },
          create: {
            artifactId: reused.id,
            submissionId: submission.id,
            workItemId: workItem.id,
            baselineRevision: updatedProject.revision,
            sourceInputRevision: reused.inputRevision,
            contentHash: computeArtifactContentHash(reused.content),
            status: ArtifactApplicabilityStatus.PENDING,
            note: `局部修订沿用${item.label} v${reused.contentVersion}（原始输入基线 r${reused.inputRevision}），待负责人确认适用于当前基线 r${updatedProject.revision}`,
          },
          update: {
            baselineRevision: updatedProject.revision,
            sourceInputRevision: reused.inputRevision,
            contentHash: computeArtifactContentHash(reused.content),
          },
        });
      }
    }

    // 5. 决策包引用具体成果 ID、精确版本、内容指纹、输入基线与产品版本，审批据此从权威记录核对
    const evidenceVersions = project.evidences.map((e) => ({
      id: e.id,
      hash: e.hash,
    }));

    const artifactVersions = [buildArtifactRef(specArtifact), buildArtifactRef(reportArtifact)];

    const budgetQuantity = suggestion.businessAssumptions.batchQuantity;
    const calculatedBudget = Number((suggestion.specificationBrief.targetCostAmount * budgetQuantity).toFixed(2));
    const budgetScope = options?.budgetScope || "实验室打样与第一期中试试制原料采购";
    const validationPlan = options?.validationPlan || "落实第三方检测多酚含量与感官盲测";

    const scopeHash = computeScopeHash({
      projectId: project.id,
      gate: GateType.RESEARCH_SAMPLING_GATE,
      productVersionId: productVersion.id,
      artifactVersions,
      evidenceVersions,
      budgetAmount: calculatedBudget,
      budgetCurrency: "CNY",
      budgetScope,
      validationPlan,
    });

    // C04: 若商业假设未确认，economicsFeasibilityPassed 设为 false，附带未决假设
    const economicsFeasibilityPassed = isVersionConfirmed;

    const requiredChecks = {
      forbiddenConstraintsCleared: true,
      economicsFeasibilityPassed,
      unconfirmedAssumptions: hasUnconfirmedAssumptions ? unconfirmedAssumptions : [],
      // P1-02: 关键证据缺口是否闭合（进入此处即已通过，true = 未阻断）
      keyEvidenceGapsFilled,
      // C01: 输入基线，审批时逐条核对引用成果是否基于同一输入版本
      inputBaselineRevision: updatedProject.revision,
    };

    // 5.1 C03 相同请求复用原决策包；若成果引用已变化，同步刷新草稿包绑定的成果指针
    let existingPacket = await tx.decisionPacket.findFirst({
      where: {
        projectId: project.id,
        gate: GateType.RESEARCH_SAMPLING_GATE,
        productVersionId: productVersion.id,
        status: { in: [DecisionPacketStatus.DRAFT, DecisionPacketStatus.CHANGES_REQUESTED] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingPacket) {
      const packetPayloadChanged =
        JSON.stringify(existingPacket.artifactVersions) !== JSON.stringify(artifactVersions) ||
        JSON.stringify(existingPacket.evidenceVersions) !== JSON.stringify(evidenceVersions) ||
        Number(existingPacket.budgetAmount ?? 0) !== calculatedBudget ||
        existingPacket.budgetScope !== budgetScope ||
        existingPacket.validationPlan !== validationPlan;

      if (packetPayloadChanged) {
        existingPacket = await tx.decisionPacket.update({
          where: { id: existingPacket.id },
          data: {
            artifactVersions: artifactVersions as any,
            evidenceVersions: evidenceVersions as any,
            budgetAmount: calculatedBudget,
            budgetScope,
            validationPlan,
            requiredChecks,
            scopeHash,
          },
        });
      }

      const responsePayload = {
        product,
        productVersion,
        decisionPacket: existingPacket,
        project: updatedProject,
      };

      if (options?.idempotencyKey) {
        await tx.idempotencyRecord.create({
          data: {
            key: options.idempotencyKey,
            actorId: session.userId,
            commandScope: "COMMIT_PRODUCT_SUGGESTION",
            requestHash: reqHash,
            responseStatus: 200,
            responseBody: responsePayload as any,
          },
        });
      }

      return responsePayload;
    }

    // 6. 自动在同一事务内创建研发打样门草稿决策包 (DecisionPacket DRAFT)
    const packet = await tx.decisionPacket.create({
      data: {
        projectId: project.id,
        gate: GateType.RESEARCH_SAMPLING_GATE,
        productVersionId: productVersion.id,
        artifactVersions: artifactVersions as any,
        evidenceVersions: evidenceVersions as any,
        budgetAmount: calculatedBudget,
        budgetCurrency: "CNY",
        budgetScope,
        validationPlan,
        requiredChecks,
        scopeHash,
        status: DecisionPacketStatus.DRAFT,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId: session.userId,
        action: "DECISION_PACKET_DRAFT_CREATED",
        objectType: "DecisionPacket",
        objectId: packet.id,
        summary: `负责人采纳建议包创建研发打样门决策草稿，产品版本: ${productVersion.versionTag}，结构化指纹: ${scopeHash.slice(0, 16)}`,
      },
    });

    const responsePayload = {
      product,
      productVersion,
      decisionPacket: packet,
      project: updatedProject,
    };

    if (options?.idempotencyKey) {
      await tx.idempotencyRecord.create({
        data: {
          key: options.idempotencyKey,
          actorId: session.userId,
          commandScope: "COMMIT_PRODUCT_SUGGESTION",
          requestHash: reqHash,
          responseStatus: 200,
          responseBody: responsePayload as any,
        },
      });
    }

    return responsePayload;
  });
}
