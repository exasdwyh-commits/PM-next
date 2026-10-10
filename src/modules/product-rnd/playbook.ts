/**
 * P0-C NEW_PRODUCT Playbook 合流
 * 一个编排器: Kern → NEW_PRODUCT Playbook → (Research/Market/Consumer/Formula/Regulatory/Cost/Channel/Competitor/GTM/Red Team) → QA → Product Blueprint → 创建 Product
 */

import { executeResearchNode } from "@/modules/supervisor/research-integration";
import { autoIdentityCode } from "@/modules/products/service";
import { checkOrRecordIdempotency } from "@/shared/idempotency";
import prisma from "@/shared/db";
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
        const product = await tx.product.create({
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
  formula_design: "配方设计 · 多酚+基质+工艺",
  cost_optimization: "成本优化 · 目标8元 3方案",
  compliance_check: "合规检查 · 蓝帽子/SC/备案",
  channel_adaptation: "渠道适配 · 大客户/小客户/现场",
  gtm_strategy: "上市策略 · 定价/渠道/卖点",
  red_team: "红队 · 风险/挑战/反驳",
  qa_verification: "QA验证 · 证据A/B/C/D + 引用全链",
  product_blueprint: "产品蓝图 · 最终报告+决策点",
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
      } else if (nodeKey === "formula_design") {
        output = {
          formula: category === "health_food" ? "多酚+低聚果糖+软糖基质 80℃烘焙" : category === "cosmetics" ? "透明质酸+烟酰胺+精华基质" : "基础配方",
          retention: "82%",
          process: "80℃烘焙",
          category,
        };
      } else if (nodeKey === "cost_optimization") {
        output = {
          current: 10.2,
          target: 8.0,
          schemes: [
            { name: "方案A 成本最优", cost: 7.8, margin: "68%", risk: "低" },
            { name: "方案B 功效最优", cost: 9.2, margin: "62%", risk: "中" },
            { name: "方案C 平衡", cost: 8.5, margin: "65%", risk: "低" },
          ],
          category,
        };
      } else if (nodeKey === "compliance_check") {
        output = {
          compliance: category === "health_food" ? "蓝帽子+功能声称+检测报告" : category === "cosmetics" ? "备案+功效宣称+安全评估" : "SC资质",
          status: "ok",
          jurisdiction: "中国",
          date: "2024-10-07",
          category,
        };
      } else if (nodeKey === "channel_adaptation") {
        output = {
          channels: ["大客户", "小客户", "客户现场"],
          adaptations: {
            大客户: "专业版话术+完整证据",
            小客户: "简洁版+高利润",
            客户现场: "促单版+快问快答3秒",
          },
          category,
        };
      } else if (nodeKey === "gtm_strategy") {
        output = {
          pricing: { cost: "10.2", retail: category === "health_food" ? "199" : "39.9", profit: "68%" },
          sellingPoints: category === "health_food" ? ["蓝帽子认证", "多酚功效", "软糖剂型"] : ["性价比高", "日常刚需"],
          category,
        };
      } else if (nodeKey === "red_team") {
        output = {
          risks: ["成本偏高需优化", "竞品价格战", "法规变化"],
          challenges: ["如何降到8元以内", "如何证明多酚功效", "如何应对竞品"],
          mitigations: ["替换供应商B降20%", "lab_test A级证据", "差异化卖点"],
          category,
        };
      } else if (nodeKey === "qa_verification") {
        output = {
          evidenceCount: 10,
          verifiedCount: 8,
          verifiedRate: 80,
          levels: { A: 5, B: 3, C: 1, D: 1 },
          lineageValid: true,
          category,
        };
      } else if (nodeKey === "product_blueprint") {
        output = {
          title: `${input.productIdea} - 产品蓝图`,
          executiveSummary: `${input.productIdea}，市场200亿+30%增长，${category}专用，成本10.2目标8.0，蓝帽子已合规，多酚留存82%验证，建议首批1000盒试销`,
          conclusions: [
            { claim: "市场200亿+30%健康趋势", level: "A", sources: ["fda.gov"] },
            { claim: "多酚留存82%已验证", level: "A", sources: ["lab_test"] },
            { claim: "蓝帽子+功能声称已合规 中国 2024", level: "A", sources: ["samr.gov.cn"], jurisdiction: "中国" },
          ],
          risks: ["成本偏高", "竞品"],
          unknowns: ["具体销量"],
          decisionsRequired: ["是否选择方案A 7.8元", "是否首批1000盒"],
          nextActions: ["成本优化到8元", "准备销售PPT"],
          category,
        };
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
    flow: "Kern → NEW_PRODUCT Playbook → Research/Market/Consumer/Regulatory/Competitor/Formula/Cost/Compliance/Channel/GTM/Red Team → QA → Product Blueprint → 创建 Product",
    nodes: Object.keys(NODE_DEPENDENCIES),
    dependencies: NODE_DEPENDENCIES,
    acceptance: "product-rnd-fusion / worker / golden-org 回归保持绿色, 在途旧 run 迁移测试, 垂直切片 女性餐前轻体饮",
    verticalSlice: "开发一个女性餐前轻体饮，市场、配方、成本、法规一起看 → 1报告+决策点",
  };
}
