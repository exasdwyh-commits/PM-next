import { Prisma, ProjectStage } from "@prisma/client";
import { computeArtifactContentHash } from "../decisions/artifact-ref";
import { readStructuredArtifact } from "../work/structured-artifacts";

export interface LaunchProductionBasis {
  projectStage: string;
  g2PacketId: string;
  productionRecordId: string;
  productionRecordContentHash: string;
  deliveredQuantity: number;
  unit: string;
}

export interface LaunchProductionBasisStatus {
  ready: boolean;
  blockers: string[];
  basis: LaunchProductionBasis | null;
}

type ProductionBasisClient = Pick<
  Prisma.TransactionClient,
  "project" | "decisionPacket" | "artifact"
>;

export async function inspectLaunchProductionBasis(
  client: ProductionBasisClient,
  params: {
    projectId: string;
    organizationId: string;
    productVersionId: string | null;
  }
): Promise<LaunchProductionBasisStatus> {
  const blockers: string[] = [];

  const project = await client.project.findUnique({
    where: { id: params.projectId },
    select: {
      id: true,
      organizationId: true,
      stage: true,
      productVersionId: true,
    },
  });

  if (!project || project.organizationId !== params.organizationId) {
    return {
      ready: false,
      blockers: ["上市项目不存在或不属于当前组织"],
      basis: null,
    };
  }
  if (project.stage !== ProjectStage.DELIVERED) {
    blockers.push(`G3 前必须完成真实生产交付，当前项目阶段为 ${project.stage}`);
  }
  if (!params.productVersionId || project.productVersionId !== params.productVersionId) {
    blockers.push("G3 当前产品版本与已交付项目版本不一致");
  }

  const approvedG2 = await client.decisionPacket.findFirst({
    where: {
      projectId: params.projectId,
      gate: "PRODUCTION_GATE",
      status: "APPROVED",
      productVersionId: params.productVersionId,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      requiredChecks: true,
    },
  });
  if (!approvedG2) {
    blockers.push("缺少当前产品版本的正式 G2 生产投入授权");
  }

  const record = await client.artifact.findFirst({
    where: {
      organizationId: params.organizationId,
      productVersionId: params.productVersionId,
      type: "PRODUCTION_RECORD",
      reviewStatus: "ACCEPTED",
      workItem: { projectId: params.projectId },
    },
    orderBy: [{ createdAt: "desc" }, { contentVersion: "desc" }],
    select: {
      id: true,
      type: true,
      content: true,
      schemaVersion: true,
    },
  });
  if (!record || !record.schemaVersion) {
    blockers.push("缺少当前产品版本、负责人验收通过的结构化 PRODUCTION_RECORD");
  }

  let quantity: number | null = null;
  let unit: string | null = null;

  if (record?.schemaVersion && approvedG2) {
    try {
      const parsed = readStructuredArtifact({
        type: record.type,
        content: record.content,
        schemaVersion: record.schemaVersion,
      });
      if (parsed.kind !== "structured") {
        blockers.push("生产记录不是可验证的结构化成果");
      } else {
        const value = parsed.value;
        if (value.dataNature !== "REAL") blockers.push("演示/测试生产记录不能作为 G3 生产依据");
        const missing = Array.isArray(value.missingInputs) ? value.missingInputs : [];
        if (missing.length > 0) {
          blockers.push(`生产记录仍有未闭合输入：${missing.join("、")}`);
        }
        if (value.authorizationRef !== approvedG2.id) {
          blockers.push("生产记录未绑定当前正式 G2 授权");
        }
        quantity =
          typeof value.quantity === "number" && Number.isFinite(value.quantity)
            ? value.quantity
            : null;
        unit = typeof value.unit === "string" && value.unit.trim() ? value.unit : null;
        if (!quantity || quantity <= 0 || !unit) {
          blockers.push("生产记录缺少有效的实际生产数量/单位");
        }

        const authorization = ((approvedG2.requiredChecks as Record<string, any>)?.productionAuthorization ?? {}) as {
          quantity?: unknown;
          unit?: unknown;
        };
        if (
          typeof authorization.quantity !== "number" ||
          authorization.quantity <= 0 ||
          typeof authorization.unit !== "string" ||
          !authorization.unit.trim()
        ) {
          blockers.push("正式 G2 缺少可验证的授权数量/单位边界");
        } else if (quantity !== null) {
          if (quantity > authorization.quantity) {
            blockers.push(
              `实际生产数量 ${quantity} 超过 G2 授权数量 ${authorization.quantity}`
            );
          }
          if (unit && unit !== authorization.unit) {
            blockers.push(
              `实际生产单位 ${unit} 与 G2 授权单位 ${authorization.unit} 不一致`
            );
          }
        }
      }
    } catch (error: any) {
      blockers.push(`生产记录无法验证：${error?.message ?? "结构化内容无效"}`);
    }
  }

  if (blockers.length > 0 || !approvedG2 || !record || quantity === null || !unit) {
    return { ready: false, blockers, basis: null };
  }

  return {
    ready: true,
    blockers: [],
    basis: {
      projectStage: project.stage,
      g2PacketId: approvedG2.id,
      productionRecordId: record.id,
      productionRecordContentHash: computeArtifactContentHash(record.content),
      deliveredQuantity: quantity,
      unit,
    },
  };
}
