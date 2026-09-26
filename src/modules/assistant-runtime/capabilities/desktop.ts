import type { SessionContext } from "@/modules/identity/session";
import {
  describeDesktopAction,
  enqueueDesktopTask,
  readDesktopPresence,
} from "@/modules/desktop-runtime";
import type {
  KernCapabilityContext,
  KernCapabilityHandler,
  KernCapabilityIntent,
  KernCapabilityResult,
} from "./contracts";

export const handleDesktopCapability: KernCapabilityHandler = async (
  session: SessionContext,
  intent: KernCapabilityIntent,
  ctx: KernCapabilityContext
): Promise<KernCapabilityResult | null> => {
  switch (intent) {
    case "DESKTOP_EXECUTION": {
      const queued = await enqueueDesktopTask(session, {
        instruction: ctx.text,
        conversationId: ctx.conversationId,
      });
      const described = describeDesktopAction(queued.action);
      // 关键诚实点：以前这里不分在线状态，一律回「已发送到你的 Mac 执行队列」。
      // runtime 没启动时任务会永远停在 QUEUED，而用户以为 Hermes 正在执行。
      // 现在按真实连接状态分别说明，并且未连接时明确告诉用户「还不会执行」。
      const presence = readDesktopPresence({
        organizationId: session.organizationId,
        userId: session.userId,
      });
      const online = presence.status === "ONLINE";
      return {
        toolKey: "desktop.runtime",
        text: [
          online
            ? `已排入你的 Mac 执行队列，${presence.deviceId} 正在连接中，会自动领取。`
            : "已排入你的 Mac 执行队列，但现在还不会执行。",
          `动作：${described.kind} · ${described.detail}`,
          "",
          online
            ? "执行完成后，真实结果会自动回到这个对话。"
            : `${presence.label}。${presence.hint ?? ""}连接恢复后这项任务会被自动领取，结果回到这个对话。`,
        ]
          .filter((line) => line !== null)
          .join("\n"),
        citations: [
          {
            kind: "desktop-task",
            ref: queued.task.id,
            title: `本机任务：${ctx.text.slice(0, 60)}`,
          },
        ],
      };
    }

    default:
      return null;
  }
};
