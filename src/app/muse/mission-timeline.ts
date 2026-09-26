/**
 * Mission timeline model (pure). Folds the ordered KernMissionEvent stream
 * into what the UI shows: one lane per step, the latest activity line, the
 * interventions the user made and QA challenges. No React, no fetch — unit
 * tested in tests/kern-mission-timeline.test.ts.
 */

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

export type MissionStatusView = {
  missionTaskId: string;
  status: string;
  goal: string;
  playbook: string;
  progress: { done: number; total: number };
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
};

export type ModelCall = { at: string; ok: boolean; latencyMs: number | null; provider: string | null; model: string | null; error?: string };

export type LaneAttempt = {
  attempt: number;
  dispatchedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  status: string | null;
  method: string[];
  modelCalls: ModelCall[];
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

export const NODE_LABEL: Record<string, string> = {
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

export const AGENT_LABEL: Record<string, string> = {
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

export const REASON_LABEL: Record<string, string> = {
  USER_SKIPPED: "你跳过了这一步",
  MISSION_CANCELLED: "任务已取消",
  TASK_BUDGET_EXHAUSTED: "步骤预算用完",
  USER_CANCELLED: "你取消了任务",
  MODEL_UNAVAILABLE: "当前没有可用的模型",
};

export const GATE_LABEL: Record<string, string> = {
  PAYMENT_OR_FINANCIAL_COMMITMENT: "付款或资金承诺",
  EXTERNAL_PUBLISH_OR_SEND: "对外发布或发送",
  IRREVERSIBLE_DELETE_OR_OVERWRITE: "不可逆的删除或覆盖",
  SENSITIVE_PERMISSION_CHANGE: "敏感权限变更",
  FORMAL_BUSINESS_GATE: "正式业务关口",
  LEGAL_OR_CONTRACT_COMMITMENT: "法律或合同承诺",
  STRATEGIC_VALUE_TRADEOFF: "战略取舍",
};

export function nodeLabel(key: string): string {
  return NODE_LABEL[key] ?? key.replace(/^specialist-\d+-/, "");
}
export function agentLabel(code: string): string {
  return AGENT_LABEL[code] ?? code;
}
export function reasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const head = reason.split(/[:\s]/)[0];
  if (REASON_LABEL[head]) return REASON_LABEL[head];
  const crit = /^CRITICAL_(.+)_(SKIPPED|BLOCKED|FAILED|MISSING)$/.exec(reason);
  if (crit) return `关键步骤「${nodeLabel(crit[1])}」${{ SKIPPED: "被跳过", BLOCKED: "受阻", FAILED: "失败", MISSING: "缺失" }[crit[2]]}`;
  if (/^SYNTHESIS_/.test(reason)) return "综合结论未能完成";
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
    case "node.dispatched":
      return { ...base, kind: "step", text: `${agentLabel(String(p.agentCode ?? ""))}${p.revision ? "返工" : "接手"}「${who}」` };
    case "node.started":
      return { ...base, kind: "step", text: `「${who}」开始${Array.isArray(p.method) && p.method.length ? `，方法：${p.method.slice(0, 2).join("、")}` : ""}` };
    case "node.tool":
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
      return { ...base, kind: "user", text: `你要求重跑「${who}」${Array.isArray(p.resetKeys) && p.resetKeys.length > 1 ? `，连带 ${p.resetKeys.length - 1} 个下游步骤` : ""}` };
    case "qa.revise":
      return {
        ...base,
        kind: "qa",
        text: `QA 要求返工：${(Array.isArray(p.nodeKeys) ? p.nodeKeys : []).map((k) => nodeLabel(String(k))).join("、")}`,
      };
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
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
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
