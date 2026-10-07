export const PROJECT_WORKSPACE_TABS = [
  ["overview", "概览"],
  ["rnd", "AI 研发"],
  ["tasks", "工作项"],
  ["evidence", "证据"],
  ["decisions", "决策"],
  ["records", "记录"],
] as const;

export const PROJECT_STAGES = ["DRAFT", "RESEARCH", "SAMPLING", "PRODUCTION_PREP", "PRODUCTION", "DELIVERED"];
const FIXED_PRODUCT_STAGES = ["PRODUCTION_PREP", "PRODUCTION", "DELIVERED"];

export function projectStagesForMode(mode: string) {
  return mode === "FIXED_PRODUCT" ? FIXED_PRODUCT_STAGES : PROJECT_STAGES;
}

export function prepareArtifactSubmission(title: string, content: string, structured: boolean) {
  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();
  if (!trimmedTitle || !trimmedContent) {
    throw new Error("请填写产物标题和实际成果内容");
  }
  if (structured) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmedContent);
    } catch {
      throw new Error("结构化成果需要有效的 JSON，请检查后重试");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("结构化成果需要 JSON 对象");
    }
  }
  return { title: trimmedTitle, content: trimmedContent };
}

export function preparePacketBudget(value: string) {
  const amount = Number(value);
  if (!value.trim() || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("请填写大于 0 的有效预算金额");
  }
  return amount;
}
