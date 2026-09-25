"use client";

import React from "react";
import { Pill } from "@/components/cockpit";
import { fmtDateTime } from "@/shared/datetime";

export type AutomationTraceView = {
  id: string;
  eventKey: string;
  eventType: string;
  eventStatus: string;
  aggregateType: string;
  aggregateId: string;
  createdAt: string;
  dispatchedAt: string | null;
  lastError: string | null;
  receipt: {
    id: string;
    status: string;
    suppressionReason: string | null;
    errorReason: string | null;
    autopilot: {
      id: string;
      key: string;
      name: string;
      actionKind: string;
      status: string;
    };
  } | null;
  decision: {
    id: string;
    decisionKey: string;
    specVersion: string;
    engine: string;
    engineVersion: string;
    value: string | boolean | number | null;
    reasonCodes: string[];
    policyAction: string;
    policyReasons: string[];
    createdAt: string;
  } | null;
  agentTask: {
    id: string;
    goal: string;
    status: string;
    triggerType: string;
    createdAt: string;
    agent: { id: string; code: string; name: string };
  } | null;
};

const EVENT_LABELS: Record<string, string> = {
  SIGNAL_CAPTURED: "市场信号进入系统",
  PRODUCT_VERSION_PUBLISHED: "产品版本发布",
  EVIDENCE_VERIFIED: "证据正式核验",
  AGENT_CHILD_TERMINAL: "子 Agent 返回结果",
};

const REASON_LABELS: Record<string, string> = {
  HIGH_VALUE_TIER: "高价值分级",
  NOT_HIGH_VALUE: "未达到高价值分级",
  VALUE_REASON_PRESENT: "已有价值判断依据",
  VALUE_REASON_MISSING: "缺少价值判断依据",
  REAL_SIGNAL: "真实信号",
  NON_REAL_SIGNAL: "非真实信号",
  BLOCKED: "存在阻塞",
  NOT_BLOCKED: "无阻塞",
  VERSION_TAG_PRESENT: "版本标识完整",
  VERSION_TAG_MISSING: "缺少版本标识",
  IMMUTABLE_VERSION: "不可变版本",
  MUTABLE_VERSION: "版本仍可变",
  BUSINESS_CONFIRMED: "业务已确认",
  NOT_BUSINESS_CONFIRMED: "业务尚未确认",
  UNKNOWNS_PRESENT: "仍有未知项",
  NO_DECLARED_UNKNOWNS: "未声明未知项",
  EVIDENCE_VERIFIED: "证据已核验",
  EVIDENCE_NOT_VERIFIED: "证据未核验",
  REAL_EVIDENCE: "真实证据",
  NON_REAL_EVIDENCE: "非真实证据",
  PARENT_AGENT_RESOLVED: "已定位原父 Agent",
  CHILD_SUCCEEDED: "子任务成功",
  CHILD_FAILED: "子任务失败",
  CHILD_TERMINAL: "子任务进入终态",
};

function statusTone(trace: AutomationTraceView): "ok" | "warn" | "neutral" | "info" {
  if (trace.agentTask) return "ok";
  if (trace.receipt?.status === "WAITING_HUMAN" || trace.receipt?.status === "FAILED") return "warn";
  if (trace.receipt?.status === "SUPPRESSED") return "neutral";
  return "info";
}

function outcomeLabel(trace: AutomationTraceView) {
  if (trace.agentTask) return "已唤醒 " + trace.agentTask.agent.name;
  if (trace.receipt?.status === "SUPPRESSED") return "未触发自动跟进";
  if (trace.receipt?.status === "WAITING_HUMAN") return "等待人工判断";
  if (trace.receipt?.status === "FAILED" || trace.eventStatus === "FAILED") return "自动化失败";
  if (!trace.receipt) return "等待派发";
  // 剩下的只有 PENDING / PROCESSING / 已触发但没落 AgentTask 三种。
  // 一律说「判断处理中」会把排队和触发后没落任务的异常都描述成正在判断。
  if (trace.receipt.status === "PROCESSING") return "判断处理中";
  if (trace.receipt.status === "PENDING") return "等待判断";
  if (trace.receipt.status === "TRIGGERED") return "已触发，未记录到 Agent 任务";
  return "状态未知";
}

export function AutomationTraceInline({
  trace,
}: {
  trace: AutomationTraceView | null | undefined;
}) {
  if (!trace) {
    return (
      <div className="hermes-row-meta" style={{ marginTop: 8 }}>
        <span>自动化：历史记录暂无因果链</span>
      </div>
    );
  }

  return (
    <div className="hermes-note" style={{ marginTop: 9 }}>
      <div className="hermes-row-head" style={{ marginBottom: 5 }}>
        <strong style={{ fontSize: 12.5 }}>Hermes 自动判断</strong>
        <Pill tone={statusTone(trace)}>{outcomeLabel(trace)}</Pill>
      </div>
      <div className="hermes-row-meta">
        <span>{EVENT_LABELS[trace.eventType] ?? trace.eventType}</span>
        {trace.decision ? (
          <>
            <span>→ {trace.decision.decisionKey}@{trace.decision.specVersion}</span>
            <span>→ {trace.decision.engine}</span>
          </>
        ) : null}
        {trace.agentTask ? <span>→ {trace.agentTask.agent.name}</span> : null}
      </div>
      {trace.decision?.reasonCodes?.length ? (
        <div className="hermes-inline" style={{ marginTop: 6 }}>
          {trace.decision.reasonCodes.slice(0, 4).map((reason) => (
            <span className="hermes-chip" key={reason}>
              {REASON_LABELS[reason] ?? reason}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AutomationTraceList({
  traces,
  emptyText = "还没有自动化因果记录。",
}: {
  traces: AutomationTraceView[];
  emptyText?: string;
}) {
  if (traces.length === 0) {
    return <div className="hermes-note">{emptyText}</div>;
  }

  return (
    <div className="hermes-list">
      {traces.map((trace) => (
        <div className="hermes-row is-flat" key={trace.id}>
          <div className="hermes-row-head">
            <strong className="hermes-row-title">
              {EVENT_LABELS[trace.eventType] ?? trace.eventType}
            </strong>
            <Pill tone={statusTone(trace)}>{outcomeLabel(trace)}</Pill>
          </div>
          <div className="hermes-row-meta">
            <span>{trace.aggregateType}</span>
            <span>{fmtDateTime(trace.createdAt)}</span>
          </div>
          <div className="hermes-row-body" style={{ marginTop: 7 }}>
            <span>事件</span>
            <span> → </span>
            <span>{trace.receipt?.autopilot.name ?? "等待 Autopilot"}</span>
            <span> → </span>
            <span>
              {trace.decision
                ? trace.decision.decisionKey + "@" + trace.decision.specVersion
                : "等待 DecisionRun"}
            </span>
            <span> → </span>
            <span>{trace.agentTask?.agent.name ?? outcomeLabel(trace)}</span>
          </div>
          {trace.decision?.reasonCodes?.length ? (
            <div className="hermes-inline" style={{ marginTop: 7 }}>
              {trace.decision.reasonCodes.slice(0, 5).map((reason) => (
                <span className="hermes-chip" key={reason}>
                  {REASON_LABELS[reason] ?? reason}
                </span>
              ))}
            </div>
          ) : null}
          {trace.lastError || trace.receipt?.errorReason ? (
            <div className="hermes-banner is-danger" style={{ marginTop: 8 }}>
              {trace.receipt?.errorReason || trace.lastError}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
