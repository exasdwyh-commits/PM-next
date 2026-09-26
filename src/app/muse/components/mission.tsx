"use client";

import { useEffect, useState } from "react";
import type { AiState } from "../types";
import { Card, CardHead, I, Node, Tag } from "./kit";

type MissionNode = { key: string; kind: string; agentCode: string; status: string; attempts: number };
type MissionStatus = {
  status: string;
  playbook: string;
  progress: { done: number; total: number };
  revisionRounds: number;
  nodes: MissionNode[];
  outcome: { status: "COMPLETED" | "NEEDS_USER" | "CANCELLED"; reasons: string[] } | null;
};

const NODE_LABEL: Record<string, string> = {
  market: "市场与竞品研究",
  compliance: "合规边界",
  economics: "单位经济性",
  opportunity: "机会判断与方向",
  validation: "验证计划",
  gtm: "上市与营销策略",
  "red-team": "红队挑战",
  qa: "独立 QA 复核",
  synthesis: "Kern 综合结论",
};

const AGENT_LABEL: Record<string, string> = {
  research_agent: "市场研究",
  compliance_agent: "合规",
  cost_bom_agent: "成本",
  product_agent: "产品",
  marketing_agent: "营销",
  red_team: "红队",
  qa_verifier: "QA",
  hermes_pm: "Kern",
  scientific_evidence_agent: "科学证据",
  formulation_agent: "配方",
  ops_agent: "供应与运营",
  tech_architect_agent: "技术架构",
};

function toState(status: string): AiState {
  switch (status) {
    case "SUCCEEDED":
      return "success";
    case "ACTIVE":
      return "working";
    case "BLOCKED":
      return "needs-review";
    case "FAILED":
      return "error";
    case "SKIPPED":
      return "cancelled";
    default:
      return "idle";
  }
}

/**
 * Live view of a Kern mission inside the conversation.
 * The user sees *what Kern is doing*, not an agent console: one card,
 * steps in plain language, polling stops once the mission is terminal.
 */
export function MissionCard({ missionId }: { missionId: string }) {
  const [data, setData] = useState<MissionStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const response = await fetch(`/api/missions/${missionId}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as MissionStatus;
        if (disposed) return;
        setData(next);
        if (!next.outcome) timer = setTimeout(load, 5000);
      } catch {
        if (!disposed) setFailed(true);
      }
    };
    void load();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [missionId]);

  if (failed && !data) return null;
  const aside = !data ? null : data.outcome ? (
    <Tag tone={data.outcome.status === "COMPLETED" ? "ok" : "warn"}>
      {data.outcome.status === "COMPLETED" ? "已完成" : data.outcome.status === "CANCELLED" ? "已取消" : "需要你处理"}
    </Tag>
  ) : (
    <Tag tone="accent" live>
      {data.progress.done}/{data.progress.total}
    </Tag>
  );

  return (
    <Card>
      <CardHead
        icon={<I.plan />}
        title={!data?.outcome ? "Kern 正在推进" : data.outcome.status === "COMPLETED" ? "Kern 已完成" : data.outcome.status === "CANCELLED" ? "已取消" : "这项工作停下了"}
        aside={aside}
      />
      <div className="m-card-body">
        {!data ? (
          <p className="m-hint">读取进展…</p>
        ) : (
          <ol className="m-plan">
            {data.nodes.map((node) => (
              <li key={node.key} className="m-step">
                <Node state={toState(node.status)} />
                <div className="m-step-main">
                  <b>{NODE_LABEL[node.key] ?? node.key.replace(/^specialist-\d+-/, "")}</b>
                  {node.attempts > 1 ? <span>根据 QA 意见返工 {node.attempts - 1} 次</span> : null}
                  {node.status === "BLOCKED" ? <span>受阻，结论中按 UNKNOWN 处理</span> : null}
                </div>
                <span className="m-step-by">{AGENT_LABEL[node.agentCode] ?? node.agentCode}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
