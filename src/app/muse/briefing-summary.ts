import type { DailyBriefingOutput } from "@/modules/assistant-runtime/capabilities/daily-briefing";

const COUNTS = [
  "todos", "decisions", "gaps", "risks", "verifiedCount", "totalEvidence",
  "doneWork", "totalWork", "projectCount",
] as const;

/** API 异常或格式不对时进入错误态，不能用示例统计把失败掩盖成成功。 */
export function isDailyBriefingSnapshot(value: unknown): value is DailyBriefingOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (!COUNTS.every((key) =>
    typeof data[key] === "number" && Number.isSafeInteger(data[key]) && (data[key] as number) >= 0,
  )) return false;
  if (!["evidenceRate", "workRate"].every((key) =>
    typeof data[key] === "number" && Number.isFinite(data[key]) && (data[key] as number) >= 0 && (data[key] as number) <= 100,
  )) return false;
  if ((data.verifiedCount as number) > (data.totalEvidence as number)) return false;
  if ((data.doneWork as number) > (data.totalWork as number)) return false;
  if (typeof data.category !== "string" || typeof data.scopeLabel !== "string") return false;
  if (typeof data.generatedAt !== "string" || !Number.isFinite(Date.parse(data.generatedAt))) return false;
  if (!Array.isArray(data.suggestions) || !data.suggestions.every((s) => typeof s === "string")) return false;
  if ((data.projectCount as number) > 0 && (typeof data.projectTitle !== "string" || !data.projectTitle.trim())) return false;
  if (data.projectId !== undefined && typeof data.projectId !== "string") return false;
  if (data.projectCount === 0 && COUNTS.some((key) => key !== "projectCount" && data[key] !== 0)) return false;
  return true;
}

/** 没有分母时保持未知，不能用 0% 或它的补数 100% 表示不存在的工作。 */
export function briefingRatio(numerator: number, denominator: number): string {
  return denominator > 0 ? `${numerator}/${denominator}` : "—";
}

export function briefingPercent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : "尚无记录";
}

export function briefingDraft(data: DailyBriefingOutput, suggestion: string): string {
  const context = data.projectCount === 1 && data.projectTitle ? `项目「${data.projectTitle}」` : "当前项目简报";
  return `请根据${context}，${suggestion}。先说明依据、缺失信息和下一步计划。`;
}
