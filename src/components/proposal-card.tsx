"use client";

import React from "react";
import { Badge, cx } from "@/components/ui";
import Icon from "@/components/icons";
import { fmtDateTime } from "@/shared/datetime";

/**
 * 顾问提议卡片（蓝图 §5.3：提议 → 权限和版本检查 → 用户确认 → 业务命令 → 回执）
 *
 * 刻意做的事：
 * - 把「提议要改什么」写成可读的一句话，不做任何美化或收益承诺。
 * - 确认按钮带稳定幂等键（提议 id + 确认说明的指纹），双击/刷新重试都不会二次写入。
 * - 应用后展示服务端回执（对象类型/对象 id/确认说明），而不是客户端自己推断成功。
 *
 * 刻意不做的事：
 * - 不在前端判断"有没有权限""版本是否过期"——那由服务端在确认时判定并返回明确错误。
 * - 不在模型侧生成后直接写入；未确认前数据库里只有一条 PENDING_CONFIRMATION 提议。
 */

export interface ProposalCardData {
  id: string;
  actionType: string;
  actionLabel?: string | null;
  status: string;
  payloadJson: unknown;
  idempotencyKey?: string | null;
  decidedAt?: string | null;
  decisionReason?: string | null;
  appliedObjectType?: string | null;
  appliedObjectId?: string | null;
  product?: { id: string; name: string } | null;
  project?: { id: string; title: string } | null;
  proposedBy?: { id: string; name: string } | null;
  createdAt?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_CONFIRMATION: "待你确认",
  APPLIED: "已应用",
  REJECTED: "已拒绝",
  SUPERSEDED: "已作废",
  EXPIRED: "已过期",
};

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "neutral" | "info"> = {
  DRAFT: "neutral",
  PENDING_CONFIRMATION: "warn",
  APPLIED: "ok",
  REJECTED: "danger",
  SUPERSEDED: "neutral",
  EXPIRED: "neutral",
};

const ACTION_LABEL: Record<string, string> = {
  CREATE_WORK_ITEM: "创建内部工作项",
  UPDATE_FIELD: "修改产品方案字段",
  CREATE_REVISION: "创建产品新版本",
};

/** 同步、确定性的短指纹：用于把"确认说明"纳入幂等键 */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function text(v: unknown): string {
  return v === null || v === undefined || v === "" ? "（空）" : String(v);
}

interface FieldPayload {
  productId?: string;
  baseVersionTag?: string;
  field?: string;
  fieldLabel?: string;
  value?: string | null;
  rationale?: string | null;
}

function describe(proposal: ProposalCardData): { headline: string; rows: { k: string; v: React.ReactNode }[] } {
  const p = (proposal.payloadJson && typeof proposal.payloadJson === "object"
    ? proposal.payloadJson
    : {}) as Record<string, any>;

  if (proposal.actionType === "UPDATE_FIELD") {
    const fp = p as FieldPayload;
    return {
      headline: `把「${fp.fieldLabel ?? fp.field ?? "字段"}」改为：${text(fp.value)}`,
      rows: [
        {
          k: "产品",
          v: proposal.product?.name ?? fp.productId ?? "—",
        },
        { k: "依据版本", v: `${fp.baseVersionTag ?? "—"}（确认前会重新校验是否仍为最新）` },
        { k: "字段", v: `${fp.fieldLabel ?? fp.field}（${fp.field}）` },
        { k: "新值", v: text(fp.value) },
      ],
    };
  }

  if (proposal.actionType === "CREATE_WORK_ITEM") {
    return {
      headline: `创建内部工作项：${text(p.title)}`,
      rows: [
        { k: "项目", v: proposal.project?.title ?? p.projectTitle ?? p.projectId ?? "—" },
        { k: "标题", v: text(p.title) },
        { k: "目标", v: text(p.target) },
        { k: "交付要求", v: text(p.deliverableReq) },
      ],
    };
  }

  return {
    headline: ACTION_LABEL[proposal.actionType] ?? proposal.actionType,
    rows: [{ k: "载荷", v: <code className="muted-line">{JSON.stringify(p)}</code> }],
  };
}

export default function ProposalCard({
  proposal,
  receipt: receiptProp,
  onDone,
}: {
  proposal: ProposalCardData;
  /** 由父级保管的回执：确认后父级会刷新列表，卡片可能被重新挂载，本地 state 会丢 */
  receipt?: any;
  onDone?: (receipt?: any) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [receipt, setReceipt] = React.useState<any>(receiptProp ?? null);
  const [showReject, setShowReject] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");

  // useState 只在挂载时取初值：若父级在本卡片已挂载之后才写回执
  // （确认后列表刷新，卡片从「待确认」区挪到「决策记录」区），本地 state 不会自动跟上。
  // 这里同步一次，保证服务端回执在任何挂载顺序下都能显示出来。
  React.useEffect(() => {
    if (receiptProp) setReceipt(receiptProp);
  }, [receiptProp]);

  const pending = proposal.status === "PENDING_CONFIRMATION";
  const { headline, rows } = describe(proposal);

  const confirm = async () => {
    if (busy || !pending) return;
    setBusy(true);
    setErr(null);
    try {
      // 幂等键 = 提议 id + 确认说明指纹：重复点击命中同一条回执，
      // 改了说明则是另一个请求（服务端会因提议已应用而返回既有回执，不二次写入）。
      const key = `ui-proposal-${proposal.id}-${fnv1a(reason.trim())}`;
      const res = await fetch(`/api/proposals/${proposal.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "应用提议失败");
      setReceipt(json);
      onDone?.(json);
    } catch (e: any) {
      setErr(e.message || "应用提议失败");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (busy || !pending) return;
    if (!rejectReason.trim()) {
      setErr("拒绝提议必须填写理由，用于留痕与后续回归");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "拒绝提议失败");
      onDone?.();
    } catch (e: any) {
      setErr(e.message || "拒绝提议失败");
    } finally {
      setBusy(false);
    }
  };

  const applied = proposal.status === "APPLIED";

  return (
    <div className={cx("hermes-row", pending && "is-selected")} style={{ display: "block" }}>
      <div className="hermes-row-head">
        <span className="hermes-row-title">
          <Icon name="nodes" size={14} /> {ACTION_LABEL[proposal.actionType] ?? proposal.actionType}
        </span>
        <Badge tone={STATUS_TONE[proposal.status] ?? "info"}>
          {STATUS_LABEL[proposal.status] ?? proposal.status}
        </Badge>
      </div>

      <p className="hermes-note" style={{ marginTop: 6 }}>
        {headline}
      </p>

      <div className="hermes-row-meta" style={{ marginTop: 8 }}>
        {rows.map((r) => (
          <span key={r.k}>
            {r.k}：{r.v}
          </span>
        ))}
      </div>

      {typeof (proposal.payloadJson as any)?.rationale === "string" && (
        <p className="hermes-note" style={{ marginTop: 6 }}>
          提议依据：{(proposal.payloadJson as any).rationale}
        </p>
      )}

      <p className="hermes-note" style={{ marginTop: 6 }}>
        未确认前不会写入任何业务数据；确认时会由服务端重新做权限与版本检查。
        {proposal.idempotencyKey ? `（提议幂等键 ${proposal.idempotencyKey}）` : ""}
      </p>

      {err && (
        <div className="hermes-banner is-danger" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}

      {pending && (
        <div className="hermes-form-grid" style={{ marginTop: 12 }}>
          <label className="hermes-label">
            确认说明（写入审计；建议写明依据，便于日后追溯）
            <input
              className="hermes-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：已与渠道确认，按新价格预期再跑一轮"
            />
          </label>

          {showReject && (
            <label className="hermes-label">
              拒绝理由（必填）
              <input
                className="hermes-input"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="例如：当前证据不足，暂不修改方案"
              />
            </label>
          )}

          <div className="hermes-inline-end">
            <button className="hermes-outline-btn" onClick={() => setShowReject((v) => !v)} disabled={busy}>
              <Icon name="close" size={14} />
              {showReject ? "取消拒绝" : "拒绝提议"}
            </button>
            {showReject ? (
              <button className="hermes-outline-btn" onClick={reject} disabled={busy || !rejectReason.trim()}>
                {busy ? "提交中…" : "确认拒绝"}
              </button>
            ) : (
              <button className="hermes-primary-btn" onClick={confirm} disabled={busy}>
                <Icon name="arrow" size={15} />
                {busy ? "应用中…" : "确认并应用"}
              </button>
            )}
          </div>
        </div>
      )}

      {!pending && proposal.decidedAt && (
        <p className="hermes-note" style={{ marginTop: 10 }}>
          决策时间：{fmtDateTime(proposal.decidedAt)}
          {proposal.decisionReason ? ` · 说明：${proposal.decisionReason}` : ""}
        </p>
      )}

      {applied && (
        <p className="hermes-note" style={{ marginTop: 6 }}>
          写入对象：{proposal.appliedObjectType ?? "—"} · {proposal.appliedObjectId ?? "—"}
        </p>
      )}

      {receipt && (
        <div className="hermes-banner is-ok" style={{ marginTop: 10 }}>
          <strong>已应用（服务端回执）</strong>
          <div style={{ marginTop: 4 }}>
            {receipt.idempotent ? "本次命中幂等回执，未发生新的写入。" : "本次为首次应用。"}
            结果对象：{receipt.appliedObjectType ?? "—"} · {receipt.appliedObjectId ?? "—"}
            {receipt.result?.versionTag ? ` · 新版本 ${receipt.result.versionTag}` : ""}
            {receipt.result?.workItem?.title ? ` · 工作项「${receipt.result.workItem.title}」` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
