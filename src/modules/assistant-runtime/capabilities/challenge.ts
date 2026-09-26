import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import {
  generateChallengeReport,
  matchRelevantIngredients,
  parseIngredientFrontmatter,
} from "@/modules/advisor/challenge";
import type { ScientificEvidenceInput } from "@/modules/research/scientific-evidence";
import type {
  KernCapabilityContext,
  KernCapabilityHandler,
  KernCapabilityIntent,
  KernCapabilityResult,
} from "./contracts";

export const handleChallengeCapability: KernCapabilityHandler = async (
  session: SessionContext,
  intent: KernCapabilityIntent,
  ctx: KernCapabilityContext
): Promise<KernCapabilityResult | null> => {
  switch (intent) {
    case "CHALLENGE_THESIS": {
      if (!ctx.productId) {
        return {
          toolKey: "advisor.challenge",
          text: "当前会话未绑定产品，无法生成挑战报告。请从产品页的「AI 顾问」入口进入，或先绑定一个产品。",
          citations: [],
        };
      }

      const product = await prisma.product.findUnique({
        where: { id: ctx.productId },
        select: {
          id: true,
          name: true,
          identityCode: true,
          coreIdea: true,
          coreSellingPoints: true,
          formSpec: true,
          targetAudience: true,
        },
      });
      if (!product) {
        return {
          toolKey: "advisor.challenge",
          text: "未找到绑定的产品，无法生成挑战报告。",
          citations: [],
        };
      }

      // 从知识库同步的原料卡中解析科学证据（hermes-brain/30-science/ingredients/*.md）
      const ingredientDocs = await prisma.knowledgeDocument.findMany({
        where: {
          organizationId: session.organizationId,
          relativePath: { startsWith: "30-science/ingredients/" },
          deletedAt: null,
        },
        select: { title: true, frontmatter: true, relativePath: true },
      });

      const allIngredients: ScientificEvidenceInput[] = [];
      for (const doc of ingredientDocs) {
        const fm = doc.frontmatter as Record<string, string> | null;
        if (!fm) continue;
        const parsed = parseIngredientFrontmatter(fm, doc.relativePath.split("/").pop() || doc.title);
        if (parsed) allIngredients.push(parsed);
      }

      // 原料相关性匹配：产品名 + 用户消息 + 产品规格字段（核心概念/卖点/剂型规格/目标人群）。
      // 规格字段是成分信息的主要落点（如核心卖点写「含 AKG 与骆驼奶」），只看产品名会漏配。
      // 诚实口径：无关原料不得塞入报告，缺口保持未知而非掩盖。
      const productText = [
        product.name,
        ctx.text,
        product.coreIdea,
        product.coreSellingPoints,
        product.formSpec,
        product.targetAudience,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchedIngredients = matchRelevantIngredients(allIngredients, productText);

      // 宣称解析：只取「挑战我的判断：」后的明确宣称，疑问句/空内容不当作宣称
      // 正则用懒惰匹配到「哪里/最/？/。/结尾」，但需排除「这个产品假设」这类无意义前缀
      const claimMatch = ctx.text.match(/挑战我的判断[:：]\s*(.+?)(?:哪里|最|？|。|$)/);
      const rawClaim = claimMatch?.[1]?.trim();
      // 若提取结果为空、过短、以疑问词开头、或只是「这个产品假设」等无意义前缀，则回退到产品名
      const isMeaningless = !rawClaim || rawClaim.length < 2 || /^(哪里|如何|是否|为什么|这个产品|该)/.test(rawClaim);
      const proposedClaim = isMeaningless ? product.name : rawClaim!;

      const report = generateChallengeReport({
        productName: product.name,
        proposedClaim,
        ingredients: matchedIngredients,
        advisorVerdict: null,
        evidenceScope: {
          considered: allIngredients.length,
          matched: matchedIngredients.length,
          ingredientNames: matchedIngredients.map((i) => i.ingredient),
          note:
            matchedIngredients.length > 0
              ? `从 ${allIngredients.length} 张原料卡中匹配到 ${matchedIngredients.length} 张相关卡（匹配范围：产品名、宣称与产品规格字段）。`
              : `知识库共 ${allIngredients.length} 张原料卡，但与产品「${product.name}」的名称、宣称及规格字段均无匹配，科学证据维度无依据。`,
        },
      });

      return {
        toolKey: "advisor.challenge",
        text: `已完成对「${product.name}」的证伪式审查。`,
        citations: [{ kind: "challenge", ref: product.id, title: `挑战报告：${product.name}` }],
        challengeReport: report,
      };
    }

    default:
      return null;
  }
};
