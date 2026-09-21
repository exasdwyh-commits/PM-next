/**
 * 知识库内容性质开关（P3：示例标注可配置化）
 *
 * 背景：hermes-brain/ 的原料卡 / 事实卡目前为示例与模板数据（见 hermes-brain/README.md
 * 「内容性质声明」）。在领域专家审核并替换为真实可溯源证据之前，UI 需要如实的性质声明。
 *
 * 开关约定（诚实口径优先）：
 * - 未配置 `HERMES_KNOWLEDGE_SAMPLE_MODE` 时默认视为示例模式 —— 不确定就标注，不假设真实；
 * - 显式配置 `HERMES_KNOWLEDGE_SAMPLE_MODE=false` 后声明消失，表示内容已由专家审核替换。
 */

export interface ContentModeConfig {
  /** 知识库内容是否仍处于示例 / 待审核模式 */
  knowledgeSampleMode: boolean;
}

export function getContentModeConfig(): ContentModeConfig {
  const raw = process.env.HERMES_KNOWLEDGE_SAMPLE_MODE?.trim().toLowerCase();
  return {
    knowledgeSampleMode: raw !== "false" && raw !== "0" && raw !== "off",
  };
}

/** 知识库页顶部的性质声明横幅文案（knowledgeSampleMode=true 时展示） */
export const KNOWLEDGE_SAMPLE_MODE_BANNER =
  "⚠️ 知识库内容性质声明：当前原料证据卡与业务事实均为示例 / 模板数据，仅用于验证系统流程，未经领域专家审核，不得作为真实决策依据。内容经专家审核替换后，可设置 HERMES_KNOWLEDGE_SAMPLE_MODE=false 关闭本声明。";
