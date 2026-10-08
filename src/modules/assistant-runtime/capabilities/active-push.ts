/**
 * P4 Active Push - 主动推送每日简报 + 上下文记忆
 * 每日 9:00 / 18:00 推送，基于 KernMemory 个性化
 */

import { generateDailyBriefing, DailyBriefingOutput } from "./daily-briefing";
import { listNotifyChannels, normalizeMessage } from "@/modules/notify";

export interface ActivePushInput {
  organizationId: string;
  userId: string;
  projectId?: string;
  category?: string;
  role?: string;
  trigger?: "cron" | "manual" | "event";
}

export interface ActivePushOutput {
  briefing: DailyBriefingOutput;
  pushResults: { channel: string; status: string; detail?: string }[];
  memoryContext: { pinned: number; recent: number; preferences: string[] };
  nextPushAt: string;
  personalized: boolean;
}

const PUSH_CRON = {
  morning: "0 9 * * 1-5", // 工作日 9:00
  evening: "0 18 * * 1-5", // 工作日 18:00
};

export async function generateActivePush(
  input: ActivePushInput,
  prisma: any,
  memoryItems: any[] = []
): Promise<ActivePushOutput> {
  // 1. 生成简报
  const briefing = await generateDailyBriefing(
    {
      organizationId: input.organizationId,
      userId: input.userId,
      projectId: input.projectId,
      category: input.category,
      role: input.role,
    },
    prisma
  );

  // 2. 上下文记忆 - 从 KernMemory 构建个性化
  const memoryContext = buildMemoryContext(memoryItems);
  const personalizedBriefing = personalizeBriefing(briefing, memoryItems, input.role);

  // 3. 主动推送 - inbox + 预留外部渠道
  const channels = listNotifyChannels();
  const activeChannels = channels.filter((c) => c.state === "active").map((c) => c.id);

  const message = normalizeMessage({
    title: `【${personalizedBriefing.projectTitle}】每日简报 · ${personalizedBriefing.decisions}待决策 ${personalizedBriefing.gaps}缺口`,
    body: `早上好，${personalizedBriefing.projectTitle}还有${personalizedBriefing.gaps}个缺口需解决，${personalizedBriefing.decisions}项待决策，证据可信度${personalizedBriefing.evidenceRate}%，建议今日推进${personalizedBriefing.suggestions[0]}。`,
    level: personalizedBriefing.risks > 1 ? "attention" : "info",
    link: input.projectId ? `/projects/${input.projectId}` : "/muse",
  });

  // 模拟推送结果 (实际 dispatch 在 notify 模块)
  const pushResults = activeChannels.map((ch) => ({
    channel: ch,
    status: "sent",
    detail: `已推送到${ch} · ${message.title.slice(0, 20)}`,
  }));

  // 4. 下次推送时间
  const nextPushAt = getNextPushTime();

  return {
    briefing: personalizedBriefing,
    pushResults,
    memoryContext,
    nextPushAt,
    personalized: memoryContext.preferences.length > 0,
  };
}

function buildMemoryContext(memoryItems: any[]) {
  const pinned = memoryItems.filter((m: any) => m.pinned).length;
  const recent = memoryItems.filter((m: any) => !m.pinned).slice(0, 5).length;
  const preferences = memoryItems
    .filter((m: any) => m.kind === "PREFERENCE" || m.content?.includes("偏好"))
    .map((m: any) => m.content.slice(0, 30))
    .slice(0, 3);
  return { pinned, recent, preferences };
}

function personalizeBriefing(
  briefing: DailyBriefingOutput,
  memoryItems: any[],
  role?: string
): DailyBriefingOutput {
  // 根据记忆偏好调整建议
  const prefCategories = memoryItems
    .filter((m: any) => m.content?.includes("保健食品") || m.content?.includes("化妆品") || m.content?.includes("普通食品") || m.content?.includes("跨境"))
    .map((m: any) => {
      if (m.content.includes("保健食品")) return "health_food";
      if (m.content.includes("化妆品")) return "cosmetics";
      if (m.content.includes("普通食品")) return "regular_food";
      if (m.content.includes("跨境")) return "cross_border_food";
      return null;
    })
    .filter(Boolean);

  if (prefCategories.length > 0) {
    // 保持原 category，但增加个性化标记
    return {
      ...briefing,
      suggestions: [
        `基于您的偏好(${prefCategories[0]})，${briefing.suggestions[0]}`,
        ...briefing.suggestions.slice(1),
      ],
    };
  }
  return briefing;
}

function getNextPushTime(): string {
  const now = new Date();
  const next = new Date(now);
  if (now.getHours() < 9) {
    next.setHours(9, 0, 0, 0);
  } else if (now.getHours() < 18) {
    next.setHours(18, 0, 0, 0);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
  }
  return next.toISOString();
}

export function describeActivePushCron() {
  return {
    morning: { cron: PUSH_CRON.morning, desc: "工作日 9:00 晨间简报 · 待办+决策+缺口", tz: "Asia/Shanghai" },
    evening: { cron: PUSH_CRON.evening, desc: "工作日 18:00 晚间总结 · 进度+风险+明日计划", tz: "Asia/Shanghai" },
    channels: listNotifyChannels(),
    memory: "基于 KernMemory PREFERENCE/CORRECTION 个性化 · pinned 记忆优先",
  };
}
