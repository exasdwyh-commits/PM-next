/**
 * KX-34 · 每日简报的内容（纯函数）。原则：没有真实内容就不打扰（返回 null）。
 */
export type DigestInput = {
  needsYou: { title: string; why: string }[];
  inProgress: { title: string; why: string }[];
  finishedSince: { goal: string; status: string }[];
  expiringCredentials: { label: string; target: string; expiresAt: string }[];
  brokenConnectors: { name: string; error: string }[];
};

export function composeDailyDigest(input: DigestInput, now = new Date()): string | null {
  const sections: string[] = [];
  if (input.needsYou.length) {
    sections.push(`**需要你（${input.needsYou.length}）**\n${input.needsYou.slice(0, 6).map((i) => `- ${i.title}：${i.why}`).join("\n")}`);
  }
  if (input.finishedSince.length) {
    const done = input.finishedSince.filter((m) => m.status === "COMPLETED").length;
    sections.push(
      `**上次简报以来结束的工作（${input.finishedSince.length}，其中完成 ${done}）**\n${input.finishedSince
        .slice(0, 6)
        .map((m) => `- ${m.goal}：${m.status === "COMPLETED" ? "已完成" : m.status === "CANCELLED" ? "已取消" : "需要你处理"}`)
        .join("\n")}`
    );
  }
  if (input.expiringCredentials.length) {
    sections.push(
      `**快过期的凭证**\n${input.expiringCredentials
        .map((c) => `- ${c.label}（${c.target}）：${Math.max(0, Math.ceil((new Date(c.expiresAt).getTime() - now.getTime()) / 3_600_000))} 小时后过期`)
        .join("\n")}`
    );
  }
  if (input.brokenConnectors.length) {
    sections.push(`**连接器异常**\n${input.brokenConnectors.map((c) => `- ${c.name}：${c.error}`).join("\n")}`);
  }
  // 只有「进行中」不算值得打扰的内容；但有其他内容时顺带列出。
  if (!sections.length) return null;
  if (input.inProgress.length) {
    sections.push(`**正在推进（${input.inProgress.length}）**\n${input.inProgress.slice(0, 4).map((i) => `- ${i.title}：${i.why}`).join("\n")}`);
  }
  return `今日简报\n\n${sections.join("\n\n")}`;
}
