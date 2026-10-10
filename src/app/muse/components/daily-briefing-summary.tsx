"use client";

import type { DailyBriefingOutput } from "@/modules/assistant-runtime/capabilities/daily-briefing";
import { fmtDateTime } from "@/shared/datetime";
import { briefingDraft, briefingPercent, briefingRatio } from "../briefing-summary";
import { I } from "./kit";

/** 默认只占一行；需要时展开真实记录，不把完整研究仪表盘放在对话入口前。 */
export function DailyBriefingSummary({
  data,
  onAction,
}: {
  data: DailyBriefingOutput;
  onAction?: (draft: string) => void;
}) {
  if (data.projectCount === 0) {
    return (
      <div className="m-briefing-empty">
        <I.plan />
        <span>开始第一个项目后，这里会汇总真实进度。</span>
        <a href="/manage">查看工作台 <span aria-hidden>↗</span></a>
      </div>
    );
  }

  return (
    <details className="m-briefing">
      <summary>
        <span className="m-briefing-mark" aria-hidden><I.plan /></span>
        <span className="m-briefing-heading">
          <small>项目简报</small>
          <strong>{data.projectTitle}</strong>
        </span>
        <span className="m-briefing-peek" data-attention={data.decisions > 0 ? "true" : undefined}>
          {data.decisions > 0 ? `${data.decisions} 项待决策` : "暂无待决策"}
        </span>
        <span className="m-briefing-toggle">
          <span className="m-briefing-open-label">展开</span>
          <span className="m-briefing-close-label">收起</span>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </summary>
      <div className="m-briefing-body">
        <dl className="m-briefing-metrics">
          <div><dt>待决策</dt><dd>{data.decisions}<small>项</small></dd><p>待负责人审查</p></div>
          <div><dt>未完成工作</dt><dd>{data.todos}<small>项</small></dd><p>不代表正在执行</p></div>
          <div><dt>已核实证据</dt><dd>{briefingRatio(data.verifiedCount, data.totalEvidence)}</dd><p>{data.totalEvidence ? `${data.gaps} 条待核实` : "尚未建立证据"}</p></div>
          <div><dt>工作验收</dt><dd>{briefingRatio(data.doneWork, data.totalWork)}</dd><p>{data.totalWork ? `${briefingPercent(data.doneWork, data.totalWork)} 已验收` : "尚未建立工作项"}</p></div>
        </dl>
        {data.suggestions.length > 0 ? (
          <section className="m-briefing-next" aria-label="建议的下一步">
            <h3>建议的下一步</h3>
            <ol>
              {data.suggestions.map((suggestion, index) => (
                <li key={`${index}-${suggestion}`}>
                  <span>{suggestion}</span>
                  {onAction ? <button type="button" data-briefing-action title="填入对话草稿，不会自动发送或执行" onClick={() => onAction(briefingDraft(data, suggestion))}>加入对话 <span aria-hidden>↗</span></button> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : <p className="m-briefing-note">这次读取的记录中没有待决策、待核实或未完成工作。</p>}
        <footer className="m-briefing-foot">
          <span>{data.scopeLabel} · 更新于 {fmtDateTime(data.generatedAt)}</span>
          <a href={data.projectId ? `/projects/${data.projectId}` : "/projects"}>查看项目 <span aria-hidden>↗</span></a>
        </footer>
      </div>
    </details>
  );
}
