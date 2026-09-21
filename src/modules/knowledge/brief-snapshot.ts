/**
 * 品牌简报快照构建（TASK-010；计划 §1.7 / 契约「结构化成果与门禁契约」B 节）
 *
 * 从组织已确认的 CompanyFact 聚合成 COMPANY_BRAND_BRIEF 结构化成果。
 * - 只读聚合：不创建、不确认、不修改任何 CompanyFact。
 * - 来源追踪：每个 fact 记录 id、key、label、status、sourceDocId、sourcePath。
 * - 缺口识别：brief 必填字段若无对应 CONFIRMED fact，列入 missingInputs。
 * - confirmedFactVersion：取所有纳入 fact 中最新 confirmedAt，无则 null。
 */
import prisma from "@/shared/db";
import { CompanyFactStatus } from "@prisma/client";
import { SessionContext } from "../identity/session";
import { computeInputFingerprint } from "../work/structured-artifacts";

/**
 * COMPANY_BRAND_BRIEF 的业务字段与 CompanyFact.key 映射。
 * key 不区分大小写（实际存储为 lowercase）。
 */
const BRIEF_FIELD_FACT_MAP: Record<string, { briefField: string; description: string }> = {
  goals: { briefField: "goals", description: "品牌目标/使命" },
  audience: { briefField: "audience", description: "目标受众" },
  channels: { briefField: "channels", description: "销售渠道/触达渠道" },
  resources: { briefField: "resources", description: "可用资源/供应链" },
  forbidden: { briefField: "forbiddenItems", description: "禁止事项/红线" },
};

export interface BriefSourceRef {
  factId: string;
  factKey: string;
  factLabel: string;
  status: CompanyFactStatus;
  sourceDocId: string | null;
  sourcePath: string | null;
}

export interface BuildBriefSnapshotInput {
  session: SessionContext;
}

export interface BriefSnapshotResult {
  /** 适合写入 COMPANY_BRAND_BRIEF 的业务输入（不含信封字段） */
  businessInput: Record<string, unknown>;
  /** 每个 brief 字段的来源 fact */
  sourceRefs: BriefSourceRef[];
  /** 缺少 CONFIRMED fact 的必填字段名 */
  missingInputs: string[];
  /** 所有纳入 fact 中最新的 confirmedAt（无则 null） */
  confirmedFactVersion: string | null;
  /** 业务输入指纹 */
  inputFingerprint: string;
}

type FactRow = {
  id: string;
  key: string;
  label: string;
  value: string;
  status: CompanyFactStatus;
  sourceDocId: string | null;
  sourcePath: string | null;
  confirmedAt: Date | null;
};

/**
 * 从 CompanyFact 列表中按 key 前缀匹配 brief 字段。
 * 同一 brief 字段若有多个 fact（如 goals.brand、goals.product），合并为数组。
 */
function matchFactsToFields(facts: FactRow[]): {
  matched: Record<string, string[]>;
  sourceRefs: BriefSourceRef[];
} {
  const matched: Record<string, string[]> = {};
  const sourceRefs: BriefSourceRef[] = [];

  for (const fact of facts) {
    const keyLower = fact.key.toLowerCase();
    for (const [prefix, mapping] of Object.entries(BRIEF_FIELD_FACT_MAP)) {
      if (keyLower === prefix || keyLower.startsWith(prefix + ".") || keyLower.startsWith(prefix + "/")) {
        const arr = (matched[mapping.briefField] ??= []);
        arr.push(fact.value);
        sourceRefs.push({
          factId: fact.id,
          factKey: fact.key,
          factLabel: fact.label,
          status: fact.status,
          sourceDocId: fact.sourceDocId,
          sourcePath: fact.sourcePath,
        });
        break;
      }
    }
  }

  return { matched, sourceRefs };
}

/**
 * 构建 COMPANY_BRAND_BRIEF 快照。
 *
 * 只读操作：查询已确认的 CompanyFact，聚合成结构化成果业务输入。
 * 调用方负责通过 writeStructuredArtifact 落库。
 */
export async function buildCompanyBriefSnapshot(
  input: BuildBriefSnapshotInput
): Promise<BriefSnapshotResult> {
  const { session } = input;

  // 查询本组织所有 CONFIRMED + PENDING 的 fact（PENDING 也纳入以识别缺口）
  const facts = await prisma.companyFact.findMany({
    where: {
      organizationId: session.organizationId,
      status: { in: [CompanyFactStatus.CONFIRMED, CompanyFactStatus.PENDING] },
    },
    orderBy: [{ status: "asc" }, { key: "asc" }],
  });

  const factRows: FactRow[] = facts.map((f) => ({
    id: f.id,
    key: f.key,
    label: f.label,
    value: f.value,
    status: f.status,
    sourceDocId: f.sourceDocId,
    sourcePath: f.sourcePath,
    confirmedAt: f.confirmedAt,
  }));

  const { matched, sourceRefs } = matchFactsToFields(factRows);

  // 缺口识别：必填字段若无 CONFIRMED fact 则列入 missingInputs
  const requiredFields = ["goals", "audience", "channels", "resources", "forbiddenItems"];
  const missingInputs: string[] = [];
  for (const field of requiredFields) {
    if (!matched[field] || matched[field].length === 0) {
      missingInputs.push(`${field}: 无已确认事实（${BRIEF_FIELD_FACT_MAP[field]?.description ?? field}）`);
    }
  }

  // confirmedFactVersion：取所有纳入 fact 中最新 confirmedAt
  const confirmedDates = sourceRefs
    .map((ref) => {
      const fact = factRows.find((f) => f.id === ref.factId);
      return fact?.confirmedAt ?? null;
    })
    .filter((d): d is Date => d !== null);

  const confirmedFactVersion =
    confirmedDates.length > 0
      ? new Date(Math.max(...confirmedDates.map((d) => d.getTime()))).toISOString()
      : null;

  const businessInput: Record<string, unknown> = {
    goals: matched.goals ?? [],
    audience: matched.audience ?? [],
    channels: matched.channels ?? [],
    resources: matched.resources ?? [],
    forbiddenItems: matched.forbiddenItems ?? [],
    confirmedFactRefs: sourceRefs.map((ref) => ref.factId),
    confirmedFactVersion,
  };

  return {
    businessInput,
    sourceRefs,
    missingInputs,
    confirmedFactVersion,
    inputFingerprint: computeInputFingerprint(businessInput),
  };
}
