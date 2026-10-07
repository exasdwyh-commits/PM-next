/**
 * Mission timeline model (pure). Folds the ordered KernMissionEvent stream
 * into what the UI shows: one lane per step, the latest activity line, the
 * interventions the user made and QA challenges. No React, no fetch — unit
 * tested in tests/kern-mission-timeline.test.ts.
 */

import { HUMAN_GATE_LABEL } from "@/modules/governance/protected-actions";
import { fmtTime } from "@/shared/datetime";
import { AGENT_LABEL, NODE_LABEL, agentLabel, nodeLabel } from "@/modules/supervisor/labels";

export { AGENT_LABEL, NODE_LABEL, agentLabel, nodeLabel };

export type MissionEvent = {
  id: string;
  seq: number;
  type: string;
  nodeKey: string | null;
  actorUserId: string | null;
  payload: Record<string, unknown>;
  demo: boolean;
  createdAt: string;
};

export type MissionNodeView = {
  key: string;
  kind: string;
  agentCode: string;
  status: string;
  attempts: number;
  taskId: string | null;
  objective?: string;
  dependsOn?: string[];
  critical?: boolean;
  summary?: string | null;
  reason?: string | null;
  qa?: { verdict: string; issues: { target: string | null; problem: string }[] } | null;
};

export type MissionMetricsView = {
  completed: boolean;
  accepted: boolean | null;
  humanInterventions: number;
  reworkRounds: number;
  timeToResultMs: number | null;
  cost: { modelCalls: number; modelLatencyMs: number; tokens: number | null; logicalCalls?: number | null; actualAttempts?: number | null; successfulAttempts?: number | null; knownTokens?: number };
};
export type AutomationView = { allowed: boolean; reason: string | null; streak: number; required: number };

/** KX-73：把 5 个指标说成一句人话。 */
export function metricsLine(m: MissionMetricsView): string {
  const parts = [
    m.completed ? "已完成" : "未完成",
    m.accepted === null ? "未复核" : m.accepted ? "验收通过" : "验收未通过",
    `人工介入 ${m.humanInterventions} 次`,
    `返工 ${m.reworkRounds} 轮`,
    m.timeToResultMs === null ? "耗时未知" : `耗时 ${fmtDuration(m.timeToResultMs)}`,
    typeof m.cost.actualAttempts === "number"
      ? `模型请求 ${m.cost.actualAttempts} 次（成功 ${m.cost.successfulAttempts ?? "未知"} 次）${m.cost.tokens === null ? `、tokens 不完整${m.cost.knownTokens ? `（已知 ${m.cost.knownTokens}）` : ""}` : `、${m.cost.tokens} tokens`}`
      : m.cost.logicalCalls === null ? "逻辑模型调用与实际请求次数未知" : `逻辑模型调用 ${m.cost.modelCalls} 次，实际请求次数未知`,
  ];
  return parts.join("，");
}
function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} 秒`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟`;
  return `${(ms / 3_600_000).toFixed(1)} 小时`;
}

export type MissionStatusView = {
  missionTaskId: string;
  status: string;
  goal: string;
  playbook: string;
  progress: { done: number; total: number; pct?: number; remainingSteps?: number; remainingDepth?: number };
  revisionRounds: number;
  tasksCreated: number;
  budget?: { maxTasks: number; maxRevisionRounds: number };
  successCriteria?: string[];
  humanGates?: string[];
  createdAt?: string;
  nodes: MissionNodeView[];
  outcome: { status: "COMPLETED" | "NEEDS_USER" | "CANCELLED"; reasons: string[]; finishedAt?: string } | null;
  paused: { at: string; byUserId: string } | null;
  userInputs: { id: string; at: string; text: string; appliedTo: string[] }[];
  demo?: boolean;
  memoriesUsed?: { id: string; text: string }[];
  /** KX-36：按你保存的做法启动。 */
  savedPlaybook?: { id: string; name: string } | null;
  /** KX-72：任务契约与验收状态。 */
  contract?: import("./components/contract-card").ContractView | null;
  /** KX-73：这次的结果指标；以及能否转成定时任务。 */
  metrics?: MissionMetricsView | null;
  automation?: AutomationView | null;
  /** KX-51：步骤中途在等你回答的问题。 */
  pendingAsks?: {
    askId: string;
    nodeKey: string | null;
    question: string;
    defaultAssumption: string;
    askedAt: string;
    timeoutSec: number | null;
    /** KX-31b：连接器写操作的审批卡。 */
    approval?: { connector: string; title: string; toolName: string; inputPreview: string };
  }[];
  /** KX-53：此刻需要你做的事（提问 / 停下待处理 / 已暂停）。 */
  attention?: { kind: "ASK" | "NEEDS_USER" | "PAUSED"; text: string; askId?: string; nodeKey?: string | null }[];
};

/** KX-53：进度百分比（优先用服务端按依赖图估算的真实值，老数据回退到计数）。 */
export function progressPct(status: Pick<MissionStatusView, "progress" | "outcome">): number {
  if (status.outcome?.status === "COMPLETED") return 100;
  const p = status.progress;
  if (typeof p.pct === "number") return Math.max(0, Math.min(100, p.pct));
  return Math.round((p.done / Math.max(1, p.total)) * 100);
}

/** 进度旁的一句话：「约 62% · 还剩 2 轮」。 */
export function progressLabel(status: Pick<MissionStatusView, "progress" | "outcome">): string {
  const pct = progressPct(status);
  if (status.outcome) return `${pct}%`;
  const depth = status.progress.remainingDepth;
  return typeof depth === "number" && depth > 0 ? `约 ${pct}% · 还剩 ${depth} 轮` : `约 ${pct}%`;
}

export type ModelCall = { at: string; ok: boolean; latencyMs: number | null; provider: string | null; model: string | null; error?: string };
export type ToolCallView = { at: string; tool: string; label: string; ok: boolean; input: string | null; output: string | null; latencyMs: number | null };

const TOOL_LABEL: Record<string, string> = { knowledge_search: "知识库检索", calculate: "计算", invalid: "无效的工具调用" };
export function toolLabel(tool: string): string {
  return TOOL_LABEL[tool] ?? tool;
}
/** 工具输入的一句话预览：{"query":"x"} → 「x」。 */
export function toolInputPreview(input: string | null): string {
  if (!input) return "";
  try {
    const o = JSON.parse(input) as Record<string, unknown>;
    const v = o.query ?? o.expression ?? Object.values(o)[0];
    return typeof v === "string" && v ? `「${v.slice(0, 40)}」` : "";
  } catch {
    return "";
  }
}

export type LaneAttempt = {
  attempt: number;
  dispatchedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  status: string | null;
  method: string[];
  modelCalls: ModelCall[];
  /** KX-50：模型之外的工具调用（知识库检索、计算……）。 */
  toolCalls: ToolCallView[];
  cites: { title: string; url: string | null; fetchedAt: string | null }[];
  output: string | null;
  durationMs: number | null;
  revision: boolean;
  userInputIds: string[];
  reason: string | null;
};

export type Lane = {
  key: string;
  label: string;
  agentCode: string;
  agentLabel: string;
  kind: string;
  status: string;
  critical: boolean;
  objective: string;
  attempts: LaneAttempt[];
  skippedReason: string | null;
};

export type TimelineEntry = {
  seq: number;
  at: string;
  kind: "system" | "user" | "qa" | "step";
  nodeKey: string | null;
  text: string;
};

export const REASON_LABEL: Record<string, string> = {
  USER_SKIPPED: "你跳过了这一步",
  MISSION_CANCELLED: "任务已取消",
  TASK_BUDGET_EXHAUSTED: "步骤预算用完",
  USER_CANCELLED: "你取消了任务",
  MODEL_UNAVAILABLE: "当前没有可用的模型",
};

/** 标签来自受保护动作清单（governance/protected-actions.ts），不在这里另抄一份。 */
export const GATE_LABEL: Readonly<Record<string, string>> = HUMAN_GATE_LABEL;

export function reasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const head = reason.split(/[:\s]/)[0];
  if (REASON_LABEL[head]) return REASON_LABEL[head];
  const crit = /^CRITICAL_(.+)_(SKIPPED|BLOCKED|FAILED|MISSING)$/.exec(reason);
  if (crit) return `关键步骤「${nodeLabel(crit[1])}」${{ SKIPPED: "被跳过", BLOCKED: "受阻", FAILED: "失败", MISSING: "缺失" }[crit[2]]}`;
  if (/^SYNTHESIS_/.test(reason)) return "综合结论未能完成";
  const cond = /^CONDITION_(.+)_(PROHIBITED|CONDITIONAL|CLEAR)$/.exec(reason);
  if (cond) {
    const verdict = { PROHIBITED: "禁止", CONDITIONAL: "有条件可做", CLEAR: "可做" }[cond[2]];
    return `「${nodeLabel(cond[1])}」判定为${verdict}，按计划跳过`;
  }
  return reason;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function blankAttempt(attempt: number): LaneAttempt {
  return {
    attempt,
    dispatchedAt: null,
    startedAt: null,
    finishedAt: null,
    status: null,
    method: [],
    modelCalls: [],
    toolCalls: [],
    cites: [],
    output: null,
    durationMs: null,
    revision: false,
    userInputIds: [],
    reason: null,
  };
}

/** Lanes follow the plan order (status view), enriched with event detail. */
export function buildLanes(status: MissionStatusView | null, events: MissionEvent[]): Lane[] {
  const order: string[] = [];
  const lanes = new Map<string, Lane>();
  const ensure = (key: string, seed?: Partial<Lane>) => {
    let lane = lanes.get(key);
    if (!lane) {
      lane = {
        key,
        label: nodeLabel(key),
        agentCode: seed?.agentCode ?? "",
        agentLabel: agentLabel(seed?.agentCode ?? ""),
        kind: seed?.kind ?? "SPECIALIST",
        status: seed?.status ?? "PENDING",
        critical: seed?.critical ?? false,
        objective: seed?.objective ?? "",
        attempts: [],
        skippedReason: null,
      };
      lanes.set(key, lane);
      order.push(key);
    }
    return lane;
  };
  for (const n of status?.nodes ?? []) {
    ensure(n.key, { agentCode: n.agentCode, kind: n.kind, status: n.status, critical: !!n.critical, objective: n.objective ?? "" });
  }
  const current = (lane: Lane) => {
    if (!lane.attempts.length) lane.attempts.push(blankAttempt(1));
    return lane.attempts[lane.attempts.length - 1];
  };
  for (const e of events) {
    if (!e.nodeKey) continue;
    // Removed-by-edit steps keep their history only if they had any.
    const lane = ensure(e.nodeKey, { agentCode: str(e.payload.agentCode) ?? "" });
    const p = e.payload;
    switch (e.type) {
      case "node.dispatched": {
        const n = num(p.attempt) ?? lane.attempts.length + 1;
        const a = blankAttempt(n);
        a.dispatchedAt = e.createdAt;
        a.revision = p.revision === true;
        lane.attempts.push(a);
        if (!lane.agentCode && str(p.agentCode)) {
          lane.agentCode = str(p.agentCode)!;
          lane.agentLabel = agentLabel(lane.agentCode);
        }
        lane.skippedReason = null;
        break;
      }
      case "node.started": {
        const a = current(lane);
        a.startedAt = e.createdAt;
        a.method = Array.isArray(p.method) ? p.method.filter((m): m is string => typeof m === "string") : [];
        a.userInputIds = Array.isArray(p.userInputIds) ? p.userInputIds.filter((m): m is string => typeof m === "string") : [];
        break;
      }
      case "node.tool": {
        if (p.tool === "model_call") {
          current(lane).modelCalls.push({
            at: e.createdAt,
            ok: p.ok !== false,
            latencyMs: num(p.latencyMs),
            provider: str(p.provider),
            model: str(p.model),
            error: str(p.error) ?? undefined,
          });
        } else if (str(p.tool)) {
          current(lane).toolCalls.push({
            at: e.createdAt,
            tool: str(p.tool)!,
            label: toolLabel(str(p.tool)!),
            ok: p.ok !== false,
            input: str(p.input),
            output: str(p.output),
            latencyMs: num(p.latencyMs),
          });
        }
        break;
      }
      case "node.cite":
        current(lane).cites.push({ title: str(p.title) ?? str(p.url) ?? "来源", url: str(p.url), fetchedAt: str(p.fetchedAt) });
        break;
      case "node.delta": {
        const a = current(lane);
        const text = str(p.text) ?? "";
        a.output = p.complete === true || a.output === null ? text : a.output + text;
        break;
      }
      case "node.finished": {
        const a = current(lane);
        a.finishedAt = e.createdAt;
        a.status = str(p.status);
        a.durationMs = num(p.durationMs);
        a.reason = str(p.reason);
        if (!a.output && str(p.summary)) a.output = str(p.summary);
        break;
      }
      case "node.skipped":
        lane.skippedReason = str(p.reason);
        break;
    }
  }
  return order.map((k) => lanes.get(k)!).filter((l) => status?.nodes.some((n) => n.key === l.key) || l.attempts.length);
}

/** One human sentence per meaningful event (the conversation card + 「过程」 summary). */
export function describeEvent(e: MissionEvent): TimelineEntry | null {
  const p = e.payload;
  const who = e.nodeKey ? nodeLabel(e.nodeKey) : "";
  const base = { seq: e.seq, at: e.createdAt, nodeKey: e.nodeKey };
  switch (e.type) {
    case "mission.launched":
      return { ...base, kind: "system", text: `Kern 接手目标，拆成 ${Array.isArray(p.nodes) ? p.nodes.length : "若干"} 个步骤` };
    case "mission.paused":
      return { ...base, kind: "user", text: "你暂停了任务，进行中的步骤会做完" };
    case "mission.resumed":
      return { ...base, kind: "user", text: p.from === "PAUSED" ? "你让任务继续" : "任务从停下的地方继续" };
    case "mission.cancelled":
      return { ...base, kind: "user", text: "你取消了任务" };
    case "mission.finished":
      return {
        ...base,
        kind: "system",
        text: p.outcome === "COMPLETED" ? "全部完成，结论已送达" : `停下了：${(Array.isArray(p.reasons) ? p.reasons : []).map((r) => reasonLabel(String(r))).join("；") || "需要你处理"}`,
      };
    case "plan.edited":
      return { ...base, kind: "user", text: `你调整了计划：${(Array.isArray(p.changes) ? p.changes : []).join("；")}` };
    case "user.input":
      return { ...base, kind: "user", text: `你补充：「${String(p.text ?? "").slice(0, 60)}」— 将带入后续步骤` };
    case "user.input.applied":
      return { ...base, kind: "user", text: `已带入「${who}」` };
    case "node.ask":
      return { ...base, kind: "step", text: `「${who}」向你提问：${String(p.question ?? "").slice(0, 80)}` };
    case "node.answered":
      if (p.decision === "allow" || p.decision === "deny") {
        return { ...base, kind: "user", text: p.decision === "allow" ? `你允许了一次：${String(p.text ?? "").slice(0, 60)}` : `你没有允许：${String(p.text ?? "").slice(0, 60)}` };
      }
      return {
        ...base,
        kind: "user",
        text:
          p.mode === "answer"
            ? `你回答：「${String(p.text ?? "").slice(0, 60)}」`
            : p.mode === "abort"
              ? "你在提问处中止了任务"
              : p.mode === "timeout"
                ? `「${who}」没等到回答，按默认假设继续`
                : `你跳过了提问，「${who}」按默认假设继续`,
      };
    case "node.dispatched":
      return { ...base, kind: "step", text: `${agentLabel(String(p.agentCode ?? ""))}${p.revision ? "返工" : "接手"}「${who}」` };
    case "node.started":
      return { ...base, kind: "step", text: `「${who}」开始${Array.isArray(p.method) && p.method.length ? `，方法：${p.method.slice(0, 2).join("、")}` : ""}` };
    case "node.tool":
      if (p.tool !== "model_call" && str(p.tool)) {
        return {
          ...base,
          kind: "step",
          text: `「${who}」${p.ok === false ? "工具失败" : "使用工具"}：${toolLabel(str(p.tool)!)}${toolInputPreview(str(p.input))}`,
        };
      }
      return p.ok === false
        ? { ...base, kind: "step", text: `「${who}」调用模型失败` }
        : { ...base, kind: "step", text: `「${who}」调用模型 ${str(p.model) ?? ""}${num(p.latencyMs) !== null ? ` · ${formatMs(num(p.latencyMs))}` : ""}`.trim() };
    case "node.cite":
      return { ...base, kind: "step", text: `「${who}」引用 ${str(p.title) ?? str(p.url) ?? "来源"}` };
    case "node.finished": {
      const s = str(p.status);
      if (s === "SUCCEEDED") {
        const qa = p.qa as { verdict?: string } | null | undefined;
        return { ...base, kind: qa ? "qa" : "step", text: qa ? `QA 结论：${qaLabel(qa.verdict)}` : `「${who}」完成` };
      }
      return { ...base, kind: "step", text: `「${who}」${s === "BLOCKED" ? "受阻" : "失败"}${reasonLabel(str(p.reason)) ? `：${reasonLabel(str(p.reason))}` : ""}` };
    }
    case "node.skipped":
      return { ...base, kind: p.reason === "USER_SKIPPED" ? "user" : "system", text: `「${who}」已跳过${reasonLabel(str(p.reason)) ? `（${reasonLabel(str(p.reason))}）` : ""}` };
    case "node.rerun":
      return {
        ...base,
        kind: "user",
        text: `${p.reason === "USER_ANSWERED" ? "按你的回答重做" : "你要求重跑"}「${who}」${Array.isArray(p.resetKeys) && p.resetKeys.length > 1 ? `，连带 ${p.resetKeys.length - 1} 个下游步骤` : ""}`,
      };
    case "qa.revise":
      return {
        ...base,
        kind: "qa",
        text: `QA 要求返工：${(Array.isArray(p.nodeKeys) ? p.nodeKeys : []).map((k) => nodeLabel(String(k))).join("、")}`,
      };
    case "node.hypothesis": {
      const h = Array.isArray(p.hypotheses) ? p.hypotheses.length : 0;
      const u = Array.isArray(p.unknowns) ? p.unknowns.length : 0;
      const what = [h ? `${h} 处推断` : "", u ? `${u} 项还不知道` : ""].filter(Boolean).join("、");
      if (!what) return null;
      return { ...base, kind: "step", text: `「${who}」自己标出了${what} — 未核实，别当结论用` };
    }
    case "node.refuted": {
      const why = str(p.feedback);
      return { ...base, kind: "qa", text: `「${who}」的结论被复核推翻${why ? `：${why.slice(0, 60)}` : ""}` };
    }
    case "node.retracted":
      return { ...base, kind: "qa", text: `「${who}」此前给出的结论作废（上游被推翻），正在重做` };
    default:
      return null; // node.delta is shown in the lane, not the log
  }
}

export function buildTimeline(events: MissionEvent[]): TimelineEntry[] {
  return events.map(describeEvent).filter((e): e is TimelineEntry => !!e);
}

/** What the conversation card shows as "now": latest non-noise entry. */
export function currentActivity(status: MissionStatusView | null, events: MissionEvent[]): string {
  if (status?.outcome) {
    if (status.outcome.status === "CANCELLED") return "你取消了任务";
    return (
      describeEvent({ id: "", seq: 0, type: "mission.finished", nodeKey: null, actorUserId: null, demo: false, createdAt: "", payload: { outcome: status.outcome.status, reasons: status.outcome.reasons } })?.text ?? ""
    );
  }
  if (status?.paused) return "已暂停 · 进行中的步骤做完后停下，等你继续";
  const active = (status?.nodes ?? []).filter((n) => n.status === "ACTIVE");
  if (active.length) return `正在：${active.map((n) => `${agentLabel(n.agentCode)}「${nodeLabel(n.key)}」`).join("、")}`;
  const last = buildTimeline(events).at(-1);
  return last?.text ?? "准备中…";
}

export type QaChallenge = { seq: number; at: string; source: "QA" | "RED_TEAM"; verdict: string | null; items: { target: string | null; problem: string }[]; revised: string[] };

/** QA / red-team challenges and what got revised because of them. */
export function buildChallenges(events: MissionEvent[]): QaChallenge[] {
  const out: QaChallenge[] = [];
  for (const e of events) {
    if (e.type === "node.finished" && e.payload.qa) {
      const qa = e.payload.qa as { verdict?: string; issues?: { target: string | null; problem: string }[] };
      out.push({ seq: e.seq, at: e.createdAt, source: "QA", verdict: qa.verdict ?? null, items: qa.issues ?? [], revised: [] });
    }
    if (e.type === "qa.revise") {
      const last = [...out].reverse().find((c) => c.source === "QA");
      if (last) last.revised = (Array.isArray(e.payload.nodeKeys) ? e.payload.nodeKeys : []).map(String);
    }
  }
  return out;
}

export function qaLabel(v: string | null | undefined): string {
  return v === "PASS" ? "通过" : v === "REVISE" ? "要求返工" : v === "FAIL" ? "未通过" : "未知";
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  // 业务时区的 HH:mm:ss，与服务端渲染一致。
  return Number.isNaN(d.getTime()) ? "" : fmtTime(d);
}

export function mergeEvents(prev: MissionEvent[], next: MissionEvent[]): MissionEvent[] {
  if (!next.length) return prev;
  const seen = new Set(prev.map((e) => e.seq));
  const merged = [...prev, ...next.filter((e) => !seen.has(e.seq))];
  merged.sort((a, b) => a.seq - b.seq);
  return merged;
}

export function totalModelCalls(lanes: Lane[]): { calls: number; latencyMs: number } {
  let calls = 0;
  let latencyMs = 0;
  for (const l of lanes) for (const a of l.attempts) for (const c of a.modelCalls) {
    calls++;
    latencyMs += c.latencyMs ?? 0;
  }
  return { calls, latencyMs };
}
