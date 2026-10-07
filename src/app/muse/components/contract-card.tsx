"use client";
/**
 * KX-72 任务契约卡（开跑前）与验收清单（完成后按条复核 / 打回）。
 * 契约由后端生成；这里只展示与收集用户的按条判定。
 */
import { useState } from "react";
import { Btn, Tag } from "./kit";

export type ContractView = {
  expectedResult: string;
  inputs: string[];
  deliverables: string[];
  frequency: { kind: "once" | "recurring"; cron: string | null };
  acceptance: { id: string; text: string; check: "auto" | "human"; status: "PENDING" | "PASS" | "FAIL"; note: string | null }[];
  constraints: string[];
  approvalGates: string[];
  capabilities: string[];
  reviews: { at: string; byUserId: string; rejected: string[]; round: number }[];
};

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <span className="m-quiet">{empty}</span>;
  return <ul className="m-contract-list">{items.map((t) => <li key={t}>{t}</li>)}</ul>;
}

/** 开跑前的契约卡：结果 / 产出 / 完成标准 / 约束 / 审批门 / 能力。 */
export function ContractCard({ c }: { c: ContractView }) {
  return (
    <section className="m-contract" aria-label="任务契约">
      <div className="m-contract-head"><b>任务契约</b><Tag>{c.frequency.kind === "recurring" ? `定期 · ${c.frequency.cron}` : "一次"}</Tag></div>
      <div className="m-contract-grid">
        <i>要的结果</i><span>{c.expectedResult}</span>
        <i>产出</i><span><List items={c.deliverables} empty="—" /></span>
        <i>怎样算完成</i>
        <span>
          <ul className="m-contract-list">
            {c.acceptance.map((a) => <li key={a.id}>{a.text}{a.check === "auto" ? <em className="m-quiet">（自动检查）</em> : null}</li>)}
          </ul>
        </span>
        <i>约束</i><span><List items={c.constraints} empty="无额外约束" /></span>
        <i>会先问你</i><span><List items={c.approvalGates} empty="不需要" /></span>
        <i>会用到</i><span>{c.capabilities.length ? c.capabilities.join("、") : "内置能力"}</span>
      </div>
    </section>
  );
}

const STATUS_LABEL: Record<ContractView["acceptance"][number]["status"], string> = { PASS: "通过", FAIL: "未通过", PENDING: "待复核" };

/** 完成后的验收清单：自动项只读；人工项可通过 / 打回并写意见；提交后有打回则重做综合结论。 */
export function ContractReview({ c, busy, onSubmit }: { c: ContractView; busy: boolean; onSubmit: (verdicts: { id: string; pass: boolean; note?: string }[]) => Promise<boolean> }) {
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const accepted = c.acceptance.every((a) => a.status === "PASS");
  const lastRound = c.reviews.at(-1)?.round ?? 0;
  const toggle = (id: string) =>
    setRejected((r) => {
      const next = { ...r };
      if (id in next) delete next[id];
      else next[id] = "";
      return next;
    });
  const submit = async () => {
    const verdicts = c.acceptance
      .filter((a) => a.check === "human" || a.status === "FAIL")
      .map((a) => (a.id in rejected ? { id: a.id, pass: false, note: rejected[a.id] } : { id: a.id, pass: a.check === "human" || a.status !== "FAIL" }));
    const ok = await onSubmit(verdicts);
    if (ok) setRejected({});
  };
  return (
    <section className="m-contract m-contract-review" aria-label="验收清单">
      <div className="m-contract-head">
        <b>验收清单</b>
        {accepted ? <Tag tone="ok">已通过{lastRound ? ` · 第 ${lastRound} 轮` : ""}</Tag> : lastRound ? <Tag tone="warn">第 {lastRound} 轮复核后重做</Tag> : <Tag tone="accent">待你复核</Tag>}
      </div>
      <ul className="m-contract-checks">
        {c.acceptance.map((a) => {
          const marked = a.id in rejected;
          const tone = marked || a.status === "FAIL" ? "bad" : a.status === "PASS" ? "ok" : "pending";
          return (
            <li key={a.id} data-t={tone}>
              <span className="m-contract-mark" aria-label={STATUS_LABEL[a.status]}>{a.status === "PASS" && !marked ? "✓" : a.status === "FAIL" || marked ? "✗" : "○"}</span>
              <div>
                <span>{a.text}{a.check === "auto" ? <em className="m-quiet">（自动检查）</em> : null}</span>
                {a.note ? <p className="m-quiet">{a.note}</p> : null}
                {marked ? (
                  <input
                    className="m-contract-note"
                    placeholder="哪里不对？（会带给团队重做）"
                    value={rejected[a.id]}
                    maxLength={500}
                    onChange={(e) => setRejected((r) => ({ ...r, [a.id]: e.target.value }))}
                  />
                ) : null}
              </div>
              {!accepted && a.check === "human" ? (
                <Btn v="ghost" size="sm" disabled={busy} onClick={() => toggle(a.id)} aria-pressed={marked}>
                  {marked ? "取消打回" : "打回"}
                </Btn>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!accepted ? (
        <div className="m-card-actions">
          <Btn v="primary" size="sm" disabled={busy} onClick={submit}>
            {Object.keys(rejected).length ? `打回 ${Object.keys(rejected).length} 条并重做结论` : "全部通过"}
          </Btn>
          <span className="m-quiet">自动检查未通过的项会一起带去重做。</span>
        </div>
      ) : null}
    </section>
  );
}
