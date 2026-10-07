import type { SessionContext } from "@/modules/identity/session";
import { searchKnowledge } from "@/modules/knowledge/service";
import type {
  KernCapabilityContext,
  KernCapabilityHandler,
  KernCapabilityIntent,
  KernCapabilityResult,
} from "./contracts";

export const handleKnowledgeCapability: KernCapabilityHandler = async (
  session: SessionContext,
  intent: KernCapabilityIntent,
  ctx: KernCapabilityContext
): Promise<KernCapabilityResult | null> => {
  switch (intent) {
    case "KNOWLEDGE_SEARCH": {
      const searchResult = await searchKnowledge(session, { query: ctx.text, limit: 5 });
      const facts = searchResult.facts;
      const citations = searchResult.citations;

      if (facts.length === 0 && citations.length === 0) {
        return {
          toolKey: "knowledge.search",
          text: `在公司知识库中未检索到与「${ctx.text}」相关的事实或已索引文档。当前已接入知识库尚未录入此项规则或内容（知识缺口）。`,
          citations: [],
        };
      }

      const parts: string[] = [];
      if (facts.length > 0) {
        parts.push("【公司已确认事实依据】:\n" + facts.map((f, i) => `${i + 1}. [${f.category}] ${f.label}: ${f.value}`).join("\n"));
      }
      if (citations.length > 0) {
        parts.push("【相关知识文档切片引用】:\n" + citations.map((c, i) => `${i + 1}. ${c.headingPath || c.docTitle}（来源: ${c.relativePath}）：\n   "${c.snippet}"`).join("\n"));
      }

      return {
        toolKey: "knowledge.search",
        text: parts.join("\n\n"),
        citations: citations.map((c) => ({
          kind: "knowledge",
          ref: c.ref,
          title: `${c.docTitle}${c.headingPath ? ` > ${c.headingPath}` : ""}`,
        })),
      };
    }
    default: {
      const searchResult = await searchKnowledge(session, { query: ctx.text, limit: 3 });
      if (searchResult.facts.length > 0 || searchResult.citations.length > 0) {
        const parts: string[] = [];
        if (searchResult.facts.length > 0) {
          parts.push("【相关公司事实】:\n" + searchResult.facts.map((f, i) => `${i + 1}. ${f.label}: ${f.value}`).join("\n"));
        }
        if (searchResult.citations.length > 0) {
          parts.push("【参考知识切片】:\n" + searchResult.citations.map((c, i) => `${i + 1}. ${c.headingPath || c.docTitle}：${c.snippet}`).join("\n"));
        }
        return {
          toolKey: "knowledge.search",
          text: parts.join("\n\n"),
          citations: searchResult.citations.map((c) => ({
            kind: "knowledge",
            ref: c.ref,
            title: c.docTitle,
          })),
        };
      }

      return {
        toolKey: "none",
        text:
          // 用 Kern 回复格式（reply-format.ts）的 Markdown 子集书写，前端 Prose 渲染成有层次的回答。
          "这一轮没有拿到语言模型的回复，我先回答与**项目、产品、决策状态和公司知识库**相关的结构化问题。\n\n" +
          "### 可以这样问\n\n" +
          "- 本周哪些项目需要我决定\n" +
          "- 组织里产品推进到什么阶段了\n" +
          "- 公司有哪些渠道政策\n" +
          "- 查一下禁用成分\n\n" +
          "### 开一个新产品\n\n" +
          "直接说想做什么就行，例如「我想做一款给敏感肌的氨基酸洁面」。我会问齐入库要的几项，生成受治理动作，并按风险策略执行。\n\n" +
          (ctx.productId
            ? "> [!TIP] 也可以直接改方案字段\n> 例如「把目标人群改成 25-35 岁办公室人群」。低风险的内部修改会直接执行，只有受保护动作才要求确认。"
            : "> [!NOTE] 想修改产品方案字段？\n> 请从产品页进入 Kern，让当前会话绑定到具体产品。"),
        citations: [],
      };
    }

  }
};
