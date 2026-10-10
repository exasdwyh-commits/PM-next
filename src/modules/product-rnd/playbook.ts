/**
 * P0-C NEW_PRODUCT Playbook 合流
 * 一个编排器: Kern → NEW_PRODUCT Playbook → (Research/Market/Consumer/Formula/Regulatory/Cost/Channel/Competitor/GTM/Red Team) → QA → Product Blueprint → 创建 Product
 */

import { executeResearchNode } from "@/modules/supervisor/research-integration";
import { autoIdentityCode } from "@/modules/products/service";
import { checkOrRecordIdempotency } from "@/shared/idempotency";
import prisma from "@/shared/db";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

export type PlaybookNodeKey =
  | "research_market"
  | "research_consumer"
  | "research_regulatory"
  | "research_competitor"
  | "formula_design"
  | "cost_optimization"
  | "compliance_check"
  | "channel_adaptation"
  | "gtm_strategy"
  | "red_team"
  | "qa_verification"
  | "product_blueprint";

export interface PlaybookInput {
  organizationId: string;
  userId: string;
  projectId?: string;
  missionId: string;
  productIdea: string; // "开发一个女性餐前轻体饮，市场、配方、成本、法规一起看"
  category?: string; // 4类专用
  revisionRound?: number;
}

export interface PlaybookNodeResult {
  nodeKey: PlaybookNodeKey;
  status: "DONE" | "RUNNING" | "BLOCKED" | "FAILED";
  output?: any;
  citations?: any[];
  blockedReason?: string;
  durationMs?: number;
}

export interface PlaybookOutput {
  missionId: string;
  productIdea: string;
  category: string;
  nodes: PlaybookNodeResult[];
  blueprint?: any;
  productId?: string;
  /** R2：产品落库状态与错误——失败可感知，重复确认幂等。 */
  productCreation: PlaybookProductCreation;
  status: "SUCCEEDED" | "BLOCKED" | "FAILED";
  criticalPath: string;
  totalDurationMs: number;
}

export interface PlaybookProductCreation {
  status: "CREATED" | "REUSED" | "FAILED" | "NOT_ATTEMPTED";
  productId?: string;
  error?: string;
}

const PRODUCT_CREATION_LABEL: Record<PlaybookProductCreation["status"], string> = {
  CREATED: "已创建",
  REUSED: "复用已建产品（幂等重放，未重复建品）",
  FAILED: "失败",
  NOT_ATTEMPTED: "未触发（任务未成功或未关联项目）",
};

/**
 * 对话确认后的产品落库。三件事必须同时成立（P0/R2）：
 * 1. 真实落库：结果可查询（productId 回传，route 原文返回）；
 * 2. 失败可感知：落库失败不能只剩 console.error——状态与错误文本进
 *    PlaybookOutput.productCreation，随接口与关键路径一起回到对话；
 * 3. 重复确认幂等：同一 组织×项目×产品构想 重复执行只建一次产品，
 *    支撑是 IdempotencyRecord（checkOrRecordIdempotency 带唯一键的重放机制）。
 *
 * key 形如 `product-rnd-playbook:{orgId}:create-product:{sha256(projectId|productIdea)}`，
 * 换构想/换项目自然产生新 key；不同操作者复用同 key 时既有守卫会判冲突并在此如实报 FAILED。
 */
export async function ensurePlaybookProduct(input: PlaybookInput): Promise<PlaybookProductCreation> {
  if (!input.projectId) {
    return { status: "NOT_ATTEMPTED" };
  }
  const digest = createHash("sha256")
    .update(`${input.projectId}|${input.productIdea}`)
    .digest("hex");
  const idemKey = `product-rnd-playbook:${input.organizationId}:create-product:${digest}`;
  const productName = input.productIdea.slice(0, 50);
  try {
    const outcome = await prisma.$transaction(async (tx) =>
      checkOrRecordIdempotency(tx, idemKey, input.userId, "product-rnd-playbook.create-product", digest, async () => {
        // Product 的必填项是 identityCode / targetAudience / marketPath / devMode；
        // Playbook 阶段这些业务字段尚未由用户确认，按已解析信息落最小可用集，
        // 其余留给产品工作台补全（sourceKind=AI_EXTRACTED 标明来源）。
        // 组织内 identityCode 重复（极小概率随机尾缀撞码）时自动换码重试，
        // 不把 P2002 当 FAILED 上抛 —— 这是编码策略问题，不是落库失败。
        const createOnce = async (tx: Prisma.TransactionClient) => {
          const maxAttempts = 3;
          for (let attempt = 0; ; attempt += 1) {
            try {
              return await tx.product.create({
                data: {
                  organizationId: input.organizationId,
                  projects: { connect: { id: input.projectId! } },
                  name: productName,
                  identityCode: autoIdentityCode(productName),
                  targetAudience: input.productIdea.slice(0, 200),
                  marketPath: "PENDING",
                  devMode: "PENDING",
                  sourceKind: "AI_EXTRACTED",
                  ownerId: input.userId,
                },
              });
            } catch (error) {
              const code = (error as { code?: string } | null)?.code;
              if (code === "P2002" && attempt < maxAttempts - 1) continue;
              throw error;
            }
          }
        };
        const product = await createOnce(tx);
        return { status: 200, body: { productId: product.id } };
      }),
    );
    return outcome.wasReplayed
      ? { status: "REUSED", productId: outcome.body.productId }
      : { status: "CREATED", productId: outcome.body.productId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 兼容收益之外的可感知：抛错文本进 productCreation.error，对话可直接看到。
    console.error("[product-rnd/playbook] Product creation failed", error);
    return { status: "FAILED", error: message };
  }
}

const NODE_DEPENDENCIES: Record<PlaybookNodeKey, PlaybookNodeKey[]> = {
  research_market: [],
  research_consumer: [],
  research_regulatory: [],
  research_competitor: [],
  formula_design: ["research_market", "research_consumer"],
  cost_optimization: ["formula_design"],
  compliance_check: ["formula_design", "research_regulatory"],
  channel_adaptation: ["cost_optimization", "compliance_check"],
  gtm_strategy: ["research_market", "research_competitor", "channel_adaptation"],
  red_team: ["formula_design", "cost_optimization", "compliance_check", "gtm_strategy"],
  qa_verification: ["research_market", "research_regulatory", "formula_design", "cost_optimization", "compliance_check"],
  product_blueprint: ["qa_verification", "red_team"],
};

const NODE_DESCRIPTIONS: Record<PlaybookNodeKey, string> = {
  research_market: "市场研究 · 规模/增长/趋势",
  research_consumer: "消费者研究 · 偏好/痛点/场景",
  research_regulatory: "法规研究 · 认证/宣称/备案",
  research_competitor: "竞品研究 · 成本/卖点/合规对比",
  formula_design: "配方设计（待真实配方约束输入）",
  cost_optimization: "成本优化（待可追溯报价输入）",
  compliance_check: "合规检查（待真实合规判定输入）",
  channel_adaptation: "渠道适配（待渠道数据输入）",
  gtm_strategy: "上市策略（待定价/渠道真实数据）",
  red_team: "红队（待真实风险素材）",
  qa_verification: "QA验证（待真实核验记录）",
  product_blueprint: "产品蓝图（仅由真实产出组合）",
};

export async function executeNewProductPlaybook(input: PlaybookInput): Promise<PlaybookOutput> {
  const category = input.category || "health_food";
  const revisionRound = input.revisionRound || 0;
  const startTime = Date.now();
  const nodes: PlaybookNodeResult[] = [];

  // 按依赖顺序执行
  const executionOrder: PlaybookNodeKey[] = [
    "research_market",
    "research_consumer",
    "research_regulatory",
    "research_competitor",
    "formula_design",
    "cost_optimization",
    "compliance_check",
    "channel_adaptation",
    "gtm_strategy",
    "red_team",
    "qa_verification",
    "product_blueprint",
  ];

  for (const nodeKey of executionOrder) {
    const deps = NODE_DEPENDENCIES[nodeKey];
    const blockedDep = deps.find((dep) => {
      const depNode = nodes.find((n) => n.nodeKey === dep);
      return depNode && depNode.status !== "DONE";
    });

    if (blockedDep) {
      nodes.push({
        nodeKey,
        status: "BLOCKED",
        blockedReason: `依赖 ${blockedDep} 未完成 (${NODE_DESCRIPTIONS[blockedDep]})`,
      });
      continue;
    }

    const nodeStart = Date.now();
    try {
      let output: any = null;
      let citations: any[] = [];

      if (nodeKey.startsWith("research_")) {
        // B1 研究节点接 ResearchRun
        const researchResult = await executeResearchNode({
          missionId: input.missionId,
          projectId: input.projectId || "proj_default",
          nodeKey,
          revisionRound,
          question: `${input.productIdea} - ${NODE_DESCRIPTIONS[nodeKey]}`,
          requiredSources: nodeKey === "research_market" ? ["market"] : nodeKey === "research_regulatory" ? ["regulatory"] : ["market", "competitor"],
          organizationId: input.organizationId,
          userId: input.userId,
        });

        if (researchResult.status === "BLOCKED") {
          nodes.push({
            nodeKey,
            status: "BLOCKED",
            blockedReason: researchResult.blockedReason,
            durationMs: Date.now() - nodeStart,
          });
          continue;
        }

        output = { researchRunId: researchResult.researchRun.id, sourceCount: researchResult.sourceCaptures.length, lineageValid: researchResult.lineageValid };
        citations = researchResult.citations;
      } else if (nodeKey !== "product_blueprint") {
        // 诚实缺省（批次C+ 拆雷）：formula/cost/compliance/channel/gtm/red_team/qa_verification
        // 需要真实输入（原料候选与供应商规格、可追溯报价、合规判定、渠道与定价数据、真实核验记录），
        // 当前 playbook 链条没有任何数据源支撑——历史版本在此全部用写死的演示值充当产出，
        // 已按「宁可 UNKNOWN 不编造」契约整段拆除，改为如实标记缺口。
        nodes.push({
          nodeKey,
          status: "BLOCKED",
          blockedReason:
            NODE_DESCRIPTIONS[nodeKey] +
            "：缺少真实输入与数据源，已按诚实缺省标记缺口；补齐路径见 docs/ROLE_REPORT_OPTIMIZATION_ROADMAP_2026-10-10.md §3 P0（数据供给批）。",
          durationMs: Date.now() - nodeStart,
        });
        continue;
      } else {
        // product_blueprint：只由真实节点产出组合；没有任何真实研究产出时，宁可缺，不编造。
        // 注：当前依赖链（qa_verification/red_team 均无生产者）下本节点会被依赖守卫 BLOCKED；
        // 本实现是为未来真实生产者就绪后的组合逻辑，代码本体已不含任何演示值。
        const researchNodes = nodes.filter((n) => n.nodeKey.startsWith("research_") && n.status === "DONE");
        if (researchNodes.length === 0) {
          nodes.push({
            nodeKey,
            status: "BLOCKED",
            blockedReason: "无任何真实研究产出，不生成蓝图（宁可缺，不编造）。",
            durationMs: Date.now() - nodeStart,
          });
          continue;
        }
        output = {
          title: `${input.productIdea} - 产品蓝图（部分·仅含真实研究产出）`,
          executiveSummary:
            `基于 ${researchNodes.length} 个真实研究节点的产出汇总；` +
            `配方/成本/合规/渠道/定价各节因缺真实输入未生成（见各节点 blockedReason），不得作为业务批准依据。`,
          researchRefs: researchNodes.map((n) => ({ nodeKey: n.nodeKey, output: n.output })),
          conclusions: [],
          risks: [],
          unknowns: nodes
            .filter((n) => n.status === "BLOCKED")
            .map((n) => `${NODE_DESCRIPTIONS[n.nodeKey]}：${n.blockedReason ?? "未完成"}`),
          decisionsRequired: ["是否按数据供给批补齐真实输入（§3 P0）后重跑本 playbook。"],
          nextActions: ["接入真实报价/配方/合规数据通道后重跑"],
          category,
        };
        citations = researchNodes.flatMap((n) => n.citations ?? []);
      }

      nodes.push({
        nodeKey,
        status: "DONE",
        output,
        citations,
        durationMs: Date.now() - nodeStart,
      });
    } catch (e: any) {
      nodes.push({
        nodeKey,
        status: "FAILED",
        blockedReason: e.message,
        durationMs: Date.now() - nodeStart,
      });
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const failed = nodes.filter((n) => n.status === "FAILED").length;
  const blocked = nodes.filter((n) => n.status === "BLOCKED").length;
  const status = failed > 0 ? "FAILED" : blocked > 0 ? "BLOCKED" : "SUCCEEDED";

  // 创建 Product（任务成功且关联项目时）：
  // - 落库失败可感知（productCreation 字段 + 关键路径文字），不再只剩 console.error；
  // - 重复执行同一 组织×项目×构想 不再重复建品（ensurePlaybookProduct 的幂等键）。
  const productCreation: PlaybookProductCreation =
    status === "SUCCEEDED" && input.projectId ? await ensurePlaybookProduct(input) : { status: "NOT_ATTEMPTED" };
  const productId = productCreation.productId;
  const productLine =
    productCreation.status === "FAILED"
      ? ` · 产品落库${PRODUCT_CREATION_LABEL.FAILED}：${(productCreation.error ?? "未知错误").slice(0, 120)}`
      : ` · 产品落库${PRODUCT_CREATION_LABEL[productCreation.status]}${productId ? `（${productId}）` : ""}`;

  return {
    missionId: input.missionId,
    productIdea: input.productIdea,
    category,
    nodes,
    blueprint: nodes.find((n) => n.nodeKey === "product_blueprint")?.output,
    productId,
    productCreation,
    status,
    criticalPath: executionOrder.map((k) => NODE_DESCRIPTIONS[k]).join(" → ") + ` · 总计${Math.round(totalDurationMs / 1000)}s · ${status}` + productLine,
    totalDurationMs,
  };
}

export function describePlaybook() {
  return {
    flow: "Kern → NEW_PRODUCT Playbook → 四个研究节点(真实) → 配方/成本/合规/渠道/GTM/红队/QA(无真实输入一律 BLOCKED 缺口) → Product Blueprint(仅由真实产出组合) → 全成功才创建 Product",
    nodes: Object.keys(NODE_DEPENDENCIES),
    dependencies: NODE_DEPENDENCIES,
    acceptance: "product-rnd-fusion / worker / golden-org 回归保持绿色, 在途旧 run 迁移测试, 垂直切片 女性餐前轻体饮",
    verticalSlice: "开发一个女性餐前轻体饮，市场、配方、成本、法规一起看 → 1报告+决策点",
  };
}
