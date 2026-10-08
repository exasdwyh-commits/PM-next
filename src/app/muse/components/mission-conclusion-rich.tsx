"use client";

import { useEffect, useState } from "react";
import type { ResponseEnvelope } from "@/modules/response-format/types";
import "../response/response.css";
import "./mission-conclusion-rich.css";
import { ResponseRoleBased } from "../response/response-role-based";
import { Prose } from "./prose";
import { useConclusionDecisions } from "./conclusion-decisions";
import { useRole } from "@/components/role-context";

const CATEGORY_INFO: Record<string, { icon: string; name: string; color: string; gradient: string }> = {
  regular_food: { icon: "🍪", name: "普通食品", color: "#f59e0b", gradient: "linear-gradient(135deg,#fffbeb,#fef3c7)" },
  health_food: { icon: "💊", name: "保健食品", color: "#7c3aed", gradient: "linear-gradient(135deg,#f5f3ff,#ede9fe)" },
  cross_border_food: { icon: "🌍", name: "跨境食品", color: "#0891b2", gradient: "linear-gradient(135deg,#ecfeff,#cffafe)" },
  cosmetics: { icon: "💄", name: "化妆品", color: "#db2777", gradient: "linear-gradient(135deg,#fdf2f8,#fce7f3)" },
};

function getCategoryFromText(text: string): string {
  const t = (text || "").toLowerCase();
  if (t.includes("化妆") || t.includes("护肤") || t.includes("面膜")) return "cosmetics";
  if (t.includes("跨境") || t.includes("进口") || t.includes("保税")) return "cross_border_food";
  if (t.includes("保健") || t.includes("多酚") || t.includes("胶囊") || t.includes("软糖")) return "health_food";
  return "regular_food";
}

type Loaded = { envelope: ResponseEnvelope; renderable: boolean };

export function MissionConclusionRich({
  missionId,
  text,
  density = "summary",
  showAsk = true,
}: {
  missionId: string;
  text: string;
  density?: "summary" | "full";
  showAsk?: boolean;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const decisions = useConclusionDecisions();
  const { role } = useRole();
  const category = getCategoryFromText(text);
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;

  useEffect(() => {
    let alive = true;
    fetch(`/api/missions/${encodeURIComponent(missionId)}/response`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Loaded>) : null))
      .then((d) => { if (alive && d?.envelope) setData(d); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [missionId]);

  const fallback = (
    <div className="mission-conclusion-rich" data-role={role} style={{ borderColor: catInfo.color } as any}>
      <div className="conclusion-header" style={{ background: catInfo.gradient }}>
        <div>
          <span className="eyebrow" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name} · 任务结论 · {role === "leadership" ? "领导" : role === "product" ? "研发" : role === "sales" ? "销售" : "默认"}视角 · 富可视化</span>
          <h3>任务结论 · {missionId.slice(0, 8)}</h3>
          <small>Kern智能统筹 · {catInfo.name}专用 · 富可视化 · 15组件+8动效</small>
        </div>
        <div className="category-badge" style={{ background: catInfo.color, color: "white" }}>{catInfo.icon} {catInfo.name}</div>
      </div>
      <Prose text={text} />
      {role === "leadership" && (
        <div className="boss-summary" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
          <strong>💡 老板一句话结论</strong>
          <p>{text.slice(0, 120) || "任务已完成，可推进下一阶段"} · {catInfo.name}专用</p>
        </div>
      )}
      {role === "sales" && (
        <div className="selling-points">
          <strong>💎 销售卖点 · {catInfo.name}</strong>
          <p>任务结论已核实，{catInfo.name}卖点突出，可直接用于客户沟通 · Kern已提炼</p>
        </div>
      )}
    </div>
  );

  if (!data?.renderable) return fallback;

  const envelope = showAsk ? data.envelope : { ...data.envelope, ask: undefined };
  const choice = envelope.ask ? { missionId, question: envelope.ask.question, demo: envelope.demo, label: "" } : null;

  return (
    <div className="mission-conclusion-rich-wrapper" style={{ borderColor: catInfo.color } as any}>
      <div className="conclusion-meta-bar" style={{ background: catInfo.gradient, borderBottom: `2px solid ${catInfo.color}` }}>
        <span style={{ background: catInfo.color, color: "white", padding: "2px 8px", borderRadius: 99, fontSize: 10 }}>{catInfo.icon} {catInfo.name} · 富可视化</span>
        <small>{role}视角 · Kern调度 · {catInfo.name}专用</small>
      </div>
      <ResponseRoleBased envelope={envelope} defaultDensity={density} fallback={fallback}
        onAsk={decisions && choice ? label => decisions.choose({ ...choice, label }) : undefined}
        askState={decisions && choice ? decisions.state(choice, envelope.ask!.options.map(o => o.label)) : undefined}
      />
    </div>
  );
}
