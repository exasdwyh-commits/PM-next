import crypto from "crypto";
import { LaunchMilestoneStatus } from "@prisma/client";

export interface LaunchGateCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface LaunchGate {
  ready: boolean;
  checks: LaunchGateCheck[];
  blockers: string[];
  summary: string;
}

export interface LaunchPlanSnapshotInput {
  launchPlanId: string;
  governanceRevision: number;
  projectId: string;
  projectRevision: number;
  productId: string;
  productVersionId: string | null;
  productionBasis?: {
    projectStage: string;
    g2PacketId: string;
    productionRecordId: string;
    productionRecordContentHash: string;
    deliveredQuantity: number;
    unit: string;
  } | null;
  title: string;
  targetDate: Date | string | null;
  ownerId: string | null;
  status: string;
  notes?: string | null;
  milestones: Array<{
    id: string;
    title: string;
    kind: string;
    seq: number;
    dueDate: Date | string | null;
    ownerId: string | null;
    status: LaunchMilestoneStatus | string;
    blockerReason: string | null;
    workItemId: string | null;
    completedAt?: Date | string | null;
  }>;
}

const iso = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
};

export function evaluateGate(plan: {
  ownerId: string | null;
  targetDate: Date | null;
  milestones: { title: string; status: LaunchMilestoneStatus }[];
}): LaunchGate {
  const checks: LaunchGateCheck[] = [
    {
      key: "owner",
      label: "已指定负责人",
      ok: !!plan.ownerId,
      detail: plan.ownerId ? "负责人已指定" : "尚未指定负责人",
    },
    {
      key: "targetDate",
      label: "已设置目标日期",
      ok: !!plan.targetDate,
      detail: plan.targetDate ? "目标日期已设置" : "尚未设置目标日期",
    },
    {
      key: "milestones",
      label: "至少一个依赖里程碑",
      ok: plan.milestones.length > 0,
      detail: plan.milestones.length > 0 ? `已有 ${plan.milestones.length} 个里程碑` : "尚无任何依赖里程碑",
    },
  ];

  const blocked = plan.milestones.filter((m) => m.status === "BLOCKED");
  checks.push({
    key: "no_blocked",
    label: "无阻塞项",
    ok: blocked.length === 0,
    detail: blocked.length === 0
      ? "无阻塞项"
      : `存在 ${blocked.length} 个阻塞项：${blocked.map((m) => m.title).join("、")}`,
  });

  const unfinished = plan.milestones.filter((m) => m.status !== "DONE");
  checks.push({
    key: "all_done",
    label: "全部依赖已完成",
    ok: plan.milestones.length > 0 && unfinished.length === 0,
    detail: plan.milestones.length === 0
      ? "尚无里程碑，谈不上完成"
      : unfinished.length === 0
        ? "全部里程碑已完成"
        : `未完成 ${unfinished.length} 项：${unfinished.map((m) => `${m.title}（${m.status}）`).join("、")}`,
  });

  const blockers = checks.filter((c) => !c.ok).map((c) => c.detail);
  return {
    ready: blockers.length === 0,
    checks,
    blockers,
    summary: blockers.length === 0
      ? "门禁全部满足，可提交正式 G3 上市授权审批。"
      : `尚有 ${blockers.length} 项未满足：${blockers.join("；")}`,
  };
}

export function canonicalLaunchPlanSnapshot(input: LaunchPlanSnapshotInput) {
  return {
    launchPlanId: input.launchPlanId,
    governanceRevision: input.governanceRevision,
    projectId: input.projectId,
    projectRevision: input.projectRevision,
    productId: input.productId,
    productVersionId: input.productVersionId ?? null,
    productionBasis: input.productionBasis
      ? {
          projectStage: input.productionBasis.projectStage,
          g2PacketId: input.productionBasis.g2PacketId,
          productionRecordId: input.productionBasis.productionRecordId,
          productionRecordContentHash: input.productionBasis.productionRecordContentHash,
          deliveredQuantity: input.productionBasis.deliveredQuantity,
          unit: input.productionBasis.unit,
        }
      : null,
    title: input.title.trim(),
    targetDate: iso(input.targetDate),
    ownerId: input.ownerId ?? null,
    status: input.status,
    notes: input.notes?.trim() || null,
    milestones: [...input.milestones]
      .map((m) => ({
        id: m.id,
        title: m.title.trim(),
        kind: m.kind,
        seq: m.seq,
        dueDate: iso(m.dueDate),
        ownerId: m.ownerId ?? null,
        status: String(m.status),
        blockerReason: m.blockerReason?.trim() || null,
        workItemId: m.workItemId ?? null,
        completedAt: iso(m.completedAt),
      }))
      .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id)),
  };
}

export function computeLaunchPlanHash(input: LaunchPlanSnapshotInput): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalLaunchPlanSnapshot(input)))
    .digest("hex");
}
