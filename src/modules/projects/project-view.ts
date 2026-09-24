/**
 * 项目详情对外字段白名单（Phase 3A · B6 收尾）
 *
 * 背景：项目详情原来有**两套**查询形状——`projects/[id]/page.tsx`（SSR）与
 * `GET /api/projects/[id]`（客户端 reloadProject 后整体替换 state）。两者字段不一致，
 * 既造成「刷新后沿用成果提示消失」这类功能漂移，又让 `include` 整行下发了内部字段。
 *
 * 因此把形状收口到本文件一份定义，页面与服务端同源使用，新字段默认不外发。
 *
 * 剔除内容与理由：
 * - `workItems.artifacts` / `receipts` / `submissions` / `applicabilities`：原为 `include` 整行，
 *   会带出 `workItemId`、`submissionId`、`artifactIds`(Json)、`evidenceRefs`(Json)、
 *   `contentHash`、`submittedById`、`reviewedById` 等内部关联与实现细节；
 *   现按客户端**已证实消费的字段**显式选取。
 * - `submissions.artifacts`：客户端从不读取（只用 `submissions[0].id` / `.attempt`），移除。
 * - `members`：客户端不消费；仅服务端用于成员鉴权与角色判定，故只取 `userId` + `role`。
 * - `owner` / `decisionMaker`：客户端只展示 `name`，不再下发 `email`。
 * - `decisionPackets.artifactVersions` / `evidenceVersions` / `requiredChecks` / `snapshot`：
 *   服务端用于批准有效性（漂移）判定的原始 Json，客户端不消费，改由服务端单独窄查询获取。
 * - 各类 `createdAt/updatedAt`、外键 id：仅保留 UI 实际渲染的 `createdAt`。
 */

import { EVIDENCE_PUBLIC_SELECT } from "@/modules/evidence/evidence-view";

/** 交付产物的客户端可见字段（`content` 为成果正文，页面直接渲染） */
const ARTIFACT_PUBLIC_SELECT = {
  id: true,
  type: true,
  title: true,
  content: true,
  contentVersion: true,
  producerType: true,
  reviewStatus: true,
} as const;

/** 运行回执的客户端可见字段（`artifactIds` 为内部 Json，已剔除） */
const RECEIPT_PUBLIC_SELECT = {
  id: true,
  attempt: true,
  inputRevision: true,
  runMode: true,
  status: true,
  startedAt: true,
  errorMessage: true,
} as const;

/** 提交批次的客户端可见字段（原 `include` 会带出提交人/审核人内部 id） */
const SUBMISSION_PUBLIC_SELECT = {
  id: true,
  attempt: true,
  status: true,
  reviewReason: true,
  reviewedAt: true,
  createdAt: true,
} as const;

/** 沿用成果适用性的客户端可见字段（`contentHash` / `confirmedById` 属内部；确认人姓名属可见信息） */
const APPLICABILITY_PUBLIC_SELECT = {
  id: true,
  submissionId: true,
  status: true,
  baselineRevision: true,
  sourceInputRevision: true,
  note: true,
  confirmedAt: true,
  // 审核提示会渲染确认人姓名（`ap.confirmedBy?.name`），不能只留 confirmedById
  confirmedBy: { select: { id: true, name: true } },
  artifact: {
    select: { id: true, type: true, title: true, contentVersion: true, inputRevision: true },
  },
} as const;

/**
 * 项目详情查询白名单。页面与服务端 API 必须共用，禁止再各自 `include` 整行。
 */
export const PROJECT_DETAIL_SELECT = {
  // 项目本体：`constraints` 供服务端缺口/机会分析使用；`productId`/`productVersionId` 供版本基准判定
  id: true,
  organizationId: true,
  mode: true,
  title: true,
  target: true,
  constraints: true,
  stage: true,
  revision: true,
  isDemo: true,
  productId: true,
  productVersionId: true,
  ownerId: true,
  decisionMakerId: true,
  createdAt: true,
  updatedAt: true,

  owner: { select: { id: true, name: true } },
  decisionMaker: { select: { id: true, name: true } },
  // 仅服务端鉴权/角色判定使用；客户端不消费该关系
  members: { select: { userId: true, role: true } },

  workItems: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      target: true,
      status: true,
      executorType: true,
      deliverableReq: true,
      dependencies: true,
      artifacts: { select: ARTIFACT_PUBLIC_SELECT },
      receipts: { orderBy: { startedAt: "desc" }, select: RECEIPT_PUBLIC_SELECT },
      // B01-03：审核提示要取「最新一批」提交。用 attempt 排序，而不是 createdAt——
      // createdAt 为毫秒精度，同一工作项内连续两次提交可能落在同一毫秒，排序平局时
      // 可能取到上一批：表现为「第 N 批」显示错误、且沿用成果/未确认提示整块不渲染（实测 D-010）。
      submissions: { orderBy: { attempt: "desc" }, select: SUBMISSION_PUBLIC_SELECT },
      // B01-03：审核页需展示本批次沿用成果及其原始版本与确认状态
      applicabilities: {
        orderBy: { createdAt: "desc" },
        select: APPLICABILITY_PUBLIC_SELECT,
      },
    },
  },

  // B6：Evidence 显式白名单（剔除 fileKey 等服务端字段）
  evidences: {
    orderBy: { createdAt: "desc" },
    select: {
      ...EVIDENCE_PUBLIC_SELECT,
      verifiedBy: { select: { id: true, name: true } },
      claims: true,
    },
  },

  feedbackItems: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      targetType: true,
      targetId: true,
      status: true,
      content: true,
      dispositionReason: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
  },

  decisionPackets: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      gate: true,
      scopeHash: true,
      status: true,
      budgetAmount: true,
      budgetCurrency: true,
      budgetScope: true,
      validationPlan: true,
      submittedAt: true,
      createdAt: true,
      decisions: {
        orderBy: { decidedAt: "desc" },
        select: {
          id: true,
          decision: true,
          reason: true,
          obligations: true,
          decidedAt: true,
          actor: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

/**
 * 批准有效性（漂移）判定所需的**服务端内部**字段。
 *
 * 这些 Json 是批准比对的原像，客户端不需要，因此**不进** `PROJECT_DETAIL_SELECT`；
 * 仅在项目处于 `SAMPLING` 且存在 `APPROVED` 决策包时按需窄查询。
 */
export const APPROVAL_META_SELECT = {
  id: true,
  gate: true,
  scopeHash: true,
  budgetAmount: true,
  budgetCurrency: true,
  budgetScope: true,
  validationPlan: true,
  artifactVersions: true,
  evidenceVersions: true,
  snapshot: true,
} as const;
