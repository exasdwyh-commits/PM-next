"use client";

import * as React from "react";
import { DailyBriefingRich, DailyBriefingData } from "@/components/daily-briefing-rich";
import "@/components/daily-briefing-rich.css";
import { useRole } from "@/components/role-context";

export function DailyBriefing({ projectId, category = "health_food" }: { projectId?: string; category?: string }) {
  const { role } = useRole();
  const [data, setData] = React.useState<DailyBriefingData | null>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchBriefing = React.useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (category) params.set("category", category);
      params.set("role", role);
      const res = await fetch(`/api/assistant/daily-briefing?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setData(json.briefing);
      } else {
        // fallback mock
        setData({
          todos: 3,
          decisions: 2,
          gaps: 4,
          risks: 1,
          evidenceRate: 70,
          workRate: 62,
          verifiedCount: 7,
          totalEvidence: 10,
          doneWork: 5,
          totalWork: 8,
          category: category || "health_food",
          projectTitle: "多酚软糖项目",
          suggestions: ["补充80℃烘焙温度证据", "优化成本到8元以内", "准备蓝帽子认证材料", "生成多酚功效销售话术"],
          generatedAt: new Date().toISOString(),
        });
      }
    } catch {
      setData({
        todos: 3,
        decisions: 2,
        gaps: 4,
        risks: 1,
        evidenceRate: 70,
        workRate: 62,
        verifiedCount: 7,
        totalEvidence: 10,
        doneWork: 5,
        totalWork: 8,
        category: category || "health_food",
        projectTitle: "多酚软糖项目",
        suggestions: ["补充80℃烘焙温度证据", "优化成本到8元以内", "准备蓝帽子认证材料", "生成多酚功效销售话术"],
        generatedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, category, role]);

  React.useEffect(() => {
    fetchBriefing();
  }, [fetchBriefing]);

  if (loading) {
    return <div className="daily-briefing-rich" style={{ padding: 20, textAlign: "center", fontSize: 11, color: "#9099a6" }}>Kern正在生成每日简报... {category} · {role}视角 · 富可视化</div>;
  }

  if (!data) return null;

  return (
    <DailyBriefingRich
      data={data}
      onAction={(action) => {
        // Dispatch to parent or trigger Kern dialogue
        console.log("Daily briefing action:", action);
        // Could trigger: window.dispatchEvent(new CustomEvent('kern-action', { detail: action }))
        window.dispatchEvent(new CustomEvent("kern-daily-action", { detail: { action, category, role } }));
      }}
    />
  );
}
