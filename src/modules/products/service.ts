import prisma from "@/shared/db";
import { SessionContext } from "../identity/session";
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { Prisma, ProductLifecycleStage, ProjectMode, Role } from "@prisma/client";
import { createAuditEventInTx } from "@/shared/audit";
import { PRODUCT_WRITE_ROLES, requireProductRead, requireProductRole } from "../identity/product-access";
import {
  BUSINESS_EVENT_TYPES,
  dispatchBusinessEvent,
  enqueueBusinessEventInTx,
} from "../business-events";

export interface CreateProductParams {
  name: string;
  identityCode: string;
  targetAudience: string;
  marketPath: string;
  devMode: string;
}

export async function createProduct(session: SessionContext, params: CreateProductParams) {
  // D-017：缺必填字段此前会一路冒到 `params.targetAudience.trim()`，抛**原生 TypeError**
  // （"Cannot read properties of undefined (reading 'trim')"）→ 被当成「服务端崩了」的 500。
  // 修法照抄本文件 createDevelopmentProduct 的既有范式（收集缺失项 → 一次性 422 并点名字段），
  // 不发明新写法。缺失项用 **API 字段名**，便于调用方直接定位。
  const name = params.name?.trim();
  const identityCode = params.identityCode?.trim();
  const targetAudience = params.targetAudience?.trim();
  const marketPath = params.marketPath?.trim();
  const devMode = params.devMode?.trim();

  const missing = [
    ["name", name],
    ["identityCode", identityCode],
    ["targetAudience", targetAudience],
    ["marketPath", marketPath],
    ["devMode", devMode],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new UnprocessableEntityError(`入库必填项缺失：${missing.join("、")}`);
  }

  const product = await prisma.product.create({
    data: {
      organizationId: session.organizationId,
      name: name!,
      identityCode: identityCode!,
      targetAudience: targetAudience!,
      marketPath: marketPath!,
      devMode: devMode!,
    },
  });

  return product;
}

export interface PublishVersionParams {
  versionTag: string;
  specs: Record<string, any>;
  technicalAdvice?: string;
  experienceGoals?: string;
  targetCost?: number;
  currency?: string;
  unknowns?: Record<string, any>;
  isConfirmed?: boolean;
}

export async function publishProductVersion(
  session: SessionContext,
  productId: string,
  params: PublishVersionParams
) {
  // B4：产品级授权。此前仅校验 organizationId（同组织任意用户可发布版本），
  // 现要求调用者是该产品**关联项目**的 OWNER / DECISION_MAKER。
  // 产品不存在或跨组织由 requireProductRole 统一返回 404，不泄露存在性。
  await requireProductRole(session, productId, PRODUCT_WRITE_ROLES);

  if (!params.versionTag || !params.specs) {
    throw new UnprocessableEntityError("versionTag and specs are required");
  }

  const created = await prisma.$transaction(async (tx) => {
    const version = await tx.productVersion.create({
      data: {
        productId,
        versionTag: params.versionTag.trim(),
        specs: params.specs,
        technicalAdvice: params.technicalAdvice,
        experienceGoals: params.experienceGoals,
        targetCost: params.targetCost,
        currency: params.currency || "CNY",
        unknowns: params.unknowns,
        isImmutable: true,
        isConfirmed: params.isConfirmed ?? false, // R08: Business confirmation distinction
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "PRODUCT_VERSION_PUBLISHED",
      objectType: "ProductVersion",
      objectId: version.id,
      summary: `发布产品版本 ${version.versionTag}`,
      details: {
        productId,
        versionTag: version.versionTag,
        isConfirmed: version.isConfirmed,
      } as Prisma.InputJsonValue,
    });

    const event = await enqueueBusinessEventInTx(tx, {
      organizationId: session.organizationId,
      eventKey: `product-version:${version.id}:published`,
      eventType: BUSINESS_EVENT_TYPES.PRODUCT_VERSION_PUBLISHED,
      aggregateType: "ProductVersion",
      aggregateId: version.id,
      payload: {
        productId,
        versionTag: version.versionTag,
        isImmutable: version.isImmutable,
        isConfirmed: version.isConfirmed,
        hasUnknowns:
          !!params.unknowns && Object.keys(params.unknowns).length > 0,
      },
      contextRefs: [
        `product:${productId}`,
        `product-version:${version.id}`,
      ],
      createdById: session.userId,
    });

    return { version, eventId: event.id };
  });

  // The ProductVersion is already committed together with its outbox event.
  // Automation failure must not turn a successful immutable version write into
  // an ambiguous API failure.
  await dispatchBusinessEvent(session.organizationId, created.eventId, {
    workerId: "product-version:" + session.userId,
  }).catch(() => null);

  return created.version;
}

export async function listOrganizationProducts(session: SessionContext) {
  return await prisma.product.findMany({
    where: { organizationId: session.organizationId },
    include: {
      versions: {
        where: { isConfirmed: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ===========================================================================
// 产品开发工作台（蓝图 §4.2 / §4.3）
// ===========================================================================

export interface CreateDevelopmentProductParams {
  name: string;
  coreIdea: string;
  targetAudience: string;
  coreSellingPoints: string;
  targetChannels: string;
  // 选填 / 后续补充
  priceExpectation?: string;
  targetCost?: number;
  formSpec?: string;
  forbiddenItems?: string;
  targetLaunchDate?: string | null;
  /** MANUAL 手工填写 / AI_EXTRACTED 粘贴文本提取草稿（用户已编辑确认） */
  sourceKind?: string;
}

function autoIdentityCode(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9\u4e00-\u9fa5]/g, "")
    .slice(0, 6);
  const tail = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `P-${slug || "NEW"}-${tail}`;
}

/**
 * 产品入库（蓝图 §4.2）：**原子**创建 Product + 初始 ProductVersion(v1) + 首次开发 Project，
 * 并写 Project.productId、ProjectMember、AuditEvent。
 *
 * 首屏只要求 名称/一句话想法、目标人群与场景、核心卖点、预期渠道；
 * 价格、目标成本、剂型规格、禁用项、目标上市日均为选填 —— 不阻止保存想法。
 */
export async function createDevelopmentProduct(
  session: SessionContext,
  params: CreateDevelopmentProductParams
) {
  const name = params.name?.trim();
  const coreIdea = params.coreIdea?.trim();
  const targetAudience = params.targetAudience?.trim();
  const coreSellingPoints = params.coreSellingPoints?.trim();
  const targetChannels = params.targetChannels?.trim();

  const missing = [
    ["名称", name],
    ["一句话想法", coreIdea],
    ["目标人群与场景", targetAudience],
    ["核心卖点", coreSellingPoints],
    ["预期渠道", targetChannels],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new UnprocessableEntityError(`入库必填项缺失：${missing.join("、")}`);
  }

  const targetLaunchDate = params.targetLaunchDate ? new Date(params.targetLaunchDate) : null;
  if (targetLaunchDate && Number.isNaN(targetLaunchDate.getTime())) {
    throw new UnprocessableEntityError("目标上市日期格式无效");
  }

  let identityCode = autoIdentityCode(name);
  // 极小概率冲突时重试一次，避免整个入库失败。
  // D-001 修复后唯一性是**组织内**的（`@@unique([organizationId, identityCode])`），
  // 因此这里必须按 `organizationId + identityCode` 复合键查重：
  // 用 `findUnique({ where: { identityCode } })` 既不再合法（identityCode 不是单列唯一），
  // 也会把「别的组织已用此码」误判成本组织冲突。
  const dup = await prisma.product.findUnique({
    where: { organizationId_identityCode: { organizationId: session.organizationId, identityCode } },
  });
  if (dup) identityCode = autoIdentityCode(name);

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        organizationId: session.organizationId,
        name,
        identityCode,
        targetAudience,
        marketPath: targetChannels, // 复用既有非空字段承载「预期渠道」
        devMode: "NEW_PRODUCT",
        coreIdea,
        coreSellingPoints,
        targetChannels,
        ownerId: session.userId,
        lifecycleStage: ProductLifecycleStage.IDEA,
        targetLaunchDate,
        priceExpectation: params.priceExpectation?.trim() || null,
        formSpec: params.formSpec?.trim() || null,
        forbiddenItems: params.forbiddenItems?.trim() || null,
        sourceKind: params.sourceKind === "AI_EXTRACTED" ? "AI_EXTRACTED" : "MANUAL",
      },
    });

    const version = await tx.productVersion.create({
      data: {
        productId: product.id,
        versionTag: "v1",
        specs: {
          coreIdea,
          coreSellingPoints,
          targetChannels,
          formSpec: params.formSpec?.trim() || null,
          priceExpectation: params.priceExpectation?.trim() || null,
          forbiddenItems: params.forbiddenItems?.trim() || null,
          sourceKind: product.sourceKind,
        } as Prisma.InputJsonValue,
        targetCost: params.targetCost ?? null,
        unknowns: {
          note: "入库时未提供的字段保持未知，不补造数值",
          missing: [
            ...(params.priceExpectation ? [] : ["priceExpectation"]),
            ...(params.targetCost === undefined || params.targetCost === null ? ["targetCost"] : []),
            ...(params.formSpec ? [] : ["formSpec"]),
            ...(targetLaunchDate ? [] : ["targetLaunchDate"]),
          ],
        } as Prisma.InputJsonValue,
        isImmutable: true,
        isConfirmed: false,
      },
    });

    const project = await tx.project.create({
      data: {
        organizationId: session.organizationId,
        title: name,
        target: coreIdea,
        mode: ProjectMode.NEW_PRODUCT,
        isDemo: false,
        productId: product.id,
        productVersionId: version.id,
        ownerId: session.userId,
      },
    });

    await tx.projectMember.create({
      data: { projectId: project.id, userId: session.userId, role: Role.OWNER },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "PRODUCT_INGESTED",
      objectType: "Product",
      objectId: product.id,
      summary: `产品入库 "${name}"（${identityCode}），同时创建初始版本 v1 与首次开发项目`,
    });

    return { product, version, project };
  });

  return result;
}

/**
 * 产品列表 / 阶段看板（蓝图 §3「产品开发」入口）
 * 只返回当前组织数据；每个产品的负责人、当前阶段、目标上市日、阻塞项均为真实字段，
 * 未填写即返回 null，由前端显示「未设置」。
 */
export async function listProductBoard(session: SessionContext) {
  const products = await prisma.product.findMany({
    where: { organizationId: session.organizationId },
    include: {
      owner: { select: { id: true, name: true } },
      versions: { orderBy: { createdAt: "desc" }, take: 1 },
      projects: { select: { id: true, title: true, stage: true } },
      analysisRuns: {
        where: { status: "SUCCEEDED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { scorecard: true },
      },
      launchPlans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { milestones: { select: { status: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return products.map((p) => {
    const latestRun = p.analysisRuns[0] ?? null;
    const plan = p.launchPlans[0] ?? null;
    const blockedMilestones = plan?.milestones.filter((m) => m.status === "BLOCKED").length ?? 0;
    return {
      id: p.id,
      name: p.name,
      identityCode: p.identityCode,
      coreIdea: p.coreIdea,
      lifecycleStage: p.lifecycleStage,
      owner: p.owner ? { id: p.owner.id, name: p.owner.name } : null,
      targetLaunchDate: p.targetLaunchDate,
      actualLaunchDate: p.actualLaunchDate,
      versionTag: p.versions[0]?.versionTag ?? null,
      projectCount: p.projects.length,
      projects: p.projects,
      scorecard: latestRun?.scorecard
        ? {
            weightedScore: latestRun.scorecard.weightedScore,
            coverageRatio: latestRun.scorecard.coverageRatio,
            provisional: latestRun.scorecard.provisional,
            ruleVersion: latestRun.scorecard.ruleVersion,
            computedAt: latestRun.scorecard.computedAt,
          }
        : null,
      launchBlockedCount: blockedMilestones,
      hasLaunchPlan: !!plan,
    };
  });
}

/**
 * 产品总览（蓝图 §4.3 默认页签）
 * 组成：产品定义卡、最新综合判断、评分与证据完整度、前三风险、下一步、最近变更、里程碑。
 */
export async function getProductOverview(session: SessionContext, productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      versions: { orderBy: { createdAt: "desc" } },
      projects: {
        select: {
          id: true,
          title: true,
          stage: true,
          revision: true,
          updatedAt: true,
          productVersionId: true,
          evidences: {
            select: {
              id: true,
              source: true,
              contentOrUri: true,
              author: true,
              verifyStatus: true,
              nature: true,
              validationStatus: true,
              productRef: true,
              channel: true,
              claims: { select: { id: true, fieldName: true, kind: true, value: true, unit: true, mechanism: true } },
            },
          },
          dataGaps: {
            select: { id: true, fieldKey: true, fieldName: true, status: true, description: true },
          },
        },
      },
      analysisRuns: {
        where: { status: "SUCCEEDED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { dimensions: true, scorecard: true },
      },
      launchPlans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          milestones: { orderBy: { seq: "asc" } },
          owner: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!product) {
    throw new NotFoundError("Product not found");
  }

  // B4（2026-09-16 拍板）：读路径 = **组织内可读**。产品详情（含分析、证据、版本轨迹）
  // 同组织的任何成员都可查看；此前要求「必须是关联项目成员」会让同事看不到同公司产品。
  // 跨组织 / 不存在仍由 requireProductRead 统一 404，不泄露存在性。
  await requireProductRead(session, productId);

  const latestRun = product.analysisRuns[0] ?? null;
  const dimensionList = latestRun
    ? (["DEMAND_VALUE", "DIFFERENTIATION", "UNIT_ECONOMICS", "COMPANY_FIT", "DELIVERY_FEASIBILITY", "LAUNCH_READINESS"] as const)
        .map((k) => latestRun.dimensions.find((d) => d.dimension === k))
        .filter((d): d is NonNullable<typeof d> => !!d)
    : [];

  // 前三风险：优先取分析维度里的缺口，其次取项目缺口
  const risks = dimensionList
    .filter((d) => d.gaps)
    .map((d) => ({ dimension: d.dimension, text: d.gaps as string }))
    .slice(0, 3);

  // 下一步：取已评维度中最低分的建议，否则取第一条有建议的维度
  const rated = dimensionList.filter((d) => d.score !== null);
  const nextStepDimension = rated.length > 0 ? rated.reduce((a, b) => ((a.score ?? 0) <= (b.score ?? 0) ? a : b)) : null;
  const nextStep = nextStepDimension?.recommendation ?? dimensionList.find((d) => d.recommendation)?.recommendation ?? null;

  const evidenceCounts = product.projects.flatMap((p) => p.evidences);
  const evidenceCompleteness = {
    total: evidenceCounts.length,
    verifiedReal: evidenceCounts.filter((e) => e.verifyStatus === "VERIFIED" && e.nature === "REAL").length,
    unverified: evidenceCounts.filter((e) => e.verifyStatus === "UNVERIFIED").length,
    demo: evidenceCounts.filter((e) => e.nature === "DEMO").length,
  };

  const recentChanges = await prisma.auditEvent.findMany({
    where: {
      OR: [
        { objectType: "Product", objectId: product.id },
        ...(product.projects.length > 0
          ? [{ objectType: "Project", objectId: { in: product.projects.map((p) => p.id) } }]
          : []),
      ],
    },
    orderBy: { timestamp: "desc" },
    // 产品详情「变更审计」折叠区默认展示 8 条，其余由客户端「查看全部」展开
    take: 50,
    include: { actor: { select: { id: true, name: true } } },
  });

  return {
    product,
    latestRun,
    dimensions: dimensionList,
    scorecard: latestRun?.scorecard ?? null,
    risks,
    nextStep,
    evidenceCompleteness,
    recentChanges,
    launchPlan: product.launchPlans[0] ?? null,
  };
}

export type ProductOverview = Awaited<ReturnType<typeof getProductOverview>>;

