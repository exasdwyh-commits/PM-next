"use client";

import { useEffect, useState } from "react";
import type { DailyBriefingOutput } from "@/modules/assistant-runtime/capabilities/daily-briefing";
import { defaultCategoryKey } from "@/modules/tenant";
import { useRole } from "@/components/role-context";
import { isDailyBriefingSnapshot } from "../briefing-summary";
import { DailyBriefingSummary } from "./daily-briefing-summary";
import { Btn } from "./kit";

type BriefingState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DailyBriefingOutput };

export function DailyBriefing({
  projectId,
  category = defaultCategoryKey(),
  onAction,
}: {
  projectId?: string;
  category?: string;
  onAction?: (draft: string) => void;
}) {
  const { role } = useRole();
  const [state, setState] = useState<BriefingState>({ status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    const params = new URLSearchParams({ category, role });
    if (projectId) params.set("projectId", projectId);

    const load = async () => {
      try {
        const response = await fetch(`/api/assistant/daily-briefing?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(response.status === 401
            ? "登录状态已过期，请重新登录后重试。"
            : "暂时无法读取项目数据，请稍后重试。");
        }
        const json: unknown = await response.json();
        const data = json && typeof json === "object" && "briefing" in json ? json.briefing : null;
        if (!isDailyBriefingSnapshot(data)) throw new Error("简报数据不完整，请重试。未展示示例统计。");
        if (!controller.signal.aborted) setState({ status: "ready", data });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "无法读取项目简报，请重试。" });
      }
    };
    void load();
    // 切换视角或卸载时取消旧请求，避免慢回执覆盖新状态。
    return () => controller.abort();
  }, [projectId, category, role, retry]);

  if (state.status === "loading") {
    return <div className="m-briefing-status" role="status" aria-busy="true"><span className="m-briefing-skeleton" aria-hidden /><span>正在读取项目简报…</span></div>;
  }
  if (state.status === "error") {
    return (
      <div className="m-briefing-status" data-error="true" role="alert">
        <div><strong>项目简报暂时不可用</strong><p>{state.message}</p></div>
        <Btn size="sm" v="ghost" onClick={() => setRetry((value) => value + 1)}>重试</Btn>
      </div>
    );
  }
  return <DailyBriefingSummary data={state.data} onAction={onAction} />;
}
